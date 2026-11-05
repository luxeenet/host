import { db } from "@dokploy/server/db";
import { platformSettings } from "@dokploy/server/db/schema";
import { and, eq, like, lt, sql } from "drizzle-orm";

/**
 * 24 hours in milliseconds. GitHub webhook retries occur within hours of an outage.
 */
export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 60 seconds processing timeout. If a worker process crashed mid-flight,
 * a subsequent retry can safely take over the claim after this timeout.
 */
export const PROCESSING_TIMEOUT_MS = 60 * 1000;

export type GithubDeliveryState = "PROCESSING" | "QUEUED" | "FAILED";

export interface GithubDeliveryPayload {
	state: GithubDeliveryState;
	claimedAt: number;
	queuedAt?: number;
	failedAt?: number;
	jobIds?: string[];
	error?: string;
	expiresAt: number;
}

export interface ClaimGithubDeliveryResult {
	canProcess: boolean;
	deliveryId?: string;
	reason?: "ALREADY_QUEUED" | "CURRENTLY_PROCESSING" | "CONCURRENT_CLAIM" | "DATABASE_ERROR";
}

// In-memory cache for fast sub-millisecond lookups and test fallback
const memoryCache = new Map<string, GithubDeliveryPayload>();

export const normalizeDeliveryId = (
	deliveryIdHeader?: string | string[] | null,
): string | undefined => {
	const raw = Array.isArray(deliveryIdHeader)
		? deliveryIdHeader[0]
		: deliveryIdHeader;
	const trimmed = raw?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const getSettingKey = (deliveryId: string) =>
	`webhook:github:delivery:${deliveryId}`;

/**
 * Database-backed atomic delivery claim.
 *
 * Uses PostgreSQL UNIQUE constraint on `paas_platform_setting.key` so that
 * when concurrent requests (or multiple HatDot replicas) receive the same
 * delivery ID, exactly ONE request successfully claims the delivery.
 *
 * States:
 * - PROCESSING: Claimed by a worker; active execution.
 * - QUEUED: Deployment jobs safely enqueued in Redis/in-memory queue.
 * - FAILED: Queue rejected job or execution crashed; retry allowed.
 */
export const claimGithubDelivery = async (
	deliveryIdHeader?: string | string[] | null,
	options?: { now?: number; processingTimeoutMs?: number },
): Promise<ClaimGithubDeliveryResult> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) {
		return { canProcess: true };
	}

	const now = options?.now ?? Date.now();
	const timeoutMs = options?.processingTimeoutMs ?? PROCESSING_TIMEOUT_MS;
	const key = getSettingKey(deliveryId);

	// 1. Fast in-memory check
	const inMem = memoryCache.get(deliveryId);
	if (inMem) {
		if (inMem.state === "QUEUED") {
			return { canProcess: false, deliveryId, reason: "ALREADY_QUEUED" };
		}
		if (inMem.state === "PROCESSING" && now - inMem.claimedAt < timeoutMs) {
			return { canProcess: false, deliveryId, reason: "CURRENTLY_PROCESSING" };
		}
	}

	const newPayload: GithubDeliveryPayload = {
		state: "PROCESSING",
		claimedAt: now,
		expiresAt: now + DELIVERY_TTL_MS,
	};

	// 2. Atomic claim via PostgreSQL paas_platform_setting table
	try {
		if (db?.insert) {
			await db.insert(platformSettings).values({
				key,
				value: JSON.stringify(newPayload),
				description: "GitHub webhook delivery state",
				updatedAt: new Date(now),
			});

			memoryCache.set(deliveryId, newPayload);
			return { canProcess: true, deliveryId };
		}
	} catch (err: any) {
		const isUniqueConstraint =
			err?.code === "23505" ||
			err?.message?.includes("duplicate key") ||
			err?.message?.includes("unique constraint");

		if (!isUniqueConstraint) {
			// Fail-safe handling: database is down or connection dropped.
			// Fall back to memory cache gracefully without crashing.
			console.warn(
				`[webhook:github:delivery] Database error while inserting claim for ${deliveryId}, falling back to memory:`,
				err?.message || err,
			);
			if (inMem && inMem.state === "PROCESSING" && now - inMem.claimedAt < timeoutMs) {
				return { canProcess: false, deliveryId, reason: "CURRENTLY_PROCESSING" };
			}
			memoryCache.set(deliveryId, newPayload);
			return { canProcess: true, deliveryId };
		}

		// Row already exists in PostgreSQL: inspect state
		try {
			const row = await db.query.platformSettings?.findFirst({
				where: eq(platformSettings.key, key),
			});

			let existingPayload: GithubDeliveryPayload | null = null;
			if (row?.value) {
				try {
					existingPayload = JSON.parse(row.value);
				} catch {
					if (row.value === "processed") {
						existingPayload = {
							state: "QUEUED",
							claimedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : now,
							expiresAt: now + DELIVERY_TTL_MS,
						};
					}
				}
			}

			if (existingPayload) {
				if (existingPayload.state === "QUEUED") {
					memoryCache.set(deliveryId, existingPayload);
					return { canProcess: false, deliveryId, reason: "ALREADY_QUEUED" };
				}

				const isStale = now - existingPayload.claimedAt >= timeoutMs;
				if (existingPayload.state === "PROCESSING" && !isStale) {
					memoryCache.set(deliveryId, existingPayload);
					return { canProcess: false, deliveryId, reason: "CURRENTLY_PROCESSING" };
				}

				// If FAILED or timed-out PROCESSING, attempt atomic takeover
				const updateConditions = [eq(platformSettings.key, key)];
				if (row?.updatedAt) {
					updateConditions.push(eq(platformSettings.updatedAt, row.updatedAt));
				}

				await db
					.update(platformSettings)
					.set({
						value: JSON.stringify(newPayload),
						updatedAt: new Date(now),
					})
					.where(and(...updateConditions));

				memoryCache.set(deliveryId, newPayload);
				return { canProcess: true, deliveryId };
			}
		} catch (readErr: any) {
			console.warn(
				`[webhook:github:delivery] Database read error for delivery ${deliveryId}:`,
				readErr?.message || readErr,
			);
			memoryCache.set(deliveryId, newPayload);
			return { canProcess: true, deliveryId };
		}
	}

	memoryCache.set(deliveryId, newPayload);
	return { canProcess: true, deliveryId };
};

/**
 * Transitions delivery state from PROCESSING to QUEUED.
 * Call this strictly AFTER deployment jobs have been accepted by the queue.
 */
export const markGithubDeliveryQueued = async (
	deliveryIdHeader?: string | string[] | null,
	jobIds: string[] = [],
	options?: { now?: number },
): Promise<void> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) return;

	const now = options?.now ?? Date.now();
	const key = getSettingKey(deliveryId);
	const existing = memoryCache.get(deliveryId);

	const payload: GithubDeliveryPayload = {
		state: "QUEUED",
		claimedAt: existing?.claimedAt ?? now,
		queuedAt: now,
		jobIds,
		expiresAt: now + DELIVERY_TTL_MS,
	};

	memoryCache.set(deliveryId, payload);

	try {
		if (db?.update) {
			await db
				.update(platformSettings)
				.set({
					value: JSON.stringify(payload),
					updatedAt: new Date(now),
				})
				.where(eq(platformSettings.key, key));
		}
	} catch (err: any) {
		console.warn(
			`[webhook:github:delivery] Failed to record QUEUED in DB for ${deliveryId}:`,
			err?.message || err,
		);
	}
};

/**
 * Transitions delivery state to FAILED.
 * Allows subsequent GitHub retries to safely reclaim and retry the delivery.
 */
export const markGithubDeliveryFailed = async (
	deliveryIdHeader?: string | string[] | null,
	error?: unknown,
	options?: { now?: number },
): Promise<void> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) return;

	const now = options?.now ?? Date.now();
	const key = getSettingKey(deliveryId);
	const existing = memoryCache.get(deliveryId);
	const errorMessage =
		error instanceof Error ? error.message : String(error ?? "Unknown error");

	const payload: GithubDeliveryPayload = {
		state: "FAILED",
		claimedAt: existing?.claimedAt ?? now,
		failedAt: now,
		error: errorMessage,
		expiresAt: now + DELIVERY_TTL_MS,
	};

	memoryCache.set(deliveryId, payload);

	try {
		if (db?.update) {
			await db
				.update(platformSettings)
				.set({
					value: JSON.stringify(payload),
					updatedAt: new Date(now),
				})
				.where(eq(platformSettings.key, key));
		}
	} catch (err: any) {
		console.warn(
			`[webhook:github:delivery] Failed to record FAILED in DB for ${deliveryId}:`,
			err?.message || err,
		);
	}
};

/**
 * Cleans up delivery records older than 24 hours.
 *
 * CRITICAL SAFETY INVARIANTS:
 * 1. ONLY deletes keys starting with 'webhook:github:delivery:' (never general platform settings).
 * 2. NEVER deletes active PROCESSING records (only deletes records updated > 24 hours ago).
 * 3. Fails safe if database is unavailable.
 */
export const cleanupExpiredGithubDeliveries = async (
	now = Date.now(),
): Promise<number> => {
	// Clean in-memory cache
	for (const [id, record] of memoryCache.entries()) {
		if (record.expiresAt && now >= record.expiresAt) {
			memoryCache.delete(id);
		}
	}

	const expiredThreshold = new Date(now - DELIVERY_TTL_MS);

	try {
		if (db?.delete) {
			const res = await db
				.delete(platformSettings)
				.where(
					and(
						like(platformSettings.key, "webhook:github:delivery:%"),
						lt(platformSettings.updatedAt, expiredThreshold),
					),
				);
			return (res as any)?.rowCount ?? 0;
		}
	} catch (err: any) {
		console.warn(
			"[webhook:github:delivery] Expiration cleanup failed safely:",
			err?.message || err,
		);
	}
	return 0;
};

/**
 * Check if delivery is a duplicate.
 */
export const isGithubDeliveryDuplicate = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<{ isDuplicate: boolean; deliveryId?: string }> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) return { isDuplicate: false };

	const inMem = memoryCache.get(deliveryId);
	if (inMem && (inMem.state === "QUEUED" || inMem.state === "PROCESSING")) {
		return { isDuplicate: true, deliveryId };
	}

	try {
		const key = getSettingKey(deliveryId);
		const row = await db.query.platformSettings?.findFirst({
			where: eq(platformSettings.key, key),
		});

		if (row?.value) {
			try {
				const parsed = JSON.parse(row.value);
				if (parsed.state === "QUEUED" || parsed.state === "PROCESSING") {
					return { isDuplicate: true, deliveryId };
				}
			} catch {
				if (row.value === "processed") {
					return { isDuplicate: true, deliveryId };
				}
			}
		}
	} catch {
		// Fall through to in-memory check
	}

	return { isDuplicate: false, deliveryId };
};

/**
 * Backward compatibility aliases.
 */
export const markGithubDeliveryProcessed = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<void> => {
	await markGithubDeliveryQueued(deliveryIdHeader);
};

export const checkAndRecordGithubDelivery = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<{ isDuplicate: boolean; deliveryId?: string }> => {
	const claim = await claimGithubDelivery(deliveryIdHeader);
	if (!claim.canProcess) {
		return { isDuplicate: true, deliveryId: claim.deliveryId };
	}
	if (claim.deliveryId) {
		await markGithubDeliveryQueued(claim.deliveryId);
	}
	return { isDuplicate: false, deliveryId: claim.deliveryId };
};

export const _clearDeliveryCacheForTesting = () => {
	memoryCache.clear();
};

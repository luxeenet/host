import { db } from "@dokploy/server/db";
import { platformSettings } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * 24 hours in milliseconds. GitHub webhook retries occur within hours of an outage.
 */
const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

interface DeliveryRecord {
	timestamp: number;
}

// In-memory cache for fast sub-millisecond lookups and test fallback
const memoryCache = new Map<string, DeliveryRecord>();

const normalizeDeliveryId = (
	deliveryIdHeader?: string | string[] | null,
): string | undefined => {
	const raw = Array.isArray(deliveryIdHeader)
		? deliveryIdHeader[0]
		: deliveryIdHeader;
	const trimmed = raw?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const getSettingKey = (deliveryId: string) =>
	`webhook:github:delivery:${deliveryId}`;

/**
 * Checks if a GitHub webhook delivery (identified by x-github-delivery UUID)
 * has already been processed within the last 24 hours.
 *
 * Checks in-memory cache first, then PostgreSQL (paas_platform_setting) so
 * all HatDot cluster replicas share atomic delivery state.
 *
 * Does NOT mark the delivery as processed. Delivery must only be marked
 * processed after deployment jobs are successfully enqueued.
 */
export const isGithubDeliveryDuplicate = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<{ isDuplicate: boolean; deliveryId?: string }> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) {
		return { isDuplicate: false };
	}

	const now = Date.now();

	// 1. Check in-memory cache
	const inMem = memoryCache.get(deliveryId);
	if (inMem && now - inMem.timestamp < DELIVERY_TTL_MS) {
		return { isDuplicate: true, deliveryId };
	}

	// 2. Check PostgreSQL paas_platform_setting table (shared across all replicas)
	try {
		const key = getSettingKey(deliveryId);
		const row = await db.query.platformSettings?.findFirst({
			where: eq(platformSettings.key, key),
		});

		if (row && row.updatedAt) {
			const recordTime = new Date(row.updatedAt).getTime();
			if (now - recordTime < DELIVERY_TTL_MS) {
				memoryCache.set(deliveryId, { timestamp: recordTime });
				return { isDuplicate: true, deliveryId };
			}
		}
	} catch {
		// Fall through: if DB query fails, fallback to in-memory state
	}

	return { isDuplicate: false, deliveryId };
};

/**
 * Atomically marks a GitHub webhook delivery as processed in PostgreSQL and memory.
 * Call this ONLY AFTER deployment jobs have been safely accepted by the queue.
 */
export const markGithubDeliveryProcessed = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<void> => {
	const deliveryId = normalizeDeliveryId(deliveryIdHeader);
	if (!deliveryId) {
		return;
	}

	const now = Date.now();
	memoryCache.set(deliveryId, { timestamp: now });

	// Persist to PostgreSQL paas_platform_setting
	try {
		const key = getSettingKey(deliveryId);
		await db
			?.insert(platformSettings)
			?.values({
				key,
				value: "processed",
				description: "GitHub webhook delivery deduplication marker",
				updatedAt: new Date(now),
			})
			?.onConflictDoUpdate({
				target: platformSettings.key,
				set: { updatedAt: new Date(now) },
			});
	} catch {
		// Fall through: in-memory recorded; non-fatal if DB write fails
	}
};

/**
 * Combined check-and-record helper for backward compatibility.
 */
export const checkAndRecordGithubDelivery = async (
	deliveryIdHeader?: string | string[] | null,
): Promise<{ isDuplicate: boolean; deliveryId?: string }> => {
	const check = await isGithubDeliveryDuplicate(deliveryIdHeader);
	if (check.isDuplicate) {
		return check;
	}
	if (check.deliveryId) {
		await markGithubDeliveryProcessed(check.deliveryId);
	}
	return check;
};

/**
 * Helper strictly for testing.
 */
export const _clearDeliveryCacheForTesting = () => {
	memoryCache.clear();
};

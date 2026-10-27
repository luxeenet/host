/**
 * Cloudflare for SaaS Background Status Reconciliation Service
 *
 * Periodically reconciles Cloudflare Custom Hostname ownership verification
 * and SSL certificate issuance states in the background.
 */

import { db } from "@dokploy/server/db";
import { domains } from "../db/schema/domain";
import { and, isNotNull, ne, or, sql } from "drizzle-orm";
import {
	isCloudflareSaasActive,
	syncCustomHostnameStatus,
} from "./cloudflare-saas-service";

let isReconciliationRunning = false;
let syncIntervalTimer: NodeJS.Timeout | null = null;

export interface ReconciliationResult {
	processed: number;
	updated: number;
	errors: Array<{ domainId: string; host: string; error: string }>;
}

/**
 * Perform a single reconciliation pass over pending or stale Cloudflare custom hostnames.
 * Protected by concurrency guard to prevent overlapping runs.
 */
export const reconcileCloudflareHostnames = async (options?: {
	forceAll?: boolean;
	fetchImpl?: typeof fetch;
	batchSize?: number;
}): Promise<ReconciliationResult> => {
	if (isReconciliationRunning) {
		return { processed: 0, updated: 0, errors: [] };
	}

	isReconciliationRunning = true;
	const errors: Array<{ domainId: string; host: string; error: string }> = [];
	let processed = 0;
	let updated = 0;

	try {
		const active = await isCloudflareSaasActive();
		if (!active) {
			return { processed: 0, updated: 0, errors: [] };
		}

		const batchLimit = options?.batchSize ?? 50;

		// Select domains with a Cloudflare hostname ID that either:
		// 1. Are not yet fully active (hostname != 'active' OR ssl != 'active')
		// 2. Or haven't been synced in over 1 hour
		// 3. Or forceAll is true
		const queryCondition = options?.forceAll
			? isNotNull(domains.cfHostnameId)
			: and(
					isNotNull(domains.cfHostnameId),
					or(
						ne(domains.cfStatus, "active"),
						ne(domains.cfSslStatus, "active"),
						sql`${domains.cfStatus} IS NULL`,
						sql`${domains.cfSslStatus} IS NULL`,
						sql`${domains.cfLastSyncAt} < NOW() - INTERVAL '1 hour'`,
						sql`${domains.cfLastSyncAt} IS NULL`,
					),
			  );

		const pendingDomains = await db
			.select({
				domainId: domains.domainId,
				host: domains.host,
				cfStatus: domains.cfStatus,
				cfSslStatus: domains.cfSslStatus,
			})
			.from(domains)
			.where(queryCondition)
			.limit(batchLimit);

		for (const domain of pendingDomains) {
			processed++;
			try {
				const result = await syncCustomHostnameStatus(domain.domainId, {
					fetchImpl: options?.fetchImpl,
				});

				if (
					result.cfStatus !== domain.cfStatus ||
					result.cfSslStatus !== domain.cfSslStatus
				) {
					updated++;
				}

				// Gentle pause between API requests to respect Cloudflare rate limits
				await new Promise((r) => setTimeout(r, 100));
			} catch (err: any) {
				errors.push({
					domainId: domain.domainId,
					host: domain.host,
					error: err?.message || "Reconciliation failed",
				});
			}
		}

		return { processed, updated, errors };
	} finally {
		isReconciliationRunning = false;
	}
};

/**
 * Start the background reconciliation timer.
 * Default polling frequency: every 2 minutes.
 */
export const startCloudflareSaasSyncJob = (
	intervalMinutes: number = 2,
): void => {
	if (syncIntervalTimer) {
		return;
	}

	const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

	// Initial reconciliation pass 10 seconds after server boot
	setTimeout(() => {
		reconcileCloudflareHostnames().catch((err) =>
			console.error("[Cloudflare SaaS] Initial reconciliation error:", err),
		);
	}, 10000);

	// Recurring timer
	syncIntervalTimer = setInterval(() => {
		reconcileCloudflareHostnames().catch((err) =>
			console.error("[Cloudflare SaaS] Periodic reconciliation error:", err),
		);
	}, intervalMs);

	console.log(
		`[Cloudflare SaaS] Background hostname status reconciliation started (every ${intervalMinutes}m).`,
	);
};

export const stopCloudflareSaasSyncJob = (): void => {
	if (syncIntervalTimer) {
		clearInterval(syncIntervalTimer);
		syncIntervalTimer = null;
		console.log("[Cloudflare SaaS] Background reconciliation stopped.");
	}
};

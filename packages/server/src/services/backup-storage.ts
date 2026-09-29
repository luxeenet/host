import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import { backupStorageRecords } from "../db/schema/backup-storage";
import { destinations } from "../db/schema/destination";
import { logger } from "../lib/logger";
import { PlanEntitlementService } from "./plan-entitlement";

export interface ReserveBackupStorageInput {
	organizationId: string;
	destinationId: string;
	backupId?: string | null;
	objectKey: string;
	bytes: number;
}

export class BackupStorageService {
	/**
	 * Compute the authoritative active backup storage usage in bytes for an organization.
	 * Includes:
	 * - All committed backup files
	 * - Active in-flight reservations that have not yet expired
	 * Excludes:
	 * - Deleted files
	 * - Expired reservations (crash safety)
	 */
	static async getOrganizationBackupStorageUsage(
		organizationId: string,
		executor: any = db,
	): Promise<number> {
		const now = new Date();
		const result = await executor
			.select({
				totalBytes: sql<string>`COALESCE(SUM(${backupStorageRecords.bytes}), 0)`,
			})
			.from(backupStorageRecords)
			.where(
				and(
					eq(backupStorageRecords.organizationId, organizationId),
					or(
						eq(backupStorageRecords.status, "committed"),
						and(
							eq(backupStorageRecords.status, "reserved"),
							or(
								isNull(backupStorageRecords.expiresAt),
								gte(backupStorageRecords.expiresAt, now),
							),
						),
					),
				),
			);

		const totalBytes = Number(result[0]?.totalBytes ?? 0);
		return Math.max(0, totalBytes);
	}

	/**
	 * Atomically verify plan quota and reserve backup storage capacity before starting an upload.
	 * Runs inside `PlanEntitlementService.withAtomicQuotaLock` with an advisory lock on the organization.
	 */
	static async reserveBackupStorage(
		input: ReserveBackupStorageInput,
		executor: any = db,
	): Promise<typeof backupStorageRecords.$inferSelect> {
		const { organizationId, destinationId, backupId, objectKey, bytes } = input;

		return await PlanEntitlementService.withAtomicQuotaLock(
			organizationId,
			async (tx) => {
				const txOrDb = tx?.insert ? tx : (executor?.insert ? executor : db);

				const activeCheck =
					await PlanEntitlementService.checkSubscriptionActive(
						organizationId,
						txOrDb,
					);
				if (!activeCheck.allowed) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message:
							activeCheck.reason ??
							"Active subscription required for backup operations.",
					});
				}

				const snapshot = await PlanEntitlementService.getPlanSnapshot(
					organizationId,
					txOrDb,
				);
				if (!snapshot) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "No active plan found for this organization.",
					});
				}

				const limitGb = snapshot.resources["backup_storage_gb"] ?? -1;

				if (limitGb !== -1) {
					const limitBytes = limitGb * 1024 * 1024 * 1024;
					const currentUsageBytes =
						await BackupStorageService.getOrganizationBackupStorageUsage(
							organizationId,
							txOrDb,
						);
					const projectedUsageBytes = currentUsageBytes + bytes;

					if (projectedUsageBytes > limitBytes) {
						const limitGbFormatted =
							limitGb >= 1 ? `${limitGb} GB` : `${Math.round(limitGb * 1024)} MB`;
						const currentMbFormatted = (
							currentUsageBytes /
							(1024 * 1024)
						).toFixed(2);
						const requestedMbFormatted = (bytes / (1024 * 1024)).toFixed(2);

						logger.warn(
							{
								organizationId,
								destinationId,
								backupId,
								objectKey,
								bytes,
								currentUsageBytes,
								limitBytes,
							},
							"Backup quota reservation rejected: storage limit exceeded",
						);

						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Backup storage limit exceeded. Your plan allows ${limitGbFormatted} of backup storage (currently using ${currentMbFormatted} MB), but this backup requires an additional ${requestedMbFormatted} MB. Please upgrade your plan or delete older backups.`,
						});
					}
				}

				// Create in-flight reservation with 2-hour TTL
				const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
				const [record] = await txOrDb
					.insert(backupStorageRecords)
					.values({
						organizationId,
						destinationId,
						backupId: backupId ?? null,
						objectKey,
						bytes,
						status: "reserved",
						expiresAt,
					})
					.returning();

				logger.info(
					{
						reservationId: record.id,
						organizationId,
						destinationId,
						objectKey,
						bytes,
						limitGb,
					},
					"Backup quota reservation approved and created",
				);

				return record;
			},
			executor,
		);
	}

	/**
	 * Mark a reservation as committed following a successful backup upload.
	 */
	static async commitBackupStorage(
		recordId: string,
		finalBytes?: number,
		executor: any = db,
	): Promise<void> {
		const updateValues: Partial<typeof backupStorageRecords.$inferInsert> = {
			status: "committed",
			expiresAt: null,
			updatedAt: new Date(),
		};

		if (finalBytes !== undefined) {
			updateValues.bytes = finalBytes;
		}

		await executor
			.update(backupStorageRecords)
			.set(updateValues)
			.where(eq(backupStorageRecords.id, recordId));

		logger.info(
			{ recordId, finalBytes },
			"Backup quota reservation committed successfully",
		);
	}

	/**
	 * Release an in-flight reservation following an upload failure.
	 */
	static async releaseBackupStorage(
		recordId: string,
		executor: any = db,
	): Promise<void> {
		await executor
			.update(backupStorageRecords)
			.set({
				status: "deleted",
				updatedAt: new Date(),
			})
			.where(eq(backupStorageRecords.id, recordId));

		logger.info(
			{ recordId },
			"Backup quota reservation released due to error/cleanup",
		);
	}

	/**
	 * Mark one or more backup objects as deleted following retention cleanup.
	 */
	static async markBackupsDeleted(
		destinationId: string,
		objectKeys: string[],
		executor: any = db,
	): Promise<void> {
		if (objectKeys.length === 0) return;

		await executor
			.update(backupStorageRecords)
			.set({
				status: "deleted",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(backupStorageRecords.destinationId, destinationId),
					inArray(backupStorageRecords.objectKey, objectKeys),
				),
			);

		logger.info(
			{ destinationId, count: objectKeys.length },
			"Backup storage records marked as deleted following retention cleanup",
		);
	}

	/**
	 * Reconcile backup storage records against remote object storage for a destination.
	 * Discovers Dokploy backup files, reconciles exact byte counts, marks removed files as deleted,
	 * and removes stale reservations.
	 */
	static async reconcileDestination(
		destinationId: string,
		rcloneListingJson?: Array<{ Path: string; Size: number; IsDir?: boolean }>,
		executor: any = db,
	): Promise<{
		reconciledCount: number;
		deletedCount: number;
		totalBytes: number;
	}> {
		const dest = await executor.query.destinations.findFirst({
			where: eq(destinations.destinationId, destinationId),
		});

		if (!dest) {
			return { reconciledCount: 0, deletedCount: 0, totalBytes: 0 };
		}

		const organizationId = dest.organizationId;
		const now = new Date();

		// Expire old pending reservations (> 2 hours)
		await executor
			.update(backupStorageRecords)
			.set({
				status: "deleted",
				updatedAt: now,
			})
			.where(
				and(
					eq(backupStorageRecords.destinationId, destinationId),
					eq(backupStorageRecords.status, "reserved"),
					or(
						isNull(backupStorageRecords.expiresAt),
						sql`${backupStorageRecords.expiresAt} < ${now}`,
					),
				),
			);

		if (!rcloneListingJson) {
			const totalUsage = await this.getOrganizationBackupStorageUsage(
				organizationId,
				executor,
			);
			return { reconciledCount: 0, deletedCount: 0, totalBytes: totalUsage };
		}

		// Filter for valid Dokploy backup files
		const validBackupFiles = rcloneListingJson.filter((item) => {
			if (item.IsDir) return false;
			const p = item.Path.toLowerCase();
			return (
				p.endsWith(".sql.gz") ||
				p.endsWith(".bson.gz") ||
				p.endsWith(".zip") ||
				p.endsWith(".tar") ||
				p.endsWith(".dump")
			);
		});

		const remoteKeys = new Set(validBackupFiles.map((f) => f.Path));
		let totalBytes = 0;

		// Upsert or update each remote object as committed
		for (const file of validBackupFiles) {
			totalBytes += file.Size;
			const existing = await executor.query.backupStorageRecords.findFirst({
				where: and(
					eq(backupStorageRecords.destinationId, destinationId),
					eq(backupStorageRecords.objectKey, file.Path),
				),
			});

			if (existing) {
				await executor
					.update(backupStorageRecords)
					.set({
						status: "committed",
						bytes: file.Size,
						expiresAt: null,
						updatedAt: now,
					})
					.where(eq(backupStorageRecords.id, existing.id));
			} else {
				await executor.insert(backupStorageRecords).values({
					organizationId,
					destinationId,
					objectKey: file.Path,
					bytes: file.Size,
					status: "committed",
					expiresAt: null,
				});
			}
		}

		// Mark any database records for this destination that are no longer in S3 as deleted
		const allDbRecords = await executor.query.backupStorageRecords.findMany({
			where: and(
				eq(backupStorageRecords.destinationId, destinationId),
				eq(backupStorageRecords.status, "committed"),
			),
		});

		let deletedCount = 0;
		for (const record of allDbRecords) {
			if (!remoteKeys.has(record.objectKey)) {
				await executor
					.update(backupStorageRecords)
					.set({
						status: "deleted",
						updatedAt: now,
					})
					.where(eq(backupStorageRecords.id, record.id));
				deletedCount++;
			}
		}

		logger.info(
			{
				destinationId,
				organizationId,
				reconciledCount: validBackupFiles.length,
				deletedCount,
				totalBytes,
			},
			"Backup storage destination reconciled successfully",
		);

		return {
			reconciledCount: validBackupFiles.length,
			deletedCount,
			totalBytes,
		};
	}
}

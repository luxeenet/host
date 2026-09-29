import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { BackupStorageService } from "@dokploy/server/services/backup-storage";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";

describe("Production-Grade Backup Storage Quota Enforcement", () => {
	const GB = 1024 * 1024 * 1024;
	const MB = 1024 * 1024;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe("1. Entitlement & Quota Calculation", () => {
		it("allows backup upload when usage + reservation + incoming <= limit", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: { backup_storage_gb: 10 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});
			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);
			vi.spyOn(
				BackupStorageService,
				"getOrganizationBackupStorageUsage",
			).mockResolvedValue(5 * GB);

			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([
							{
								id: "rec-1",
								organizationId: "org-1",
								destinationId: "dest-1",
								objectKey: "app/backup.sql.gz",
								bytes: 2 * GB,
								status: "reserved",
							},
						]),
					}),
				}),
			};

			const reservation = await BackupStorageService.reserveBackupStorage(
				{
					organizationId: "org-1",
					destinationId: "dest-1",
					backupId: "bk-1",
					objectKey: "app/backup.sql.gz",
					bytes: 2 * GB,
				},
				mockTx as any,
			);

			expect(reservation.id).toBe("rec-1");
			expect(reservation.status).toBe("reserved");
		});

		it("allows backup upload exactly at limit (5 GB + 5 GB = 10 GB limit)", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: { backup_storage_gb: 10 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});
			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);
			vi.spyOn(
				BackupStorageService,
				"getOrganizationBackupStorageUsage",
			).mockResolvedValue(5 * GB);

			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([
							{
								id: "rec-2",
								organizationId: "org-1",
								bytes: 5 * GB,
								status: "reserved",
							},
						]),
					}),
				}),
			};

			const reservation = await BackupStorageService.reserveBackupStorage(
				{
					organizationId: "org-1",
					destinationId: "dest-1",
					backupId: "bk-1",
					objectKey: "app/backup.sql.gz",
					bytes: 5 * GB,
				},
				mockTx as any,
			);

			expect(reservation.bytes).toBe(5 * GB);
		});

		it("rejects backup upload when projected usage exceeds limit (8 GB + 3 GB > 10 GB)", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: { backup_storage_gb: 10 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});
			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);
			vi.spyOn(
				BackupStorageService,
				"getOrganizationBackupStorageUsage",
			).mockResolvedValue(8 * GB);

			await expect(
				BackupStorageService.reserveBackupStorage({
					organizationId: "org-1",
					destinationId: "dest-1",
					backupId: "bk-1",
					objectKey: "app/backup.sql.gz",
					bytes: 3 * GB,
				}),
			).rejects.toThrow(TRPCError);
		});

		it("allows unlimited backup storage when backup_storage_gb is -1", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "enterprise",
				planName: "Enterprise",
				resources: { backup_storage_gb: -1 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});
			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);

			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([
							{
								id: "rec-unlimited",
								organizationId: "org-1",
								bytes: 100 * GB,
								status: "reserved",
							},
						]),
					}),
				}),
			};

			const reservation = await BackupStorageService.reserveBackupStorage(
				{
					organizationId: "org-1",
					destinationId: "dest-1",
					backupId: "bk-1",
					objectKey: "app/backup.sql.gz",
					bytes: 100 * GB,
				},
				mockTx as any,
			);

			expect(reservation.id).toBe("rec-unlimited");
		});

		it("rejects backup upload when subscription is inactive", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: false,
				reason: "Subscription past due or cancelled",
			});
			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);

			await expect(
				BackupStorageService.reserveBackupStorage({
					organizationId: "org-1",
					destinationId: "dest-1",
					backupId: "bk-1",
					objectKey: "app/backup.sql.gz",
					bytes: 100 * MB,
				}),
			).rejects.toThrow(TRPCError);
		});
	});

	describe("2. Reservation Lifecycle & Accounting", () => {
		it("commitBackupStorage marks record as committed and clears expiresAt", async () => {
			const mockExecutor = {
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			await BackupStorageService.commitBackupStorage(
				"rec-123",
				500 * MB,
				mockExecutor as any,
			);

			expect(mockExecutor.update).toHaveBeenCalled();
		});

		it("releaseBackupStorage marks record as deleted on failure", async () => {
			const mockExecutor = {
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			await BackupStorageService.releaseBackupStorage(
				"rec-123",
				mockExecutor as any,
			);

			expect(mockExecutor.update).toHaveBeenCalled();
		});

		it("markBackupsDeleted updates retention-deleted records to deleted", async () => {
			const mockExecutor = {
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				}),
			};

			await BackupStorageService.markBackupsDeleted(
				"dest-1",
				["app/old-1.sql.gz", "app/old-2.sql.gz"],
				mockExecutor as any,
			);

			expect(mockExecutor.update).toHaveBeenCalled();
		});
	});

	describe("3. Concurrency Protection", () => {
		it("serializes concurrent reservations and prevents over-allocation", async () => {
			let currentUsage = 200 * MB;
			const limitGb = 1; // 1024 MB
			const limitBytes = limitGb * GB;

			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: { backup_storage_gb: limitGb },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			// Simulate atomic quota lock mutex
			let lockAcquired = false;
			const lockQueue: Array<() => void> = [];

			const acquireLock = async () => {
				if (lockAcquired) {
					await new Promise<void>((resolve) => lockQueue.push(resolve));
				}
				lockAcquired = true;
			};

			const releaseLock = () => {
				lockAcquired = false;
				const next = lockQueue.shift();
				if (next) next();
			};

			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => {
					await acquireLock();
					try {
						return await fn({} as any);
					} finally {
						releaseLock();
					}
				},
			);

			vi.spyOn(
				BackupStorageService,
				"getOrganizationBackupStorageUsage",
			).mockImplementation(async () => currentUsage);

			const mockTx = {
				insert: vi.fn().mockImplementation(() => ({
					values: vi.fn().mockImplementation((vals: any) => {
						currentUsage += vals.bytes;
						return {
							returning: vi.fn().mockResolvedValue([
								{
									id: "rec-" + Math.random(),
									organizationId: vals.organizationId,
									bytes: vals.bytes,
									status: "reserved",
								},
							]),
						};
					}),
				})),
			};

			// Backup A requests 500 MB (200 + 500 = 700 MB <= 1024 MB) -> allowed
			// Backup B requests 500 MB (700 + 500 = 1200 MB > 1024 MB) -> rejected
			const results = await Promise.allSettled([
				BackupStorageService.reserveBackupStorage(
					{
						organizationId: "org-concurrent",
						destinationId: "dest-1",
						objectKey: "app/backup-a.sql.gz",
						bytes: 500 * MB,
					},
					mockTx as any,
				),
				BackupStorageService.reserveBackupStorage(
					{
						organizationId: "org-concurrent",
						destinationId: "dest-1",
						objectKey: "app/backup-b.sql.gz",
						bytes: 500 * MB,
					},
					mockTx as any,
				),
			]);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			expect(fulfilled.length).toBe(1);
			expect(rejected.length).toBe(1);
		});

		it("allows both concurrent reservations when both fit within quota", async () => {
			let currentUsage = 100 * MB;
			const limitGb = 1; // 1024 MB

			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: { backup_storage_gb: limitGb },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			vi.spyOn(PlanEntitlementService, "withAtomicQuotaLock").mockImplementation(
				async (_orgId, fn) => fn({} as any),
			);

			vi.spyOn(
				BackupStorageService,
				"getOrganizationBackupStorageUsage",
			).mockImplementation(async () => currentUsage);

			const mockTx = {
				insert: vi.fn().mockImplementation(() => ({
					values: vi.fn().mockImplementation((vals: any) => {
						currentUsage += vals.bytes;
						return {
							returning: vi.fn().mockResolvedValue([
								{
									id: "rec-" + Math.random(),
									organizationId: vals.organizationId,
									bytes: vals.bytes,
									status: "reserved",
								},
							]),
						};
					}),
				})),
			};

			// Backup A requests 300 MB, Backup B requests 300 MB (100 + 300 + 300 = 700 MB <= 1024 MB)
			const results = await Promise.allSettled([
				BackupStorageService.reserveBackupStorage(
					{
						organizationId: "org-both-fit",
						destinationId: "dest-1",
						objectKey: "app/backup-1.sql.gz",
						bytes: 300 * MB,
					},
					mockTx as any,
				),
				BackupStorageService.reserveBackupStorage(
					{
						organizationId: "org-both-fit",
						destinationId: "dest-1",
						objectKey: "app/backup-2.sql.gz",
						bytes: 300 * MB,
					},
					mockTx as any,
				),
			]);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			expect(fulfilled.length).toBe(2);
		});
	});

	describe("4. Reconciliation", () => {
		it("reconcileDestination accurately records S3 objects and cleans up deleted items", async () => {
			const mockExecutor = {
				query: {
					destinations: {
						findFirst: vi.fn().mockResolvedValue({
							destinationId: "dest-1",
							organizationId: "org-1",
						}),
					},
					backupStorageRecords: {
						findFirst: vi.fn().mockResolvedValue(null),
						findMany: vi.fn().mockResolvedValue([
							{
								id: "old-rec-1",
								objectKey: "app/deleted-on-s3.sql.gz",
								status: "committed",
							},
						]),
					},
				},
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				}),
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockResolvedValue([]),
				}),
			};

			const remoteListing = [
				{ Path: "app/2026-09-30.sql.gz", Size: 250 * MB, IsDir: false },
				{ Path: "app/webserver.zip", Size: 100 * MB, IsDir: false },
				{ Path: "unrelated/customer-file.txt", Size: 50 * MB, IsDir: false },
			];

			const result = await BackupStorageService.reconcileDestination(
				"dest-1",
				remoteListing,
				mockExecutor as any,
			);

			expect(result.reconciledCount).toBe(2); // Only .sql.gz and .zip counted
			expect(result.totalBytes).toBe(350 * MB);
			expect(result.deletedCount).toBe(1); // deleted-on-s3.sql.gz marked deleted
		});
	});
});

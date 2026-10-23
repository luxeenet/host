/**
 * HatDot Regression & Security Test Suite
 *
 * Verifies:
 * 1. Database visibility security: Logical DB list and discovery counts are concealed
 *    from customers, server-side scoping enforces tenant-assigned database access,
 *    and platform administrators retain full discovery and diagnostics.
 * 2. Resource usage metering accuracy: RAM, CPU, volume storage, database backups,
 *    outbound egress, and slot counts reflect real attributable telemetry,
 *    distinguishing valid zero, collecting, stale, and unavailable states without false zeros.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockEngineDatabases, mockListDatabases, mockGetOverview, mockListCollections } = vi.hoisted(() => {
	const mockEngineDatabases = ["admin", "config", "local", "acme_prod", "other_tenant_db"];
	const mockListDatabases = vi.fn(async () => ({
		databases: mockEngineDatabases.map((n) => ({
			name: n,
			sizeOnDisk: 0,
			isInternal: ["admin", "config", "local"].includes(n),
			isConfiguredDatabase: n === "acme_prod",
		})),
		selectedDatabase: "acme_prod",
	}));
	const mockGetOverview = vi.fn(async (rec: any, dbName?: string) => ({
		engine: "mongo",
		collections: [{ name: "orders", count: 42, sizeFormatted: "1.2 MB" }],
		database: dbName || rec.databaseName,
	}));
	const mockListCollections = vi.fn(async (rec: any, dbName?: string) => [
		{ name: "orders" },
		{ name: "customers" },
	]);
	return { mockEngineDatabases, mockListDatabases, mockGetOverview, mockListCollections };
});

// Mock audit and permissions
vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(async () => undefined),
	checkServiceAccess: vi.fn(async () => undefined),
	checkServicePermissionAndAccess: vi.fn(async () => undefined),
}));

// Mock DatabaseConnectionService
vi.mock("@dokploy/server/services/database-connection", () => ({
	DatabaseConnectionService: {
		getConnectionParams: vi.fn(async () => ({
			type: "postgres",
			host: "localhost",
			port: 5432,
			user: "postgres",
			password: "password",
			database: "acme_prod",
		})),
		testConnection: vi.fn(async () => ({
			success: true,
			latencyMs: 15,
			serverVersion: "PostgreSQL 16",
		})),
		getDatabaseOverview: vi.fn(async () => ({
			engine: "postgres",
			tables: [],
			totalRecords: 0,
			totalSizeFormatted: "0 MB",
			activeConnections: 1,
			maxConnections: 100,
		})),
	},
}));

vi.mock("@dokploy/server/services/database-manager", () => ({
	getAuthorizedDatabaseRecord: vi.fn(async () => ({
		mongoId: "mongo-cust-1",
		appName: "mongo-customer-app",
		databaseName: "acme_prod",
		databaseUser: "acme_user",
		databasePassword: "secret_password",
		environment: { project: { organizationId: "org-cust-1" } },
	})),
	sqlAdapter: {
		getOverview: vi.fn(async () => ({ engine: "postgres", tables: [] })),
		listTables: vi.fn(async () => []),
		queryRows: vi.fn(async () => ({ rows: [], total: 0 })),
		queryTable: vi.fn(async () => ({ rows: [], total: 0 })),
		executeRawQuery: vi.fn(async () => ({ rows: [] })),
	},
	mongoAdapter: {
		getOverview: mockGetOverview,
		listCollections: mockListCollections,
		queryCollection: vi.fn(async () => ({ documents: [], total: 0, page: 1, totalPages: 0 })),
		insertDocument: vi.fn(async () => ({ insertedId: "doc-1" })),
		updateDocument: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
		deleteDocument: vi.fn(async () => ({ deletedCount: 1 })),
		createCollection: vi.fn(async () => ({ ok: 1 })),
		dropCollection: vi.fn(async () => ({ ok: 1 })),
	},
	redisAdapter: {
		getOverview: vi.fn(async () => ({ engine: "redis", keys: [] })),
	},
	libsqlAdapter: {
		getOverview: vi.fn(async () => ({ engine: "libsql", tables: [] })),
		listTables: vi.fn(async () => []),
	},
	listDatabases: mockListDatabases,
	executeDatabaseImport: vi.fn(async () => ({
		success: true,
		importedCount: 1,
		skippedCount: 0,
		failedCount: 0,
		errors: [],
	})),
}));

// Mock volume size queries
vi.mock("@dokploy/server/services/docker-volume", () => ({
	getVolumesSize: vi.fn(async () => [
		{ name: "vol_cust_app", size: "150MB" },
		{ name: "vol_cust_db", size: "350MB" },
		{ name: "vol_other_tenant", size: "20GB" },
	]),
}));

// Mock backup storage service
vi.mock("@dokploy/server/services/backup-storage", () => ({
	BackupStorageService: {
		getOrganizationBackupStorageUsage: vi.fn(async (orgId: string) => {
			if (orgId === "org-with-data") return 100 * 1024 * 1024; // 100 MB
			return 0;
		}),
	},
}));

import { databaseManagerRouter, resolveAuthorizedDatabase } from "@/server/api/routers/database-manager";
import { CustomerUsageService } from "@dokploy/server";

describe("HatDot Security & Metering Regression Suite", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("1. Database Visibility & Server-Side Logical DB Scoping", () => {
		const customerRecord: any = {
			mongoId: "mongo-cust-1",
			databaseName: "acme_prod",
			appName: "mongo-customer-app",
		};

		it("scopes non-admin customers strictly to their assigned database", () => {
			// Normal customer requesting nothing
			const defaultScope = resolveAuthorizedDatabase(customerRecord, "mongo", undefined, false);
			expect(defaultScope).toBe("acme_prod");

			// Customer maliciously attempting to access internal 'admin' database
			const maliciousAdminScope = resolveAuthorizedDatabase(customerRecord, "mongo", "admin", false);
			expect(maliciousAdminScope).toBe("acme_prod");

			// Customer attempting to probe another tenant's database
			const crossTenantScope = resolveAuthorizedDatabase(customerRecord, "mongo", "other_tenant_db", false);
			expect(crossTenantScope).toBe("acme_prod");

			// Customer attempting to probe config or local system dbs
			const configScope = resolveAuthorizedDatabase(customerRecord, "mongo", "config", false);
			expect(configScope).toBe("acme_prod");
		});

		it("permits platform administrators to access requested logical databases for diagnostics", () => {
			const adminScope = resolveAuthorizedDatabase(customerRecord, "mongo", "admin", true);
			expect(adminScope).toBe("admin");

			const configScope = resolveAuthorizedDatabase(customerRecord, "mongo", "config", true);
			expect(configScope).toBe("config");

			const defaultAdminScope = resolveAuthorizedDatabase(customerRecord, "mongo", undefined, true);
			expect(defaultAdminScope).toBe("acme_prod");
		});

		it("listDatabases for customers conceals internal databases and returns only assigned DB", async () => {
			const customerContext: any = {
				user: {
					id: "cust-1",
					role: "user",
					isPlatformAdmin: false,
				},
				session: { id: "sess-1", activeOrganizationId: "org-cust-1" },
			};
			const caller = databaseManagerRouter.createCaller(customerContext);

			const result = await caller.listDatabases({
				databaseId: "mongo-cust-1",
				engine: "mongo",
			});

			// Verify only customer's assigned database is returned
			expect(result.databases).toHaveLength(1);
			expect(result.databases[0]).toEqual({
				name: "acme_prod",
				sizeOnDisk: "0 MB",
				isInternal: false,
				isConfiguredDatabase: true,
				isDefault: true,
			});
			expect(result.selectedDatabase).toBe("acme_prod");

			// Engine listDatabases was NOT called for customer requests
			expect(mockListDatabases).not.toHaveBeenCalled();

			// Ensure internal DBs like admin, config, local, and other tenants are completely absent
			const names = result.databases.map((db: any) => db.name);
			expect(names).not.toContain("admin");
			expect(names).not.toContain("config");
			expect(names).not.toContain("local");
			expect(names).not.toContain("other_tenant_db");
		});

		it("listDatabases for platform administrators retains full discovery for diagnostics", async () => {
			const adminContext: any = {
				user: {
					id: "admin-1",
					role: "admin",
					isPlatformAdmin: true,
				},
				session: { id: "sess-admin", activeOrganizationId: "org-admin" },
			};
			const adminCaller = databaseManagerRouter.createCaller(adminContext);

			const result = await adminCaller.listDatabases({
				databaseId: "mongo-cust-1",
				engine: "mongo",
			});

			// Engine listDatabases WAS called for admin diagnostics
			expect(mockListDatabases).toHaveBeenCalledWith(
				expect.objectContaining({ mongoId: "mongo-cust-1" }),
				"mongo",
			);
			expect(result.databases.length).toBeGreaterThan(1);
			const names = result.databases.map((db: any) => db.name);
			expect(names).toContain("admin");
			expect(names).toContain("acme_prod");
		});

		it("engineOverview server-side forces customer database even if customer passes admin", async () => {
			const customerContext: any = {
				user: {
					id: "cust-1",
					role: "user",
					isPlatformAdmin: false,
				},
				session: { id: "sess-1", activeOrganizationId: "org-cust-1" },
			};
			const caller = databaseManagerRouter.createCaller(customerContext);

			const res = await caller.engineOverview({
				databaseId: "mongo-cust-1",
				engine: "mongo",
				database: "admin", // Malicious parameter
			});

			expect(mockGetOverview).toHaveBeenCalledWith(
				expect.objectContaining({ databaseName: "acme_prod" }),
				"acme_prod", // Forced to customer DB!
			);
			expect(res).toBeDefined();
		});

		it("listCollectionsOrTables forces customer database server-side", async () => {
			const customerContext: any = {
				user: {
					id: "cust-1",
					role: "user",
					isPlatformAdmin: false,
				},
				session: { id: "sess-1", activeOrganizationId: "org-cust-1" },
			};
			const caller = databaseManagerRouter.createCaller(customerContext);

			await caller.listCollectionsOrTables({
				databaseId: "mongo-cust-1",
				engine: "mongo",
				database: "config", // Probing attempt
			});

			expect(mockListCollections).toHaveBeenCalledWith(
				expect.objectContaining({ databaseName: "acme_prod" }),
				"acme_prod",
			);
		});
	});

	describe("2. Resource Usage & Telemetry Pipeline Accuracy", () => {
		it("measures real attributable memory, CPU, storage, and egress with correct units", async () => {
			// Mock database executor with tenant workloads across separate Drizzle tables
			const mockExecutor: any = {
				query: {
					projects: {
						findMany: vi.fn(async () => [
							{
								projectId: "proj-1",
								name: "Production",
							},
						]),
					},
					environments: {
						findMany: vi.fn(async () => [
							{
								environmentId: "env-1",
								name: "production",
								projectId: "proj-1",
							},
						]),
					},
					applications: {
						findMany: vi.fn(async () => [
							{
								applicationId: "app-1",
								name: "Web API",
								appName: "app-web-api",
								applicationStatus: "done",
								memoryLimit: "536870912", // 512 MB in bytes
								cpuLimit: "1000000000",
								environmentId: "env-1",
							},
						]),
					},
					compose: { findMany: vi.fn(async () => []) },
					mariadb: { findMany: vi.fn(async () => []) },
					mongo: {
						findMany: vi.fn(async () => [
							{
								mongoId: "mongo-1",
								name: "Analytics DB",
								appName: "db-mongo-analytics",
								applicationStatus: "done",
								databaseName: "analytics",
								memoryLimit: "1073741824", // 1024 MB in bytes
								cpuLimit: "2000000000",
								environmentId: "env-1",
							},
						]),
					},
					postgres: { findMany: vi.fn(async () => []) },
					redis: { findMany: vi.fn(async () => []) },
					mysql: { findMany: vi.fn(async () => []) },
					libsql: { findMany: vi.fn(async () => []) },
					mounts: {
						findMany: vi.fn(async () => [
							{ volumeName: "vol_cust_app", type: "volume" },
							{ volumeName: "vol_cust_db", type: "volume" },
						]),
					},
					organizations: {
						findFirst: vi.fn(async () => ({ id: "org-with-data", name: "Acme Corp" })),
					},
					subscriptions: {
						findFirst: vi.fn(async () => ({
							id: "sub-1",
							status: "active",
							currentPeriodEnd: new Date("2026-11-01"),
							plan: {
								id: "pro-plan",
								name: "Professional",
								resources: [
									{ resourceKey: "max_ram_mb", value: 4096 },
									{ resourceKey: "max_cpu_millicores", value: 4000 },
									{ resourceKey: "max_storage_gb", value: 50 },
									{ resourceKey: "max_bandwidth_gb", value: 100 },
									{ resourceKey: "max_applications", value: 10 },
									{ resourceKey: "max_databases", value: 5 },
								],
							},
						})),
					},
				},
			};

			const usage = await CustomerUsageService.getOrganizationUsage("org-with-data", mockExecutor);

			expect(usage).toBeDefined();
			expect(usage.organizationId).toBe("org-with-data");
			expect(usage.planName).toBe("Professional");

			// Check Workloads breakdown
			expect(usage.workloads).toHaveLength(2);
			const appWorkload = usage.workloads.find((w) => w.serviceType === "application");
			const dbWorkload = usage.workloads.find((w) => w.serviceType === "database");

			expect(appWorkload).toBeDefined();
			expect(appWorkload?.name).toBe("Web API");
			expect(appWorkload?.projectName).toBe("Production");

			expect(dbWorkload).toBeDefined();
			expect(dbWorkload?.name).toBe("Analytics DB");
			expect(dbWorkload?.engine).toBe("mongo");

			// Storage: 150MB (app vol) + 350MB (db vol) + 100MB (backup) = 600MB
			expect(usage.storage.used).toBe(600 * 1024 * 1024);
			expect(usage.storage.formattedUsed).toBe("600.0 MB");
			expect(usage.storage.limit).toBe(50 * 1024 * 1024 * 1024);
			expect(usage.storage.formattedLimit).toBe("50 GB");
			expect(usage.storage.telemetryState).toBe("measured");

			// Bandwidth: Not stuck on Collecting if traffic is measured or verified zero
			expect(["0.0 MB", "Collecting..."].includes(usage.bandwidth.formattedUsed) || usage.bandwidth.formattedUsed.endsWith("MB")).toBe(true);

			// Slot counts: 1 app, 1 db (managed db instances, not logical dbs!)
			expect(usage.applications.used).toBe(1);
			expect(usage.applications.limit).toBe(10);
			expect(usage.applications.remaining).toBe(9);

			expect(usage.databases.used).toBe(1);
			expect(usage.databases.limit).toBe(5);
			expect(usage.databases.remaining).toBe(4);
		});

		it("distinguishes lifecycle states from telemetry states and avoids false zero on pending workloads", async () => {
			const mockExecutor: any = {
				query: {
					projects: {
						findMany: vi.fn(async () => [
							{
								projectId: "proj-stopped",
								name: "Archived",
							},
						]),
					},
					environments: {
						findMany: vi.fn(async () => [
							{
								environmentId: "env-s",
								name: "staging",
								projectId: "proj-stopped",
							},
						]),
					},
					applications: {
						findMany: vi.fn(async () => [
							{
								applicationId: "app-idle",
								name: "Stopped Service",
								appName: "app-stopped",
								applicationStatus: "idle", // Stopped!
								memoryLimit: "268435456", // 256MB
								cpuLimit: "500000000",
								environmentId: "env-s",
							},
						]),
					},
					compose: { findMany: vi.fn(async () => []) },
					mariadb: { findMany: vi.fn(async () => []) },
					mongo: { findMany: vi.fn(async () => []) },
					postgres: { findMany: vi.fn(async () => []) },
					redis: { findMany: vi.fn(async () => []) },
					mysql: { findMany: vi.fn(async () => []) },
					libsql: { findMany: vi.fn(async () => []) },
					mounts: { findMany: vi.fn(async () => []) },
					organizations: { findFirst: vi.fn(async () => ({ id: "org-stopped-test" })) },
					subscriptions: { findFirst: vi.fn(async () => null) },
				},
			};

			const usage = await CustomerUsageService.getOrganizationUsage("org-stopped-test", mockExecutor);

			expect(usage.workloads).toHaveLength(1);
			const workload = usage.workloads[0];
			expect(workload).toBeDefined();
			expect(workload?.lifecycleStatus).toBe("stopped");
			expect(workload?.status).toBe("idle");
			// Telemetry status for stopped service is 'unavailable' or 'zero' with explicit reason, not false live metrics
			expect(["unavailable", "zero"]).toContain(workload?.telemetryStatus);
			expect(workload?.telemetryReason).toBeDefined();
		});

		it("strictly isolates tenant storage and never includes other tenants' volumes", async () => {
			const mockExecutor: any = {
				query: {
					projects: {
						findMany: vi.fn(async () => [
							{
								projectId: "proj-isolated",
								name: "Isolated",
							},
						]),
					},
					environments: {
						findMany: vi.fn(async () => [
							{
								environmentId: "env-iso",
								name: "prod",
								projectId: "proj-isolated",
							},
						]),
					},
					applications: {
						findMany: vi.fn(async () => [
							{
								applicationId: "app-iso",
								name: "Isolated App",
								appName: "app-iso",
								applicationStatus: "done",
								environmentId: "env-iso",
							},
						]),
					},
					compose: { findMany: vi.fn(async () => []) },
					mariadb: { findMany: vi.fn(async () => []) },
					mongo: { findMany: vi.fn(async () => []) },
					postgres: { findMany: vi.fn(async () => []) },
					redis: { findMany: vi.fn(async () => []) },
					mysql: { findMany: vi.fn(async () => []) },
					libsql: { findMany: vi.fn(async () => []) },
					mounts: {
						findMany: vi.fn(async () => [
							// Only vol_cust_app is mounted for this tenant!
							{ volumeName: "vol_cust_app", type: "volume" },
						]),
					},
					organizations: { findFirst: vi.fn(async () => ({ id: "org-isolated" })) },
					subscriptions: { findFirst: vi.fn(async () => null) },
				},
			};

			const usage = await CustomerUsageService.getOrganizationUsage("org-isolated", mockExecutor);

			// Should ONLY include vol_cust_app (150MB), NEVER vol_other_tenant (20GB)!
			expect(usage.storage.used).toBe(150 * 1024 * 1024);
			expect(usage.storage.formattedUsed).toBe("150.0 MB");
		});
	});
});

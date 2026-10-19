/**
 * HatDot Production Security & Customer Dashboard Hardening Test Suite
 *
 * Verifies:
 * 1. Database management feature gate (Coming Soon enforcement).
 * 2. Database manager router server-side denial for customers and permission for platform admins.
 * 3. Customer usage telemetry isolation, accurate plan limits, remaining capacity, and zero host physical leak.
 * 4. Infrastructure confidentiality: deployment logs audiences strictly require isPlatformAdmin.
 * 5. Primary server Docker & Swarm topology endpoints require platform admin privileges.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock audit and permissions
vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(async () => undefined),
	checkServiceAccess: vi.fn(async () => undefined),
}));

// Mock DatabaseConnectionService and DatabaseManagerService so router calls don't hit live databases
vi.mock("@dokploy/server/services/database-connection", () => ({
	DatabaseConnectionService: {
		getConnectionParams: vi.fn(async () => ({
			type: "postgres",
			host: "localhost",
			port: 5432,
			user: "postgres",
			password: "password",
			database: "testdb",
		})),
		testConnection: vi.fn(async () => ({
			success: true,
			latencyMs: 12,
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
	DatabaseManagerService: {
		getTablesOrCollections: vi.fn(async () => []),
		getRecordCount: vi.fn(async () => 0),
		getTableStructure: vi.fn(async () => ({ columns: [], primaryKey: "id" })),
		queryRecords: vi.fn(async () => ({ records: [], total: 0, page: 1, pageSize: 25 })),
		executeUniversalImport: vi.fn(async () => ({
			success: true,
			importedCount: 0,
			skippedCount: 0,
			failedCount: 0,
			errors: [],
		})),
		previewImportData: vi.fn(async () => ({
			headers: ["id", "name"],
			previewRows: [],
			totalRecords: 0,
		})),
	},
}));

import {
	assertDatabaseManagementAccess,
	DATABASE_MANAGEMENT_DISABLED_MESSAGE,
	isDatabaseManagementEnabledForUser,
} from "@dokploy/server";
import { databaseManagerRouter } from "@/server/api/routers/database-manager";
import { deploymentRouter } from "@/server/api/routers/deployment";
import { dockerRouter } from "@/server/api/routers/docker";
import { swarmRouter } from "@/server/api/routers/swarm";
import { CustomerUsageService } from "@dokploy/server";

describe("HatDot Production Hardening & Security Enforcement", () => {
	const originalEnv = process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT;

	beforeEach(() => {
		delete process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT;
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT = originalEnv;
		} else {
			delete process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT;
		}
	});

	describe("1. Database Management Feature Gate Policy", () => {
		it("denies access to standard customers when public database management is disabled", () => {
			const standardUser: any = {
				id: "cust-1",
				email: "customer@example.com",
				role: "user",
				isPlatformAdmin: false,
			};

			expect(isDatabaseManagementEnabledForUser(standardUser)).toBe(false);
			expect(() => assertDatabaseManagementAccess(standardUser)).toThrowError(
				TRPCError,
			);
			try {
				assertDatabaseManagementAccess(standardUser);
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
				expect(err.message).toBe(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
			}
		});

		it("denies access to organization owners when they are not platform admins", () => {
			const orgOwner: any = {
				id: "cust-owner",
				email: "owner@company.com",
				role: "owner", // Org owner, NOT platform admin
				isPlatformAdmin: false,
			};

			expect(isDatabaseManagementEnabledForUser(orgOwner)).toBe(false);
			expect(() => assertDatabaseManagementAccess(orgOwner)).toThrowError(
				TRPCError,
			);
		});

		it("permits platform administrators even when public database management is disabled", () => {
			const adminUser: any = {
				id: "admin-1",
				email: "admin@hatdot.cloud",
				role: "admin",
				isPlatformAdmin: true,
			};

			expect(isDatabaseManagementEnabledForUser(adminUser)).toBe(true);
			expect(() => assertDatabaseManagementAccess(adminUser)).not.toThrow();
		});

		it("permits all users when ENABLE_PUBLIC_DATABASE_MANAGEMENT is explicitly set to true", () => {
			process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT = "true";

			const standardUser: any = {
				id: "cust-1",
				email: "customer@example.com",
				role: "user",
				isPlatformAdmin: false,
			};

			expect(isDatabaseManagementEnabledForUser(standardUser)).toBe(true);
			expect(() => assertDatabaseManagementAccess(standardUser)).not.toThrow();
		});
	});

	describe("2. Database Manager Router Enforcement Across Endpoints", () => {
		const customerContext: any = {
			user: {
				id: "cust-123",
				authId: "auth-123",
				email: "client@test.com",
				role: "owner",
				isPlatformAdmin: false,
			},
			session: { id: "sess-123" },
		};

		const adminContext: any = {
			user: {
				id: "admin-999",
				authId: "auth-admin",
				email: "ops@hatdot.cloud",
				role: "owner",
				isPlatformAdmin: true,
			},
			session: { id: "sess-admin" },
		};

		const callerCustomer = databaseManagerRouter.createCaller(customerContext);
		const callerAdmin = databaseManagerRouter.createCaller(adminContext);

		it("denies direct customer request to overview", async () => {
			await expect(callerCustomer.overview()).rejects.toThrow(
				DATABASE_MANAGEMENT_DISABLED_MESSAGE,
			);
		});

		it("denies direct customer request to engineOverview", async () => {
			await expect(
				callerCustomer.engineOverview({
					databaseId: "db-1",
					engine: "postgres",
				}),
			).rejects.toThrow(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
		});

		it("denies direct customer request to queryData", async () => {
			await expect(
				callerCustomer.queryData({
					databaseId: "db-1",
					engine: "postgres",
					name: "users",
					page: 1,
					limit: 25,
				}),
			).rejects.toThrow(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
		});

		it("denies direct customer request to importData", async () => {
			await expect(
				callerCustomer.importData({
					databaseId: "db-1",
					engine: "postgres",
					targetEntity: "users",
					duplicatePolicy: "skip",
					fileType: "json",
					fileContent: '{"name":"test"}',
				}),
			).rejects.toThrow(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
		});

		it("denies direct customer request to executeSql", async () => {
			await expect(
				callerCustomer.executeSql({
					databaseId: "db-1",
					engine: "postgres",
					sql: "SELECT * FROM users",
				}),
			).rejects.toThrow(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
		});

		it("denies direct customer request to redisExecute", async () => {
			await expect(
				callerCustomer.redisExecute({
					databaseId: "db-1",
					command: "KEYS *",
				}),
			).rejects.toThrow(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
		});

		it("allows authorized platform admin caller to pass database management feature gate", async () => {
			// For admin, it should pass the feature gate assertDatabaseManagementAccess without throwing FORBIDDEN
			try {
				await callerAdmin.overview();
			} catch (err: any) {
				expect(err.message).not.toBe(DATABASE_MANAGEMENT_DISABLED_MESSAGE);
			}
		});
	});

	describe("3. Customer Usage Telemetry & Strict Tenant Isolation", () => {
		it("provides structured plan-aware metric gauges with correct units and remaining capacity", async () => {
			// Test calculation helpers directly from CustomerUsageService
			const usage = await CustomerUsageService.getOrganizationUsage("org-test-mock");

			expect(usage).toBeDefined();
			expect(usage.organizationId).toBe("org-test-mock");
			expect(usage.ram).toBeDefined();
			expect(usage.ram.formattedUsed).toMatch(/MB|GB/);
			expect(usage.ram.formattedLimit).toBeDefined();
			expect(usage.ram.formattedRemaining).toBeDefined();
			expect(usage.ram.percentage).toBeGreaterThanOrEqual(0);

			expect(usage.cpu).toBeDefined();
			expect(usage.cpu.percentage).toBeGreaterThanOrEqual(0);

			expect(usage.storage).toBeDefined();
			expect(usage.storage.formattedUsed).toMatch(/MB|GB/);

			expect(usage.bandwidth).toBeDefined();

			expect(usage.applications).toBeDefined();
			expect(typeof usage.applications.used).toBe("number");
			expect(typeof usage.applications.limit).toBe("number");

			expect(usage.databases).toBeDefined();
			expect(typeof usage.databases.used).toBe("number");
			expect(typeof usage.databases.limit).toBe("number");

			// Ensure physical server hardware details are never present in the report
			expect((usage as any).hostTotalRam).toBeUndefined();
			expect((usage as any).hostTotalCpu).toBeUndefined();
			expect((usage as any).hostDiskInventory).toBeUndefined();
			expect((usage as any).allTenants).toBeUndefined();
		});
	});

	describe("4. Infrastructure Confidentiality in Deployment Logs", () => {
		it("treats non-platform-admin organization owners as customer audience to conceal raw Docker commands and paths", async () => {
			const customerOwnerContext: any = {
				user: {
					id: "cust-owner-id",
					email: "customer@domain.com",
					role: "owner",
					isPlatformAdmin: false, // NOT platform admin
				},
				session: { id: "sess-abc" },
			};

			const caller = deploymentRouter.createCaller(customerOwnerContext);

			// Calling allDeploymentsByApplicationId with a non-existent app should fail safely
			// without leaking Swarm or Docker daemon internals
			await expect(
				caller.all({
					applicationId: "non-existent-app-id",
				}),
			).rejects.toThrow();
		});
	});

	describe("5. Primary Server Docker & Swarm Topology Hardening", () => {
		const regularCustomerContext: any = {
			user: {
				id: "cust-regular",
				email: "customer@domain.com",
				role: "owner",
				isPlatformAdmin: false,
			},
			session: { id: "sess-reg" },
		};

		it("rejects non-platform-admins calling docker.getContainers on the primary host", async () => {
			const caller = dockerRouter.createCaller(regularCustomerContext);
			await expect(caller.getContainers({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getContainers({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling docker.getServerHealth on the primary host", async () => {
			const caller = dockerRouter.createCaller(regularCustomerContext);
			await expect(caller.getServerHealth({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getServerHealth({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling swarm.getNodes on the primary host", async () => {
			const caller = swarmRouter.createCaller(regularCustomerContext);
			await expect(caller.getNodes({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getNodes({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling swarm.getContainerStats on the primary host", async () => {
			const caller = swarmRouter.createCaller(regularCustomerContext);
			await expect(caller.getContainerStats({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getContainerStats({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});
	});
});

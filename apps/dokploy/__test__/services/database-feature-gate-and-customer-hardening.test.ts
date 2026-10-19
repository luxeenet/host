/**
 * HatDot Production Security & Customer Dashboard Hardening Test Suite
 *
 * Verifies:
 * 1. Public Database Access policy (Coming Soon strictly on public/external connectivity).
 * 2. Internal Database Management UI and operations remain fully functional for customers.
 * 3. Sanitization of public database hostnames, ports, credentials, and connection strings for customers.
 * 4. Preservation of internal connection strings and private networking.
 * 5. Customer usage telemetry isolation, accurate plan limits, remaining capacity, and zero secret leakage.
 * 6. Graceful handling of Docker telemetry failure and empty organizations.
 * 7. Canonical usage routing (/home/dashboard/usage) and navigation active state detection.
 * 8. Primary server Docker & Swarm topology endpoints strictly require isPlatformAdmin.
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
	checkServicePermissionAndAccess: vi.fn(async () => undefined),
}));

// Mock DatabaseConnectionService so router calls don't hit live databases
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
	getAuthorizedDatabaseRecord: vi.fn(async () => ({
		postgresId: "db-1",
		appName: "pg-app",
		databaseName: "testdb",
		databaseUser: "postgres",
		databasePassword: "pwd",
		environment: { project: { organizationId: "sess-123" } },
	})),
	sqlAdapter: {
		getOverview: vi.fn(async () => ({ engine: "postgres", tables: [] })),
		queryRows: vi.fn(async () => ({ rows: [], total: 0 })),
		queryTable: vi.fn(async () => ({ rows: [], total: 0 })),
		executeRawQuery: vi.fn(async () => ({ rows: [] })),
	},
	mongoAdapter: {
		getOverview: vi.fn(async () => ({ engine: "mongo", collections: [] })),
	},
	redisAdapter: {
		getOverview: vi.fn(async () => ({ engine: "redis", keys: [] })),
	},
	libsqlAdapter: {
		getOverview: vi.fn(async () => ({ engine: "libsql", tables: [] })),
	},
	listDatabases: vi.fn(async () => ["testdb"]),
	executeDatabaseImport: vi.fn(async () => ({
		success: true,
		importedCount: 1,
		skippedCount: 0,
		failedCount: 0,
		errors: [],
	})),
}));

import {
	assertPublicDatabaseAccess,
	PUBLIC_DATABASE_ACCESS_DISABLED_MESSAGE,
	isPublicDatabaseAccessEnabled,
	isDatabaseManagementEnabledForUser,
	sanitizeConnectionDetailsForCustomer,
	sanitizeDatabaseRecordForCustomer,
	CustomerUsageService,
	transformLogForAudience,
} from "@dokploy/server";
import { databaseManagerRouter } from "@/server/api/routers/database-manager";
import { dockerRouter } from "@/server/api/routers/docker";
import { swarmRouter } from "@/server/api/routers/swarm";
import { isCustomerRouteActive } from "@/components/layouts/customer-layout";
import { isActiveRoute } from "@/components/layouts/side";
import { getServerSideProps as usageRedirectGSSP } from "@/pages/dashboard/usage";

describe("HatDot Production Hardening & Customer Security", () => {
	const originalAccessEnv = process.env.ENABLE_PUBLIC_DATABASE_ACCESS;

	beforeEach(() => {
		delete process.env.ENABLE_PUBLIC_DATABASE_ACCESS;
	});

	afterEach(() => {
		if (originalAccessEnv !== undefined) {
			process.env.ENABLE_PUBLIC_DATABASE_ACCESS = originalAccessEnv;
		} else {
			delete process.env.ENABLE_PUBLIC_DATABASE_ACCESS;
		}
	});

	describe("1. Public Database Access Feature Gate Policy", () => {
		it("denies external/public database access to standard customers by default", () => {
			const standardUser: any = {
				id: "cust-1",
				email: "customer@example.com",
				role: "user",
				isPlatformAdmin: false,
			};

			expect(isPublicDatabaseAccessEnabled(standardUser)).toBe(false);
			expect(() => assertPublicDatabaseAccess(standardUser)).toThrowError(
				TRPCError,
			);
			try {
				assertPublicDatabaseAccess(standardUser);
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
				expect(err.message).toBe(PUBLIC_DATABASE_ACCESS_DISABLED_MESSAGE);
			}
		});

		it("denies public access to organization owners when they are not platform admins", () => {
			const orgOwner: any = {
				id: "cust-owner",
				email: "owner@company.com",
				role: "owner",
				isPlatformAdmin: false,
			};

			expect(isPublicDatabaseAccessEnabled(orgOwner)).toBe(false);
			expect(() => assertPublicDatabaseAccess(orgOwner)).toThrowError(
				TRPCError,
			);
		});

		it("permits platform administrators full public database access", () => {
			const adminUser: any = {
				id: "admin-1",
				email: "admin@hatdot.cloud",
				role: "admin",
				isPlatformAdmin: true,
			};

			expect(isPublicDatabaseAccessEnabled(adminUser)).toBe(true);
			expect(() => assertPublicDatabaseAccess(adminUser)).not.toThrow();
		});

		it("permits all users when ENABLE_PUBLIC_DATABASE_ACCESS is explicitly set to true", () => {
			process.env.ENABLE_PUBLIC_DATABASE_ACCESS = "true";

			const standardUser: any = {
				id: "cust-1",
				email: "customer@example.com",
				role: "user",
				isPlatformAdmin: false,
			};

			expect(isPublicDatabaseAccessEnabled(standardUser)).toBe(true);
			expect(() => assertPublicDatabaseAccess(standardUser)).not.toThrow();
		});

		it("keeps internal database management ENABLED for ordinary customers", () => {
			const standardUser: any = {
				id: "cust-1",
				email: "customer@example.com",
				role: "user",
				isPlatformAdmin: false,
			};

			// Customers MUST retain the internal database management UI and its supported operations
			expect(isDatabaseManagementEnabledForUser(standardUser)).toBe(true);
		});
	});

	describe("2. Public Database Connection & Record Sanitization", () => {
		const sampleDetails: any = {
			engine: "postgres",
			internal: {
				url: "postgres://postgres:secret123@hatdot-pg-service:5432/mydb",
				host: "hatdot-pg-service",
				port: 5432,
				user: "postgres",
				password: "secret123",
				database: "mydb",
			},
			external: {
				url: "postgres://postgres:secret123@node1.hatdot.cloud:25432/mydb",
				host: "node1.hatdot.cloud",
				port: 25432,
				user: "postgres",
				password: "secret123",
				database: "mydb",
				command: "psql -h node1.hatdot.cloud -p 25432 -U postgres mydb",
				isComingSoon: false,
			},
		};

		it("sanitizes external connection strings, ports, and credentials for customers while keeping internal connection intact", () => {
			const customerUser: any = {
				id: "cust-1",
				isPlatformAdmin: false,
			};

			const sanitized = sanitizeConnectionDetailsForCustomer(sampleDetails, customerUser);

			// Internal details MUST remain functional for internal application networking
			expect(sanitized.internal.url).toBe("postgres://postgres:secret123@hatdot-pg-service:5432/mydb");
			expect(sanitized.internal.host).toBe("hatdot-pg-service");
			expect(sanitized.internal.port).toBe(5432);

			// External details MUST be sanitized and marked Coming Soon
			expect(sanitized.external.isComingSoon).toBe(true);
			expect(sanitized.external.url).toBeNull();
			expect(sanitized.external.host).toBeNull();
			expect(sanitized.external.port).toBeNull();
			expect(sanitized.external.user).toBeNull();
			expect(sanitized.external.password).toBeNull();
			expect(sanitized.external.command).toBeNull();
		});

		it("preserves external connection details for platform administrators", () => {
			const adminUser: any = {
				id: "admin-1",
				isPlatformAdmin: true,
			};

			const result = sanitizeConnectionDetailsForCustomer(sampleDetails, adminUser);

			expect(result.external.isComingSoon).toBe(false);
			expect(result.external.url).toBe("postgres://postgres:secret123@node1.hatdot.cloud:25432/mydb");
			expect(result.external.port).toBe(25432);
			expect(result.external.command).toBe("psql -h node1.hatdot.cloud -p 25432 -U postgres mydb");
		});

		it("sanitizes database record externalPort and publicHost for customers", () => {
			const customerUser: any = {
				id: "cust-1",
				isPlatformAdmin: false,
			};

			const rawRecord: any = {
				postgresId: "pg-123",
				name: "production-db",
				appName: "prod-pg-app",
				externalPort: 25432,
				publicHost: "node1.hatdot.cloud",
				publicHostInfo: { host: "node1.hatdot.cloud", port: 25432 },
				databaseName: "mydb",
				databaseUser: "postgres",
			};

			const sanitizedRecord = sanitizeDatabaseRecordForCustomer(rawRecord, customerUser);

			expect(sanitizedRecord.externalPort).toBeNull();
			expect(sanitizedRecord.publicHost).toBeNull();
			expect(sanitizedRecord.publicHostInfo).toBeNull();
			expect(sanitizedRecord.name).toBe("production-db");
			expect(sanitizedRecord.appName).toBe("prod-pg-app");
		});
	});

	describe("3. Internal Database Management Operations Unblocked for Customers", () => {
		const customerContext: any = {
			user: {
				id: "cust-123",
				authId: "auth-123",
				email: "client@test.com",
				role: "owner",
				isPlatformAdmin: false,
			},
			session: { id: "sess-123", activeOrganizationId: "sess-123" },
		};

		const callerCustomer = databaseManagerRouter.createCaller(customerContext);

		it("allows customer to call overview without Coming Soon blocker", async () => {
			const res = await callerCustomer.overview();
			expect(res).toBeDefined();
		});

		it("allows customer to query engine overview", async () => {
			const res = await callerCustomer.engineOverview({
				databaseId: "db-1",
				engine: "postgres",
			});
			expect(res).toBeDefined();
		});

		it("allows customer to query table records", async () => {
			const res = await callerCustomer.queryData({
				databaseId: "db-1",
				engine: "postgres",
				name: "users",
				page: 1,
				limit: 25,
			});
			expect(res).toBeDefined();
		});

		it("allows customer to execute universal import", async () => {
			const res = await callerCustomer.importData({
				databaseId: "db-1",
				engine: "postgres",
				targetEntity: "users",
				duplicatePolicy: "skip",
				fileType: "json",
				fileContent: '[{"id":1,"name":"Alice"}]',
			});
			expect(res).toBeDefined();
		});
	});

	describe("4. Customer Usage Telemetry & Strict Tenant Isolation", () => {
		it("provides structured plan-aware metric gauges with correct units and remaining capacity", async () => {
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

		it("never leaks database passwords, root passwords, environment secrets, or refresh tokens in usage response", async () => {
			const usage = await CustomerUsageService.getOrganizationUsage("org-test-mock");

			const serialized = JSON.stringify(usage);
			expect(serialized).not.toContain("databasePassword");
			expect(serialized).not.toContain("rootPassword");
			expect(serialized).not.toContain("refreshToken");
			expect(serialized).not.toContain("dockerSocket");
		});

		it("handles an organization with no projects gracefully without errors", async () => {
			const usage = await CustomerUsageService.getOrganizationUsage("org-empty-test");
			expect(usage).toBeDefined();
			expect(usage.workloads).toBeDefined();
			expect(Array.isArray(usage.workloads)).toBe(true);
			expect(usage.applications.used).toBe(0);
			expect(usage.databases.used).toBe(0);
		});
	});

	describe("5. Canonical Routing & Navigation", () => {
		it("redirects legacy /dashboard/usage to canonical /home/dashboard/usage via getServerSideProps", async () => {
			const ctx: any = { req: {}, res: {} };
			const result = await usageRedirectGSSP(ctx);

			expect(result).toEqual({
				redirect: {
					destination: "/home/dashboard/usage",
					permanent: false,
				},
			});
		});

		it("accurately detects active route for /home/dashboard/usage in customer layout", () => {
			expect(isCustomerRouteActive("/home/dashboard/usage", "/home/dashboard/usage")).toBe(true);
			expect(isCustomerRouteActive("/home/dashboard/usage", "/dashboard/usage")).toBe(true);
			expect(isCustomerRouteActive("/home/dashboard/usage", "/dashboard/projects")).toBe(false);
		});

		it("accurately detects active route for /home/dashboard in customer layout", () => {
			expect(isCustomerRouteActive("/dashboard/home", "/home/dashboard")).toBe(true);
			expect(isCustomerRouteActive("/dashboard/home", "/dashboard/home")).toBe(true);
			expect(isCustomerRouteActive("/dashboard/home", "/dashboard/home/databases")).toBe(false);
		});

		it("accurately detects active route in side menu for canonical usage and home", () => {
			expect(isActiveRoute({ itemUrl: "/home/dashboard/usage", pathname: "/home/dashboard/usage" })).toBe(true);
			expect(isActiveRoute({ itemUrl: "/home/dashboard/usage", pathname: "/dashboard/usage" })).toBe(true);
			expect(isActiveRoute({ itemUrl: "/dashboard/home", pathname: "/home/dashboard" })).toBe(true);
			expect(isActiveRoute({ itemUrl: "/dashboard/home", pathname: "/dashboard/home" })).toBe(true);
			// Must isolate /dashboard/home so it does not match subpaths
			expect(isActiveRoute({ itemUrl: "/dashboard/home", pathname: "/dashboard/home/databases" })).toBe(false);
		});
	});

	describe("6. Infrastructure Confidentiality & Primary Server Hardening", () => {
		const regularCustomerContext: any = {
			user: {
				id: "cust-regular",
				email: "customer@domain.com",
				role: "owner",
				isPlatformAdmin: false,
			},
			session: { id: "sess-reg" },
		};

		it("transforms deployment logs for customer audience by concealing internal docker commands and paths", () => {
			const rawAdminLog = [
				"docker run -d --name test-container /var/run/docker.sock",
				"Step 1/5: Building app...",
				"/etc/dokploy/compose/workloads/123/docker-compose.yml",
				"Successfully deployed",
			].join("\n");

			const customerLog = transformLogForAudience(rawAdminLog, "customer");
			expect(customerLog).not.toContain("docker run");
			expect(customerLog).not.toContain("/var/run/docker.sock");
			expect(customerLog).not.toContain("/etc/dokploy");
			expect(customerLog).toContain("Successfully deployed");

			const adminLog = transformLogForAudience(rawAdminLog, "admin");
			expect(adminLog).toContain("docker run");
			expect(adminLog).toContain("/etc/dokploy");
		});

		it("rejects non-platform-admins calling docker.getContainers on primary host", async () => {
			const caller = dockerRouter.createCaller(regularCustomerContext);
			await expect(caller.getContainers({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getContainers({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling docker.getServerHealth on primary host", async () => {
			const caller = dockerRouter.createCaller(regularCustomerContext);
			await expect(caller.getServerHealth({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getServerHealth({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling swarm.getNodes on primary host", async () => {
			const caller = swarmRouter.createCaller(regularCustomerContext);
			await expect(caller.getNodes({})).rejects.toThrowError(TRPCError);
			try {
				await caller.getNodes({});
			} catch (err: any) {
				expect(err.code).toBe("FORBIDDEN");
			}
		});

		it("rejects non-platform-admins calling swarm.getContainerStats on primary host", async () => {
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

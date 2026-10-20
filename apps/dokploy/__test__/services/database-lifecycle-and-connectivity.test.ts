import {
	buildDatabaseConnectionStrings,
	connectDatabaseToApplication,
} from "@dokploy/server/services/database-connection";
import {
	provisionDatabaseService,
	waitForDatabaseEngineReadiness,
	verifyInternalDatabaseConnectivity,
} from "@dokploy/server/services/database-lifecycle";
import {
	mongoAdapter,
	listDatabases,
} from "@dokploy/server/services/database-manager";
import { execAsync } from "@dokploy/server/utils/process/execAsync";
import {
	getServiceContainer,
	pullImage,
	waitForSwarmServiceConvergence,
} from "@dokploy/server/utils/docker/utils";
import { buildMongo } from "@dokploy/server/utils/databases/mongo";
import { buildPostgres } from "@dokploy/server/utils/databases/postgres";
import { buildMysql } from "@dokploy/server/utils/databases/mysql";
import { buildMariadb } from "@dokploy/server/utils/databases/mariadb";
import { buildRedis } from "@dokploy/server/utils/databases/redis";
import { buildLibsql } from "@dokploy/server/utils/databases/libsql";
import * as mongoService from "@dokploy/server/services/mongo";
import * as postgresService from "@dokploy/server/services/postgres";
import * as mysqlService from "@dokploy/server/services/mysql";
import * as mariadbService from "@dokploy/server/services/mariadb";
import * as redisService from "@dokploy/server/services/redis";
import * as libsqlService from "@dokploy/server/services/libsql";
import * as applicationService from "@dokploy/server/services/application";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock docker service container and exec utilities
vi.mock("@dokploy/server/utils/docker/utils", () => ({
	getServiceContainer: vi.fn(),
	pullImage: vi.fn().mockResolvedValue(undefined),
	waitForSwarmServiceConvergence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/mongo", () => ({
	buildMongo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/postgres", () => ({
	buildPostgres: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/mysql", () => ({
	buildMysql: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/mariadb", () => ({
	buildMariadb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/redis", () => ({
	buildRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/databases/libsql", () => ({
	buildLibsql: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
}));

// Mock database services for state updates and record lookups
vi.mock("@dokploy/server/services/mongo", () => ({
	updateMongoById: vi.fn().mockResolvedValue(undefined),
	findMongoById: vi.fn(),
}));

vi.mock("@dokploy/server/services/postgres", () => ({
	updatePostgresById: vi.fn().mockResolvedValue(undefined),
	findPostgresById: vi.fn(),
}));

vi.mock("@dokploy/server/services/mysql", () => ({
	updateMySqlById: vi.fn().mockResolvedValue(undefined),
	findMySqlById: vi.fn(),
}));

vi.mock("@dokploy/server/services/mariadb", () => ({
	updateMariadbById: vi.fn().mockResolvedValue(undefined),
	findMariadbById: vi.fn(),
}));

vi.mock("@dokploy/server/services/redis", () => ({
	updateRedisById: vi.fn().mockResolvedValue(undefined),
	findRedisById: vi.fn(),
}));

vi.mock("@dokploy/server/services/libsql", () => ({
	updateLibsqlById: vi.fn().mockResolvedValue(undefined),
	findLibsqlById: vi.fn(),
}));

vi.mock("@dokploy/server/services/application", () => ({
	findApplicationById: vi.fn(),
	updateApplication: vi.fn().mockResolvedValue(undefined),
	updateApplicationById: vi.fn().mockResolvedValue(undefined),
	updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/services/database-security", () => ({
	reconcileDatabaseSecurity: vi.fn().mockResolvedValue({
		success: true,
		appliedRules: ["db_isolated"],
		warnings: [],
	}),
	sanitizeDatabaseIdentifier: (val: string) => (val ? val.replace(/[^a-zA-Z0-9_]/g, "_") : "main_db"),
	redactCredentials: (val: string) => (val ? val.replace(/:([^@]+)@/, ":[REDACTED]@") : val),
	sanitizeCustomerDiagnostic: (val: string) => (val ? val.replace(/container [a-f0-9]+/gi, "database service") : val),
}));

describe("HatDot Database Lifecycle, MongoDB Identity, and Application Integration Test Suite", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getServiceContainer).mockResolvedValue({
			Id: "mock-container-id-hatdot-77",
			State: "running",
		} as any);
	});

	describe("1. Immediate Database Lifecycle & Provisioning without Application Deployment", () => {
		it("provisions database service immediately through lifecycle states without needing application deployment", async () => {
			const mockRecord = {
				id: "mongo-cust-001",
				appName: "mongo-instance-xyz",
				name: "Store DB",
				databaseName: "customer_store",
				databaseUser: "cust_user",
				databasePassword: "SecPassword123!",
				authSource: "customer_store",
				dockerImage: "mongo:7.0",
				applicationStatus: "idle",
			};

			vi.mocked(mongoService.findMongoById).mockResolvedValue(mockRecord as any);
			const mockUpdateMongo = vi.mocked(mongoService.updateMongoById);
			const mockExec = vi.mocked(execAsync);

			// Readiness mongosh ping
			mockExec.mockResolvedValueOnce({ stdout: '{"ok":1}\n', stderr: "" } as any);
			// Connectivity probe result with ping & readWrite
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({ ping: true, readWrite: true, isolation: true }) + "\n",
				stderr: "",
			} as any);

			await provisionDatabaseService({
				databaseId: "mongo-cust-001",
				engine: "mongo",
			});

			// Database was updated to 'running' (Provisioning) then 'done' (Ready)
			expect(mockUpdateMongo).toHaveBeenCalledWith("mongo-cust-001", {
				applicationStatus: "running",
			});
			expect(mockUpdateMongo).toHaveBeenCalledWith("mongo-cust-001", {
				applicationStatus: "done",
			});
		});

		it("marks database status 'error' and preserves sanitized failure if engine readiness fails", async () => {
			const mockRecord = {
				id: "mongo-cust-fail",
				appName: "mongo-fail-xyz",
				name: "Fail DB",
				databaseName: "store_db",
				databaseUser: "admin_user",
				databasePassword: "password",
				dockerImage: "mongo:7.0",
				applicationStatus: "idle",
			};

			vi.mocked(mongoService.findMongoById).mockResolvedValue(mockRecord as any);
			const mockUpdateMongo = vi.mocked(mongoService.updateMongoById);
			const mockExec = vi.mocked(execAsync);

			// Mongosh readiness ping repeatedly fails
			mockExec.mockRejectedValue(new Error("Connection refused on port 27017"));

			await expect(
				provisionDatabaseService({
					databaseId: "mongo-cust-fail",
					engine: "mongo",
					readinessOptions: { maxAttempts: 2, delayMs: 10 },
				}),
			).rejects.toThrow();

			expect(mockUpdateMongo).toHaveBeenCalledWith("mongo-cust-fail", {
				applicationStatus: "error",
			});
		});
	});

	describe("2. Engine Protocol Readiness Polling across Engines", () => {
		it("verifies MongoDB engine readiness via mongosh ping", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({ stdout: '{"ok":1}\n', stderr: "" } as any);

			const isReady = await waitForDatabaseEngineReadiness("mongo-test", "mongo", undefined, {
				maxAttempts: 3,
				delayMs: 10,
			});

			expect(isReady).toBe(true);
			const cmd = String(mockExec.mock.calls[0]?.[0] || "");
			expect(cmd).toContain("mongosh");
			expect(cmd).toContain("ping");
		});

		it("verifies PostgreSQL engine readiness via pg_isready", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({ stdout: "/var/run/postgresql:5432 - accepting connections\n", stderr: "" } as any);

			const isReady = await waitForDatabaseEngineReadiness("pg-test", "postgres", undefined, {
				maxAttempts: 3,
				delayMs: 10,
			});

			expect(isReady).toBe(true);
			const cmd = String(mockExec.mock.calls[0]?.[0] || "");
			expect(cmd).toContain("pg_isready");
		});

		it("verifies MySQL and MariaDB engine readiness via mysqladmin / mariadb-admin ping", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({ stdout: "mysqld is alive\n", stderr: "" } as any);

			const isReady = await waitForDatabaseEngineReadiness("mysql-test", "mysql", undefined, {
				maxAttempts: 3,
				delayMs: 10,
			});

			expect(isReady).toBe(true);
			const cmd = String(mockExec.mock.calls[0]?.[0] || "");
			expect(cmd).toContain("mysqladmin ping");
		});

		it("verifies Redis engine readiness via redis-cli ping", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({ stdout: "PONG\n", stderr: "" } as any);

			const isReady = await waitForDatabaseEngineReadiness("redis-test", "redis", undefined, {
				maxAttempts: 3,
				delayMs: 10,
			});

			expect(isReady).toBe(true);
			const cmd = String(mockExec.mock.calls[0]?.[0] || "");
			expect(cmd).toContain("redis-cli ping");
		});

		it("verifies LibSQL engine readiness via curl health endpoint", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({ stdout: "OK\n", stderr: "" } as any);

			const isReady = await waitForDatabaseEngineReadiness("libsql-test", "libsql", undefined, {
				maxAttempts: 3,
				delayMs: 10,
			});

			expect(isReady).toBe(true);
			const cmd = String(mockExec.mock.calls[0]?.[0] || "");
			expect(cmd).toContain("http://127.0.0.1:8080/health");
		});
	});

	describe("3. MongoDB Logical Identity, Connection Strings, and URI Generation", () => {
		it("generates correct connection strings with MONGODB_URI, MONGO_AUTH_SOURCE, and MONGODB_DATABASE", () => {
			const mongoRecord = {
				appName: "mongo-instance-corp",
				databaseName: "corp_production",
				databaseUser: "corp_user",
				databasePassword: "P@ss#w$ord*Special!",
				authSource: "corp_production",
			};

			const result = buildDatabaseConnectionStrings("mongo", mongoRecord, "");

			expect(result.envVariables.MONGODB_DATABASE).toBe("corp_production");
			expect(result.envVariables.MONGO_AUTH_SOURCE).toBe("corp_production");
			expect(result.envVariables.DATABASE_URL).toBe(result.internal.url);
			expect(result.envVariables.MONGODB_URI).toBe(result.internal.url);

			// URI contains correctly URL-encoded special characters
			expect(result.internal.url).toContain(encodeURIComponent("P@ss#w$ord*Special!"));
			expect(result.internal.url).toContain("/corp_production");
			expect(result.internal.url).toContain("authSource=corp_production");
			expect(result.internal.url).not.toContain("/test");
			expect(result.internal.url).not.toContain("/app");
		});

		it("distinguishes system databases (admin, config, local) from customer database", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					databases: [
						{ name: "admin", sizeOnDisk: 100000, empty: false, isInternal: true, isSystemDatabase: true, isConfiguredDatabase: false },
						{ name: "config", sizeOnDisk: 10000, empty: false, isInternal: true, isSystemDatabase: true, isConfiguredDatabase: false },
						{ name: "local", sizeOnDisk: 50000, empty: false, isInternal: true, isSystemDatabase: true, isConfiguredDatabase: false },
						{ name: "customer_shop", sizeOnDisk: 400000, empty: false, isInternal: false, isSystemDatabase: false, isConfiguredDatabase: true },
					],
					restricted: false,
					configuredDatabase: "customer_shop",
				}) + "\n",
				stderr: "",
			} as any);

			const mongoRecord = {
				appName: "mongo-shop",
				databaseName: "customer_shop",
				databaseUser: "shop_user",
				databasePassword: "password",
				authSource: "customer_shop",
			};

			const dbs = await mongoAdapter.listDatabases(mongoRecord);
			const adminDb = dbs.find((d: any) => d.name === "admin");
			const customerDb = dbs.find((d: any) => d.name === "customer_shop");

			expect(adminDb?.isSystemDatabase).toBe(true);
			expect(adminDb?.isInternal).toBe(true);
			expect(adminDb?.isConfiguredDatabase).toBe(false);

			expect(customerDb?.isSystemDatabase).toBe(false);
			expect(customerDb?.isConfiguredDatabase).toBe(true);
		});

		it("marks new empty customer database as uninitialized without inventing 'test' or 'app'", async () => {
			const mockExec = vi.mocked(execAsync);
			// Server only has system databases initially
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					databases: [
						{ name: "admin", sizeOnDisk: 100000, empty: false, isInternal: true, isSystemDatabase: true, isConfiguredDatabase: false },
						{ name: "local", sizeOnDisk: 50000, empty: false, isInternal: true, isSystemDatabase: true, isConfiguredDatabase: false },
						{ name: "analytics_db", sizeOnDisk: 0, empty: true, isInternal: false, isSystemDatabase: false, isConfiguredDatabase: true, uninitialized: true },
					],
					restricted: false,
					configuredDatabase: "analytics_db",
				}) + "\n",
				stderr: "",
			} as any);

			const mongoRecord = {
				appName: "mongo-analytics",
				databaseName: "analytics_db",
				databaseUser: "analytics_user",
				databasePassword: "password",
				authSource: "analytics_db",
			};

			const dbs = await mongoAdapter.listDatabases(mongoRecord);
			const analyticsDb = dbs.find((d: any) => d.name === "analytics_db");

			expect(analyticsDb).toBeDefined();
			expect(analyticsDb?.isConfiguredDatabase).toBe(true);
			expect(analyticsDb?.uninitialized).toBe(true);
			expect(analyticsDb?.empty).toBe(true);

			// Must not contain phantom test database
			expect(dbs.some((d: any) => d.name === "test")).toBe(false);
		});
	});

	describe("4. Authenticated Internal Connectivity & Safe Read/Write Probes", () => {
		it("performs successful authenticated probe and write/read verification", async () => {
			const mockExec = vi.mocked(execAsync);

			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({ ping: true, readWrite: true, isolation: true }) + "\n",
				stderr: "",
			} as any);

			const mockRecord = {
				id: "mongo-active",
				appName: "mongo-active",
				databaseName: "customer_crm",
				databaseUser: "crm_user",
				databasePassword: "SecurePassword123!",
				authSource: "customer_crm",
				applicationStatus: "done",
			};

			const result = await verifyInternalDatabaseConnectivity({
				type: "mongo",
				databaseId: "mongo-active",
				dbRecord: mockRecord,
			});

			expect(result.success).toBe(true);
			expect(result.state).toBe("ready");
			expect(result.databaseName).toBe("customer_crm");
			expect(result.details?.writeProbeSucceeded).toBe(true);
			expect(result.details?.readProbeSucceeded).toBe(true);
		});

		it("reports sanitized auth_failed status on authentication failure without leaking credentials", async () => {
			const mockExec = vi.mocked(execAsync);

			mockExec.mockResolvedValueOnce({
				stdout: "MongoServerError: Authentication failed for user 'crm_user' on authSource 'customer_crm' with secret 'SuperSecretPass'\n",
				stderr: "",
			} as any);

			const mockRecord = {
				id: "mongo-active",
				appName: "mongo-active",
				databaseName: "customer_crm",
				databaseUser: "crm_user",
				databasePassword: "SuperSecretPass",
				authSource: "customer_crm",
				applicationStatus: "done",
			};

			const result = await verifyInternalDatabaseConnectivity({
				type: "mongo",
				databaseId: "mongo-active",
				dbRecord: mockRecord,
			});

			expect(result.success).toBe(false);
			expect(result.state).toBe("auth_failed");
			expect(result.message).toContain("authentication failed");
			// Must redact password from message
			expect(result.message).not.toContain("SuperSecretPass");
		});

		it("reports unreachable status when container cannot be contacted", async () => {
			vi.mocked(getServiceContainer).mockResolvedValueOnce(null);

			const mockRecord = {
				id: "mongo-down",
				appName: "mongo-down",
				databaseName: "customer_crm",
				databaseUser: "crm_user",
				databasePassword: "password",
				authSource: "customer_crm",
				applicationStatus: "done",
			};

			const result = await verifyInternalDatabaseConnectivity({
				type: "mongo",
				databaseId: "mongo-down",
				dbRecord: mockRecord,
			});

			expect(result.success).toBe(false);
			expect(result.state).toBe("unreachable");
		});
	});

	describe("5. Application Integration & Precondition Enforcement", () => {
		it("rejects connecting an unready database with PRECONDITION_FAILED", async () => {
			const unreadyMongo = {
				id: "mongo-unready",
				appName: "mongo-unready-xyz",
				databaseName: "unready_db",
				databaseUser: "user",
				databasePassword: "pass",
				applicationStatus: "running", // still provisioning!
			};

			vi.mocked(mongoService.findMongoById).mockResolvedValue(unreadyMongo as any);

			const mockApp = {
				applicationId: "app-target-1",
				name: "My Next.js Frontend",
				env: "NODE_ENV=production\n",
			};

			vi.mocked(applicationService.findApplicationById).mockResolvedValue(mockApp as any);

			await expect(
				connectDatabaseToApplication({
					databaseId: "mongo-unready",
					databaseType: "mongo",
					applicationId: "app-target-1",
				}),
			).rejects.toThrow(/not ready/i);
		});

		it("connects ready database and injects all required variables into target application", async () => {
			const readyMongo = {
				id: "mongo-ready",
				appName: "mongo-ready-xyz",
				databaseName: "ecommerce_db",
				databaseUser: "ecom_user",
				databasePassword: "EcomPassword123!",
				authSource: "ecommerce_db",
				applicationStatus: "done", // Ready!
			};

			vi.mocked(mongoService.findMongoById).mockResolvedValue(readyMongo as any);

			const mockApp = {
				applicationId: "app-target-2",
				name: "E-Commerce Web",
				env: "PORT=3000\n",
			};

			vi.mocked(applicationService.findApplicationById).mockResolvedValue(mockApp as any);
			const mockUpdateApp = vi.mocked(applicationService.updateApplication);

			// Mock connectivity check success
			const mockExec = vi.mocked(execAsync);
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({ ping: true, readWrite: true, isolation: true }) + "\n",
				stderr: "",
			} as any);

			const result = await connectDatabaseToApplication({
				databaseId: "mongo-ready",
				databaseType: "mongo",
				applicationId: "app-target-2",
			});

			expect(result.success).toBe(true);
			expect(mockUpdateApp).toHaveBeenCalled();

			const updatedEnvCall = mockUpdateApp.mock.calls[0]?.[1]?.env as string;
			expect(updatedEnvCall).toContain("PORT=3000"); // preserved existing!
			expect(updatedEnvCall).toContain("DATABASE_URL=");
			expect(updatedEnvCall).toContain("MONGODB_URI=");
			expect(updatedEnvCall).toContain('MONGODB_DATABASE="ecommerce_db"');
			expect(updatedEnvCall).toContain('MONGO_AUTH_SOURCE="ecommerce_db"');
			expect(updatedEnvCall).toContain("mongo-ready-xyz:27017/ecommerce_db");
		});

		it("supports connecting PostgreSQL, MySQL, MariaDB, Redis, and LibSQL when ready", async () => {
			const engines = ["postgres", "mysql", "mariadb", "redis", "libsql"] as const;

			for (const engine of engines) {
				const readyDb = {
					id: `${engine}-ready`,
					appName: `${engine}-ready-xyz`,
					databaseName: `${engine}_db`,
					databaseUser: "test_user",
					databasePassword: "SecurePassword1!",
					applicationStatus: "done",
				};

				if (engine === "postgres") vi.mocked(postgresService.findPostgresById).mockResolvedValue(readyDb as any);
				else if (engine === "mysql") vi.mocked(mysqlService.findMySqlById).mockResolvedValue(readyDb as any);
				else if (engine === "mariadb") vi.mocked(mariadbService.findMariadbById).mockResolvedValue(readyDb as any);
				else if (engine === "redis") vi.mocked(redisService.findRedisById).mockResolvedValue(readyDb as any);
				else if (engine === "libsql") vi.mocked(libsqlService.findLibsqlById).mockResolvedValue(readyDb as any);

				const mockApp = {
					applicationId: `app-${engine}`,
					name: `${engine} App`,
					env: "",
				};

				vi.mocked(applicationService.findApplicationById).mockResolvedValue(mockApp as any);
				const mockExec = vi.mocked(execAsync);
				mockExec.mockResolvedValue({ stdout: "PONG\nOK\n1\n", stderr: "" } as any);

				const result = await connectDatabaseToApplication({
					databaseId: `${engine}-ready`,
					databaseType: engine,
					applicationId: `app-${engine}`,
				});

				expect(result.success).toBe(true);
			}
		});
	});
});

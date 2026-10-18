import {
	buildDatabaseConnectionStrings,
	verifyDatabaseConnectivity,
} from "@dokploy/server/services/database-connection";
import {
	redactCredentials,
	sanitizeDatabaseIdentifier,
} from "@dokploy/server/services/database-security";
import {
	executeInsideServiceContainer,
	getAuthorizedDatabaseRecord,
	redisAdapter,
} from "@dokploy/server/services/database-manager";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

describe("MongoDB Authentication, Connection URI Generation, and Database Management Platform", () => {
	describe("1. MongoDB Compass & External Connection URL Diagnostics", () => {
		it("generates external URI with directConnection=true, db.hatdot.cloud host, and authSource=admin", () => {
			const mongoRecord = {
				appName: "customer-app-mongo-abc123",
				databaseUser: "customer_user",
				databasePassword: "SecurePassword123!",
				databaseName: "customer_app",
				authSource: "admin",
				externalPort: 27017,
				replicaSets: "rs0",
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				mongoRecord,
				"db.hatdot.cloud",
			);

			// Must be externally enabled
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.host).toBe("db.hatdot.cloud");
			expect(conn.external.port).toBe(27017);

			const externalUrl = conn.external.url!;
			// Must route to public host, not internal Docker Swarm hostname
			expect(externalUrl).toContain("mongodb://customer_user:SecurePassword123!@db.hatdot.cloud:27017/customer_app");
			expect(externalUrl).not.toContain("customer-app-mongo-abc123");

			// Must preserve directConnection=true for Compass / external drivers
			expect(externalUrl).toContain("directConnection=true");

			// Must NOT contain replicaSet=rs0 in external URL (preventing Swarm internal replica-set node discovery)
			expect(externalUrl).not.toContain("replicaSet=rs0");

			// Must specify authSource=admin
			expect(externalUrl).toContain("authSource=admin");
		});

		it("encodes special characters in passwords so MongoDB connection URIs remain valid and parseable", () => {
			const specialPass = "p@ss:w/ord#with?chars&more=1%40";
			const mongoRecord = {
				appName: "mongo-special-chars",
				databaseUser: "user_special",
				databasePassword: specialPass,
				databaseName: "testdb",
				authSource: "admin",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				mongoRecord,
				"db.hatdot.cloud",
			);

			const externalUrl = conn.external.url!;
			// Verify percent encoding of @, :, /, #, ?, &, %
			expect(externalUrl).toContain(encodeURIComponent(specialPass));
			expect(externalUrl).toContain("authSource=admin");
			expect(externalUrl).toContain("directConnection=true");

			// Ensure MongoDB URI starts with mongodb:// and does not corrupt protocol or host
			expect(externalUrl.startsWith("mongodb://")).toBe(true);
			expect(externalUrl).toContain("@db.hatdot.cloud:27017/testdb");
		});

		it("respects custom authSource when configured on database record", () => {
			const mongoRecord = {
				appName: "mongo-custom-auth",
				databaseUser: "custom_user",
				databasePassword: "mypassword",
				databaseName: "my_app_db",
				authSource: "my_app_db",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				mongoRecord,
				"db.hatdot.cloud",
			);

			expect(conn.external.url).toContain("authSource=my_app_db");
		});

		it("masks passwords by default in connection string builders", () => {
			const record = {
				appName: "postgres-masking",
				databaseUser: "pg_user",
				databasePassword: "super_secret_password",
				databaseName: "production_db",
				externalPort: 5432,
			};

			const conn = buildDatabaseConnectionStrings(
				"postgres",
				record,
				"db.hatdot.cloud",
			);

			// Real URL has password for connection
			expect(conn.external.url).toContain("super_secret_password");

			// redactCredentials hides passwords
			const redacted = redactCredentials(conn.external.url!);
			expect(redacted).not.toContain("super_secret_password");
			expect(redacted).toContain("***");
		});
	});

	describe("2. Database Connectivity Verification & Diagnostics", () => {
		it("marks internal-only databases as not externally enabled when externalPort is null", () => {
			const record = {
				appName: "mongo-internal-only",
				databaseUser: "user1",
				databasePassword: "pass1",
				databaseName: "db1",
				externalPort: null,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				record,
				"db.hatdot.cloud",
			);

			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.internal.url).toBe(
				"mongodb://user1:pass1@mongo-internal-only:27017/db1?authSource=admin&directConnection=true",
			);
		});

		it("returns unconfigured status when external access is not published", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "db.hatdot.cloud",
				port: null,
			});

			expect(result.isConfigured).toBe(false);
			expect(result.dnsStatus).toBe("unconfigured");
			expect(result.tcpStatus).toBe("unconfigured");
			expect(result.authStatus).toBe("untested");
			expect(result.message).toContain("Public external access is currently disabled");
		});

		it("reports failed DNS resolution for non-existent domain", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "non-existent-fake-domain-123456789.invalid",
				port: 27017,
			});

			expect(result.isConfigured).toBe(true);
			expect(result.dnsStatus).toBe("failed");
			expect(result.diagnostics?.errorCode).toBe("ENOTFOUND");
		});
	});

	describe("3. Multi-Tenant Isolation & Security Boundaries", () => {
		it("sanitizes database and collection identifiers against injection", () => {
			expect(sanitizeDatabaseIdentifier("users")).toBe("users");
			expect(sanitizeDatabaseIdentifier("app_data_2026")).toBe("app_data_2026");
			// Cleanses malicious characters (semicolons, quotes, spaces) into safe underscores
			expect(sanitizeDatabaseIdentifier("users; DROP TABLE users;")).toBe("users_drop_table_users");
			expect(sanitizeDatabaseIdentifier("coll$name")).toBe("coll_name");
			expect(sanitizeDatabaseIdentifier("db/test")).toBe("db_test");
			// Avoids reserved system database names
			expect(sanitizeDatabaseIdentifier("admin")).toBe("admin_db");
			expect(sanitizeDatabaseIdentifier("")).toBe("app");
		});

		it("blocks destructive and administrative Redis commands in the command console", async () => {
			const fakeRecord = {
				appName: "redis-test",
				serverId: null,
				databasePassword: "password",
			};

			const BANNED_COMMANDS = [
				"FLUSHALL",
				"flushall",
				"FLUSHDB",
				"SHUTDOWN",
				"CONFIG GET *",
				"DEBUG SEGFAULT",
				"SLAVEOF 127.0.0.1 6379",
				"REPLICAOF NO ONE",
				"KEYS *",
				"ACL LIST",
				"CLUSTER NODES",
				"SAVE",
				"BGSAVE",
			];

			for (const cmd of BANNED_COMMANDS) {
				await expect(
					redisAdapter.executeCommand(fakeRecord, cmd),
				).rejects.toThrow(TRPCError);

				try {
					await redisAdapter.executeCommand(fakeRecord, cmd);
				} catch (err: any) {
					expect(err.code).toBe("FORBIDDEN");
					expect(err.message).toContain("restricted for database safety");
				}
			}
		});

		it("redacts passwords and credentials from logs and error strings", () => {
			const sensitiveString =
				"Error connecting to mongodb://customer_user:MySecretPassword123@db.hatdot.cloud:27017/app?authSource=admin";
			const redacted = redactCredentials(sensitiveString);

			expect(redacted).not.toContain("MySecretPassword123");
			expect(redacted).toContain("customer_user:***@db.hatdot.cloud:27017/app");
		});

		it("redacts postgres and mysql passwords from error logs", () => {
			const pgError =
				"psql: error: connection to postgresql://postgres:SuperSecretPostgresPass!@db.hatdot.cloud:5432/postgres failed";
			const redacted = redactCredentials(pgError);

			expect(redacted).not.toContain("SuperSecretPostgresPass!");
			expect(redacted).toContain("postgres:***@db.hatdot.cloud:5432");
		});
	});
});

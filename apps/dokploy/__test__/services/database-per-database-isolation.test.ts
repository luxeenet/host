import {
	buildDatabaseConnectionStrings,
	generateMongoIsolationScript,
	generatePostgresIsolationSql,
	generatePostgresSchemaIsolationSql,
	generateMysqlIsolationSql,
	generateRedisAclCommands,
	redactCredentials,
	sanitizeDatabaseIdentifier,
	sanitizeDatabaseRecord,
	reconcileDatabaseSecurity,
} from "@dokploy/server";
import { describe, expect, it } from "vitest";

describe("CRITICAL SECURITY: Per-Database Isolation and Least-Privilege Verification", () => {
	describe("1. Database A's credentials can access Database A as intended", () => {
		it("generates MongoDB URI targeting strictly assigned database and authSource", () => {
			const record = {
				appName: "customer-mongo-1",
				name: "Customer Mongo",
				databaseUser: "tenant_user_1",
				databasePassword: "password_secure_1",
				databaseName: "customer_db_1",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings("mongo", record, "db.hatdot.cloud");
			expect(conn.type).toBe("mongo");
			expect(conn.internal.url).toContain("/customer_db_1?authSource=customer_db_1");
			expect(conn.external.url).toContain("/customer_db_1?authSource=customer_db_1");
			expect(conn.isolation?.isIsolated).toBe(true);
			expect(conn.isolation?.scope).toBe("database: customer_db_1");
			expect(conn.isolation?.role).toBe("readWrite");
		});

		it("generates PostgreSQL URI scoped strictly to the customer database", () => {
			const record = {
				appName: "customer-pg-1",
				name: "Customer Postgres",
				databaseUser: "tenant_pg_user",
				databasePassword: "pg_password_1",
				databaseName: "tenant_sales_db",
				externalPort: 5432,
			};

			const conn = buildDatabaseConnectionStrings("postgres", record, "db.hatdot.cloud");
			expect(conn.internal.url).toBe("postgresql://tenant_pg_user:pg_password_1@customer-pg-1:5432/tenant_sales_db");
			expect(conn.external.url).toBe("postgresql://tenant_pg_user:pg_password_1@db.hatdot.cloud:5432/tenant_sales_db");
			expect(conn.isolation?.isIsolated).toBe(true);
			expect(conn.isolation?.scope).toBe("database: tenant_sales_db");
		});

		it("generates MySQL URI scoped strictly to the customer database", () => {
			const record = {
				appName: "customer-mysql-1",
				name: "Customer MySQL",
				databaseUser: "tenant_mysql_user",
				databasePassword: "mysql_pass_1",
				databaseName: "tenant_inventory",
				externalPort: 3306,
			};

			const conn = buildDatabaseConnectionStrings("mysql", record, "db.hatdot.cloud");
			expect(conn.internal.url).toBe("mysql://tenant_mysql_user:mysql_pass_1@customer-mysql-1:3306/tenant_inventory");
			expect(conn.external.url).toBe("mysql://tenant_mysql_user:mysql_pass_1@db.hatdot.cloud:3306/tenant_inventory");
		});
	});

	describe("2. Database A's credentials cannot read or modify Database B", () => {
		it("enforces MongoDB script grants readWrite strictly on assigned DB and removes admin access", () => {
			const script = generateMongoIsolationScript({
				customerUser: "tenant_a_user",
				customerPass: "tenant_a_pass",
				databaseName: "tenant_a_db",
			});

			// Must target tenant_a_db
			expect(script).toContain("db.getSiblingDB('tenant_a_db')");
			expect(script).toContain("roles: [{ role: 'readWrite', db: 'tenant_a_db' }]");
			// Must drop user from admin db if legacy overprivileged
			expect(script).toContain("adminDb.dropUser('tenant_a_user')");
			// Must NOT grant any cluster admin roles
			expect(script).not.toContain("root");
			expect(script).not.toContain("dbAdminAnyDatabase");
			expect(script).not.toContain("readWriteAnyDatabase");
			expect(script).not.toContain("userAdminAnyDatabase");
		});

		it("enforces MySQL script revokes global privileges and grants only database_name.*", () => {
			const sql = generateMysqlIsolationSql({
				customerUser: "tenant_a",
				customerPass: "secret_a",
				databaseName: "database_a",
			});

			expect(sql).toContain("REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tenant_a'@'%'");
			expect(sql).toContain("ON `database_a`.* TO 'tenant_a'@'%'");
			// Must NOT grant on *.*
			expect(sql).not.toContain("ON *.*");
			expect(sql).not.toContain("GRANT ALL PRIVILEGES ON *.*");
		});
	});

	describe("3. Database A's credentials cannot create or provision another database outside allowed scope", () => {
		it("enforces PostgreSQL script creates role with NOCREATEDB", () => {
			const sql = generatePostgresIsolationSql({
				customerUser: "tenant_user",
				customerPass: "tenant_pass",
				databaseName: "customer_db",
			});

			expect(sql).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION");
			// Revoke connect on default databases
			expect(sql).toContain("REVOKE CONNECT ON DATABASE template1 FROM \"tenant_user\"");
			expect(sql).toContain("REVOKE CONNECT ON DATABASE postgres FROM \"tenant_user\"");
		});

		it("enforces MySQL script excludes global CREATE DATABASE privilege", () => {
			const sql = generateMysqlIsolationSql({
				customerUser: "app_user",
				customerPass: "app_pass",
				databaseName: "app_db",
			});

			// Only grants on `app_db`.*, not global CREATE
			expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER");
			expect(sql).toContain("ON `app_db`.*");
			expect(sql).not.toContain("GRANT CREATE USER");
			expect(sql).not.toContain("GRANT ALL PRIVILEGES ON *.*");
			expect(sql).not.toContain("CREATE TABLESPACE");
		});
	});

	describe("4. Database A's credentials cannot create users, grant roles, or obtain administrative privileges", () => {
		it("verifies MongoDB script grants no userAdmin or clusterAdmin roles", () => {
			const script = generateMongoIsolationScript({
				customerUser: "client_user",
				customerPass: "client_pass",
				databaseName: "client_db",
			});

			expect(script).not.toContain("userAdmin");
			expect(script).not.toContain("clusterAdmin");
			expect(script).not.toContain("hostManager");
		});

		it("verifies PostgreSQL script assigns NOCREATEROLE and NOSUPERUSER", () => {
			const sql = generatePostgresIsolationSql({
				customerUser: "pg_client",
				customerPass: "pg_pass",
				databaseName: "pg_db",
			});

			expect(sql).toContain("NOCREATEROLE");
			expect(sql).toContain("NOSUPERUSER");
		});

		it("verifies MySQL script revokes GRANT OPTION", () => {
			const sql = generateMysqlIsolationSql({
				customerUser: "my_client",
				customerPass: "my_pass",
				databaseName: "my_db",
			});

			expect(sql).toContain("REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'my_client'@'%'");
			expect(sql).not.toContain("WITH GRANT OPTION");
		});
	});

	describe("5. MongoDB Compass-style connections expose only assigned database", () => {
		it("generates Compass URI with authSource matching target database instead of admin", () => {
			const record = {
				appName: "mongo-compass-app",
				databaseUser: "compass_user",
				databasePassword: "compass_password",
				databaseName: "ecommerce_db",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings("mongo", record, "db.hatdot.cloud");
			// Must have database path /ecommerce_db
			expect(conn.external.url).toContain("/ecommerce_db?");
			// Must have authSource=ecommerce_db (not authSource=admin!)
			expect(conn.external.url).toContain("authSource=ecommerce_db");
			expect(conn.external.url).not.toContain("authSource=admin");
			expect(conn.external.url).toContain("directConnection=true");
		});

		it("sanitizes default database name when databaseName is missing", () => {
			const record = {
				appName: "mongo-no-db-name",
				name: "My App Database",
				databaseUser: "compass_user",
				databasePassword: "compass_password",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings("mongo", record, "db.hatdot.cloud");
			expect(conn.external.url).toContain("/my_app_database?");
			expect(conn.external.url).toContain("authSource=my_app_database");
		});
	});

	describe("6. PostgreSQL users cannot connect to unrelated tenant databases or exploit permissive schema grants", () => {
		it("revokes CONNECT on template1 and postgres", () => {
			const sql = generatePostgresIsolationSql({
				customerUser: "restricted_pg",
				customerPass: "safe_pass",
				databaseName: "safe_db",
			});

			expect(sql).toContain("REVOKE CONNECT ON DATABASE template1 FROM \"restricted_pg\"");
			expect(sql).toContain("REVOKE CONNECT ON DATABASE postgres FROM \"restricted_pg\"");
		});

		it("scopes schema ownership and table privileges to public schema within assigned database", () => {
			const schemaSql = generatePostgresSchemaIsolationSql("restricted_pg");
			expect(schemaSql).toContain("ALTER SCHEMA public OWNER TO \"restricted_pg\"");
			expect(schemaSql).toContain("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"restricted_pg\"");
			expect(schemaSql).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"restricted_pg\"");
		});
	});

	describe("7. MySQL/MariaDB users cannot access other schemas or perform global administration", () => {
		it("ensures host pattern is wildcard '%' and privileges strictly bounded to database", () => {
			const sql = generateMysqlIsolationSql({
				customerUser: "sql_user",
				customerPass: "sql_pass",
				databaseName: "orders_db",
			});

			expect(sql).toContain("ON `orders_db`.* TO 'sql_user'@'%'");
			expect(sql).not.toContain("ON `mysql`.*");
			expect(sql).not.toContain("ON `sys`.*");
		});
	});

	describe("8. Redis users cannot access other tenants' keys or administrative commands", () => {
		it("generates Redis ACL command disabling dangerous commands", () => {
			const commands = generateRedisAclCommands({
				customerUser: "tenant_redis",
				customerPass: "redis_secret",
			});

			expect(commands.length).toBeGreaterThan(0);
			const acl = commands[0];
			expect(acl).toContain("+@read +@write");
			expect(acl).toContain("-@admin");
			expect(acl).toContain("-@dangerous");
			expect(acl).toContain("-FLUSHALL");
			expect(acl).toContain("-FLUSHDB");
			expect(acl).toContain("-SHUTDOWN");
			expect(acl).toContain("-CONFIG");
			expect(acl).toContain("-ACL");
			expect(acl).toContain("-DEBUG");
			expect(acl).toContain("-KEYS");
		});
	});

	describe("9. LibSQL / SQLite-compatible databases: prevent unauthorized exposure", () => {
		it("generates LibSQL connection targeting only application port 8080 without exposing admin port", () => {
			const record = {
				appName: "libsql-tenant-1",
				databaseUser: "libsql_user",
				databasePassword: "libsql_password",
				externalPort: 8080,
				externalAdminPort: 5000,
			};

			const conn = buildDatabaseConnectionStrings("libsql", record, "db.hatdot.cloud");
			// Customer URL must connect to 8080 (application port), NEVER to 5000 (admin port)
			expect(conn.external.port).toBe(8080);
			expect(conn.external.url).toBe("http://libsql_user:libsql_password@db.hatdot.cloud:8080");
			expect(conn.external.url).not.toContain(":5000");
		});
	});

	describe("10. Sanitization and Credential Redaction in API Responses and Logs", () => {
		it("redacts passwords from error messages and URIs", () => {
			const logWithMongoUri = "Connection failed to mongodb://tenant_user:super_secret_password_123@db.hatdot.cloud:27017/app?authSource=app";
			const redacted = redactCredentials(logWithMongoUri);
			expect(redacted).not.toContain("super_secret_password_123");
			expect(redacted).toContain("mongodb://tenant_user:***@db.hatdot.cloud:27017/app");
		});

		it("redacts passwords from PostgreSQL URIs", () => {
			const logWithPgUri = "Error in postgresql://postgres_user:top_secret_pg_pass@45.88.188.6:5432/my_db";
			const redacted = redactCredentials(logWithPgUri);
			expect(redacted).not.toContain("top_secret_pg_pass");
			expect(redacted).toContain("postgresql://postgres_user:***@45.88.188.6:5432/my_db");
		});

		it("sanitizes database records by removing databaseRootPassword", () => {
			const rawRecord = {
				mysqlId: "mysql-123",
				appName: "my-mysql",
				databaseUser: "app_user",
				databasePassword: "user_password",
				databaseRootPassword: "root_super_secret_123",
				databaseName: "my_db",
			};

			const safeRecord = sanitizeDatabaseRecord(rawRecord);
			expect((safeRecord as any).databaseRootPassword).toBeUndefined();
			expect(safeRecord.databaseUser).toBe("app_user");
			expect(safeRecord.databasePassword).toBe("user_password");
		});
	});

	describe("11. Safe Identifier Handling and Sanitization", () => {
		it("sanitizes arbitrary strings into safe, valid identifiers", () => {
			expect(sanitizeDatabaseIdentifier("My Customer's DB!")).toBe("my_customer_s_db");
			expect(sanitizeDatabaseIdentifier("../../etc/passwd")).toBe("etc_passwd");
			expect(sanitizeDatabaseIdentifier("admin")).toBe("admin_db"); // reserved system name avoided
			expect(sanitizeDatabaseIdentifier("")).toBe("app");
			expect(sanitizeDatabaseIdentifier(null)).toBe("app");
		});
	});

	describe("12. Idempotent Reconciliation and Safe Fallbacks", () => {
		it("generates idempotent SQL that does not fail on second execution", () => {
			const pgSql = generatePostgresIsolationSql({
				customerUser: "test_role",
				customerPass: "test_pass",
				databaseName: "test_db",
			});
			// Uses DO block with IF NOT EXISTS ... ELSE ALTER ROLE
			expect(pgSql).toContain("IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles");
			expect(pgSql).toContain("ALTER ROLE \"test_role\" WITH PASSWORD");

			const mySql = generateMysqlIsolationSql({
				customerUser: "test_user",
				customerPass: "test_pass",
				databaseName: "test_db",
			});
			expect(mySql).toContain("CREATE USER IF NOT EXISTS 'test_user'@'%'");
			expect(mySql).toContain("ALTER USER 'test_user'@'%'");
		});
	});
});

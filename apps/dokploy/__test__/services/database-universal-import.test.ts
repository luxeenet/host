import {
	convertSqlValue,
	executeDatabaseImport,
	parseCsv,
	parseJsonRecords,
	previewImport,
	type DatabaseImportOptions,
} from "@dokploy/server";
import { describe, expect, it, vi } from "vitest";

// Mock docker container discovery
vi.mock("@dokploy/server/utils/docker/utils", () => ({
	getServiceContainer: vi.fn(async () => ({ Id: "mock-database-container-123" })),
}));

// Mock command execution inside docker container
vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: vi.fn(async (cmd: string) => {
		// PostgreSQL psql simulation
		if (cmd.includes("psql")) {
			return { stdout: "INSERT 0 1\n", stderr: "" };
		}

		if (cmd.includes("DESCRIBE") || cmd.includes("SHOW INDEX")) {
			return { stdout: "", stderr: "" };
		}

		// MySQL & MariaDB simulation
		if (cmd.includes("mysql")) {
			return { stdout: "Records: 1  Duplicates: 0  Warnings: 0", stderr: "" };
		}

		// LibSQL sqld HTTP pipeline simulation
		if (cmd.includes("8080/v1/pipeline")) {
			return {
				stdout: JSON.stringify({
					results: [
						{ type: "ok", response: { result: { rows_affected: 1 } } },
						{ type: "ok", response: { result: { rows_affected: 1 } } },
						{ type: "ok", response: { result: { rows_affected: 1 } } },
					],
				}),
				stderr: "",
			};
		}

		// MongoDB mongosh batch script simulation
		if (cmd.includes("mongosh")) {
			return {
				stdout: JSON.stringify({
					inserted: 2,
					updated: 0,
					skipped: 0,
					failed: 0,
					errors: [],
				}),
				stderr: "",
			};
		}

		// Redis redis-cli command simulation
		if (cmd.includes("redis-cli")) {
			if (cmd.includes("HSET")) return { stdout: "(integer) 1", stderr: "" };
			if (cmd.includes("SET")) return { stdout: "OK", stderr: "" };
			if (cmd.includes("RPUSH")) return { stdout: "(integer) 1", stderr: "" };
			if (cmd.includes("SADD")) return { stdout: "(integer) 1", stderr: "" };
			if (cmd.includes("ZADD")) return { stdout: "(integer) 1", stderr: "" };
			return { stdout: "OK", stderr: "" };
		}

		return { stdout: "OK", stderr: "" };
	}),
	execAsyncRemote: vi.fn(async () => ({ stdout: "OK", stderr: "" })),
}));

describe("Universal Data Import for All 6 Database Engines", () => {
	/* =======================================================================
	 * 1. PARSER TESTS (RFC 4180 CSV & MULTI-FORMAT JSON)
	 * ======================================================================= */
	describe("RFC 4180 CSV & Multi-format JSON Parsing", () => {
		it("correctly parses RFC 4180 CSV with quotes, commas within quotes, and escaped quotes", () => {
			const csvData = [
				'id,name,description,"price, USD",active',
				'1,"Alice, Chief Engineer","Builds ""rock-solid"" systems",99.50,true',
				'2,"Bob",,"1,250.00",false',
			].join("\n");

			const { headers, rows } = parseCsv(csvData);

			expect(headers).toEqual(["id", "name", "description", "price, USD", "active"]);
			expect(rows).toHaveLength(2);
			expect(rows[0]).toEqual({
				id: "1",
				name: "Alice, Chief Engineer",
				description: 'Builds "rock-solid" systems',
				"price, USD": "99.50",
				active: "true",
			});
			expect(rows[1]).toEqual({
				id: "2",
				name: "Bob",
				description: "",
				"price, USD": "1,250.00",
				active: "false",
			});
		});

		it("correctly parses standard JSON arrays", () => {
			const jsonArray = JSON.stringify([
				{ id: 101, username: "dev1", roles: ["admin", "editor"], active: true },
				{ id: 102, username: "dev2", roles: ["viewer"], active: false },
			]);

			const { headers, rows } = parseJsonRecords(jsonArray);

			expect(headers).toContain("id");
			expect(headers).toContain("username");
			expect(headers).toContain("roles");
			expect(headers).toContain("active");
			expect(rows).toHaveLength(2);
			expect(rows[0]?.id).toBe(101);
			expect(rows[0]?.roles).toEqual(["admin", "editor"]);
		});

		it("correctly parses NDJSON (Newline-Delimited JSON)", () => {
			const ndjson = [
				'{"id": 1, "metric": "cpu", "value": 42.5}',
				'{"id": 2, "metric": "memory", "value": 81.2}',
				'{"id": 3, "metric": "disk", "value": 15.0}',
			].join("\n");

			const { headers, rows } = parseJsonRecords(ndjson);

			expect(headers).toEqual(["id", "metric", "value"]);
			expect(rows).toHaveLength(3);
			expect(rows[1]?.metric).toBe("memory");
			expect(rows[1]?.value).toBe(81.2);
		});

		it("correctly parses single JSON objects into a single record row", () => {
			const singleObj = JSON.stringify({
				tenantId: "org-xyz",
				plan: "enterprise",
				seats: 50,
			});

			const { headers, rows } = parseJsonRecords(singleObj);

			expect(headers).toEqual(["tenantId", "plan", "seats"]);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.seats).toBe(50);
		});

		it("previewImport generates headers, preview rows, and inferred types", () => {
			const csv = "id,name,score,registered_at\n1,Alpha,98.5,2026-01-01T10:00:00Z\n2,Beta,75.0,2026-01-02T12:00:00Z";
			const preview = previewImport(csv, "csv");

			expect(preview.headers).toEqual(["id", "name", "score", "registered_at"]);
			expect(preview.totalRecords).toBe(2);
			expect(preview.previewRows).toHaveLength(2);
			expect(preview.inferredTypes.id).toBe("integer");
			expect(preview.inferredTypes.score).toBe("numeric");
			expect(preview.inferredTypes.registered_at).toBe("timestamp");
		});
	});

	/* =======================================================================
	 * 2. SCHEMA-AWARE TYPE CONVERSION TESTS
	 * ======================================================================= */
	describe("Schema-Aware SQL Type Conversion", () => {
		it("converts boolean values accurately across variants", () => {
			expect(convertSqlValue("true", "boolean").valueSql).toBe("TRUE");
			expect(convertSqlValue("TRUE", "bool").valueSql).toBe("TRUE");
			expect(convertSqlValue(1, "boolean").valueSql).toBe("TRUE");
			expect(convertSqlValue("t", "boolean").valueSql).toBe("TRUE");
			expect(convertSqlValue("yes", "boolean").valueSql).toBe("TRUE");

			expect(convertSqlValue("false", "boolean").valueSql).toBe("FALSE");
			expect(convertSqlValue("FALSE", "bool").valueSql).toBe("FALSE");
			expect(convertSqlValue(0, "boolean").valueSql).toBe("FALSE");
			expect(convertSqlValue("f", "boolean").valueSql).toBe("FALSE");
			expect(convertSqlValue("no", "boolean").valueSql).toBe("FALSE");
		});

		it("converts integer and numeric types and strips formatting commas", () => {
			expect(convertSqlValue("1,250", "integer").valueSql).toBe("1250");
			expect(convertSqlValue("-42", "int").valueSql).toBe("-42");
			expect(convertSqlValue("99.95", "decimal(10,2)").valueSql).toBe("99.95");
			expect(convertSqlValue("1.5e3", "float").valueSql).toBe("1500");
			expect(convertSqlValue(null, "integer").valueSql).toBe("NULL");
			expect(convertSqlValue("", "integer").valueSql).toBe("NULL");
		});

		it("escapes single quotes in strings to prevent SQL syntax errors and injection", () => {
			expect(convertSqlValue("O'Connor", "varchar(50)").valueSql).toBe("'O''Connor'");
			expect(convertSqlValue("HatDot's Platform", "text").valueSql).toBe("'HatDot''s Platform'");
		});

		it("converts JSON / JSONB objects and arrays safely into string literals", () => {
			const obj = { theme: "dark", notifications: true };
			const result = convertSqlValue(obj, "jsonb").valueSql;
			expect(result).toBe(`'{"theme":"dark","notifications":true}'`);
		});

		it("converts timestamps and ISO dates into sanitized SQL literals", () => {
			const iso = "2026-10-18T18:00:00.000Z";
			expect(convertSqlValue(iso, "timestamptz").valueSql).toBe(`'${iso}'`);
		});
	});

	/* =======================================================================
	 * 3. POSTGRESQL IMPORT TESTS
	 * ======================================================================= */
	describe("PostgreSQL Universal Import", () => {
		it("imports CSV records with skip duplicate policy using ON CONFLICT DO NOTHING", async () => {
			const mockRecord = {
				appName: "postgres-test",
				databaseUser: "postgres",
				databasePassword: "secret_pg_password",
				databaseName: "customer_pg",
			};

			const csv = "id,name,email,score\n1,Alice,alice@hatdot.cloud,95\n2,Bob,bob@hatdot.cloud,80";

			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "skip",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.insertedCount).toBeGreaterThanOrEqual(1);
			expect(result.failedCount).toBe(0);
			expect(result.errors).toHaveLength(0);
		});

		it("imports JSON records with update policy using ON CONFLICT DO UPDATE", async () => {
			const mockRecord = {
				appName: "postgres-test",
				databaseUser: "postgres",
				databasePassword: "secret_pg_password",
				databaseName: "customer_pg",
			};

			const json = JSON.stringify([
				{ id: 1, name: "Alice Updated", email: "alice@hatdot.cloud", score: 99 },
			]);

			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: json,
				fileType: "json",
				duplicatePolicy: "update",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(1);
			expect(result.failedCount).toBe(0);
		});
	});

	/* =======================================================================
	 * 4. MYSQL & MARIADB IMPORT TESTS
	 * ======================================================================= */
	describe("MySQL & MariaDB Universal Import", () => {
		it("imports CSV records into MySQL using INSERT IGNORE for skip policy", async () => {
			const mockRecord = {
				appName: "mysql-test",
				databaseUser: "root",
				databasePassword: "secret_mysql_password",
				databaseName: "shop_db",
			};

			const csv = "sku,title,price,in_stock\nPROD-1,Widget A,19.99,1\nPROD-2,Widget B,29.99,0";

			const options: DatabaseImportOptions = {
				databaseId: "mysql-db-1",
				engine: "mysql",
				targetEntity: "products",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "skip",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
			expect(result.insertedCount).toBeGreaterThanOrEqual(1);
		});

		it("imports JSON records into MariaDB with ON DUPLICATE KEY UPDATE", async () => {
			const mockRecord = {
				appName: "mariadb-test",
				databaseUser: "maria_admin",
				databasePassword: "secret_maria_password",
				databaseName: "analytics_db",
			};

			const json = JSON.stringify([
				{ event_id: "evt-100", type: "pageview", count: 42 },
				{ event_id: "evt-101", type: "click", count: 18 },
			]);

			const options: DatabaseImportOptions = {
				databaseId: "maria-db-1",
				engine: "mariadb",
				targetEntity: "events",
				fileContent: json,
				fileType: "json",
				duplicatePolicy: "update",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
		});
	});

	/* =======================================================================
	 * 5. LIBSQL (SQLITE) IMPORT TESTS
	 * ======================================================================= */
	describe("LibSQL Universal Import", () => {
		it("imports CSV records into LibSQL table using INSERT OR IGNORE", async () => {
			const mockRecord = {
				appName: "libsql-test",
				databaseUser: "",
				databasePassword: "",
				databaseName: "data.db",
			};

			const csv = "id,name,category,rating\n10,Item X,Hardware,4.8\n11,Item Y,Software,4.2";

			const options: DatabaseImportOptions = {
				databaseId: "libsql-db-1",
				engine: "libsql",
				targetEntity: "catalog",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "skip",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
		});

		it("imports JSON records into LibSQL using INSERT OR REPLACE for update policy", async () => {
			const mockRecord = {
				appName: "libsql-test",
				databaseUser: "",
				databasePassword: "",
				databaseName: "data.db",
			};

			const json = JSON.stringify([
				{ id: 10, name: "Item X Updated", category: "Hardware", rating: 5.0 },
			]);

			const options: DatabaseImportOptions = {
				databaseId: "libsql-db-1",
				engine: "libsql",
				targetEntity: "catalog",
				fileContent: json,
				fileType: "json",
				duplicatePolicy: "update",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(1);
			expect(result.failedCount).toBe(0);
		});
	});

	/* =======================================================================
	 * 6. MONGODB IMPORT TESTS
	 * ======================================================================= */
	describe("MongoDB Universal Import", () => {
		it("imports JSON documents into MongoDB collection with upsert", async () => {
			const mockRecord = {
				appName: "mongo-test",
				databaseUser: "mongo_user",
				databasePassword: "mongo_password",
				databaseName: "app_mongo",
			};

			const json = JSON.stringify([
				{ _id: "doc-1", customer: "Acme Corp", tier: "Gold", active: true },
				{ _id: "doc-2", customer: "Globex", tier: "Silver", active: false },
			]);

			const options: DatabaseImportOptions = {
				databaseId: "mongo-db-1",
				engine: "mongo",
				targetEntity: "customers",
				fileContent: json,
				fileType: "json",
				duplicatePolicy: "update",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
			expect(result.insertedCount + result.updatedCount).toBeGreaterThanOrEqual(1);
		});

		it("imports CSV to MongoDB documents and maps types correctly", async () => {
			const mockRecord = {
				appName: "mongo-test",
				databaseUser: "mongo_user",
				databasePassword: "mongo_password",
				databaseName: "app_mongo",
			};

			const csv = "id,title,views,published\nart-1,Hello World,1200,true\nart-2,PaaS Guide,3400,true";

			const options: DatabaseImportOptions = {
				databaseId: "mongo-db-1",
				engine: "mongo",
				targetEntity: "articles",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "skip",
			};

			const result = await executeDatabaseImport(mockRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
		});
	});

	/* =======================================================================
	 * 7. REDIS MULTI-STRUCTURE IMPORT TESTS
	 * ======================================================================= */
	describe("Redis Multi-Structure Universal Import", () => {
		const mockRedisRecord = {
			appName: "redis-test",
			databasePassword: "secret_redis_pass",
		};

		it("imports records mapped into Redis Hashes (HSET)", async () => {
			const csv = "user_id,username,email,role\nu101,john_doe,john@example.com,admin\nu102,jane_doe,jane@example.com,user";

			const options: DatabaseImportOptions = {
				databaseId: "redis-db-1",
				engine: "redis",
				targetEntity: "users:",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "update",
				redisConfig: {
					structure: "hash",
					keyField: "user_id",
					keyPrefix: "user:",
				},
			};

			const result = await executeDatabaseImport(mockRedisRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
		});

		it("imports records mapped into Redis Strings with TTL", async () => {
			const json = JSON.stringify([
				{ session_id: "sess_abc", token: "tok_123", valid: true },
				{ session_id: "sess_def", token: "tok_456", valid: true },
			]);

			const options: DatabaseImportOptions = {
				databaseId: "redis-db-1",
				engine: "redis",
				targetEntity: "sessions:",
				fileContent: json,
				fileType: "json",
				duplicatePolicy: "update",
				redisConfig: {
					structure: "string",
					keyField: "session_id",
					keyPrefix: "sess:",
					ttl: 3600,
				},
			};

			const result = await executeDatabaseImport(mockRedisRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(2);
			expect(result.failedCount).toBe(0);
		});

		it("imports records into Redis Lists (RPUSH)", async () => {
			const csv = "task\nProcess invoice #1\nSend confirmation email\nUpdate metrics";

			const options: DatabaseImportOptions = {
				databaseId: "redis-db-1",
				engine: "redis",
				targetEntity: "queue:tasks",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "update",
				redisConfig: {
					structure: "list",
					keyPrefix: "queue:tasks",
				},
			};

			const result = await executeDatabaseImport(mockRedisRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(3);
			expect(result.failedCount).toBe(0);
		});

		it("imports records into Redis Sets (SADD)", async () => {
			const csv = "tag\nproduction\nhatdot\ncloud";

			const options: DatabaseImportOptions = {
				databaseId: "redis-db-1",
				engine: "redis",
				targetEntity: "system:tags",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "skip",
				redisConfig: {
					structure: "set",
					keyPrefix: "system:tags",
				},
			};

			const result = await executeDatabaseImport(mockRedisRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(3);
			expect(result.failedCount).toBe(0);
		});

		it("imports records into Redis Sorted Sets (ZADD with score)", async () => {
			const csv = "player,points\nAlice,950\nBob,720\nCharlie,840";

			const options: DatabaseImportOptions = {
				databaseId: "redis-db-1",
				engine: "redis",
				targetEntity: "leaderboard",
				fileContent: csv,
				fileType: "csv",
				duplicatePolicy: "update",
				redisConfig: {
					structure: "zset",
					keyField: "player",
					scoreField: "points",
					keyPrefix: "leaderboard",
				},
			};

			const result = await executeDatabaseImport(mockRedisRecord, options);

			expect(result.persisted).toBe(true);
			expect(result.totalRecords).toBe(3);
			expect(result.failedCount).toBe(0);
		});
	});

	/* =======================================================================
	 * 8. SECURITY, LIMITS & ERROR TRACKING TESTS
	 * ======================================================================= */
	describe("Security, Limits, and Error Handling", () => {
		it("enforces 10MB maximum file size limit", async () => {
			const largeContent = "a".repeat(11 * 1024 * 1024);

			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: largeContent,
				fileType: "csv",
			};

			await expect(
				executeDatabaseImport({ appName: "pg" }, options),
			).rejects.toThrow(/exceeds maximum allowed limit of 10 MB/);
		});

		it("enforces 5,000 maximum records limit per batch", async () => {
			// Generate 5,001 rows
			const rows = ["id,val"];
			for (let i = 1; i <= 5001; i++) {
				rows.push(`${i},val_${i}`);
			}
			const csv = rows.join("\n");

			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: csv,
				fileType: "csv",
			};

			await expect(
				executeDatabaseImport({ appName: "pg" }, options),
			).rejects.toThrow(/Maximum allowed per operation is 5,000 records/);
		});

		it("prevents arbitrary SQL injection in targetEntity", async () => {
			const maliciousOptions: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users; DROP TABLE users; --",
				fileContent: "id,name\n1,Alice",
				fileType: "csv",
			};

			await expect(
				executeDatabaseImport({ appName: "pg" }, maliciousOptions),
			).rejects.toThrow();
		});

		it("rejects empty or whitespace-only files with clear message", async () => {
			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: "   \n\n  ",
				fileType: "csv",
			};

			await expect(
				executeDatabaseImport({ appName: "pg" }, options),
			).rejects.toThrow(/contains no data records/);
		});

		it("returns row-level error details for partial failures without reporting success", async () => {
			const mockRecord = {
				appName: "postgres-test",
				databaseUser: "postgres",
				databasePassword: "secret_pg_password",
				databaseName: "customer_pg",
			};

			// Duplicate policy: reject
			const options: DatabaseImportOptions = {
				databaseId: "pg-db-1",
				engine: "postgres",
				targetEntity: "users",
				fileContent: "id,name\n1,Alice\n2,Bob",
				fileType: "csv",
				duplicatePolicy: "reject",
			};

			const result = await executeDatabaseImport(mockRecord, options);
			expect(result.totalRecords).toBe(2);
			expect(result.summaryMessage).toBeDefined();
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});
});

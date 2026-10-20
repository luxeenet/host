import {
	buildDatabaseConnectionStrings,
} from "@dokploy/server/services/database-connection";
import {
	mongoAdapter,
	listDatabases,
} from "@dokploy/server/services/database-manager";
import {
	redactCredentials,
	sanitizeCustomerDiagnostic,
	sanitizeDatabaseIdentifier,
} from "@dokploy/server/services/database-security";
import { execAsync } from "@dokploy/server/utils/process/execAsync";
import { getServiceContainer } from "@dokploy/server/utils/docker/utils";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock docker service container utilities
vi.mock("@dokploy/server/utils/docker/utils", () => ({
	getServiceContainer: vi.fn(),
}));

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
}));

describe("HatDot Production Fix: Real Database Records, Correct Discovery, and Customer-Safe UI", () => {
	const mockMongoRecord = {
		id: "mongo-test-id-123",
		appName: "qrcode-qrcode-43muxo",
		name: "app",
		databaseName: "app",
		databaseUser: "qrcode_user",
		databasePassword: "SecurePassword123!",
		authSource: "admin",
		externalPort: 27017,
		environment: {
			project: {
				organizationId: "org-qrcode-tenant",
			},
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getServiceContainer).mockResolvedValue({
			Id: "container-mock-qrcode-123",
		} as any);
	});

	describe("1. Real MongoDB Records Explorer & BSON Serialization", () => {
		it("returns actual documents and consistent total count for 514 auditlogs records", async () => {
			const mockExec = vi.mocked(execAsync);

			const sampleDocs = [
				{
					_id: "67123456789abcdef0123456",
					action: "user_login",
					userId: "user_abc",
					metadata: { ip: "192.168.1.1", browser: "Chrome" },
					createdAt: "2026-10-18T18:00:00.000Z",
					tags: ["auth", "security"],
					success: true,
					attempts: 1,
				},
				{
					_id: "67123456789abcdef0123457",
					action: "token_refresh",
					userId: "user_abc",
					metadata: { ip: "192.168.1.1" },
					createdAt: "2026-10-18T18:15:00.000Z",
					tags: ["token"],
					success: true,
					attempts: 1,
				},
			];

			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					total: 514,
					page: 1,
					limit: 25,
					documents: sampleDocs,
					rows: sampleDocs,
					database: "test",
				}) + "\n",
				stderr: "",
			} as any);

			const result = await mongoAdapter.queryDocuments(
				mockMongoRecord,
				"auditlogs",
				{ page: 1, limit: 25, database: "test" },
			);

			// Must return total count of 514 matching UI report
			expect(result.total).toBe(514);
			expect(result.page).toBe(1);
			expect(result.limit).toBe(25);
			expect(result.database).toBe("test");

			// CRITICAL FIX: Both rows and documents must be defined and populated
			expect(result.rows).toBeDefined();
			expect(result.documents).toBeDefined();
			expect(result.rows.length).toBe(2);
			expect(result.documents.length).toBe(2);

			// Verify document details
			const doc1 = result.rows[0];
			expect(doc1._id).toBe("67123456789abcdef0123456");
			expect(doc1.action).toBe("user_login");
			expect(doc1.metadata).toEqual({ ip: "192.168.1.1", browser: "Chrome" });
			expect(doc1.success).toBe(true);
			expect(doc1.tags).toEqual(["auth", "security"]);
		});

		it("correctly handles BSON ObjectId, Date, Decimal128, Long, and Binary representations", async () => {
			const mockExec = vi.mocked(execAsync);

			const bsonDoc = [
				{
					_id: "507f1f77bcf86cd799439011",
					timestamp: "2026-10-18T20:00:00.000Z",
					balance: "1250.75",
					highPrecisionNumber: "9223372036854775807",
					binaryData: "SGVsbG8gV29ybGQ=",
					nested: {
						subId: "507f1f77bcf86cd799439012",
						subDate: "2026-10-18T20:30:00.000Z",
					},
					items: [1, 2, "3"],
				},
			];

			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					total: 1,
					page: 1,
					limit: 25,
					documents: bsonDoc,
					rows: bsonDoc,
					database: "app",
				}) + "\n",
				stderr: "",
			} as any);

			const result = await mongoAdapter.queryDocuments(
				mockMongoRecord,
				"auditlogs",
				{ page: 1, limit: 25 },
			);
			expect(result.rows.length).toBe(1);
			const doc = result.rows[0];

			expect(doc._id).toBe("507f1f77bcf86cd799439011");
			expect(doc.timestamp).toBe("2026-10-18T20:00:00.000Z");
			expect(doc.balance).toBe("1250.75");
			expect(doc.nested.subId).toBe("507f1f77bcf86cd799439012");
			expect(doc.items).toEqual([1, 2, "3"]);
		});

		it("calculates accurate pagination offsets for pages 1, 2, and page 21", async () => {
			const mockExec = vi.mocked(execAsync);

			// Page 2
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({ total: 514, page: 2, limit: 25, documents: [], rows: [] }) + "\n",
				stderr: "",
			} as any);

			await mongoAdapter.queryDocuments(mockMongoRecord, "auditlogs", { page: 2, limit: 25, database: "test" });

			// Skip for page 2 must be (2 - 1) * 25 = 25
			const queryCallPage2 = String(mockExec.mock.calls[0]?.[0] || "");
			expect(queryCallPage2).toContain(".skip(25).limit(25)");

			// Page 21 (final page)
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({ total: 514, page: 21, limit: 25, documents: [], rows: [] }) + "\n",
				stderr: "",
			} as any);

			await mongoAdapter.queryDocuments(mockMongoRecord, "auditlogs", { page: 21, limit: 25, database: "test" });

			// Skip for page 21 must be (21 - 1) * 25 = 500
			const queryCallPage21 = String(mockExec.mock.calls[1]?.[0] || "");
			expect(queryCallPage21).toContain(".skip(500).limit(25)");
		});

		it("does not swallow errors or report '0 records' on backend query failures", async () => {
			const mockExec = vi.mocked(execAsync);
			mockExec.mockRejectedValueOnce(
				new Error("MongoServerError: Authentication failed."),
			);

			await expect(
				mongoAdapter.queryDocuments(mockMongoRecord, "auditlogs", { page: 1, limit: 25 }),
			).rejects.toThrow("Authentication failed");
		});
	});

	describe("2. Database Discovery and 'app' vs 'test' Resolution", () => {
		it("discovers all logical databases on the MongoDB server including 'test' and 'app'", async () => {
			const mockExec = vi.mocked(execAsync);

			const listDbsOutput = JSON.stringify({
				databases: [
					{ name: "admin", sizeOnDisk: 1048576, empty: false, isInternal: true },
					{ name: "config", sizeOnDisk: 110592, empty: false, isInternal: true },
					{ name: "local", sizeOnDisk: 73728, empty: false, isInternal: true },
					{ name: "test", sizeOnDisk: 5242880, empty: false, isInternal: false },
					{ name: "app", sizeOnDisk: 32768, empty: true, isInternal: false },
				],
				restricted: false,
			});

			mockExec.mockResolvedValueOnce({
				stdout: listDbsOutput + "\n",
				stderr: "",
			} as any);

			const discovery = await listDatabases(mockMongoRecord, "mongo");
			expect(discovery.databases.length).toBe(5);

			const dbNames = discovery.databases.map((d) => d.name);
			expect(dbNames).toContain("test");
			expect(dbNames).toContain("app");
			expect(dbNames).toContain("admin");

			// Verify test database details
			const testDb = discovery.databases.find((d) => d.name === "test");
			expect(testDb?.empty).toBe(false);
			expect(testDb?.isInternal).toBe(false);

			// Admin and config must be marked internal
			const adminDb = discovery.databases.find((d) => d.name === "admin");
			expect(adminDb?.isInternal).toBe(true);
		});

		it("generates correct connection URIs distinguishing managed resource 'app' from logical database 'test'", () => {
			// Record with configured logical db 'test'
			const testRecord = {
				...mockMongoRecord,
				databaseName: "test",
			};
			const connTest = buildDatabaseConnectionStrings("mongo", testRecord, "db.hatdot.cloud");

			expect(connTest.external.url).toContain("/test?authSource=admin");
			expect(connTest.internal.url).toContain("/test?authSource=admin");
			expect(connTest.external.url).toContain("directConnection=true");
		});

		it("ensures collection listing, counts, and queries use the selected database rather than fallback", async () => {
			const mockExec = vi.mocked(execAsync);

			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify([
					{ name: "auditlogs", estimatedRows: 514 },
					{ name: "users", estimatedRows: 12 },
					{ name: "refreshtokens", estimatedRows: 40 },
				]) + "\n",
				stderr: "",
			} as any);

			const collections = await mongoAdapter.listCollections(mockMongoRecord, "test");
			expect(collections.length).toBe(3);

			// Verify mongosh script targeted db.getSiblingDB("test")
			const execScript = String(mockExec.mock.calls[0]?.[0] || "");
			expect(execScript).toContain('db.getSiblingDB("test")');
			expect(execScript).not.toContain('db.getSiblingDB("app")');
		});

		it("falls back gracefully when user permissions prevent listDatabases enumeration", async () => {
			const mockExec = vi.mocked(execAsync);

			mockExec.mockRejectedValueOnce(
				new Error("MongoServerError: not authorized on admin to execute command { listDatabases: 1 }"),
			);

			const discovery = await listDatabases(mockMongoRecord, "mongo");

			// Should gracefully return discoverable databases without crashing and without injecting unconfigured 'test'
			expect(discovery.databases.length).toBeGreaterThan(0);
			const names = discovery.databases.map((d) => d.name);
			expect(names).toContain("app");
			expect(names).not.toContain("test");
		});

		it("handles multiple databases with identical collection names without cross-contamination", async () => {
			const mockExec = vi.mocked(execAsync);

			// Query auditlogs in 'test'
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					total: 514,
					page: 1,
					limit: 25,
					documents: [{ db: "test_doc" }],
					rows: [{ db: "test_doc" }],
					database: "test",
				}) + "\n",
				stderr: "",
			} as any);

			const testResult = await mongoAdapter.queryDocuments(mockMongoRecord, "auditlogs", { page: 1, limit: 25, database: "test" });
			expect(testResult.database).toBe("test");
			expect(String(mockExec.mock.calls[0]?.[0] || "")).toContain('db.getSiblingDB(\\"test\\")');

			// Query auditlogs in 'app'
			mockExec.mockResolvedValueOnce({
				stdout: JSON.stringify({
					total: 0,
					page: 1,
					limit: 25,
					documents: [],
					rows: [],
					database: "app",
				}) + "\n",
				stderr: "",
			} as any);

			const appResult = await mongoAdapter.queryDocuments(mockMongoRecord, "auditlogs", { page: 1, limit: 25, database: "app" });
			expect(appResult.database).toBe("app");
			expect(String(mockExec.mock.calls[1]?.[0] || "")).toContain('db.getSiblingDB(\\"app\\")');
		});
	});

	describe("3. Customer-Safe UI and Sanitized Diagnostics", () => {
		it("removes internal Docker and Swarm terminology from error messages", () => {
			const rawErrors = [
				"Error response from daemon: Docker container abc123def456 is not running",
				"Docker Swarm overlay network failure on vxlan_sys_4789",
				"Unable to find service container dokploy_qrcode-43muxo on host /var/run/docker.sock",
			];

			for (const raw of rawErrors) {
				const sanitized = sanitizeCustomerDiagnostic(raw);
				// Must not leak internal socket path, raw Docker, or Swarm terminology
				expect(sanitized).not.toContain("/var/run/docker.sock");
				expect(sanitized).not.toContain("Docker Swarm");
				expect(sanitized).not.toContain("Docker container");
			}
		});

		it("sanitizes database and collection identifiers against injection", () => {
			// Valid identifiers
			expect(sanitizeDatabaseIdentifier("test")).toBe("test");
			expect(sanitizeDatabaseIdentifier("auditlogs")).toBe("auditlogs");
			expect(sanitizeDatabaseIdentifier("my_db_2026")).toBe("my_db_2026");

			// Dangerous injection inputs are neutralized
			expect(sanitizeDatabaseIdentifier('test"; DROP DATABASE test; --')).toBe("test_drop_database_test");
			expect(sanitizeDatabaseIdentifier("test$where")).toBe("test_where");
			expect(sanitizeDatabaseIdentifier("test/../secret")).toBe("test_secret");

			// Reserved system names are suffixed
			expect(sanitizeDatabaseIdentifier("admin")).toBe("admin_db");
			expect(sanitizeDatabaseIdentifier("local")).toBe("local_db");
		});

		it("redacts credentials from connection URLs and error payloads", () => {
			const sensitiveString = "mongodb://qrcode_user:SuperSecretPassword999@db.hatdot.cloud:27017/test?authSource=admin";
			const redacted = redactCredentials(sensitiveString);

			expect(redacted).not.toContain("SuperSecretPassword999");
			expect(redacted).toContain("mongodb://qrcode_user:***@db.hatdot.cloud:27017/test?authSource=admin");
		});
	});
});

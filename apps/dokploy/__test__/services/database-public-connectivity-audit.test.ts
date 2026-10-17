import { describe, expect, it } from "vitest";
import {
	buildDatabaseConnectionStrings,
	isInternalSwarmHostname,
	validatePublicDatabaseEndpoint,
	verifyDatabaseConnectivity,
} from "@dokploy/server/services/database-connection";

describe("Database Public Connectivity Audit & Verification Matrix", () => {
	describe("1. Internal Swarm Hostname Rejection (Root Cause Elimination)", () => {
		it("detects and rejects appName as a public hostname", () => {
			expect(isInternalSwarmHostname("qrcode-qrcode-43muxo", "qrcode-qrcode-43muxo")).toBe(true);
			expect(isInternalSwarmHostname("mongo-service-12345", "mongo-service-12345")).toBe(true);
		});

		it("detects and rejects hostnames without dots that are not IP addresses", () => {
			expect(isInternalSwarmHostname("qrcode-qrcode-43muxo")).toBe(true);
			expect(isInternalSwarmHostname("postgres-db")).toBe(true);
			expect(isInternalSwarmHostname("redis-cache")).toBe(true);
			expect(isInternalSwarmHostname("libsql-node")).toBe(true);
		});

		it("detects and rejects loopback and local addresses", () => {
			expect(isInternalSwarmHostname("localhost")).toBe(true);
			expect(isInternalSwarmHostname("127.0.0.1")).toBe(true);
			expect(isInternalSwarmHostname("0.0.0.0")).toBe(true);
			expect(isInternalSwarmHostname("::1")).toBe(true);
		});

		it("detects and rejects private IP ranges (RFC 1918)", () => {
			expect(isInternalSwarmHostname("10.0.0.5")).toBe(true);
			expect(isInternalSwarmHostname("172.17.0.2")).toBe(true);
			expect(isInternalSwarmHostname("172.24.0.100")).toBe(true);
			expect(isInternalSwarmHostname("192.168.1.50")).toBe(true);
			expect(isInternalSwarmHostname("169.254.1.1")).toBe(true);
		});

		it("detects and rejects internal swarm domain suffixes", () => {
			expect(isInternalSwarmHostname("db.internal")).toBe(true);
			expect(isInternalSwarmHostname("service.local")).toBe(true);
			expect(isInternalSwarmHostname("task.swarm")).toBe(true);
		});

		it("accepts valid public FQDNs and public IPs", () => {
			expect(isInternalSwarmHostname("db.hatdot.cloud")).toBe(false);
			expect(isInternalSwarmHostname("postgres.example.com")).toBe(false);
			expect(isInternalSwarmHostname("51.158.100.20")).toBe(false);
			expect(isInternalSwarmHostname("1.1.1.1")).toBe(false);
		});
	});

	describe("2. Fail-Closed Behavior for Invalid / Internal Public Endpoints", () => {
		it("fails closed when an internal Swarm hostname is passed as publicHost", () => {
			const record = {
				appName: "qrcode-qrcode-43muxo",
				databaseUser: "customer_user",
				databasePassword: "password123",
				databaseName: "customer_db",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				record,
				"qrcode-qrcode-43muxo", // Invalid internal hostname passed as publicHost
			);

			// Must fail closed: external URL must be null and host must be empty
			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.hasPublicHost).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.external.host).toBe("");
			expect(conn.endpointStatus?.isValidPublicEndpoint).toBe(false);
			// Internal URL remains intact for internal Swarm usage
			expect(conn.internal.url).toBe(
				"mongodb://customer_user:password123@qrcode-qrcode-43muxo:27017/customer_db?authSource=customer_db&directConnection=true",
			);
		});

		it("fails closed when publicHost is localhost or 127.0.0.1", () => {
			const record = {
				appName: "pg-service",
				databaseUser: "pg_user",
				databasePassword: "secret",
				databaseName: "pg_db",
				externalPort: 5432,
			};

			const conn = buildDatabaseConnectionStrings("postgres", record, "127.0.0.1");

			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.external.host).toBe("");
			expect(conn.endpointStatus?.isValidPublicEndpoint).toBe(false);
		});

		it("fails closed when external port is null (public access disabled)", () => {
			const record = {
				appName: "mysql-service",
				databaseUser: "my_user",
				databasePassword: "secret",
				databaseName: "my_db",
				externalPort: null,
			};

			const conn = buildDatabaseConnectionStrings("mysql", record, "db.hatdot.cloud");

			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.endpointStatus?.isConfigured).toBe(false);
		});
	});

	describe("3. MongoDB Replica Set External vs Internal URL Resolution", () => {
		it("generates directConnection=true without replicaSet for external MongoDB connections", () => {
			const record = {
				appName: "qrcode-qrcode-43muxo",
				databaseUser: "restricted_user",
				databasePassword: "secure_password",
				databaseName: "qrcode_app",
				externalPort: 27017,
				replicaSets: "rs0",
			};

			const conn = buildDatabaseConnectionStrings("mongo", record, "db.hatdot.cloud");

			expect(conn.external.isEnabled).toBe(true);
			// External URL must use directConnection=true to prevent Compass from discovering qrcode-qrcode-43muxo
			expect(conn.external.url).toBe(
				"mongodb://restricted_user:secure_password@db.hatdot.cloud:27017/qrcode_app?authSource=qrcode_app&directConnection=true",
			);
			expect(conn.external.url).not.toContain("replicaSet=rs0");
			expect(conn.external.url).not.toContain("qrcode-qrcode-43muxo");

			// Internal URL preserves replicaSet=rs0 on the internal overlay network
			expect(conn.internal.url).toBe(
				"mongodb://restricted_user:secure_password@qrcode-qrcode-43muxo:27017/qrcode_app?authSource=qrcode_app&replicaSet=rs0",
			);
		});

		it("preserves assigned database path and authSource in external MongoDB URL", () => {
			const record = {
				appName: "mongo-instance",
				databaseUser: "user_a",
				databasePassword: "pass_a",
				databaseName: "tenant_database",
				externalPort: 27018,
			};

			const conn = buildDatabaseConnectionStrings("mongo", record, "db.hatdot.cloud");

			expect(conn.external.url).toContain("/tenant_database");
			expect(conn.external.url).toContain("authSource=tenant_database");
			expect(conn.external.url).toContain("directConnection=true");
		});
	});

	describe("4. Endpoint Format Across All Supported Engines", () => {
		it("generates correct public connection URL for PostgreSQL", () => {
			const record = {
				appName: "postgres-svc",
				databaseUser: "pg_tenant",
				databasePassword: "p@ssword:with+special",
				databaseName: "pg_tenant_db",
				externalPort: 5433,
			};

			const conn = buildDatabaseConnectionStrings("postgres", record, "db.hatdot.cloud");

			expect(conn.external.url).toBe(
				`postgresql://pg_tenant:${encodeURIComponent("p@ssword:with+special")}@db.hatdot.cloud:5433/pg_tenant_db`,
			);
			expect(conn.external.url).not.toContain("postgres-svc");
		});

		it("generates correct public connection URL for MySQL", () => {
			const record = {
				appName: "mysql-svc",
				databaseUser: "my_tenant",
				databasePassword: "my_password",
				databaseName: "my_tenant_db",
				externalPort: 3307,
			};

			const conn = buildDatabaseConnectionStrings("mysql", record, "db.hatdot.cloud");

			expect(conn.external.url).toBe(
				"mysql://my_tenant:my_password@db.hatdot.cloud:3307/my_tenant_db",
			);
			expect(conn.external.url).not.toContain("mysql-svc");
		});

		it("generates correct public connection URL for MariaDB", () => {
			const record = {
				appName: "mariadb-svc",
				databaseUser: "maria_tenant",
				databasePassword: "maria_password",
				databaseName: "maria_tenant_db",
				externalPort: 3308,
			};

			const conn = buildDatabaseConnectionStrings("mariadb", record, "db.hatdot.cloud");

			expect(conn.external.url).toBe(
				"mysql://maria_tenant:maria_password@db.hatdot.cloud:3308/maria_tenant_db",
			);
			expect(conn.external.url).not.toContain("mariadb-svc");
		});

		it("generates correct public connection URL for Redis", () => {
			const record = {
				appName: "redis-svc",
				databaseUser: "default",
				databasePassword: "redis_secret_password",
				externalPort: 6380,
			};

			const conn = buildDatabaseConnectionStrings("redis", record, "db.hatdot.cloud");

			expect(conn.external.url).toBe(
				"redis://default:redis_secret_password@db.hatdot.cloud:6380",
			);
			expect(conn.external.url).not.toContain("redis-svc");
		});

		it("generates correct public connection URL for LibSQL strictly targeting data port 8080", () => {
			const record = {
				appName: "libsql-svc",
				databaseUser: "libsql_user",
				databasePassword: "token_abc_123",
				externalPort: 8081,
				externalAdminPort: 5000,
			};

			const conn = buildDatabaseConnectionStrings("libsql", record, "db.hatdot.cloud");

			// Strictly port 8081 (data port), never 5000 (admin port)
			expect(conn.external.url).toBe(
				"http://libsql_user:token_abc_123@db.hatdot.cloud:8081",
			);
			expect(conn.external.url).not.toContain(":5000");
			expect(conn.external.url).not.toContain("libsql-svc");
		});
	});

	describe("5. Shared Endpoint Validation & Verification Service", () => {
		it("detects and reports unconfigured external port", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "db.hatdot.cloud",
				port: null,
			});

			expect(result.isConfigured).toBe(false);
			expect(result.dnsStatus).toBe("unconfigured");
			expect(result.tcpStatus).toBe("unconfigured");
			expect(result.message).toContain("Public external access is currently disabled");
		});

		it("rejects internal Swarm hostname in verifyDatabaseConnectivity with actionable message", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "qrcode-qrcode-43muxo",
				port: 27017,
				appName: "qrcode-qrcode-43muxo",
			});

			expect(result.isConfigured).toBe(false);
			expect(result.dnsStatus).toBe("failed");
			expect(result.tcpStatus).toBe("unreachable");
			expect(result.message).toContain("internal Docker Swarm service hostname");
			expect(result.diagnostics?.errorCode).toBe("ENOTFOUND");
			expect(result.diagnostics?.errorDetails).toContain("Internal Swarm Hostname Rejected");
		});

		it("classifies all 8 states in validatePublicDatabaseEndpoint", async () => {
			const endpointAudit = await validatePublicDatabaseEndpoint({
				type: "postgres",
				host: "postgres-swarm-internal",
				port: 5432,
				appName: "postgres-swarm-internal",
			});

			expect(endpointAudit.isConfigured).toBe(false);
			expect(endpointAudit.isInternalOnly).toBe(true);
			expect(endpointAudit.dnsStatus).toBe("failed");
			expect(endpointAudit.portStatus).toBe("published");
			expect(endpointAudit.tcpStatus).toBe("unreachable");
			expect(endpointAudit.protocolStatus).toBe("failed");
			expect(endpointAudit.isolationStatus).toBe("verified");
		});

		it("redacts credentials from error messages and diagnostics", async () => {
			const sensitiveHost = "mongo_user:secret_pass@unresolvable-domain-xyz123.com";
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: sensitiveHost,
				port: 27017,
			});

			expect(result.message).not.toContain("secret_pass");
			expect(result.diagnostics?.host).not.toContain("secret_pass");
		});
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateService, mockDocker } = vi.hoisted(() => {
	const mockCreateService = vi.fn().mockResolvedValue({});
	const mockDocker = {
		getService: vi.fn().mockReturnValue({
			inspect: vi.fn().mockRejectedValue(new Error("not found")),
		}),
		createService: mockCreateService,
	};
	return { mockCreateService, mockDocker };
});

vi.mock("@dokploy/server/utils/servers/remote-docker", () => ({
	getRemoteDocker: vi.fn().mockResolvedValue(mockDocker),
}));

import { getMountPath } from "@dokploy/server/services/postgres";
import {
	DEFAULT_DATABASE_IMAGES,
	DEFAULT_DATABASE_PORTS,
	getDatabaseMountPath,
	isValidDockerImage,
	LEGACY_INVALID_IMAGE_REPLACEMENTS,
	resolveDatabaseImage,
	validateDatabaseImage,
} from "@dokploy/server/utils/databases/image-resolution";
import { buildLibsql } from "@dokploy/server/utils/databases/libsql";
import { buildMariadb } from "@dokploy/server/utils/databases/mariadb";
import { buildMongo } from "@dokploy/server/utils/databases/mongo";
import { buildMysql } from "@dokploy/server/utils/databases/mysql";
import { buildPostgres } from "@dokploy/server/utils/databases/postgres";
import { buildRedis } from "@dokploy/server/utils/databases/redis";
import { TRPCError } from "@trpc/server";

describe("Database Image Resolution & Deployment Contract (All 6 Supported Engines)", () => {
	beforeEach(() => {
		mockCreateService.mockClear();
		mockDocker.getService.mockReturnValue({
			inspect: vi.fn().mockRejectedValue(new Error("not found")),
		});
	});

	describe("1. Default Image Resolution per Engine", () => {
		it("maps canonical default images and ports in constants", () => {
			expect(DEFAULT_DATABASE_IMAGES.postgres).toBe("postgres:18");
			expect(DEFAULT_DATABASE_IMAGES.mysql).toBe("mysql:8");
			expect(DEFAULT_DATABASE_IMAGES.mariadb).toBe("mariadb:11");
			expect(DEFAULT_DATABASE_IMAGES.mongo).toBe("mongo:8");
			expect(DEFAULT_DATABASE_IMAGES.redis).toBe("redis:7");
			expect(DEFAULT_DATABASE_IMAGES.libsql).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);

			expect(DEFAULT_DATABASE_PORTS.postgres).toBe(5432);
			expect(DEFAULT_DATABASE_PORTS.mysql).toBe(3306);
			expect(DEFAULT_DATABASE_PORTS.mariadb).toBe(3306);
			expect(DEFAULT_DATABASE_PORTS.mongo).toBe(27017);
			expect(DEFAULT_DATABASE_PORTS.redis).toBe(6379);
			expect(DEFAULT_DATABASE_PORTS.libsql).toBe(8080);
		});

		it("resolves postgres to default postgres:18", () => {
			expect(resolveDatabaseImage("postgres")).toBe("postgres:18");
			expect(resolveDatabaseImage("postgresql")).toBe("postgres:18");
			expect(resolveDatabaseImage("postgres", "")).toBe("postgres:18");
			expect(resolveDatabaseImage("postgres", "  ")).toBe("postgres:18");
			expect(resolveDatabaseImage("postgres", null)).toBe("postgres:18");
			expect(resolveDatabaseImage("postgres", undefined)).toBe("postgres:18");
		});

		it("resolves mysql to default mysql:8", () => {
			expect(resolveDatabaseImage("mysql")).toBe("mysql:8");
			expect(resolveDatabaseImage("mysql", "")).toBe("mysql:8");
			expect(resolveDatabaseImage("mysql", null)).toBe("mysql:8");
		});

		it("resolves mariadb to valid default mariadb:11 (never non-existent mariadb:6 or mariadb:4)", () => {
			expect(resolveDatabaseImage("mariadb")).toBe("mariadb:11");
			expect(resolveDatabaseImage("mariadb", "")).toBe("mariadb:11");
			expect(resolveDatabaseImage("mariadb", null)).toBe("mariadb:11");
		});

		it("resolves mongo to valid default mongo:8 (never non-existent mongo:15)", () => {
			expect(resolveDatabaseImage("mongo")).toBe("mongo:8");
			expect(resolveDatabaseImage("mongodb")).toBe("mongo:8");
			expect(resolveDatabaseImage("mongo", "")).toBe("mongo:8");
			expect(resolveDatabaseImage("mongo", null)).toBe("mongo:8");
		});

		it("resolves redis to default redis:7", () => {
			expect(resolveDatabaseImage("redis")).toBe("redis:7");
			expect(resolveDatabaseImage("redis", "")).toBe("redis:7");
			expect(resolveDatabaseImage("redis", null)).toBe("redis:7");
		});

		it("resolves libsql to default ghcr.io/tursodatabase/libsql-server:latest", () => {
			expect(resolveDatabaseImage("libsql")).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);
			expect(resolveDatabaseImage("libsql", "")).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);
			expect(resolveDatabaseImage("libsql", null)).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);
		});

		it("throws TRPCError for unsupported database engines", () => {
			expect(() => resolveDatabaseImage("cassandra")).toThrow(TRPCError);
			expect(() => resolveDatabaseImage("oracle")).toThrow(TRPCError);
		});
	});

	describe("2. Bare Engine Names and Legacy Image Repair", () => {
		it("resolves bare engine names to canonical supported defaults", () => {
			expect(resolveDatabaseImage("postgres", "postgres")).toBe("postgres:18");
			expect(resolveDatabaseImage("postgres", "postgresql")).toBe(
				"postgres:18",
			);
			expect(resolveDatabaseImage("mysql", "mysql")).toBe("mysql:8");
			expect(resolveDatabaseImage("mariadb", "mariadb")).toBe("mariadb:11");
			expect(resolveDatabaseImage("mongo", "mongo")).toBe("mongo:8");
			expect(resolveDatabaseImage("mongo", "mongodb")).toBe("mongo:8");
			expect(resolveDatabaseImage("redis", "redis")).toBe("redis:7");
			expect(resolveDatabaseImage("libsql", "libsql")).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);
		});

		it("safely migrates legacy non-existent defaults (mariadb:6, mariadb:4, mongo:15) to supported defaults", () => {
			expect(resolveDatabaseImage("mariadb", "mariadb:6")).toBe("mariadb:11");
			expect(resolveDatabaseImage("mariadb", "mariadb:4")).toBe("mariadb:11");
			expect(resolveDatabaseImage("mongo", "mongo:15")).toBe("mongo:8");
			expect(LEGACY_INVALID_IMAGE_REPLACEMENTS["mariadb:6"]).toBe("mariadb:11");
			expect(LEGACY_INVALID_IMAGE_REPLACEMENTS["mariadb:4"]).toBe("mariadb:11");
			expect(LEGACY_INVALID_IMAGE_REPLACEMENTS["mongo:15"]).toBe("mongo:8");
		});
	});

	describe("3. Explicit Version & Custom Tag Preservation", () => {
		it("preserves explicitly configured PostgreSQL versions", () => {
			expect(resolveDatabaseImage("postgres", "postgres:16")).toBe(
				"postgres:16",
			);
			expect(resolveDatabaseImage("postgres", "postgres:17-alpine")).toBe(
				"postgres:17-alpine",
			);
			expect(
				resolveDatabaseImage("postgres", "bitnami/postgresql:16.1.0"),
			).toBe("bitnami/postgresql:16.1.0");
			expect(resolveDatabaseImage("postgres", "postgis/postgis:16-3.4")).toBe(
				"postgis/postgis:16-3.4",
			);
			expect(resolveDatabaseImage("postgres", "16")).toBe("postgres:16");
		});

		it("preserves explicitly configured MySQL versions and variants", () => {
			expect(resolveDatabaseImage("mysql", "mysql:8.4")).toBe("mysql:8.4");
			expect(resolveDatabaseImage("mysql", "mysql:8.0.36")).toBe(
				"mysql:8.0.36",
			);
			expect(resolveDatabaseImage("mysql", "bitnami/mysql:8.0")).toBe(
				"bitnami/mysql:8.0",
			);
		});

		it("preserves explicitly configured MariaDB versions", () => {
			expect(resolveDatabaseImage("mariadb", "mariadb:10.11")).toBe(
				"mariadb:10.11",
			);
			expect(resolveDatabaseImage("mariadb", "mariadb:11.4-jammy")).toBe(
				"mariadb:11.4-jammy",
			);
		});

		it("preserves explicitly configured MongoDB versions", () => {
			expect(resolveDatabaseImage("mongo", "mongo:7.0")).toBe("mongo:7.0");
			expect(resolveDatabaseImage("mongo", "mongo:6.0.14")).toBe(
				"mongo:6.0.14",
			);
		});

		it("preserves explicitly configured Redis versions and alternatives", () => {
			expect(resolveDatabaseImage("redis", "redis:7.2-alpine")).toBe(
				"redis:7.2-alpine",
			);
			expect(resolveDatabaseImage("redis", "redis/redis-stack:latest")).toBe(
				"redis/redis-stack:latest",
			);
			expect(resolveDatabaseImage("redis", "valkey/valkey:8")).toBe(
				"valkey/valkey:8",
			);
		});

		it("preserves explicitly configured LibSQL image tags", () => {
			expect(
				resolveDatabaseImage(
					"libsql",
					"ghcr.io/tursodatabase/libsql-server:v0.24.32",
				),
			).toBe("ghcr.io/tursodatabase/libsql-server:v0.24.32");
			expect(
				resolveDatabaseImage("libsql", "tursodatabase/libsql-server:latest"),
			).toBe("tursodatabase/libsql-server:latest");
		});

		it("preserves custom and private registry endpoints", () => {
			expect(
				resolveDatabaseImage(
					"postgres",
					"registry.internal.example.com:5000/db/custom-pg:16",
				),
			).toBe("registry.internal.example.com:5000/db/custom-pg:16");
			expect(resolveDatabaseImage("mysql", "quay.io/myorg/mysql:8.0")).toBe(
				"quay.io/myorg/mysql:8.0",
			);
		});
	});

	describe("4. Rejection of Arbitrary Resource Identifiers & Dangerous Inputs", () => {
		it("detects valid docker image references", () => {
			expect(isValidDockerImage("postgres:18")).toBe(true);
			expect(
				isValidDockerImage("ghcr.io/tursodatabase/libsql-server:latest"),
			).toBe(true);
			expect(
				isValidDockerImage("my-registry.domain.com:5000/ns/repo:tag"),
			).toBe(true);
		});

		it("rejects arbitrary resource identifiers that lack tags or namespaces", () => {
			expect(() => resolveDatabaseImage("postgres", "my-customer-db")).toThrow(
				TRPCError,
			);
			expect(() =>
				resolveDatabaseImage("mysql", "production-db-instance-1"),
			).toThrow(TRPCError);
			expect(() => resolveDatabaseImage("redis", "cache-service-app")).toThrow(
				TRPCError,
			);
		});

		it("rejects invalid, malformed, or injected strings", () => {
			expect(isValidDockerImage("")).toBe(false);
			expect(isValidDockerImage("postgres; rm -rf /")).toBe(false);
			expect(isValidDockerImage("postgres$(whoami)")).toBe(false);
			expect(isValidDockerImage("postgres `touch test`")).toBe(false);
			expect(isValidDockerImage("postgres image with spaces")).toBe(false);
			expect(isValidDockerImage("postgres:18:22:extra")).toBe(false);
		});

		it("validateDatabaseImage throws BAD_REQUEST TRPCError without leaking secrets", () => {
			try {
				validateDatabaseImage("postgres; rm -rf /");
				expect.unreachable("Should have thrown TRPCError");
			} catch (error: any) {
				expect(error).toBeInstanceOf(TRPCError);
				expect(error.code).toBe("BAD_REQUEST");
				expect(error.message).toContain("Invalid Docker image reference");
				// Verify secret wasn't leaked in error
				expect(error.message).not.toContain("password");
			}
		});
	});

	describe("5. Persistent Storage Mount Path Resolution per Engine & Version", () => {
		it("resolves PostgreSQL >= 18 to /var/lib/postgresql/{version}/docker", () => {
			expect(getDatabaseMountPath("postgres", "postgres:18")).toBe(
				"/var/lib/postgresql/18/docker",
			);
			expect(getDatabaseMountPath("postgres", "postgres:19")).toBe(
				"/var/lib/postgresql/19/docker",
			);
			expect(getMountPath("postgres:18")).toBe("/var/lib/postgresql/18/docker");
		});

		it("resolves PostgreSQL < 18 to /var/lib/postgresql/data", () => {
			expect(getDatabaseMountPath("postgres", "postgres:16")).toBe(
				"/var/lib/postgresql/data",
			);
			expect(getDatabaseMountPath("postgres", "postgres:15-alpine")).toBe(
				"/var/lib/postgresql/data",
			);
			expect(getMountPath("postgres:16")).toBe("/var/lib/postgresql/data");
		});

		it("getMountPath safely handles missing or empty image without throwing", () => {
			expect(getMountPath("")).toBe("/var/lib/postgresql/18/docker");
			expect(getMountPath(null)).toBe("/var/lib/postgresql/18/docker");
			expect(getMountPath(undefined)).toBe("/var/lib/postgresql/18/docker");
		});

		it("resolves MySQL to /var/lib/mysql", () => {
			expect(getDatabaseMountPath("mysql", "mysql:8")).toBe("/var/lib/mysql");
		});

		it("resolves MariaDB to /var/lib/mysql", () => {
			expect(getDatabaseMountPath("mariadb", "mariadb:11")).toBe(
				"/var/lib/mysql",
			);
		});

		it("resolves MongoDB to /data/db", () => {
			expect(getDatabaseMountPath("mongo", "mongo:8")).toBe("/data/db");
		});

		it("resolves Redis to /data", () => {
			expect(getDatabaseMountPath("redis", "redis:7")).toBe("/data");
		});

		it("resolves LibSQL to /var/lib/sqld", () => {
			expect(
				getDatabaseMountPath(
					"libsql",
					"ghcr.io/tursodatabase/libsql-server:latest",
				),
			).toBe("/var/lib/sqld");
		});
	});

	describe("6. Swarm Container Spec Builder Contract (All 6 Engines)", () => {
		const mockProjectEnv = {
			env: "",
			project: { env: "" },
		};

		it("buildLibsql uses resolved dockerImage and does not hardcode v0.24.32 when custom image is given", async () => {
			const mockLibsql: any = {
				appName: "test-libsql",
				dockerImage: "ghcr.io/tursodatabase/libsql-server:latest",
				databaseUser: "libsql",
				databasePassword: "password123",
				sqldNode: "primary",
				sqldPrimaryUrl: null,
				enableNamespaces: false,
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildLibsql(mockLibsql);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe(
				"ghcr.io/tursodatabase/libsql-server:latest",
			);
		});

		it("buildPostgres resolves missing or empty dockerImage to default postgres:18", async () => {
			const mockPg: any = {
				appName: "test-pg",
				dockerImage: "", // empty - should resolve to default postgres:18
				databaseName: "postgres",
				databaseUser: "postgres",
				databasePassword: "password123",
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildPostgres(mockPg);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe("postgres:18");
		});

		it("buildMariadb resolves missing dockerImage to mariadb:11", async () => {
			const mockMaria: any = {
				appName: "test-maria",
				dockerImage: null,
				databaseName: "mariadb",
				databaseUser: "mariadb",
				databasePassword: "password123",
				databaseRootPassword: "rootpassword123",
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildMariadb(mockMaria);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe("mariadb:11");
		});

		it("buildMongo resolves missing dockerImage to mongo:8", async () => {
			const mockMongo: any = {
				appName: "test-mongo",
				dockerImage: undefined,
				databaseUser: "mongo",
				databasePassword: "password123",
				replicaSets: false,
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildMongo(mockMongo);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe("mongo:8");
		});

		it("buildMysql resolves missing dockerImage to mysql:8", async () => {
			const mockMysql: any = {
				appName: "test-mysql",
				dockerImage: undefined,
				databaseName: "mysql",
				databaseUser: "mysql",
				databasePassword: "password123",
				databaseRootPassword: "root123",
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildMysql(mockMysql);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe("mysql:8");
		});

		it("buildRedis resolves missing dockerImage to redis:7", async () => {
			const mockRedis: any = {
				appName: "test-redis",
				dockerImage: undefined,
				databasePassword: "password123",
				mounts: [],
				environment: mockProjectEnv,
				serverId: null,
			};

			await buildRedis(mockRedis);

			expect(mockCreateService).toHaveBeenCalled();
			const serviceSpec = mockCreateService.mock.calls[0]?.[0] as any;
			expect(serviceSpec.TaskTemplate.ContainerSpec.Image).toBe("redis:7");
		});
	});
});

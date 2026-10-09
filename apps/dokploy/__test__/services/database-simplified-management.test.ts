import { describe, expect, it, vi } from "vitest";
import {
	buildDatabaseConnectionStrings,
	mergeEnvironmentVariables,
	type SupportedDatabaseType,
} from "@dokploy/server";

describe("Simplified Database Management & Automated Connections", () => {
	describe("buildDatabaseConnectionStrings for all 6 database types", () => {
		it("generates correct internal and external connection URLs for PostgreSQL", () => {
			const record = {
				appName: "postgres-app1",
				databaseUser: "postgres_user",
				databasePassword: "secret_password_123",
				databaseName: "my_database",
				externalPort: 15432,
			};

			const conn = buildDatabaseConnectionStrings(
				"postgres",
				record,
				"45.88.188.6",
			);

			expect(conn.type).toBe("postgres");
			expect(conn.internal.host).toBe("postgres-app1");
			expect(conn.internal.port).toBe(5432);
			expect(conn.internal.url).toBe(
				"postgresql://postgres_user:secret_password_123@postgres-app1:5432/my_database",
			);
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.host).toBe("45.88.188.6");
			expect(conn.external.port).toBe(15432);
			expect(conn.external.url).toBe(
				"postgresql://postgres_user:secret_password_123@45.88.188.6:15432/my_database",
			);
			expect(conn.envVariables.DATABASE_URL).toBe(
				"postgresql://postgres_user:secret_password_123@postgres-app1:5432/my_database",
			);
			expect(conn.envVariables.POSTGRES_USER).toBe("postgres_user");
			expect(conn.envVariables.POSTGRES_DB).toBe("my_database");
		});

		it("generates correct internal and external connection URLs for MySQL", () => {
			const record = {
				appName: "mysql-app1",
				databaseUser: "root",
				databasePassword: "mysql_password_123",
				databaseName: "shop_db",
				externalPort: 13306,
			};

			const conn = buildDatabaseConnectionStrings(
				"mysql",
				record,
				"db.example.com",
			);

			expect(conn.type).toBe("mysql");
			expect(conn.internal.host).toBe("mysql-app1");
			expect(conn.internal.port).toBe(3306);
			expect(conn.internal.url).toBe(
				"mysql://root:mysql_password_123@mysql-app1:3306/shop_db",
			);
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.url).toBe(
				"mysql://root:mysql_password_123@db.example.com:13306/shop_db",
			);
			expect(conn.envVariables.MYSQL_DATABASE).toBe("shop_db");
		});

		it("generates correct internal and external connection URLs for MariaDB", () => {
			const record = {
				appName: "mariadb-app1",
				databaseUser: "mariadb_user",
				databasePassword: "maria_pass_123",
				databaseName: "analytics_db",
				externalPort: null,
			};

			const conn = buildDatabaseConnectionStrings(
				"mariadb",
				record,
				"127.0.0.1",
			);

			expect(conn.type).toBe("mariadb");
			expect(conn.internal.port).toBe(3306);
			expect(conn.internal.url).toBe(
				"mysql://mariadb_user:maria_pass_123@mariadb-app1:3306/analytics_db",
			);
			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.envVariables.MARIADB_USER).toBe("mariadb_user");
		});

		it("generates correct internal and external connection URLs for MongoDB", () => {
			const record = {
				appName: "mongo-app1",
				databaseUser: "mongo_admin",
				databasePassword: "mongo_password_123",
				databaseName: "cluster_data",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				record,
				"198.51.100.2",
			);

			expect(conn.type).toBe("mongo");
			expect(conn.internal.port).toBe(27017);
			expect(conn.internal.url).toBe(
				"mongodb://mongo_admin:mongo_password_123@mongo-app1:27017/cluster_data?authSource=admin",
			);
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.url).toBe(
				"mongodb://mongo_admin:mongo_password_123@198.51.100.2:27017/cluster_data?authSource=admin",
			);
			expect(conn.envVariables.MONGO_URL).toBe(
				"mongodb://mongo_admin:mongo_password_123@mongo-app1:27017/cluster_data?authSource=admin",
			);
		});

		it("generates correct internal and external connection URLs for Redis", () => {
			const record = {
				appName: "redis-cache",
				databasePassword: "redis_pass_123",
				externalPort: 6379,
			};

			const conn = buildDatabaseConnectionStrings(
				"redis",
				record,
				"cache.hatdot.io",
			);

			expect(conn.type).toBe("redis");
			expect(conn.internal.port).toBe(6379);
			expect(conn.internal.url).toBe(
				"redis://default:redis_pass_123@redis-cache:6379",
			);
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.url).toBe(
				"redis://default:redis_pass_123@cache.hatdot.io:6379",
			);
			expect(conn.envVariables.REDIS_URL).toBe(
				"redis://default:redis_pass_123@redis-cache:6379",
			);
			expect(conn.envVariables.REDIS_PORT).toBe("6379");
		});

		it("generates correct internal and external connection URLs for LibSQL", () => {
			const record = {
				appName: "libsql-edge",
				databaseUser: "admin",
				databasePassword: "libsql_token_123",
				externalPort: 8080,
			};

			const conn = buildDatabaseConnectionStrings(
				"libsql",
				record,
				"libsql.hatdot.io",
			);

			expect(conn.type).toBe("libsql");
			expect(conn.internal.port).toBe(8080);
			expect(conn.internal.url).toBe(
				"http://admin:libsql_token_123@libsql-edge:8080",
			);
			expect(conn.external.isEnabled).toBe(true);
			expect(conn.external.url).toBe(
				"http://admin:libsql_token_123@libsql.hatdot.io:8080",
			);
			expect(conn.envVariables.LIBSQL_URL).toBe(
				"http://admin:libsql_token_123@libsql-edge:8080",
			);
		});
	});

	describe("mergeEnvironmentVariables for Connect to Application", () => {
		it("safely merges new variables into existing env without losing existing settings or comments", () => {
			const existingEnv = `
# Server Configuration
PORT=3000
NODE_ENV=production

# Security Keys
JWT_SECRET=super_secret_jwt_key
API_KEY=my_api_key
`;

			const newVars = {
				DATABASE_URL: "postgresql://user:pass@postgres-app:5432/mydb",
				POSTGRES_USER: "user",
				POSTGRES_PASSWORD: "pass",
				POSTGRES_DB: "mydb",
				POSTGRES_HOST: "postgres-app",
				POSTGRES_PORT: "5432",
			};

			const merged = mergeEnvironmentVariables(existingEnv, newVars);

			expect(merged).toContain("PORT=3000");
			expect(merged).toContain("NODE_ENV=production");
			expect(merged).toContain("# Security Keys");
			expect(merged).toContain("JWT_SECRET=super_secret_jwt_key");
			expect(merged).toContain(
				'DATABASE_URL="postgresql://user:pass@postgres-app:5432/mydb"',
			);
			expect(merged).toContain('POSTGRES_USER="user"');
			expect(merged).toContain('POSTGRES_DB="mydb"');
		});

		it("updates existing database variable keys in-place if they already exist", () => {
			const existingEnv = `
DATABASE_URL="postgresql://old_user:old_pass@old_host:5432/old_db"
APP_NAME=my-web-app
`;

			const newVars = {
				DATABASE_URL: "postgresql://new_user:new_pass@new_host:5432/new_db",
			};

			const merged = mergeEnvironmentVariables(existingEnv, newVars);

			expect(merged).toContain(
				'DATABASE_URL="postgresql://new_user:new_pass@new_host:5432/new_db"',
			);
			expect(merged).not.toContain("old_user:old_pass");
			expect(merged).toContain("APP_NAME=my-web-app");
		});

		it("handles empty or null existing environment correctly", () => {
			const newVars = {
				REDIS_URL: "redis://default:pass@redis-cache:6379",
				REDIS_PORT: "6379",
			};

			const merged = mergeEnvironmentVariables(null, newVars);

			expect(merged).toContain('REDIS_URL="redis://default:pass@redis-cache:6379"');
			expect(merged).toContain('REDIS_PORT="6379"');
		});
	});
});

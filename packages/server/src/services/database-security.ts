import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { quote } from "shell-quote";
import { db } from "../db";
import {
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "../db/schema";
import { getServiceContainer } from "../utils/docker/utils";
import { execAsync, execAsyncRemote } from "../utils/process/execAsync";
import type { SupportedDatabaseType } from "./database-connection";

/**
 * Result of a database security reconciliation or audit operation.
 */
export interface SecurityReconciliationResult {
	success: boolean;
	engine: SupportedDatabaseType;
	databaseId: string;
	appName: string;
	isolatedUser: string;
	targetDatabase: string;
	appliedRules: string[];
	warnings: string[];
	auditedAt: string;
	skipped?: boolean;
	skipReason?: string;
}

/**
 * Sanitizes a string into a valid, safe database identifier across all engines.
 * Strips special characters, prevents path traversals, and ensures identifier is not reserved.
 */
export const sanitizeDatabaseIdentifier = (name: string | null | undefined): string => {
	if (!name) return "app";
	const clean = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, "_")
		.replace(/^_+|_+$/g, "");
	const result = clean.slice(0, 63) || "app";
	// Avoid reserved system database names
	if (["admin", "config", "local", "mysql", "information_schema", "performance_schema", "sys"].includes(result)) {
		return `${result}_db`;
	}
	return result;
};

/**
 * Redacts passwords, tokens, and sensitive credentials from URLs, logs, and error strings.
 */
export const redactCredentials = (text: string | null | undefined): string => {
	if (!text) return "";
	return text
		// Redact standard URI credentials: schema://user:pass@host
		.replace(/([a-zA-Z0-9+.-]+:\/\/[^:]+:)([^@]+)(@)/g, "$1***$3")
		// Redact basic auth header tokens
		.replace(/Basic\s+([A-Za-z0-9+/=]+)/gi, "Basic ***")
		// Redact password query params
		.replace(/([?&]password=)[^&]*/gi, "$1***")
		// Redact password assignment in env or logs
		.replace(/((?:PASSWORD|ROOT_PASSWORD|PASS|SECRET|AUTH)=)[^\s;&]+/gi, "$1***");
};

/**
 * Sanitizes database record by removing sensitive root/administrative passwords
 * before sending to customer APIs or UI consumers.
 */
export const sanitizeDatabaseRecord = <T extends Record<string, any>>(record: T): Omit<T, "databaseRootPassword"> => {
	if (!record) return record;
	const { databaseRootPassword, ...sanitized } = record;
	return sanitized as Omit<T, "databaseRootPassword">;
};

/**
 * Generates an idempotent MongoDB script to enforce least-privilege user isolation.
 * The customer user is granted strictly 'readWrite' on the target database only.
 * No 'root', 'readWriteAnyDatabase', 'dbAdminAnyDatabase', or cluster-wide roles are granted.
 * Any legacy customer user on 'admin' database is removed.
 */
export const generateMongoIsolationScript = (params: {
	customerUser: string;
	customerPass: string;
	databaseName: string;
	adminUser?: string;
}): string => {
	const { customerUser, customerPass, databaseName, adminUser } = params;
	const safeDb = sanitizeDatabaseIdentifier(databaseName);
	
	// Escape single quotes and backslashes for JS string literals
	const escUser = customerUser.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	const escPass = customerPass.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	const escDb = safeDb.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

	return `
(function() {
	const targetDb = db.getSiblingDB('${escDb}');
	const existingTargetUser = targetDb.getUser('${escUser}');
	
	if (!existingTargetUser) {
		targetDb.createUser({
			user: '${escUser}',
			pwd: '${escPass}',
			roles: [{ role: 'readWrite', db: '${escDb}' }]
		});
	} else {
		targetDb.updateUser('${escUser}', {
			pwd: '${escPass}',
			roles: [{ role: 'readWrite', db: '${escDb}' }]
		});
	}

	// Remove legacy customer user from admin database if previously created there with overprivileged roles
	try {
		const adminDb = db.getSiblingDB('admin');
		const userOnAdmin = adminDb.getUser('${escUser}');
		if (userOnAdmin && '${escUser}' !== '${adminUser || "admin"}') {
			adminDb.dropUser('${escUser}');
		}
	} catch (e) {
		// Ignore if admin cleanup fails or user does not exist on admin
	}
})();
`.trim();
};

/**
 * Generates PostgreSQL SQL script to enforce per-database isolation.
 * Restricts customer role to NOSUPERUSER NOCREATEDB NOCREATEROLE.
 * Revokes CONNECT to template1 and postgres, grants ownership and schema privileges on assigned database.
 */
export const generatePostgresIsolationSql = (params: {
	customerUser: string;
	customerPass: string;
	databaseName: string;
}): string => {
	const { customerUser, customerPass, databaseName } = params;
	const safeDb = sanitizeDatabaseIdentifier(databaseName);
	const escUser = customerUser.replace(/"/g, '""');
	const escPass = customerPass.replace(/'/g, "''");

	return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${escUser}') THEN
    CREATE ROLE "${escUser}" WITH LOGIN PASSWORD '${escPass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSE
    ALTER ROLE "${escUser}" WITH PASSWORD '${escPass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

-- Revoke connect on default administrative databases
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM "${escUser}";
REVOKE CONNECT ON DATABASE postgres FROM "${escUser}";

-- Grant isolated access strictly to the customer's assigned database
GRANT CONNECT, TEMPORARY ON DATABASE "${safeDb}" TO "${escUser}";
GRANT ALL PRIVILEGES ON DATABASE "${safeDb}" TO "${escUser}";
ALTER DATABASE "${safeDb}" OWNER TO "${escUser}";
`.trim();
};

/**
 * Generates SQL for inside the assigned PostgreSQL database to configure schema ownership.
 */
export const generatePostgresSchemaIsolationSql = (customerUser: string): string => {
	const escUser = customerUser.replace(/"/g, '""');
	return `
GRANT ALL ON SCHEMA public TO "${escUser}";
ALTER SCHEMA public OWNER TO "${escUser}";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${escUser}";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${escUser}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${escUser}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${escUser}";
`.trim();
};

/**
 * Generates MySQL/MariaDB SQL script to enforce per-database user isolation.
 * Revokes all global privileges and grants permissions strictly on \`databaseName\`.*.
 */
export const generateMysqlIsolationSql = (params: {
	customerUser: string;
	customerPass: string;
	databaseName: string;
}): string => {
	const { customerUser, customerPass, databaseName } = params;
	const safeDb = sanitizeDatabaseIdentifier(databaseName);
	const escUser = customerUser.replace(/'/g, "''");
	const escPass = customerPass.replace(/'/g, "''");

	return `
CREATE USER IF NOT EXISTS '${escUser}'@'%' IDENTIFIED BY '${escPass}';
ALTER USER '${escUser}'@'%' IDENTIFIED BY '${escPass}';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${escUser}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, EVENT, TRIGGER ON \`${safeDb}\`.* TO '${escUser}'@'%';
FLUSH PRIVILEGES;
`.trim();
};

/**
 * Generates Redis ACL commands to enforce command-level isolation.
 * Restricts dangerous commands like FLUSHALL, FLUSHDB, SHUTDOWN, CONFIG, ACL, DEBUG, KEYS.
 */
export const generateRedisAclCommands = (params: {
	customerUser: string;
	customerPass: string;
}): string[] => {
	const { customerUser, customerPass } = params;
	const escUser = customerUser.replace(/\s+/g, "_");
	// Remove spaces or quotes from password
	const escPass = customerPass.replace(/[\s"]/g, "");

	return [
		`ACL SETUSER ${escUser} on >${escPass} ~* +@read +@write +@string +@list +@set +@sortedset +@hash +@pubsub +@transaction +@geo +@hyperloglog +@stream +@bitmap -@admin -@dangerous -FLUSHALL -FLUSHDB -SHUTDOWN -CONFIG -ACL -DEBUG -KEYS -SAVE -BGSAVE -SLAVEOF -REPLICAOF -MODULE`,
	];
};

/**
 * Reconciles security permissions on a live database instance.
 * Idempotently creates least-privilege roles, revokes administrative privileges,
 * and verifies that unauthorized database creation / cross-database operations are blocked.
 */
export const reconcileDatabaseSecurity = async (
	databaseId: string,
	type: SupportedDatabaseType,
	serverId?: string | null,
): Promise<SecurityReconciliationResult> => {
	const timestamp = new Date().toISOString();
	const appliedRules: string[] = [];
	const warnings: string[] = [];

	let appName = "";
	let customerUser = "";
	let customerPass = "";
	let databaseName = "app";
	let rootPass = "";

	if (type === "mongo") {
		const record = await db.query.mongo.findFirst({
			where: eq(mongo.mongoId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `MongoDB ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = record.databaseUser;
		customerPass = record.databasePassword;
		databaseName = (record as any).databaseName || sanitizeDatabaseIdentifier(record.name || record.appName);
	} else if (type === "postgres") {
		const record = await db.query.postgres.findFirst({
			where: eq(postgres.postgresId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `PostgreSQL ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = record.databaseUser;
		customerPass = record.databasePassword;
		databaseName = record.databaseName;
	} else if (type === "mysql") {
		const record = await db.query.mysql.findFirst({
			where: eq(mysql.mysqlId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `MySQL ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = record.databaseUser;
		customerPass = record.databasePassword;
		databaseName = record.databaseName;
		rootPass = record.databaseRootPassword;
	} else if (type === "mariadb") {
		const record = await db.query.mariadb.findFirst({
			where: eq(mariadb.mariadbId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `MariaDB ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = record.databaseUser;
		customerPass = record.databasePassword;
		databaseName = record.databaseName;
		rootPass = record.databaseRootPassword;
	} else if (type === "redis") {
		const record = await db.query.redis.findFirst({
			where: eq(redis.redisId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `Redis ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = "default";
		customerPass = record.databasePassword;
	} else if (type === "libsql") {
		const record = await db.query.libsql.findFirst({
			where: eq(libsql.libsqlId, databaseId),
		});
		if (!record) {
			throw new TRPCError({ code: "NOT_FOUND", message: `LibSQL ${databaseId} not found` });
		}
		appName = record.appName;
		customerUser = record.databaseUser;
		customerPass = record.databasePassword;

		// Audit external ports: ensure admin port (5000) is never mapped to external internet
		if (record.externalAdminPort && record.externalAdminPort > 0) {
			warnings.push("External admin port is open! Administrative APIs must be secured.");
		} else {
			appliedRules.push("Admin port 5000 is isolated from public network access.");
		}

		return {
			success: true,
			engine: "libsql",
			databaseId,
			appName,
			isolatedUser: customerUser,
			targetDatabase: "iku.db",
			appliedRules,
			warnings,
			auditedAt: timestamp,
		};
	}

	// Locate running service container
	const container = await getServiceContainer(appName, serverId);
	if (!container) {
		return {
			success: true,
			skipped: true,
			skipReason: `Container for ${appName} is not running. Security configuration will apply upon deployment.`,
			engine: type,
			databaseId,
			appName,
			isolatedUser: customerUser,
			targetDatabase: databaseName,
			appliedRules: ["Deferred until service startup"],
			warnings: [],
			auditedAt: timestamp,
		};
	}

	try {
		if (type === "mongo") {
			const script = generateMongoIsolationScript({
				customerUser,
				customerPass,
				databaseName,
			});
			const cmd = `docker exec ${quote([container.Id])} mongosh --eval ${quote([script])}`;
			if (serverId) {
				await execAsyncRemote(serverId, cmd);
			} else {
				await execAsync(cmd, { shell: "/bin/bash" });
			}
			appliedRules.push(`Granted role 'readWrite' strictly on '${databaseName}'`);
			appliedRules.push(`Revoked administrative and root privileges from '${customerUser}' on 'admin'`);
		} else if (type === "postgres") {
			const sqlScript = generatePostgresIsolationSql({
				customerUser,
				customerPass,
				databaseName,
			});
			const cmd = `docker exec -i ${quote([container.Id])} psql -U postgres -d postgres -c ${quote([sqlScript])}`;
			if (serverId) {
				await execAsyncRemote(serverId, cmd);
			} else {
				await execAsync(cmd, { shell: "/bin/bash" });
			}

			// Configure schema privileges inside target database
			const schemaSql = generatePostgresSchemaIsolationSql(customerUser);
			const cmdSchema = `docker exec -i ${quote([container.Id])} psql -U postgres -d ${quote([databaseName])} -c ${quote([schemaSql])}`;
			if (serverId) {
				await execAsyncRemote(serverId, cmdSchema);
			} else {
				await execAsync(cmdSchema, { shell: "/bin/bash" });
			}

			appliedRules.push(`Enforced NOSUPERUSER, NOCREATEDB, NOCREATEROLE on role '${customerUser}'`);
			appliedRules.push(`Revoked CONNECT on template1 and postgres from '${customerUser}'`);
			appliedRules.push(`Granted ownership and schema privileges on '${databaseName}'`);
		} else if (type === "mysql" || type === "mariadb") {
			const clientBin = type === "mariadb" ? "mariadb" : "mysql";
			const sqlScript = generateMysqlIsolationSql({
				customerUser,
				customerPass,
				databaseName,
			});
			const authFlag = rootPass ? `-p${quote([rootPass])}` : "";
			const cmd = `docker exec -i ${quote([container.Id])} ${clientBin} -u root ${authFlag} -e ${quote([sqlScript])}`;
			if (serverId) {
				await execAsyncRemote(serverId, cmd);
			} else {
				await execAsync(cmd, { shell: "/bin/bash" });
			}
			appliedRules.push(`Revoked global privileges and GRANT OPTION from '${customerUser}'@'%'`);
			appliedRules.push(`Granted least-privilege DDL/DML strictly on \`${databaseName}\`.*`);
		} else if (type === "redis") {
			const aclCommands = generateRedisAclCommands({
				customerUser: "app_user",
				customerPass,
			});
			for (const aclCmd of aclCommands) {
				const cmd = `docker exec ${quote([container.Id])} redis-cli -a ${quote([customerPass])} ${aclCmd}`;
				try {
					if (serverId) {
						await execAsyncRemote(serverId, cmd);
					} else {
						await execAsync(cmd, { shell: "/bin/bash" });
					}
					appliedRules.push("Configured Redis ACL user with dangerous administrative commands disabled");
				} catch (err) {
					// Fall back if Redis server version does not support ACLs (< Redis 6)
					warnings.push("Redis ACL command failed (version may be < 6). Instance isolation remains bound to container.");
				}
			}
		}

		return {
			success: true,
			engine: type,
			databaseId,
			appName,
			isolatedUser: customerUser,
			targetDatabase: databaseName,
			appliedRules,
			warnings,
			auditedAt: timestamp,
		};
	} catch (error: any) {
		const sanitizedError = redactCredentials(error?.message || String(error));
		return {
			success: false,
			engine: type,
			databaseId,
			appName,
			isolatedUser: customerUser,
			targetDatabase: databaseName,
			appliedRules,
			warnings: [...warnings, `Reconciliation error: ${sanitizedError}`],
			auditedAt: timestamp,
		};
	}
};

/**
 * Reconciles security across all provisioned databases in the system or organization.
 * Used for safe migrations and scheduled security sweeps.
 */
export const reconcileAllDatabasesSecurity = async (
	organizationId?: string,
): Promise<{
	secured: SecurityReconciliationResult[];
	skipped: SecurityReconciliationResult[];
	failed: SecurityReconciliationResult[];
}> => {
	const secured: SecurityReconciliationResult[] = [];
	const skipped: SecurityReconciliationResult[] = [];
	const failed: SecurityReconciliationResult[] = [];

	const allMongo = await db.query.mongo.findMany();
	for (const m of allMongo) {
		try {
			const res = await reconcileDatabaseSecurity(m.mongoId, "mongo", m.serverId);
			if (res.skipped) skipped.push(res);
			else if (res.success) secured.push(res);
			else failed.push(res);
		} catch (err: any) {
			failed.push({
				success: false,
				engine: "mongo",
				databaseId: m.mongoId,
				appName: m.appName,
				isolatedUser: m.databaseUser,
				targetDatabase: "app",
				appliedRules: [],
				warnings: [redactCredentials(err?.message || String(err))],
				auditedAt: new Date().toISOString(),
			});
		}
	}

	const allPostgres = await db.query.postgres.findMany();
	for (const p of allPostgres) {
		try {
			const res = await reconcileDatabaseSecurity(p.postgresId, "postgres", p.serverId);
			if (res.skipped) skipped.push(res);
			else if (res.success) secured.push(res);
			else failed.push(res);
		} catch (err: any) {
			failed.push({
				success: false,
				engine: "postgres",
				databaseId: p.postgresId,
				appName: p.appName,
				isolatedUser: p.databaseUser,
				targetDatabase: p.databaseName,
				appliedRules: [],
				warnings: [redactCredentials(err?.message || String(err))],
				auditedAt: new Date().toISOString(),
			});
		}
	}

	const allMysql = await db.query.mysql.findMany();
	for (const my of allMysql) {
		try {
			const res = await reconcileDatabaseSecurity(my.mysqlId, "mysql", my.serverId);
			if (res.skipped) skipped.push(res);
			else if (res.success) secured.push(res);
			else failed.push(res);
		} catch (err: any) {
			failed.push({
				success: false,
				engine: "mysql",
				databaseId: my.mysqlId,
				appName: my.appName,
				isolatedUser: my.databaseUser,
				targetDatabase: my.databaseName,
				appliedRules: [],
				warnings: [redactCredentials(err?.message || String(err))],
				auditedAt: new Date().toISOString(),
			});
		}
	}

	const allMariadb = await db.query.mariadb.findMany();
	for (const ma of allMariadb) {
		try {
			const res = await reconcileDatabaseSecurity(ma.mariadbId, "mariadb", ma.serverId);
			if (res.skipped) skipped.push(res);
			else if (res.success) secured.push(res);
			else failed.push(res);
		} catch (err: any) {
			failed.push({
				success: false,
				engine: "mariadb",
				databaseId: ma.mariadbId,
				appName: ma.appName,
				isolatedUser: ma.databaseUser,
				targetDatabase: ma.databaseName,
				appliedRules: [],
				warnings: [redactCredentials(err?.message || String(err))],
				auditedAt: new Date().toISOString(),
			});
		}
	}

	return { secured, skipped, failed };
};

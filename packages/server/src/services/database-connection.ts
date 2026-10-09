import { BRAND } from "@paas/branding";
import { TRPCError } from "@trpc/server";
import { isNull, not } from "drizzle-orm";
import { isIP } from "net";
import { db } from "../db";
import {
	libsql,
	mariadb,
	mongo,
	mysql,
	ports,
	postgres,
	redis,
} from "../db/schema";
import { findApplicationById, updateApplication } from "./application";
import { getPublicServerIp } from "./domain";
import { findLibsqlById } from "./libsql";
import { findMariadbById } from "./mariadb";
import { findMongoById } from "./mongo";
import { findMySqlById } from "./mysql";
import { findPostgresById } from "./postgres";
import { findRedisById } from "./redis";
import { checkPortInUse } from "./settings";
import { getWebServerSettings } from "./web-server-settings";

export type SupportedDatabaseType =
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

export interface DatabaseConnectionInfo {
	type: SupportedDatabaseType;
	internal: {
		host: string;
		port: number;
		user: string;
		password?: string;
		databaseName?: string;
		url: string;
	};
	external: {
		host: string;
		port: number | null;
		user: string;
		password?: string;
		databaseName?: string;
		url: string | null;
		isEnabled: boolean;
		hasPublicHost: boolean;
		isDomain: boolean;
		platformDomain: string | null;
		serverIp: string;
	};
	envVariables: Record<string, string>;
}

export interface DatabasePublicHostInfo {
	host: string;
	isDomain: boolean;
	platformDomain: string | null;
	serverIp: string;
}

/**
 * Resolves the platform database hostname (e.g. db.hatdot.cloud or db-<app>.hatdot.cloud)
 * ensuring customers see a branded managed domain rather than raw server IP addresses.
 */
export const getPublicDatabaseHost = async (
	serverId?: string,
	appName?: string,
): Promise<DatabasePublicHostInfo> => {
	const serverIp = await getPublicServerIp(serverId);
	const settings = await getWebServerSettings();

	// 1. Explicit environment variable for custom database gateway
	if (process.env.PLATFORM_DB_DOMAIN) {
		return {
			host: process.env.PLATFORM_DB_DOMAIN,
			isDomain: true,
			platformDomain: process.env.PLATFORM_DB_DOMAIN,
			serverIp,
		};
	}

	// 2. Web server settings host domain (e.g. app.hatdot.cloud -> db.hatdot.cloud)
	if (
		settings?.host &&
		!isIP(settings.host) &&
		settings.host !== "localhost" &&
		settings.host !== "127.0.0.1"
	) {
		const cleanHost = settings.host.replace(/^https?:\/\//, "").split(":")[0]!;
		const baseDomain = cleanHost.startsWith("app.")
			? cleanHost.slice(4)
			: cleanHost;
		const dbDomain = baseDomain.startsWith("db.")
			? baseDomain
			: `db.${baseDomain}`;

		return {
			host: dbDomain,
			isDomain: true,
			platformDomain: dbDomain,
			serverIp,
		};
	}

	// 3. Platform subdomain base from Branding config (defaults to hatdot.cloud)
	if (
		BRAND.PLATFORM_SUBDOMAIN_BASE &&
		BRAND.PLATFORM_SUBDOMAIN_BASE !== "localhost" &&
		!isIP(BRAND.PLATFORM_SUBDOMAIN_BASE)
	) {
		const cleanBase = BRAND.PLATFORM_SUBDOMAIN_BASE.replace(/^https?:\/\//, "").split(":")[0]!;
		const brandDbDomain = cleanBase.startsWith("db.")
			? cleanBase
			: `db.${cleanBase}`;

		return {
			host: brandDbDomain,
			isDomain: true,
			platformDomain: brandDbDomain,
			serverIp,
		};
	}

	// 4. Fallback to public IP
	const isResolvedDomain =
		!isIP(serverIp) && serverIp !== "localhost" && serverIp !== "127.0.0.1";

	return {
		host: serverIp,
		isDomain: isResolvedDomain,
		platformDomain: isResolvedDomain ? serverIp : null,
		serverIp,
	};
};

/**
 * Automatically allocates a safe, non-conflicting external TCP port
 * by inspecting both the database registry and active host/docker ports.
 */
export const allocateAvailableExternalPort = async (
	defaultPort: number,
	serverId?: string,
): Promise<number> => {
	const [pgRows, myRows, maRows, moRows, rdRows, lsRows, customPorts] =
		await Promise.all([
			db
				.select({ port: postgres.externalPort })
				.from(postgres)
				.where(not(isNull(postgres.externalPort))),
			db
				.select({ port: mysql.externalPort })
				.from(mysql)
				.where(not(isNull(mysql.externalPort))),
			db
				.select({ port: mariadb.externalPort })
				.from(mariadb)
				.where(not(isNull(mariadb.externalPort))),
			db
				.select({ port: mongo.externalPort })
				.from(mongo)
				.where(not(isNull(mongo.externalPort))),
			db
				.select({ port: redis.externalPort })
				.from(redis)
				.where(not(isNull(redis.externalPort))),
			db
				.select({
					port: libsql.externalPort,
					grpc: libsql.externalGRPCPort,
					admin: libsql.externalAdminPort,
				})
				.from(libsql),
			db.select({ port: ports.publishedPort }).from(ports),
		]);

	const allocated = new Set<number>();
	for (const r of pgRows) if (r.port) allocated.add(r.port);
	for (const r of myRows) if (r.port) allocated.add(r.port);
	for (const r of maRows) if (r.port) allocated.add(r.port);
	for (const r of moRows) if (r.port) allocated.add(r.port);
	for (const r of rdRows) if (r.port) allocated.add(r.port);
	for (const r of lsRows) {
		if (r.port) allocated.add(r.port);
		if (r.grpc) allocated.add(r.grpc);
		if (r.admin) allocated.add(r.admin);
	}
	for (const r of customPorts) if (r.port) allocated.add(r.port);

	// Try default engine port if available
	if (!allocated.has(defaultPort)) {
		const check = await checkPortInUse(defaultPort, serverId);
		if (!check.isInUse) {
			return defaultPort;
		}
	}

	// Try defaultPort + 1 to defaultPort + 500
	for (let p = defaultPort + 1; p <= Math.min(defaultPort + 500, 65000); p++) {
		if (allocated.has(p)) continue;
		const check = await checkPortInUse(p, serverId);
		if (!check.isInUse) {
			return p;
		}
	}

	// Fallback to dynamic port range (10000 - 30000)
	for (let p = 10000; p <= 30000; p++) {
		if (allocated.has(p)) continue;
		const check = await checkPortInUse(p, serverId);
		if (!check.isInUse) {
			return p;
		}
	}

	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: "No available external ports found",
	});
};

/**
 * Builds authoritative internal and external connection metadata and connection strings.
 */
export const buildDatabaseConnectionStrings = (
	type: SupportedDatabaseType,
	dbRecord: any,
	publicHost: string,
	publicHostInfo?: {
		isDomain?: boolean;
		platformDomain?: string | null;
		serverIp?: string;
	},
): DatabaseConnectionInfo => {
	const appName = dbRecord.appName || "";
	const user = dbRecord.databaseUser || (type === "redis" ? "default" : "postgres");
	const password = dbRecord.databasePassword || "";
	const databaseName = dbRecord.databaseName || "";
	const externalPort = dbRecord.externalPort ?? null;
	const isEnabled = externalPort !== null && externalPort > 0;
	const hasPublicHost = Boolean(publicHost && publicHost !== "127.0.0.1");
	const isDomain = publicHostInfo?.isDomain ?? (!isIP(publicHost) && publicHost !== "127.0.0.1");
	const platformDomain = publicHostInfo?.platformDomain ?? (isDomain ? publicHost : null);
	const serverIp = publicHostInfo?.serverIp ?? (isIP(publicHost) ? publicHost : "");

	let internalPort = 5432;
	let internalUrl = "";
	let externalUrl: string | null = null;
	const envVariables: Record<string, string> = {};

	if (type === "postgres") {
		internalPort = 5432;
		internalUrl = `postgresql://${user}:${password}@${appName}:${internalPort}/${databaseName}`;
		externalUrl = isEnabled
			? `postgresql://${user}:${password}@${publicHost}:${externalPort}/${databaseName}`
			: null;
		envVariables.DATABASE_URL = internalUrl;
		envVariables.POSTGRES_USER = user;
		envVariables.POSTGRES_PASSWORD = password;
		envVariables.POSTGRES_DB = databaseName;
		envVariables.POSTGRES_HOST = appName;
		envVariables.POSTGRES_PORT = String(internalPort);
	} else if (type === "mysql") {
		internalPort = 3306;
		internalUrl = `mysql://${user}:${password}@${appName}:${internalPort}/${databaseName}`;
		externalUrl = isEnabled
			? `mysql://${user}:${password}@${publicHost}:${externalPort}/${databaseName}`
			: null;
		envVariables.DATABASE_URL = internalUrl;
		envVariables.MYSQL_USER = user;
		envVariables.MYSQL_PASSWORD = password;
		envVariables.MYSQL_DATABASE = databaseName;
		envVariables.MYSQL_HOST = appName;
		envVariables.MYSQL_PORT = String(internalPort);
	} else if (type === "mariadb") {
		internalPort = 3306;
		internalUrl = `mysql://${user}:${password}@${appName}:${internalPort}/${databaseName}`;
		externalUrl = isEnabled
			? `mysql://${user}:${password}@${publicHost}:${externalPort}/${databaseName}`
			: null;
		envVariables.DATABASE_URL = internalUrl;
		envVariables.MARIADB_USER = user;
		envVariables.MARIADB_PASSWORD = password;
		envVariables.MARIADB_DATABASE = databaseName;
		envVariables.MARIADB_HOST = appName;
		envVariables.MARIADB_PORT = String(internalPort);
	} else if (type === "mongo") {
		internalPort = 27017;
		internalUrl = `mongodb://${user}:${password}@${appName}:${internalPort}/${databaseName}?authSource=admin`;
		externalUrl = isEnabled
			? `mongodb://${user}:${password}@${publicHost}:${externalPort}/${databaseName}?authSource=admin`
			: null;
		envVariables.DATABASE_URL = internalUrl;
		envVariables.MONGO_URL = internalUrl;
		envVariables.MONGO_USER = user;
		envVariables.MONGO_PASSWORD = password;
		envVariables.MONGO_DATABASE = databaseName;
		envVariables.MONGO_HOST = appName;
		envVariables.MONGO_PORT = String(internalPort);
	} else if (type === "redis") {
		internalPort = 6379;
		internalUrl = `redis://default:${password}@${appName}:${internalPort}`;
		externalUrl = isEnabled
			? `redis://default:${password}@${publicHost}:${externalPort}`
			: null;
		envVariables.REDIS_URL = internalUrl;
		envVariables.REDIS_PASSWORD = password;
		envVariables.REDIS_HOST = appName;
		envVariables.REDIS_PORT = String(internalPort);
	} else if (type === "libsql") {
		internalPort = 8080;
		internalUrl = `http://${user}:${password}@${appName}:${internalPort}`;
		externalUrl = isEnabled
			? `http://${user}:${password}@${publicHost}:${externalPort}`
			: null;
		envVariables.DATABASE_URL = internalUrl;
		envVariables.LIBSQL_URL = internalUrl;
		envVariables.LIBSQL_USER = user;
		envVariables.LIBSQL_PASSWORD = password;
		envVariables.LIBSQL_HOST = appName;
		envVariables.LIBSQL_PORT = String(internalPort);
	}

	return {
		type,
		internal: {
			host: appName,
			port: internalPort,
			user,
			password,
			databaseName: databaseName || undefined,
			url: internalUrl,
		},
		external: {
			host: publicHost,
			port: externalPort,
			user,
			password,
			databaseName: databaseName || undefined,
			url: externalUrl,
			isEnabled,
			hasPublicHost,
			isDomain,
			platformDomain,
			serverIp,
		},
		envVariables,
	};
};

/**
 * Merges new environment variables into an existing multi-line environment string
 * without deleting or damaging unrelated variables, comments, or whitespace.
 */
export const mergeEnvironmentVariables = (
	existingEnv: string | null | undefined,
	newVars: Record<string, string>,
): string => {
	const current = existingEnv || "";
	const lines = current.split("\n");
	const handled = new Set<string>();

	const updatedLines = lines.map((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			return line;
		}

		const hasExport = trimmed.startsWith("export ");
		const cleanLine = hasExport ? trimmed.replace(/^export\s+/, "") : trimmed;
		const eqIndex = cleanLine.indexOf("=");
		if (eqIndex === -1) return line;

		const key = cleanLine.substring(0, eqIndex).trim();
		if (key in newVars) {
			handled.add(key);
			const prefix = hasExport ? "export " : "";
			return `${prefix}${key}="${newVars[key]}"`;
		}
		return line;
	});

	const toAppend: string[] = [];
	for (const [key, value] of Object.entries(newVars)) {
		if (!handled.has(key)) {
			toAppend.push(`${key}="${value}"`);
		}
	}

	if (toAppend.length > 0) {
		const base = updatedLines.join("\n").trimEnd();
		return base
			? `${base}\n\n# Connected Database Configuration\n${toAppend.join("\n")}\n`
			: `${toAppend.join("\n")}\n`;
	}

	return updatedLines.join("\n");
};

/**
 * Connects an existing database to a target application by safely injecting
 * standard connection variables into the application's environment configuration.
 */
export const connectDatabaseToApplication = async (params: {
	databaseType: SupportedDatabaseType;
	databaseId: string;
	applicationId: string;
}) => {
	const app = await findApplicationById(params.applicationId);
	if (!app) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Target application not found",
		});
	}

	let dbRecord: any;
	if (params.databaseType === "postgres") {
		dbRecord = await findPostgresById(params.databaseId);
	} else if (params.databaseType === "mysql") {
		dbRecord = await findMySqlById(params.databaseId);
	} else if (params.databaseType === "mariadb") {
		dbRecord = await findMariadbById(params.databaseId);
	} else if (params.databaseType === "mongo") {
		dbRecord = await findMongoById(params.databaseId);
	} else if (params.databaseType === "redis") {
		dbRecord = await findRedisById(params.databaseId);
	} else if (params.databaseType === "libsql") {
		dbRecord = await findLibsqlById(params.databaseId);
	}

	if (!dbRecord) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Database not found",
		});
	}

	const publicHostInfo = await getPublicDatabaseHost(
		dbRecord.serverId || undefined,
		dbRecord.appName || undefined,
	);
	const connInfo = buildDatabaseConnectionStrings(
		params.databaseType,
		dbRecord,
		publicHostInfo.host,
		publicHostInfo,
	);
	const mergedEnv = mergeEnvironmentVariables(app.env, connInfo.envVariables);

	await updateApplication(params.applicationId, {
		env: mergedEnv,
	});

	return {
		success: true,
		appliedVariables: connInfo.envVariables,
		applicationName: app.name,
	};
};

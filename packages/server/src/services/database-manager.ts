import { TRPCError } from "@trpc/server";
import { quote } from "shell-quote";
import { db } from "../db";
import {
	libsql as libsqlTable,
	mariadb as mariadbTable,
	mongo as mongoTable,
	mysql as mysqlTable,
	postgres as postgresTable,
	redis as redisTable,
} from "../db/schema";
import { getServiceContainer } from "../utils/docker/utils";
import { execAsync, execAsyncRemote } from "../utils/process/execAsync";
import {
	redactCredentials,
	sanitizeDatabaseIdentifier,
} from "./database-security";
import { findLibsqlById } from "./libsql";
import { findMariadbById } from "./mariadb";
import { findMongoById } from "./mongo";
import { findMySqlById } from "./mysql";
import { findPostgresById } from "./postgres";
import { findRedisById } from "./redis";

import type { SupportedDatabaseType } from "./database-connection";

/**
 * Validates tenant ownership and returns the authorized database record.
 */
export const getAuthorizedDatabaseRecord = async (
	databaseId: string,
	engine: SupportedDatabaseType,
	organizationId: string,
) => {
	let record: any;
	if (engine === "mongo") {
		record = await findMongoById(databaseId);
	} else if (engine === "postgres") {
		record = await findPostgresById(databaseId);
	} else if (engine === "mysql") {
		record = await findMySqlById(databaseId);
	} else if (engine === "mariadb") {
		record = await findMariadbById(databaseId);
	} else if (engine === "redis") {
		record = await findRedisById(databaseId);
	} else if (engine === "libsql") {
		record = await findLibsqlById(databaseId);
	}

	if (!record) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Database with ID '${databaseId}' (${engine}) was not found.`,
		});
	}

	const orgId = record.environment?.project?.organizationId;
	if (!orgId || orgId !== organizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to manage this database resource.",
		});
	}

	return record;
};

/**
 * Executes a shell command inside a target service container on local or remote node.
 */
export const executeInsideServiceContainer = async (
	appName: string,
	serverId: string | null | undefined,
	command: string,
): Promise<{ stdout: string; stderr: string }> => {
	const container = await getServiceContainer(appName, serverId);
	if (!container) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Database instance for '${appName}' is not currently running. Please start or deploy the service to use manager features.`,
		});
	}

	const fullCmd = `docker exec ${quote([container.Id])} ${command}`;
	if (serverId) {
		return await execAsyncRemote(serverId, fullCmd);
	}
	return await execAsync(fullCmd, { shell: "/bin/bash" });
};

/**
 * Safely extracts and parses JSON payload from command output,
 * stripping any prefix/suffix daemon warnings, mongosh log notices, or connection headers.
 */
export function extractJsonFromStdout(stdout: string): any {
	const trimmed = stdout.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const firstBrace = trimmed.indexOf("{");
		const lastBrace = trimmed.lastIndexOf("}");
		if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
			const candidate = trimmed.substring(firstBrace, lastBrace + 1);
			return JSON.parse(candidate);
		}
		const firstBracket = trimmed.indexOf("[");
		const lastBracket = trimmed.lastIndexOf("]");
		if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
			const candidate = trimmed.substring(firstBracket, lastBracket + 1);
			return JSON.parse(candidate);
		}
		throw new Error(`Unable to parse JSON from command output: ${trimmed.slice(0, 150)}`);
	}
}

/* =======================================================================
 * 1. MONGODB ADAPTER
 * ======================================================================= */

export const mongoAdapter = {
	/**
	 * Discovers all logical databases available on the MongoDB instance.
	 */
	async listDatabases(record: any) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const configuredDb = record.databaseName || "app";

		const script = `
		(function() {
			let list = [];
			let restricted = false;
			let errorMsg = null;
			try {
				const adminRes = db.adminCommand({ listDatabases: 1 });
				if (adminRes && adminRes.databases) {
					list = adminRes.databases.map(d => ({
						name: d.name,
						sizeOnDisk: d.sizeOnDisk || 0,
						empty: d.empty || false,
						isInternal: ["admin", "config", "local"].includes(d.name)
					}));
				}
			} catch(e) {
				try {
					const names = db.getMongo().getDBNames();
					list = names.map(n => ({
						name: n,
						sizeOnDisk: 0,
						empty: false,
						isInternal: ["admin", "config", "local"].includes(n)
					}));
				} catch(e2) {
					restricted = true;
					errorMsg = e.message || e2.message;
				}
			}

			// Ensure configuredDb, "test", and "app" are included in the discoverable set
			const candidates = [${JSON.stringify(configuredDb)}, "test", "app"].filter(Boolean);
			candidates.forEach(cand => {
				if (!list.some(d => d.name === cand)) {
					list.push({
						name: cand,
						sizeOnDisk: 0,
						empty: false,
						isInternal: false
					});
				}
			});

			print(JSON.stringify({ databases: list, restricted, error: errorMsg, configuredDatabase: ${JSON.stringify(configuredDb)} }));
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = extractJsonFromStdout(res.stdout);
			return parsed.databases || [{ name: configuredDb, sizeOnDisk: 0, empty: false, isInternal: false }];
		} catch {
			return [
				{ name: configuredDb, sizeOnDisk: 0, empty: false, isInternal: false },
				...(configuredDb !== "test" ? [{ name: "test", sizeOnDisk: 0, empty: false, isInternal: false }] : [])
			];
		}
	},

	async getOverview(record: any, database?: string) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const v = db.version();
				const s = db.getSiblingDB(${JSON.stringify(targetDb)}).stats();
				const c = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollectionNames();
				print(JSON.stringify({
					version: v,
					database: ${JSON.stringify(targetDb)},
					collectionsCount: c.length,
					dataSize: s.dataSize || 0,
					storageSize: s.storageSize || 0,
					objectsCount: s.objects || 0,
					indexesCount: s.indexes || 0,
					indexSize: s.indexSize || 0,
				}));
			} catch(e) {
				print(JSON.stringify({ error: e.message, database: ${JSON.stringify(targetDb)} }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return extractJsonFromStdout(res.stdout);
		} catch {
			return { version: "MongoDB", database: targetDb, collectionsCount: 0, storageSize: 0 };
		}
	},

	async listCollections(record: any, database?: string) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			const target = db.getSiblingDB(${JSON.stringify(targetDb)});
			const names = target.getCollectionNames();
			const list = names.map(n => {
				try {
					const c = target.getCollection(n);
					const count = c.estimatedDocumentCount();
					return { name: n, documentCount: count, estimatedRows: count };
				} catch(e) {
					return { name: n, documentCount: 0, estimatedRows: 0 };
				}
			});
			print(JSON.stringify(list));
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return extractJsonFromStdout(res.stdout);
		} catch {
			return [];
		}
	},

	async createCollection(record: any, collectionName: string, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		if (!safeName) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid collection name." });
		}
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `db.getSiblingDB(${JSON.stringify(targetDb)}).createCollection(${JSON.stringify(safeName)}); print(JSON.stringify({ success: true }));`;
		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, name: safeName, database: targetDb };
	},

	async dropCollection(record: any, collectionName: string, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)}).drop(); print(JSON.stringify({ success: true }));`;
		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, name: safeName, database: targetDb };
	},

	async queryDocuments(
		record: any,
		collectionName: string,
		options: { page?: number; limit?: number; filter?: string; sort?: string; database?: string },
	) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const page = Math.max(1, options.page || 1);
		const limit = Math.min(100, Math.max(1, options.limit || 20));
		const skip = (page - 1) * limit;

		let filterObj = {};
		if (options.filter?.trim()) {
			try {
				filterObj = JSON.parse(options.filter);
			} catch {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid JSON filter object." });
			}
		}

		let sortObj = {};
		if (options.sort?.trim()) {
			try {
				sortObj = JSON.parse(options.sort);
			} catch {
				sortObj = { _id: -1 };
			}
		}

		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(options.database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const filter = ${JSON.stringify(filterObj)};
				const sort = ${JSON.stringify(sortObj)};
				const total = col.countDocuments(filter);
				const rawDocs = col.find(filter).sort(sort).skip(${skip}).limit(${limit}).toArray();

				function serializeVal(val) {
					if (val === null || val === undefined) return val;
					if (typeof val === 'bigint') return val.toString();
					if (typeof val === 'object') {
						if (val instanceof ObjectId || (val.constructor && val.constructor.name === 'ObjectId') || val._bsontype === 'ObjectID' || val._bsontype === 'ObjectId') {
							return val.toString();
						}
						if (val instanceof Date) {
							return val.toISOString();
						}
						if (val._bsontype === 'Decimal128' || (val.constructor && val.constructor.name === 'Decimal128')) {
							return val.toString();
						}
						if (val._bsontype === 'Long' || (val.constructor && val.constructor.name === 'Long')) {
							return val.toString();
						}
						if (val._bsontype === 'Binary' || (val.constructor && val.constructor.name === 'Binary')) {
							return typeof val.toString === 'function' ? val.toString('base64') : String(val);
						}
						if (val._bsontype === 'Timestamp' || (val.constructor && val.constructor.name === 'Timestamp')) {
							return val.toString();
						}
						if (Array.isArray(val)) {
							return val.map(serializeVal);
						}
						const copy = {};
						for (const k of Object.keys(val)) {
							copy[k] = serializeVal(val[k]);
						}
						return copy;
					}
					return val;
				}

				const docs = rawDocs.map(serializeVal);
				print(JSON.stringify({ total, page: ${page}, limit: ${limit}, documents: docs, rows: docs, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message, database: ${JSON.stringify(targetDb)} }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			const parsed = extractJsonFromStdout(res.stdout);
			if (parsed.error) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `MongoDB Query Error: ${parsed.error}` });
			}
			return {
				total: parsed.total ?? 0,
				page: parsed.page ?? page,
				limit: parsed.limit ?? limit,
				rows: parsed.rows ?? parsed.documents ?? [],
				documents: parsed.documents ?? parsed.rows ?? [],
				database: parsed.database || targetDb,
			};
		} catch (err: any) {
			if (err instanceof TRPCError) throw err;
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to query collection '${collectionName}': ${err?.message || "Unknown error"}`,
			});
		}
	},

	async insertDocument(record: any, collectionName: string, document: Record<string, any>, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const res = col.insertOne(${JSON.stringify(document)});
				print(JSON.stringify({ success: true, insertedId: res.insertedId, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async updateDocument(
		record: any,
		collectionName: string,
		docId: string,
		updateData: Record<string, any>,
		database?: string,
	) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				let id = ${JSON.stringify(docId)};
				let query = { _id: id };
				try {
					query = { _id: ObjectId(id) };
				} catch(e) {}
				const res = col.updateOne(query, { $set: ${JSON.stringify(updateData)} });
				print(JSON.stringify({ success: true, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async deleteDocument(record: any, collectionName: string, docId: string, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				let id = ${JSON.stringify(docId)};
				let query = { _id: id };
				try {
					query = { _id: ObjectId(id) };
				} catch(e) {}
				const res = col.deleteOne(query);
				print(JSON.stringify({ success: true, deletedCount: res.deletedCount, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async listIndexes(record: any, collectionName: string, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const idx = col.getIndexes();
				print(JSON.stringify(idx));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return extractJsonFromStdout(res.stdout);
		} catch {
			return [];
		}
	},

	async createIndex(
		record: any,
		collectionName: string,
		keys: Record<string, number>,
		options?: { unique?: boolean; name?: string },
		database?: string,
	) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const res = col.createIndex(${JSON.stringify(keys)}, ${JSON.stringify(options || {})});
				print(JSON.stringify({ success: true, indexName: res, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async dropIndex(record: any, collectionName: string, indexName: string, database?: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				col.dropIndex(${JSON.stringify(indexName)});
				print(JSON.stringify({ success: true, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async listUsers(record: any, database?: string) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				const users = db.getSiblingDB(${JSON.stringify(targetDb)}).getUsers();
				print(JSON.stringify(users.map(u => ({ user: u.user, roles: u.roles }))));
			} catch(e) {
				print(JSON.stringify([]));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return extractJsonFromStdout(res.stdout);
		} catch {
			return [];
		}
	},

	async createUser(record: any, username: string, password: string, role = "readWrite", database?: string) {
		const safeUser = sanitizeDatabaseIdentifier(username);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				db.getSiblingDB(${JSON.stringify(targetDb)}).createUser({
					user: ${JSON.stringify(safeUser)},
					pwd: ${JSON.stringify(password)},
					roles: [{ role: ${JSON.stringify(role)}, db: ${JSON.stringify(targetDb)} }]
				});
				print(JSON.stringify({ success: true, user: ${JSON.stringify(safeUser)}, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async dropUser(record: any, username: string, database?: string) {
		const safeUser = sanitizeDatabaseIdentifier(username);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

		const script = `
		(function() {
			try {
				db.getSiblingDB(${JSON.stringify(targetDb)}).dropUser(${JSON.stringify(safeUser)});
				print(JSON.stringify({ success: true, database: ${JSON.stringify(targetDb)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = extractJsonFromStdout(res.stdout);
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},
};

/* =======================================================================
 * 2. SQL ADAPTER (POSTGRESQL, MYSQL, MARIADB)
 * ======================================================================= */

export const sqlAdapter = {
	async listDatabases(record: any, engine: "postgres" | "mysql" | "mariadb") {
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const configuredDb = databaseName || (engine === "postgres" ? "postgres" : "");

		if (engine === "postgres") {
			const sql = `SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size_pretty FROM pg_database WHERE datistemplate = false ORDER BY datname;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([configuredDb || "postgres"])} -X -t -A -c ${quote([`SELECT json_agg(json_build_object('name', datname, 'sizeOnDisk', size_pretty, 'isInternal', datname IN ('postgres', 'template0', 'template1'))) FROM (${sql}) q;`])}`;
			try {
				const res = await executeInsideServiceContainer(appName, serverId, cmd);
				const list = JSON.parse(res.stdout.trim() || "[]");
				const found = Array.isArray(list) ? list : [];
				if (configuredDb && !found.some((d: any) => d.name === configuredDb)) {
					found.push({ name: configuredDb, sizeOnDisk: "0 MB", isInternal: false });
				}
				return found;
			} catch (err: any) {
				return [{ name: configuredDb || "postgres", sizeOnDisk: "0 MB", isInternal: false, error: err.message }];
			}
		}

		// MySQL / MariaDB
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} -s -N -e "SHOW DATABASES;"`;
		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const lines = res.stdout.trim().split("\n").filter(Boolean);
			const list = lines.map((name) => {
				const trimmed = name.trim();
				const isInternal = ["information_schema", "mysql", "performance_schema", "sys"].includes(trimmed);
				return { name: trimmed, sizeOnDisk: "0 MB", isInternal };
			});
			if (configuredDb && !list.some((d) => d.name === configuredDb)) {
				list.push({ name: configuredDb, sizeOnDisk: "0 MB", isInternal: false });
			}
			return list;
		} catch (err: any) {
			return [{ name: configuredDb || "mysql", sizeOnDisk: "0 MB", isInternal: false, error: err.message }];
		}
	},

	async getOverview(record: any, engine: "postgres" | "mysql" | "mariadb", database?: string) {
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const sql = `SELECT version() AS version, (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables_count, pg_size_pretty(pg_database_size(current_database())) AS total_size;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_build_object('version', version, 'tablesCount', tables_count, 'totalSize', total_size, 'database', '${targetDb}') FROM (${sql}) q;`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				return JSON.parse(res.stdout.trim());
			} catch {
				return { version: "PostgreSQL", database: targetDb, tablesCount: 0, totalSize: "0 MB" };
			}
		}

		// MySQL / MariaDB
		const sql = `SELECT VERSION() AS version, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tablesCount, CONCAT(ROUND(COALESCE(SUM(data_length + index_length), 0) / 1024 / 1024, 2), ' MB') AS totalSize FROM information_schema.tables WHERE table_schema = DATABASE();`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e ${quote([sql])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parts = res.stdout.trim().split("\t");
		return {
			version: parts[0] || `${engine.toUpperCase()}`,
			database: targetDb,
			tablesCount: Number.parseInt(parts[1] || "0", 10),
			totalSize: parts[2] || "0 MB",
		};
	},

	async listTables(record: any, engine: "postgres" | "mysql" | "mariadb", database?: string) {
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const sql = `SELECT table_name, COALESCE((SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = t.table_name AND n.nspname = 'public'), 0) AS estimated_rows FROM information_schema.tables t WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_agg(t) FROM (${sql}) t;`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const list = JSON.parse(res.stdout.trim() || "[]");
				return (list || []).map((t: any) => ({
					name: t.table_name,
					estimatedRows: Number(t.estimated_rows || 0),
					database: targetDb,
				}));
			} catch {
				return [];
			}
		}

		// MySQL / MariaDB
		const sql = `SELECT table_name, COALESCE(table_rows, 0) AS estimated_rows FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name;`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e ${quote([sql])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const lines = res.stdout.trim().split("\n").filter(Boolean);
		return lines.map((l) => {
			const [name, rows] = l.split("\t");
			return { name, estimatedRows: Number.parseInt(rows || "0", 10), database: targetDb };
		});
	},

	async getTableSchema(record: any, engine: "postgres" | "mysql" | "mariadb", tableName: string, database?: string) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const colSql = `
			SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
			       (SELECT count(*) > 0 FROM information_schema.table_constraints tc
			        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
			        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = c.table_name AND kcu.column_name = c.column_name) AS is_primary
			FROM information_schema.columns c
			WHERE table_schema = 'public' AND table_name = '${safeTable}'
			ORDER BY ordinal_position;
			`.trim();

			const idxSql = `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${safeTable}';`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_build_object('columns', (SELECT json_agg(c) FROM (${colSql}) c), 'indexes', (SELECT json_agg(i) FROM (${idxSql}) i));`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const parsed = JSON.parse(res.stdout.trim());
				return {
					tableName: safeTable,
					database: targetDb,
					columns: (parsed.columns || []).map((c: any) => ({
						name: c.column_name,
						type: c.data_type,
						isNullable: c.is_nullable === "YES",
						defaultValue: c.column_default,
						isPrimary: Boolean(c.is_primary),
					})),
					indexes: (parsed.indexes || []).map((i: any) => ({
						name: i.indexname,
						definition: i.indexdef,
					})),
				};
			} catch {
				return { tableName: safeTable, database: targetDb, columns: [], indexes: [] };
			}
		}

		// MySQL / MariaDB
		const colCmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e "DESCRIBE \\\`${safeTable}\\\`;"`;
		const idxCmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e "SHOW INDEX FROM \\\`${safeTable}\\\`;"`;

		const [colRes, idxRes] = await Promise.all([
			executeInsideServiceContainer(appName, serverId, colCmd),
			executeInsideServiceContainer(appName, serverId, idxCmd),
		]);

		const columns = colRes.stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				const [name, type, isNull, key, def] = l.split("\t");
				return {
					name,
					type,
					isNullable: isNull === "YES",
					defaultValue: def,
					isPrimary: key === "PRI",
				};
			});

		const indexes = idxRes.stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				const parts = l.split("\t");
				return {
					name: parts[2] || "index",
					column: parts[4] || "",
					isUnique: parts[1] === "0",
				};
			});

		return { tableName: safeTable, database: targetDb, columns, indexes };
	},

	async queryRows(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		options: { page?: number; limit?: number; searchColumn?: string; searchValue?: string; database?: string },
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const page = Math.max(1, options.page || 1);
		const limit = Math.min(100, Math.max(1, options.limit || 25));
		const offset = (page - 1) * limit;

		let whereClause = "";
		if (options.searchColumn && options.searchValue) {
			const safeCol = sanitizeDatabaseIdentifier(options.searchColumn);
			const escVal = options.searchValue.replace(/'/g, "''");
			whereClause = `WHERE "${safeCol}"::text ILIKE '%${escVal}%'`;
			if (engine !== "postgres") {
				whereClause = `WHERE \`${safeCol}\` LIKE '%${escVal}%'`;
			}
		}

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(options.database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const countSql = `SELECT count(*) FROM "${safeTable}" ${whereClause};`;
			const rowsSql = `SELECT * FROM "${safeTable}" ${whereClause} LIMIT ${limit} OFFSET ${offset};`;
			const combined = `SELECT json_build_object('total', (${countSql}), 'rows', (SELECT json_agg(r) FROM (${rowsSql}) r));`;

			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([combined])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const parsed = JSON.parse(res.stdout.trim());
				const rows = parsed.rows || [];
				return {
					total: Number.parseInt(parsed.total || "0", 10),
					page,
					limit,
					rows,
					documents: rows,
					database: targetDb,
				};
			} catch {
				return { total: 0, page, limit, rows: [], documents: [], database: targetDb };
			}
		}

		// MySQL / MariaDB
		const countCmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e "SELECT count(*) FROM \\\`${safeTable}\\\` ${whereClause};"`;
		const rowsCmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} --batch --raw -e "SELECT * FROM \\\`${safeTable}\\\` ${whereClause} LIMIT ${limit} OFFSET ${offset};"`;

		const [countRes, rowsRes] = await Promise.all([
			executeInsideServiceContainer(appName, serverId, countCmd),
			executeInsideServiceContainer(appName, serverId, rowsCmd),
		]);

		const total = Number.parseInt(countRes.stdout.trim() || "0", 10);
		const lines = rowsRes.stdout.trim().split("\n").filter(Boolean);
		if (lines.length <= 1) {
			return { total, page, limit, rows: [], documents: [], database: targetDb };
		}
		const headers = (lines[0] || "").split("\t");
		const rows = lines.slice(1).map((line) => {
			const vals = line.split("\t");
			const row: Record<string, any> = {};
			headers.forEach((h, i) => {
				if (h) row[h] = vals[i] ?? null;
			});
			return row;
		});

		return { total, page, limit, rows, documents: rows, database: targetDb };
	},

	async insertRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		rowData: Record<string, any>,
		database?: string,
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const columns = Object.keys(rowData).map(sanitizeDatabaseIdentifier).filter(Boolean);
		if (columns.length === 0) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "No row data provided." });
		}

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const colList = columns.map((c) => `"${c}"`).join(", ");
			const valList = columns
				.map((c) => {
					const val = rowData[c];
					if (val === null || val === undefined) return "NULL";
					return `'${String(val).replace(/'/g, "''")}'`;
				})
				.join(", ");

			const sql = `INSERT INTO "${safeTable}" (${colList}) VALUES (${valList}) RETURNING *;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_agg(r) FROM (${sql}) r;`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const inserted = JSON.parse(res.stdout.trim() || "[]");
				return { success: true, row: inserted[0], database: targetDb };
			} catch (err: any) {
				throw new TRPCError({ code: "BAD_REQUEST", message: res.stderr || err.message });
			}
		}

		// MySQL / MariaDB
		const colList = columns.map((c) => `\`${c}\``).join(", ");
		const valList = columns
			.map((c) => {
				const val = rowData[c];
				if (val === null || val === undefined) return "NULL";
				return `'${String(val).replace(/'/g, "''")}'`;
			})
			.join(", ");

		const sql = `INSERT INTO \`${safeTable}\` (${colList}) VALUES (${valList});`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([sql])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, database: targetDb };
	},

	async updateRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		primaryKey: { column: string; value: any },
		updateData: Record<string, any>,
		database?: string,
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const safePkCol = sanitizeDatabaseIdentifier(primaryKey.column);
		const escPkVal = String(primaryKey.value).replace(/'/g, "''");

		const cols = Object.keys(updateData).map(sanitizeDatabaseIdentifier).filter(Boolean);
		if (cols.length === 0) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "No update values provided." });
		}

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		if (engine === "postgres") {
			const setClause = cols
				.map((c) => {
					const val = updateData[c];
					if (val === null || val === undefined) return `"${c}" = NULL`;
					return `"${c}" = '${String(val).replace(/'/g, "''")}'`;
				})
				.join(", ");

			const sql = `UPDATE "${safeTable}" SET ${setClause} WHERE "${safePkCol}" = '${escPkVal}';`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -c ${quote([sql])}`;
			await executeInsideServiceContainer(appName, serverId, cmd);
			return { success: true, database: targetDb };
		}

		// MySQL / MariaDB
		const setClause = cols
			.map((c) => {
				const val = updateData[c];
				if (val === null || val === undefined) return `\`${c}\` = NULL`;
				return `\`${c}\` = '${String(val).replace(/'/g, "''")}'`;
			})
			.join(", ");

		const sql = `UPDATE \`${safeTable}\` SET ${setClause} WHERE \`${safePkCol}\` = '${escPkVal}';`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([sql])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, database: targetDb };
	},

	async deleteRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		primaryKey: { column: string; value: any },
		database?: string,
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const safePkCol = sanitizeDatabaseIdentifier(primaryKey.column);
		const escPkVal = String(primaryKey.value).replace(/'/g, "''");

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		const sql =
			engine === "postgres"
				? `DELETE FROM "${safeTable}" WHERE "${safePkCol}" = '${escPkVal}';`
				: `DELETE FROM \`${safeTable}\` WHERE \`${safePkCol}\` = '${escPkVal}';`;

		const cmd =
			engine === "postgres"
				? `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -c ${quote([sql])}`
				: `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([sql])}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, database: targetDb };
	},

	async executeSql(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		userSql: string,
		database?: string,
	) {
		const trimmed = userSql.trim();
		if (!trimmed) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "SQL query cannot be empty." });
		}

		// Detect potentially destructive commands for UI warning & confirmation
		const upper = trimmed.toUpperCase();
		const isDestructive =
			upper.startsWith("DROP ") ||
			upper.startsWith("TRUNCATE ") ||
			upper.startsWith("ALTER TABLE") ||
			(upper.startsWith("DELETE ") && !upper.includes("WHERE"));

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = sanitizeDatabaseIdentifier(database || databaseName || (engine === "postgres" ? "postgres" : ""));

		const startTime = Date.now();

		if (engine === "postgres") {
			// Wrap with timeout and max rows
			const wrapped = `SET statement_timeout = 15000;\n${trimmed}`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X --csv -c ${quote([wrapped])}`;
			try {
				const res = await executeInsideServiceContainer(appName, serverId, cmd);
				const durationMs = Date.now() - startTime;
				const lines = res.stdout.trim().split("\n").filter(Boolean);
				if (lines.length === 0) {
					return {
						columns: [],
						rows: [],
						rowCount: 0,
						durationMs,
						isDestructive,
						database: targetDb,
						statusMessage: res.stderr || "Query executed successfully.",
					};
				}
				const headers = (lines[0] || "").split(",");
				const rows = lines.slice(1, 201).map((l) => {
					const vals = l.split(",");
					const r: Record<string, any> = {};
					headers.forEach((h, i) => {
						if (h) r[h.replace(/^"|"$/g, "")] = vals[i]?.replace(/^"|"$/g, "") ?? null;
					});
					return r;
				});

				return {
					columns: headers.map((h) => h.replace(/^"|"$/g, "")),
					rows,
					rowCount: rows.length,
					durationMs,
					isDestructive,
					database: targetDb,
				};
			} catch (err: any) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: redactCredentials(err.message || "SQL Execution Error"),
				});
			}
		}

		// MySQL / MariaDB
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} --batch --raw -e ${quote([trimmed])}`;
		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const durationMs = Date.now() - startTime;
			const lines = res.stdout.trim().split("\n").filter(Boolean);
			if (lines.length === 0) {
				return {
					columns: [],
					rows: [],
					rowCount: 0,
					durationMs,
					isDestructive,
					database: targetDb,
					statusMessage: "Query executed successfully.",
				};
			}
			const headers = (lines[0] || "").split("\t");
			const rows = lines.slice(1, 201).map((l) => {
				const vals = l.split("\t");
				const r: Record<string, any> = {};
				headers.forEach((h, i) => {
					if (h) r[h] = vals[i] ?? null;
				});
				return r;
			});

			return {
				columns: headers,
				rows,
				rowCount: rows.length,
				durationMs,
				isDestructive,
				database: targetDb,
			};
		} catch (err: any) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: redactCredentials(err.message || "SQL Execution Error"),
			});
		}
	},
};

/* =======================================================================
 * 3. REDIS ADAPTER
 * ======================================================================= */

export const redisAdapter = {
	async listDatabases(record: any) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const cmd = `redis-cli ${auth}INFO keyspace`;
		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const lines = res.stdout.trim().split("\n");
			const keyspaceMap = new Map<string, number>();
			for (const line of lines) {
				const m = line.match(/^db(\d+):keys=(\d+)/);
				if (m && m[1] && m[2]) {
					keyspaceMap.set(m[1], Number.parseInt(m[2], 10));
				}
			}
			const list: Array<{ name: string; keysCount: number; empty: boolean; isInternal: boolean }> = [];
			for (let i = 0; i < 16; i++) {
				const str = String(i);
				const count = keyspaceMap.get(str) || 0;
				list.push({
					name: str,
					keysCount: count,
					empty: count === 0,
					isInternal: false,
				});
			}
			return list;
		} catch {
			return [{ name: "0", keysCount: 0, empty: false, isInternal: false }];
		}
	},

	async getOverview(record: any, database?: string) {
		const { appName, serverId, databasePassword } = record;
		const targetDb = database ? Number.parseInt(database, 10) : 0;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const cmd = `redis-cli ${auth}INFO`;

		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const lines = res.stdout.split("\n");
		const info: Record<string, string> = {};
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const idx = trimmed.indexOf(":");
			if (idx !== -1) {
				info[trimmed.substring(0, idx)] = trimmed.substring(idx + 1);
			}
		}

		let totalKeys = 0;
		const dbKey = `db${targetDb}`;
		if (info[dbKey]) {
			const m = info[dbKey].match(/keys=(\d+)/);
			if (m && m[1]) totalKeys = Number.parseInt(m[1], 10);
		}

		return {
			version: info.redis_version || "Redis",
			database: String(targetDb),
			usedMemory: info.used_memory_human || "0 MB",
			connectedClients: Number.parseInt(info.connected_clients || "1", 10),
			uptimeDays: Number.parseInt(info.uptime_in_days || "0", 10),
			totalKeys,
		};
	},

	async scanKeys(record: any, pattern = "*", cursor = "0", count = 100, database?: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const dbArg = database ? `-n ${quote([database])} ` : "";
		const scanCmd = `redis-cli ${auth}${dbArg}SCAN ${quote([cursor])} MATCH ${quote([pattern])} COUNT ${count}`;

		const res = await executeInsideServiceContainer(appName, serverId, scanCmd);
		const lines = res.stdout.trim().split("\n").filter(Boolean);
		const nextCursor = lines[0] || "0";
		const rawKeys = lines.slice(1);

		const keysWithMeta: Array<{ key: string; type: string; ttl: number }> = [];
		for (const k of rawKeys) {
			if (!k) continue;
			try {
				const typeCmd = `redis-cli ${auth}${dbArg}TYPE ${quote([k])}`;
				const ttlCmd = `redis-cli ${auth}${dbArg}TTL ${quote([k])}`;
				const [typeRes, ttlRes] = await Promise.all([
					executeInsideServiceContainer(appName, serverId, typeCmd),
					executeInsideServiceContainer(appName, serverId, ttlCmd),
				]);
				keysWithMeta.push({
					key: k,
					type: typeRes.stdout.trim() || "string",
					ttl: Number.parseInt(ttlRes.stdout.trim() || "-1", 10),
				});
			} catch {
				keysWithMeta.push({ key: k, type: "unknown", ttl: -1 });
			}
		}

		return { cursor: nextCursor, keys: keysWithMeta, database: database || "0" };
	},

	async getKey(record: any, key: string, database?: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const dbArg = database ? `-n ${quote([database])} ` : "";

		const typeCmd = `redis-cli ${auth}${dbArg}TYPE ${quote([key])}`;
		const ttlCmd = `redis-cli ${auth}${dbArg}TTL ${quote([key])}`;

		const [typeRes, ttlRes] = await Promise.all([
			executeInsideServiceContainer(appName, serverId, typeCmd),
			executeInsideServiceContainer(appName, serverId, ttlCmd),
		]);

		const type = typeRes.stdout.trim();
		const ttl = Number.parseInt(ttlRes.stdout.trim() || "-1", 10);

		let value: any = null;
		if (type === "string") {
			const getCmd = `redis-cli ${auth}${dbArg}GET ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim();
		} else if (type === "hash") {
			const getCmd = `redis-cli ${auth}${dbArg}HGETALL ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			const lines = res.stdout.trim().split("\n");
			const hash: Record<string, string> = {};
			for (let i = 0; i < lines.length; i += 2) {
				const kName = lines[i];
				if (kName) hash[kName] = lines[i + 1] || "";
			}
			value = hash;
		} else if (type === "list") {
			const getCmd = `redis-cli ${auth}${dbArg}LRANGE ${quote([key])} 0 99`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		} else if (type === "set") {
			const getCmd = `redis-cli ${auth}${dbArg}SMEMBERS ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		} else if (type === "zset") {
			const getCmd = `redis-cli ${auth}${dbArg}ZRANGE ${quote([key])} 0 99 WITHSCORES`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		}

		return { key, type, ttl, value, database: database || "0" };
	},

	async setKey(record: any, key: string, value: string, ttlSeconds?: number, database?: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const dbArg = database ? `-n ${quote([database])} ` : "";
		const exPart = ttlSeconds && ttlSeconds > 0 ? ` EX ${ttlSeconds}` : "";
		const cmd = `redis-cli ${auth}${dbArg}SET ${quote([key])} ${quote([value])}${exPart}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, key, database: database || "0" };
	},

	async deleteKey(record: any, key: string, database?: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const dbArg = database ? `-n ${quote([database])} ` : "";
		const cmd = `redis-cli ${auth}${dbArg}DEL ${quote([key])}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, key, database: database || "0" };
	},

	async executeCommand(record: any, rawCommand: string, database?: string) {
		const parts = rawCommand.trim().split(/\s+/);
		const verb = (parts[0] || "").toUpperCase();

		// Banned dangerous & destructive commands
		const BANNED = new Set([
			"FLUSHALL",
			"FLUSHDB",
			"SHUTDOWN",
			"CONFIG",
			"DEBUG",
			"SLAVEOF",
			"REPLICAOF",
			"MODULE",
			"KEYS",
			"ACL",
			"CLUSTER",
			"SAVE",
			"BGSAVE",
		]);

		if (BANNED.has(verb)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Execution of command '${verb}' is restricted for database safety and multi-tenant isolation.`,
			});
		}

		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const dbArg = database ? `-n ${quote([database])} ` : "";
		const cmd = `redis-cli ${auth}${dbArg}${rawCommand}`;

		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		return { output: res.stdout || res.stderr, database: database || "0" };
	},
};

/* =======================================================================
 * 4. LIBSQL ADAPTER
 * ======================================================================= */

export const libsqlAdapter = {
	async listDatabases(record: any) {
		return [{ name: "main", sizeOnDisk: "Embedded", empty: false, isInternal: false }];
	},

	async getOverview(record: any) {
		const { appName, serverId } = record;
		const sql = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';";
		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({
				requests: [{ type: "execute", stmt: { sql } }],
			}),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = JSON.parse(res.stdout);
			const count = parsed?.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value || 0;
			return {
				version: "LibSQL / sqld",
				database: "main",
				tablesCount: Number(count),
				totalSize: "Embedded",
			};
		} catch {
			return { version: "LibSQL", database: "main", tablesCount: 0, totalSize: "Embedded" };
		}
	},

	async listTables(record: any) {
		const { appName, serverId } = record;
		const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({
				requests: [{ type: "execute", stmt: { sql } }],
			}),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = JSON.parse(res.stdout);
			const rows = parsed?.results?.[0]?.response?.result?.rows || [];
			return rows.map((r: any) => ({ name: r[0]?.value, estimatedRows: 0, database: "main" }));
		} catch {
			return [];
		}
	},

	async getTableSchema(record: any, tableName: string) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const { appName, serverId } = record;
		const sql = `PRAGMA table_info("${safeTable}");`;
		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({
				requests: [{ type: "execute", stmt: { sql } }],
			}),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = JSON.parse(res.stdout);
			const rows = parsed?.results?.[0]?.response?.result?.rows || [];
			const columns = rows.map((r: any) => ({
				name: r[1]?.value,
				type: r[2]?.value,
				isNullable: r[3]?.value === 0,
				defaultValue: r[4]?.value,
				isPrimary: r[5]?.value === 1,
			}));
			return { tableName: safeTable, database: "main", columns, indexes: [] };
		} catch {
			return { tableName: safeTable, database: "main", columns: [], indexes: [] };
		}
	},

	async queryRows(record: any, tableName: string, options: { page?: number; limit?: number }) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const page = Math.max(1, options.page || 1);
		const limit = Math.min(100, Math.max(1, options.limit || 25));
		const offset = (page - 1) * limit;

		const { appName, serverId } = record;
		const countSql = `SELECT count(*) FROM "${safeTable}";`;
		const selectSql = `SELECT * FROM "${safeTable}" LIMIT ${limit} OFFSET ${offset};`;

		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({
				requests: [
					{ type: "execute", stmt: { sql: countSql } },
					{ type: "execute", stmt: { sql: selectSql } },
				],
			}),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = JSON.parse(res.stdout);
			const total = parsed?.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value || 0;
			const colDefs = parsed?.results?.[1]?.response?.result?.cols || [];
			const rowsRaw = parsed?.results?.[1]?.response?.result?.rows || [];

			const rows = rowsRaw.map((r: any) => {
				const row: Record<string, any> = {};
				colDefs.forEach((col: any, idx: number) => {
					row[col.name] = r[idx]?.value ?? null;
				});
				return row;
			});

			return { total: Number(total), page, limit, rows, documents: rows, database: "main" };
		} catch {
			return { total: 0, page, limit, rows: [], documents: [], database: "main" };
		}
	},

	async executeSql(record: any, userSql: string) {
		const trimmed = userSql.trim();
		const upper = trimmed.toUpperCase();
		const isDestructive =
			upper.startsWith("DROP ") ||
			upper.startsWith("TRUNCATE ") ||
			upper.startsWith("ALTER TABLE") ||
			(upper.startsWith("DELETE ") && !upper.includes("WHERE"));

		const { appName, serverId } = record;
		const startTime = Date.now();

		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({
				requests: [{ type: "execute", stmt: { sql: trimmed } }],
			}),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const durationMs = Date.now() - startTime;
			const parsed = JSON.parse(res.stdout);
			const result = parsed?.results?.[0]?.response?.result;

			if (!result) {
				const err = parsed?.results?.[0]?.response?.error?.message || "Execution error";
				throw new TRPCError({ code: "BAD_REQUEST", message: err });
			}

			const colDefs = result.cols || [];
			const rowsRaw = (result.rows || []).slice(0, 200);

			const rows = rowsRaw.map((r: any) => {
				const row: Record<string, any> = {};
				colDefs.forEach((col: any, idx: number) => {
					row[col.name] = r[idx]?.value ?? null;
				});
				return row;
			});

			return {
				columns: colDefs.map((c: any) => c.name),
				rows,
				rowCount: rows.length,
				durationMs,
				isDestructive,
				database: "main",
			};
		} catch (err: any) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: redactCredentials(err.message || "SQL Error"),
			});
		}
	},
};

/* =======================================================================
 * 5. UNIFIED DATABASE DISCOVERY & SELECTION
 * ======================================================================= */

export interface DiscoveredDatabase {
	name: string;
	sizeOnDisk?: number | string;
	empty?: boolean;
	isInternal?: boolean;
	estimatedCount?: number;
	keysCount?: number;
	isDefault?: boolean;
	error?: string;
}

/**
 * Discovers available logical databases for an authorized database resource.
 * Explicitly distinguishes managed resource identities from logical databases.
 */
export async function listDatabases(
	record: any,
	engine: SupportedDatabaseType,
): Promise<{ databases: DiscoveredDatabase[]; selectedDatabase: string }> {
	let databases: DiscoveredDatabase[] = [];

	try {
		if (engine === "mongo") {
			databases = await mongoAdapter.listDatabases(record);
		} else if (engine === "postgres" || engine === "mysql" || engine === "mariadb") {
			databases = await sqlAdapter.listDatabases(record, engine);
		} else if (engine === "redis") {
			databases = await redisAdapter.listDatabases(record);
		} else if (engine === "libsql") {
			databases = await libsqlAdapter.listDatabases(record);
		}
	} catch (err: any) {
		const fallbackDb = record.databaseName || (engine === "postgres" ? "postgres" : engine === "mongo" ? "app" : engine === "redis" ? "0" : "main");
		databases = [{ name: fallbackDb, sizeOnDisk: "0 MB", isInternal: false, isDefault: true, error: err.message }];
	}

	const selectedDatabase = record.databaseName || (engine === "postgres" ? "postgres" : engine === "mongo" ? "app" : engine === "redis" ? "0" : "main");

	for (const db of databases) {
		if (db.name === selectedDatabase) {
			db.isDefault = true;
		}
	}

	return {
		databases,
		selectedDatabase,
	};
}


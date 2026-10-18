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
			message: `Database container for '${appName}' is not currently running. Please start or deploy the service to use manager features.`,
		});
	}

	const fullCmd = `docker exec ${quote([container.Id])} ${command}`;
	if (serverId) {
		return await execAsyncRemote(serverId, fullCmd);
	}
	return await execAsync(fullCmd, { shell: "/bin/bash" });
};

/* =======================================================================
 * 1. MONGODB ADAPTER
 * ======================================================================= */

export const mongoAdapter = {
	async getOverview(record: any) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				const v = db.version();
				const s = db.getSiblingDB(${JSON.stringify(targetDb)}).stats();
				const c = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollectionNames();
				print(JSON.stringify({
					version: v,
					collectionsCount: c.length,
					dataSize: s.dataSize || 0,
					storageSize: s.storageSize || 0,
					objectsCount: s.objects || 0,
					indexesCount: s.indexes || 0,
					indexSize: s.indexSize || 0,
				}));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return JSON.parse(res.stdout.trim());
		} catch {
			return { version: "MongoDB", collectionsCount: 0, storageSize: 0 };
		}
	},

	async listCollections(record: any) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			const target = db.getSiblingDB(${JSON.stringify(targetDb)});
			const names = target.getCollectionNames();
			const list = names.map(n => {
				try {
					const c = target.getCollection(n);
					const count = c.estimatedDocumentCount();
					return { name: n, documentCount: count };
				} catch(e) {
					return { name: n, documentCount: 0 };
				}
			});
			print(JSON.stringify(list));
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			return JSON.parse(res.stdout.trim());
		} catch {
			return [];
		}
	},

	async createCollection(record: any, collectionName: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		if (!safeName) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid collection name." });
		}
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `db.getSiblingDB(${JSON.stringify(targetDb)}).createCollection(${JSON.stringify(safeName)}); print(JSON.stringify({ success: true }));`;
		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, name: safeName };
	},

	async dropCollection(record: any, collectionName: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)}).drop(); print(JSON.stringify({ success: true }));`;
		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, name: safeName };
	},

	async queryDocuments(
		record: any,
		collectionName: string,
		options: { page?: number; limit?: number; filter?: string; sort?: string },
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
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const filter = ${JSON.stringify(filterObj)};
				const sort = ${JSON.stringify(sortObj)};
				const total = col.countDocuments(filter);
				const docs = col.find(filter).sort(sort).skip(${skip}).limit(${limit}).toArray();
				print(JSON.stringify({ total, page: ${page}, limit: ${limit}, documents: docs }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		try {
			const parsed = JSON.parse(res.stdout.trim());
			if (parsed.error) {
				throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
			}
			return parsed;
		} catch (err: any) {
			if (err instanceof TRPCError) throw err;
			return { total: 0, page, limit, documents: [] };
		}
	},

	async insertDocument(record: any, collectionName: string, document: Record<string, any>) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const res = col.insertOne(${JSON.stringify(document)});
				print(JSON.stringify({ success: true, insertedId: res.insertedId }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
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
	) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

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
				print(JSON.stringify({ success: true, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async deleteDocument(record: any, collectionName: string, docId: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

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
				print(JSON.stringify({ success: true, deletedCount: res.deletedCount }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async listIndexes(record: any, collectionName: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

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
			return JSON.parse(res.stdout.trim());
		} catch {
			return [];
		}
	},

	async createIndex(
		record: any,
		collectionName: string,
		keys: Record<string, number>,
		options?: { unique?: boolean; name?: string },
	) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				const res = col.createIndex(${JSON.stringify(keys)}, ${JSON.stringify(options || {})});
				print(JSON.stringify({ success: true, indexName: res }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async dropIndex(record: any, collectionName: string, indexName: string) {
		const safeName = sanitizeDatabaseIdentifier(collectionName);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeName)});
				col.dropIndex(${JSON.stringify(indexName)});
				print(JSON.stringify({ success: true }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async listUsers(record: any) {
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

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
			return JSON.parse(res.stdout.trim());
		} catch {
			return [];
		}
	},

	async createUser(record: any, username: string, password: string, role = "readWrite") {
		const safeUser = sanitizeDatabaseIdentifier(username);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				db.getSiblingDB(${JSON.stringify(targetDb)}).createUser({
					user: ${JSON.stringify(safeUser)},
					pwd: ${JSON.stringify(password)},
					roles: [{ role: ${JSON.stringify(role)}, db: ${JSON.stringify(targetDb)} }]
				});
				print(JSON.stringify({ success: true, user: ${JSON.stringify(safeUser)} }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
		if (parsed.error) {
			throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
		}
		return parsed;
	},

	async dropUser(record: any, username: string) {
		const safeUser = sanitizeDatabaseIdentifier(username);
		const { appName, serverId, databaseUser, databasePassword } = record;
		const authDb = record.authSource || "admin";
		const targetDb = record.databaseName || "app";

		const script = `
		(function() {
			try {
				db.getSiblingDB(${JSON.stringify(targetDb)}).dropUser(${JSON.stringify(safeUser)});
				print(JSON.stringify({ success: true }));
			} catch(e) {
				print(JSON.stringify({ error: e.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh -u ${quote([databaseUser])} -p ${quote([databasePassword])} --authenticationDatabase ${quote([authDb])} --quiet --eval ${quote([script])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parsed = JSON.parse(res.stdout.trim());
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
	async getOverview(record: any, engine: "postgres" | "mysql" | "mariadb") {
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

		if (engine === "postgres") {
			const sql = `SELECT version() AS version, (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables_count, pg_size_pretty(pg_database_size(current_database())) AS total_size;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_build_object('version', version, 'tablesCount', tables_count, 'totalSize', total_size) FROM (${sql}) q;`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				return JSON.parse(res.stdout.trim());
			} catch {
				return { version: "PostgreSQL", tablesCount: 0, totalSize: "0 MB" };
			}
		}

		// MySQL / MariaDB
		const sql = `SELECT VERSION() AS version, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tablesCount, CONCAT(ROUND(COALESCE(SUM(data_length + index_length), 0) / 1024 / 1024, 2), ' MB') AS totalSize FROM information_schema.tables WHERE table_schema = DATABASE();`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -s -N -e ${quote([sql])}`;
		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		const parts = res.stdout.trim().split("\t");
		return {
			version: parts[0] || `${engine.toUpperCase()}`,
			tablesCount: Number.parseInt(parts[1] || "0", 10),
			totalSize: parts[2] || "0 MB",
		};
	},

	async listTables(record: any, engine: "postgres" | "mysql" | "mariadb") {
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

		if (engine === "postgres") {
			const sql = `SELECT table_name, COALESCE((SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = t.table_name AND n.nspname = 'public'), 0) AS estimated_rows FROM information_schema.tables t WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;`;
			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([`SELECT json_agg(t) FROM (${sql}) t;`])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const list = JSON.parse(res.stdout.trim() || "[]");
				return (list || []).map((t: any) => ({
					name: t.table_name,
					estimatedRows: Number(t.estimated_rows || 0),
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
			return { name, estimatedRows: Number.parseInt(rows || "0", 10) };
		});
	},

	async getTableSchema(record: any, engine: "postgres" | "mysql" | "mariadb", tableName: string) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

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
				return { tableName: safeTable, columns: [], indexes: [] };
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

		return { tableName: safeTable, columns, indexes };
	},

	async queryRows(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		options: { page?: number; limit?: number; searchColumn?: string; searchValue?: string },
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
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

		if (engine === "postgres") {
			const countSql = `SELECT count(*) FROM "${safeTable}" ${whereClause};`;
			const rowsSql = `SELECT * FROM "${safeTable}" ${whereClause} LIMIT ${limit} OFFSET ${offset};`;
			const combined = `SELECT json_build_object('total', (${countSql}), 'rows', (SELECT json_agg(r) FROM (${rowsSql}) r));`;

			const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([combined])}`;
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			try {
				const parsed = JSON.parse(res.stdout.trim());
				return {
					total: Number.parseInt(parsed.total || "0", 10),
					page,
					limit,
					rows: parsed.rows || [],
				};
			} catch {
				return { total: 0, page, limit, rows: [] };
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
			return { total, page, limit, rows: [] };
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

		return { total, page, limit, rows };
	},

	async insertRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		rowData: Record<string, any>,
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const columns = Object.keys(rowData).map(sanitizeDatabaseIdentifier).filter(Boolean);
		if (columns.length === 0) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "No row data provided." });
		}

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

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
				return { success: true, row: inserted[0] };
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
		return { success: true };
	},

	async updateRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		primaryKey: { column: string; value: any },
		updateData: Record<string, any>,
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const safePkCol = sanitizeDatabaseIdentifier(primaryKey.column);
		const escPkVal = String(primaryKey.value).replace(/'/g, "''");

		const cols = Object.keys(updateData).map(sanitizeDatabaseIdentifier).filter(Boolean);
		if (cols.length === 0) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "No update values provided." });
		}

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

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
			return { success: true };
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
		return { success: true };
	},

	async deleteRow(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		tableName: string,
		primaryKey: { column: string; value: any },
	) {
		const safeTable = sanitizeDatabaseIdentifier(tableName);
		const safePkCol = sanitizeDatabaseIdentifier(primaryKey.column);
		const escPkVal = String(primaryKey.value).replace(/'/g, "''");

		const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

		const sql =
			engine === "postgres"
				? `DELETE FROM "${safeTable}" WHERE "${safePkCol}" = '${escPkVal}';`
				: `DELETE FROM \`${safeTable}\` WHERE \`${safePkCol}\` = '${escPkVal}';`;

		const cmd =
			engine === "postgres"
				? `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -c ${quote([sql])}`
				: `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([sql])}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true };
	},

	async executeSql(
		record: any,
		engine: "postgres" | "mysql" | "mariadb",
		userSql: string,
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
		const targetDb = databaseName || (engine === "postgres" ? "postgres" : "");

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
	async getOverview(record: any) {
		const { appName, serverId, databasePassword } = record;
		const cmd = databasePassword
			? `redis-cli -a ${quote([databasePassword])} INFO`
			: "redis-cli INFO";

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
		if (info.db0) {
			const m = info.db0.match(/keys=(\d+)/);
			if (m && m[1]) totalKeys = Number.parseInt(m[1], 10);
		}

		return {
			version: info.redis_version || "Redis",
			usedMemory: info.used_memory_human || "0 MB",
			connectedClients: Number.parseInt(info.connected_clients || "1", 10),
			uptimeDays: Number.parseInt(info.uptime_in_days || "0", 10),
			totalKeys,
		};
	},

	async scanKeys(record: any, pattern = "*", cursor = "0", count = 100) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const scanCmd = `redis-cli ${auth}SCAN ${quote([cursor])} MATCH ${quote([pattern])} COUNT ${count}`;

		const res = await executeInsideServiceContainer(appName, serverId, scanCmd);
		const lines = res.stdout.trim().split("\n").filter(Boolean);
		const nextCursor = lines[0] || "0";
		const rawKeys = lines.slice(1);

		const keysWithMeta: Array<{ key: string; type: string; ttl: number }> = [];
		for (const k of rawKeys) {
			if (!k) continue;
			try {
				const metaCmd = `redis-cli ${auth}--raw MGET_TYPE_TTL`;
				const typeCmd = `redis-cli ${auth}TYPE ${quote([k])}`;
				const ttlCmd = `redis-cli ${auth}TTL ${quote([k])}`;
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

		return { cursor: nextCursor, keys: keysWithMeta };
	},

	async getKey(record: any, key: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";

		const typeCmd = `redis-cli ${auth}TYPE ${quote([key])}`;
		const ttlCmd = `redis-cli ${auth}TTL ${quote([key])}`;

		const [typeRes, ttlRes] = await Promise.all([
			executeInsideServiceContainer(appName, serverId, typeCmd),
			executeInsideServiceContainer(appName, serverId, ttlCmd),
		]);

		const type = typeRes.stdout.trim();
		const ttl = Number.parseInt(ttlRes.stdout.trim() || "-1", 10);

		let value: any = null;
		if (type === "string") {
			const getCmd = `redis-cli ${auth}GET ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim();
		} else if (type === "hash") {
			const getCmd = `redis-cli ${auth}HGETALL ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			const lines = res.stdout.trim().split("\n");
			const hash: Record<string, string> = {};
			for (let i = 0; i < lines.length; i += 2) {
				const kName = lines[i];
				if (kName) hash[kName] = lines[i + 1] || "";
			}
			value = hash;
		} else if (type === "list") {
			const getCmd = `redis-cli ${auth}LRANGE ${quote([key])} 0 99`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		} else if (type === "set") {
			const getCmd = `redis-cli ${auth}SMEMBERS ${quote([key])}`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		} else if (type === "zset") {
			const getCmd = `redis-cli ${auth}ZRANGE ${quote([key])} 0 99 WITHSCORES`;
			const res = await executeInsideServiceContainer(appName, serverId, getCmd);
			value = res.stdout.trim().split("\n");
		}

		return { key, type, ttl, value };
	},

	async setKey(record: any, key: string, value: string, ttlSeconds?: number) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const exPart = ttlSeconds && ttlSeconds > 0 ? ` EX ${ttlSeconds}` : "";
		const cmd = `redis-cli ${auth}SET ${quote([key])} ${quote([value])}${exPart}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, key };
	},

	async deleteKey(record: any, key: string) {
		const { appName, serverId, databasePassword } = record;
		const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";
		const cmd = `redis-cli ${auth}DEL ${quote([key])}`;

		await executeInsideServiceContainer(appName, serverId, cmd);
		return { success: true, key };
	},

	async executeCommand(record: any, rawCommand: string) {
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
		const cmd = `redis-cli ${auth}${rawCommand}`;

		const res = await executeInsideServiceContainer(appName, serverId, cmd);
		return { output: res.stdout || res.stderr };
	},
};

/* =======================================================================
 * 4. LIBSQL ADAPTER
 * ======================================================================= */

export const libsqlAdapter = {
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
				tablesCount: Number(count),
				totalSize: "Embedded",
			};
		} catch {
			return { version: "LibSQL", tablesCount: 0, totalSize: "Embedded" };
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
			return rows.map((r: any) => ({ name: r[0]?.value, estimatedRows: 0 }));
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
			return { tableName: safeTable, columns, indexes: [] };
		} catch {
			return { tableName: safeTable, columns: [], indexes: [] };
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

			return { total: Number(total), page, limit, rows };
		} catch {
			return { total: 0, page, limit, rows: [] };
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
			};
		} catch (err: any) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: redactCredentials(err.message || "SQL Error"),
			});
		}
	},
};

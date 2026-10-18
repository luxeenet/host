import {
	buildDatabaseConnectionStrings,
	executeDatabaseImport,
	getAuthorizedDatabaseRecord,
	getPublicDatabaseHost,
	libsqlAdapter,
	mongoAdapter,
	previewImport,
	redisAdapter,
	sqlAdapter,
	type SupportedDatabaseType,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import {
	backups as backupsTable,
	environments,
	libsql as libsqlTable,
	mariadb as mariadbTable,
	mongo as mongoTable,
	mysql as mysqlTable,
	postgres as postgresTable,
	projects,
	redis as redisTable,
} from "@dokploy/server/db/schema";
import { checkServiceAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";

const SupportedEngineEnum = z.enum([
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
]);

export const databaseManagerRouter = createTRPCRouter({
	/**
	 * Returns aggregated database overview list for the active organization across all 6 engines.
	 */
	overview: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;

		// 1. Fetch all projects belonging to the active organization
		const userProjects = await db.query.projects.findMany({
			where: eq(projects.organizationId, orgId),
			with: {
				environments: true,
			},
		});

		const envIds = userProjects.flatMap((p) =>
			p.environments.map((e) => e.environmentId),
		);

		if (envIds.length === 0) {
			return [];
		}

		// 2. Fetch all database instances across all engines
		const [pgList, mylList, marList, mngList, redList, libList] =
			await Promise.all([
				db.query.postgres.findMany({
					where: inArray(postgresTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
				db.query.mysql.findMany({
					where: inArray(mysqlTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
				db.query.mariadb.findMany({
					where: inArray(mariadbTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
				db.query.mongo.findMany({
					where: inArray(mongoTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
				db.query.redis.findMany({
					where: inArray(redisTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
				db.query.libsql.findMany({
					where: inArray(libsqlTable.environmentId, envIds),
					with: { environment: { with: { project: true } } },
				}),
			]);

		const allDbs: Array<{
			id: string;
			name: string;
			appName: string;
			engine: SupportedDatabaseType;
			dockerImage: string;
			status: string;
			externalPort: number | null;
			databaseName: string;
			databaseUser: string;
			projectId: string;
			projectName: string;
			environmentId: string;
			environmentName: string;
			createdAt: string;
			description: string | null;
			publicHost?: string;
			isExternalEnabled: boolean;
			authSource?: string;
		}> = [];

		for (const d of pgList) {
			allDbs.push({
				id: d.postgresId,
				name: d.name,
				appName: d.appName,
				engine: "postgres",
				dockerImage: d.dockerImage || "postgres:16",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: d.databaseName,
				databaseUser: d.databaseUser,
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		for (const d of mylList) {
			allDbs.push({
				id: d.mysqlId,
				name: d.name,
				appName: d.appName,
				engine: "mysql",
				dockerImage: d.dockerImage || "mysql:8",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: d.databaseName,
				databaseUser: d.databaseUser,
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		for (const d of marList) {
			allDbs.push({
				id: d.mariadbId,
				name: d.name,
				appName: d.appName,
				engine: "mariadb",
				dockerImage: d.dockerImage || "mariadb:11",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: d.databaseName,
				databaseUser: d.databaseUser,
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		for (const d of mngList) {
			allDbs.push({
				id: d.mongoId,
				name: d.name,
				appName: d.appName,
				engine: "mongo",
				dockerImage: d.dockerImage || "mongo:8",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: d.databaseName || "app",
				databaseUser: d.databaseUser,
				authSource: d.authSource || "admin",
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		for (const d of redList) {
			allDbs.push({
				id: d.redisId,
				name: d.name,
				appName: d.appName,
				engine: "redis",
				dockerImage: d.dockerImage || "redis:7",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: "0",
				databaseUser: "default",
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		for (const d of libList) {
			allDbs.push({
				id: d.libsqlId,
				name: d.name,
				appName: d.appName,
				engine: "libsql",
				dockerImage: d.dockerImage || "ghcr.io/tursodatabase/libsql-server:latest",
				status: d.applicationStatus || "idle",
				externalPort: d.externalPort,
				databaseName: "iku.db",
				databaseUser: d.databaseUser || "default",
				projectId: d.environment.projectId,
				projectName: d.environment.project.name,
				environmentId: d.environmentId,
				environmentName: d.environment.name,
				createdAt: d.createdAt,
				description: d.description,
				isExternalEnabled: Boolean(d.externalPort && d.externalPort > 0),
			});
		}

		// Sort by createdAt descending
		return allDbs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}),

	/**
	 * Returns engine-specific stats, storage, and version details.
	 */
	engineOverview: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			if (input.engine === "mongo") {
				return await mongoAdapter.getOverview(record);
			}
			if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				return await sqlAdapter.getOverview(record, input.engine);
			}
			if (input.engine === "redis") {
				return await redisAdapter.getOverview(record);
			}
			if (input.engine === "libsql") {
				return await libsqlAdapter.getOverview(record);
			}
			return {};
		}),

	/**
	 * Lists collections (MongoDB) or tables (PostgreSQL, MySQL, MariaDB, LibSQL).
	 */
	listCollectionsOrTables: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			if (input.engine === "mongo") {
				return await mongoAdapter.listCollections(record);
			}
			if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				return await sqlAdapter.listTables(record, input.engine);
			}
			if (input.engine === "libsql") {
				return await libsqlAdapter.listTables(record);
			}
			return [];
		}),

	/**
	 * Returns schema columns, data types, and indexes for a target table/collection.
	 */
	getSchema: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				name: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			if (input.engine === "mongo") {
				const indexes = await mongoAdapter.listIndexes(record, input.name);
				return { tableName: input.name, columns: [], indexes };
			}
			if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				return await sqlAdapter.getTableSchema(record, input.engine, input.name);
			}
			if (input.engine === "libsql") {
				return await libsqlAdapter.getTableSchema(record, input.name);
			}
			return { tableName: input.name, columns: [], indexes: [] };
		}),

	/**
	 * Returns paginated data rows or documents.
	 */
	queryData: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				name: z.string().min(1),
				page: z.number().min(1).default(1),
				limit: z.number().min(1).max(100).default(25),
				filter: z.string().optional(),
				sort: z.string().optional(),
				searchColumn: z.string().optional(),
				searchValue: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			if (input.engine === "mongo") {
				return await mongoAdapter.queryDocuments(record, input.name, {
					page: input.page,
					limit: input.limit,
					filter: input.filter,
					sort: input.sort,
				});
			}
			if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				return await sqlAdapter.queryRows(record, input.engine, input.name, {
					page: input.page,
					limit: input.limit,
					searchColumn: input.searchColumn,
					searchValue: input.searchValue,
				});
			}
			if (input.engine === "libsql") {
				return await libsqlAdapter.queryRows(record, input.name, {
					page: input.page,
					limit: input.limit,
				});
			}
			return { total: 0, page: 1, limit: 25, rows: [] };
		}),

	/**
	 * Inserts a document (MongoDB) or row (SQL).
	 */
	insertRecord: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				name: z.string().min(1),
				data: z.record(z.string(), z.any()),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			let res: any;
			if (input.engine === "mongo") {
				res = await mongoAdapter.insertDocument(record, input.name, input.data);
			} else if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				res = await sqlAdapter.insertRow(
					record,
					input.engine,
					input.name,
					input.data,
				);
			}

			await audit(ctx, {
				action: "create",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:${input.name}`,
			});

			return res;
		}),

	/**
	 * Updates a document (MongoDB) or row (SQL).
	 */
	updateRecord: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				name: z.string().min(1),
				id: z.any(),
				primaryKeyColumn: z.string().optional(),
				data: z.record(z.string(), z.any()),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			let res: any;
			if (input.engine === "mongo") {
				res = await mongoAdapter.updateDocument(
					record,
					input.name,
					String(input.id),
					input.data,
				);
			} else if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				res = await sqlAdapter.updateRow(
					record,
					input.engine,
					input.name,
					{ column: input.primaryKeyColumn || "id", value: input.id },
					input.data,
				);
			}

			await audit(ctx, {
				action: "update",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:${input.name}:${input.id}`,
			});

			return res;
		}),

	/**
	 * Deletes a document (MongoDB) or row (SQL).
	 */
	deleteRecord: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				name: z.string().min(1),
				id: z.any(),
				primaryKeyColumn: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "delete");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			let res: any;
			if (input.engine === "mongo") {
				res = await mongoAdapter.deleteDocument(
					record,
					input.name,
					String(input.id),
				);
			} else if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				res = await sqlAdapter.deleteRow(
					record,
					input.engine,
					input.name,
					{ column: input.primaryKeyColumn || "id", value: input.id },
				);
			}

			await audit(ctx, {
				action: "delete",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:${input.name}:${input.id}`,
			});

			return res;
		}),

	/**
	 * Creates a new collection (MongoDB).
	 */
	createCollection: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				name: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"mongo",
				ctx.session.activeOrganizationId,
			);
			const res = await mongoAdapter.createCollection(record, input.name);
			await audit(ctx, {
				action: "create",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:collection:${input.name}`,
			});
			return res;
		}),

	/**
	 * Drops an existing collection (MongoDB).
	 */
	dropCollection: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				name: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "delete");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"mongo",
				ctx.session.activeOrganizationId,
			);
			const res = await mongoAdapter.dropCollection(record, input.name);
			await audit(ctx, {
				action: "delete",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:collection:${input.name}`,
			});
			return res;
		}),

	/**
	 * Executes customer SQL in an isolated database container with row limits and destructive warnings.
	 */
	executeSql: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: z.enum(["postgres", "mysql", "mariadb", "libsql"]),
				sql: z.string().min(1),
				confirmedDestructive: z.boolean().default(false),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			const upper = input.sql.trim().toUpperCase();
			const isDestructive =
				upper.startsWith("DROP ") ||
				upper.startsWith("TRUNCATE ") ||
				upper.startsWith("ALTER TABLE") ||
				(upper.startsWith("DELETE ") && !upper.includes("WHERE"));

			if (isDestructive && !input.confirmedDestructive) {
				return {
					columns: [],
					rows: [],
					rowCount: 0,
					durationMs: 0,
					isDestructive: true,
					requiresConfirmation: true,
					statusMessage:
						"This query contains potentially destructive statements (DROP, TRUNCATE, or unconstrained DELETE). Please confirm execution.",
				};
			}

			let res: any;
			if (
				input.engine === "postgres" ||
				input.engine === "mysql" ||
				input.engine === "mariadb"
			) {
				res = await sqlAdapter.executeSql(record, input.engine, input.sql);
			} else if (input.engine === "libsql") {
				res = await libsqlAdapter.executeSql(record, input.sql);
			}

			await audit(ctx, {
				action: "run",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:sql`,
			});

			return res;
		}),

	/**
	 * Redis Key Scanning.
	 */
	redisScan: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				pattern: z.string().default("*"),
				cursor: z.string().default("0"),
				count: z.number().default(100),
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"redis",
				ctx.session.activeOrganizationId,
			);
			return await redisAdapter.scanKeys(
				record,
				input.pattern,
				input.cursor,
				input.count,
			);
		}),

	/**
	 * Redis Key Details.
	 */
	redisGetKey: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				key: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"redis",
				ctx.session.activeOrganizationId,
			);
			return await redisAdapter.getKey(record, input.key);
		}),

	/**
	 * Redis Set Key.
	 */
	redisSetKey: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				key: z.string().min(1),
				value: z.string(),
				ttl: z.number().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"redis",
				ctx.session.activeOrganizationId,
			);
			const res = await redisAdapter.setKey(
				record,
				input.key,
				input.value,
				input.ttl,
			);
			await audit(ctx, {
				action: "create",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:key:${input.key}`,
			});
			return res;
		}),

	/**
	 * Redis Delete Key.
	 */
	redisDeleteKey: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				key: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "delete");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"redis",
				ctx.session.activeOrganizationId,
			);
			const res = await redisAdapter.deleteKey(record, input.key);
			await audit(ctx, {
				action: "delete",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:key:${input.key}`,
			});
			return res;
		}),

	/**
	 * Redis Safe Command Runner.
	 */
	redisExecute: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				command: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				"redis",
				ctx.session.activeOrganizationId,
			);
			const res = await redisAdapter.executeCommand(record, input.command);
			await audit(ctx, {
				action: "run",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:command`,
			});
			return res;
		}),

	/**
	 * Lists database users.
	 */
	listUsers: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);
			if (input.engine === "mongo") {
				return await mongoAdapter.listUsers(record);
			}
			return [];
		}),

	/**
	 * Creates a database user.
	 */
	createUser: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				username: z.string().min(1),
				password: z.string().min(6),
				role: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			let res: any;
			if (input.engine === "mongo") {
				res = await mongoAdapter.createUser(
					record,
					input.username,
					input.password,
					input.role,
				);
			}

			await audit(ctx, {
				action: "create",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:user:${input.username}`,
			});

			return res;
		}),

	/**
	 * Drops a database user.
	 */
	dropUser: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				username: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "delete");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			let res: any;
			if (input.engine === "mongo") {
				res = await mongoAdapter.dropUser(record, input.username);
			}

			await audit(ctx, {
				action: "delete",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:user:${input.username}`,
			});

			return res;
		}),

	/**
	 * Previews an uploaded CSV or JSON file, detects headers, infers types, and offers sample records.
	 */
	previewImportFile: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				fileContent: z.string().max(10 * 1024 * 1024),
				fileType: z.enum(["csv", "json"]),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "read");
			await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			const preview = previewImport(input.fileContent, input.fileType);
			return preview;
		}),

	/**
	 * Universally imports CSV or JSON records into any of the 6 supported database engines
	 * with schema-aware conversion, duplicate handling policies, row-level error reporting, and transactions.
	 */
	importData: protectedProcedure
		.input(
			z.object({
				databaseId: z.string().min(1),
				engine: SupportedEngineEnum,
				targetEntity: z.string().min(1),
				fileContent: z.string().max(10 * 1024 * 1024),
				fileType: z.enum(["csv", "json"]),
				fieldMappings: z.record(z.string(), z.string()).optional(),
				duplicatePolicy: z.enum(["reject", "skip", "update"]).default("skip"),
				redisConfig: z
					.object({
						structure: z.enum(["string", "hash", "list", "set", "zset"]).default("hash"),
						keyField: z.string().optional(),
						keyPrefix: z.string().optional(),
						scoreField: z.string().optional(),
						ttl: z.number().optional(),
					})
					.optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await checkServiceAccess(ctx, input.databaseId, "create");
			const record = await getAuthorizedDatabaseRecord(
				input.databaseId,
				input.engine,
				ctx.session.activeOrganizationId,
			);

			const result = await executeDatabaseImport(record, input);

			await audit(ctx, {
				action: "create",
				resourceType: "service",
				resourceId: input.databaseId,
				resourceName: `${record.appName}:import:${input.targetEntity}`,
			});

			return result;
		}),
});

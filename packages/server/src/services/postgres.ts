import { db } from "@dokploy/server/db";
import {
	type apiCreatePostgres,
	backups,
	buildAppName,
	postgres,
} from "@dokploy/server/db/schema";
import { generatePassword } from "@dokploy/server/templates";
import { buildPostgres } from "@dokploy/server/utils/databases/postgres";
import {
	pullImage,
	waitForSwarmServiceConvergence,
} from "@dokploy/server/utils/docker/utils";
import { execAsyncRemote } from "@dokploy/server/utils/process/execAsync";
import { TRPCError } from "@trpc/server";
import { eq, getTableColumns } from "drizzle-orm";
import { quote } from "shell-quote";
import type { z } from "zod";
import {
	getDatabaseMountPath,
	resolveDatabaseImage,
	validateDatabaseImage,
} from "../utils/databases/image-resolution";
import { reconcileDatabaseSecurity, sanitizeDatabaseIdentifier } from "./database-security";
import { provisionDatabaseService } from "./database-lifecycle";
import { validUniqueServerAppName } from "./project";

export function getMountPath(dockerImage?: string | null): string {
	return getDatabaseMountPath("postgres", dockerImage);
}

export type Postgres = typeof postgres.$inferSelect;

export const createPostgres = async (
	input: z.infer<typeof apiCreatePostgres>,
	tx: any = db,
) => {
	const appName = buildAppName("postgres", input.appName);

	const valid = await validUniqueServerAppName(appName);
	if (!valid) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Service with this 'AppName' already exists",
		});
	}

	const resolvedImage = resolveDatabaseImage("postgres", input.dockerImage);
	const assignedDatabaseName = sanitizeDatabaseIdentifier(
		input.databaseName || "postgres",
	);

	const newPostgres = await tx
		.insert(postgres)
		.values({
			...input,
			databaseName: assignedDatabaseName,
			dockerImage: resolvedImage,
			databasePassword: input.databasePassword
				? input.databasePassword
				: generatePassword(),
			appName,
		})
		.returning()
		.then((value: any) => value[0]);

	if (!newPostgres) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error input: Inserting postgresql database",
		});
	}

	return newPostgres;
};
export const findPostgresById = async (postgresId: string) => {
	const result = await db.query.postgres.findFirst({
		where: eq(postgres.postgresId, postgresId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
			mounts: true,
			server: true,
			backups: {
				with: {
					destination: {
						columns: {
							accessKey: false,
							secretAccessKey: false,
						},
					},
					deployments: true,
				},
			},
		},
	});
	if (!result) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Postgres not found",
		});
	}
	return result;
};

export const findPostgresByBackupId = async (backupId: string) => {
	const result = await db
		.select({
			...getTableColumns(postgres),
		})
		.from(postgres)
		.innerJoin(backups, eq(postgres.postgresId, backups.postgresId))
		.where(eq(backups.backupId, backupId))
		.limit(1);

	if (!result || !result[0]) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Postgres not found",
		});
	}
	return result[0];
};

export const updatePostgresById = async (
	postgresId: string,
	postgresData: Partial<Postgres>,
) => {
	const { appName, ...rest } = postgresData;
	if (rest.dockerImage !== undefined) {
		const resolvedImage = resolveDatabaseImage("postgres", rest.dockerImage);
		validateDatabaseImage(resolvedImage);
		rest.dockerImage = resolvedImage;
	}
	const result = await db
		.update(postgres)
		.set({
			...rest,
		})
		.where(eq(postgres.postgresId, postgresId))
		.returning();

	return result[0];
};

export const removePostgresById = async (postgresId: string) => {
	const result = await db
		.delete(postgres)
		.where(eq(postgres.postgresId, postgresId))
		.returning();

	return result[0];
};

export const deployPostgres = async (
	postgresId: string,
	onData?: (data: any) => void,
) => {
	const postgres = await findPostgresById(postgresId);
	await provisionDatabaseService({
		databaseId: postgresId,
		engine: "postgres",
		serverId: postgres.serverId,
		onData,
	});
	return await findPostgresById(postgresId);
};

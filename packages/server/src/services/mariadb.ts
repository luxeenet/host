import { db } from "@dokploy/server/db";
import {
	type apiCreateMariaDB,
	backups,
	buildAppName,
	mariadb,
} from "@dokploy/server/db/schema";
import { generatePassword } from "@dokploy/server/templates";
import { buildMariadb } from "@dokploy/server/utils/databases/mariadb";
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
	resolveDatabaseImage,
	validateDatabaseImage,
} from "../utils/databases/image-resolution";
import { reconcileDatabaseSecurity, sanitizeDatabaseIdentifier } from "./database-security";
import { provisionDatabaseService } from "./database-lifecycle";
import { validUniqueServerAppName } from "./project";

export type Mariadb = typeof mariadb.$inferSelect;

export const createMariadb = async (
	input: z.infer<typeof apiCreateMariaDB>,
	tx: any = db,
) => {
	const appName = buildAppName("mariadb", input.appName);

	const valid = await validUniqueServerAppName(appName);
	if (!valid) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Service with this 'AppName' already exists",
		});
	}

	const resolvedImage = resolveDatabaseImage("mariadb", input.dockerImage);
	const assignedDatabaseName = sanitizeDatabaseIdentifier(
		input.databaseName || "mariadb",
	);

	const newMariadb = await tx
		.insert(mariadb)
		.values({
			...input,
			databaseName: assignedDatabaseName,
			dockerImage: resolvedImage,
			databasePassword: input.databasePassword
				? input.databasePassword
				: generatePassword(),
			databaseRootPassword: input.databaseRootPassword
				? input.databaseRootPassword
				: generatePassword(),
			appName,
		})
		.returning()
		.then((value: any) => value[0]);

	if (!newMariadb) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error input: Inserting mariadb database",
		});
	}

	return newMariadb;
};

// https://github.com/drizzle-team/drizzle-orm/discussions/1483#discussioncomment-7523881
export const findMariadbById = async (mariadbId: string) => {
	const result = await db.query.mariadb.findFirst({
		where: eq(mariadb.mariadbId, mariadbId),
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
			message: "Mariadb not found",
		});
	}
	return result;
};

export const updateMariadbById = async (
	mariadbId: string,
	mariadbData: Partial<Mariadb>,
) => {
	const { appName, ...rest } = mariadbData;
	if (rest.dockerImage !== undefined) {
		const resolvedImage = resolveDatabaseImage("mariadb", rest.dockerImage);
		validateDatabaseImage(resolvedImage);
		rest.dockerImage = resolvedImage;
	}
	const result = await db
		.update(mariadb)
		.set({
			...rest,
		})
		.where(eq(mariadb.mariadbId, mariadbId))
		.returning();

	return result[0];
};

export const removeMariadbById = async (mariadbId: string) => {
	const result = await db
		.delete(mariadb)
		.where(eq(mariadb.mariadbId, mariadbId))
		.returning();

	return result[0];
};

export const findMariadbByBackupId = async (backupId: string) => {
	const result = await db
		.select({
			...getTableColumns(mariadb),
		})
		.from(mariadb)
		.innerJoin(backups, eq(mariadb.mariadbId, backups.mariadbId))
		.where(eq(backups.backupId, backupId))
		.limit(1);

	if (!result || !result[0]) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "MariaDB not found",
		});
	}
	return result[0];
};

export const deployMariadb = async (
	mariadbId: string,
	onData?: (data: any) => void,
) => {
	const mariadb = await findMariadbById(mariadbId);
	await provisionDatabaseService({
		databaseId: mariadbId,
		engine: "mariadb",
		serverId: mariadb.serverId,
		onData,
	});
	return await findMariadbById(mariadbId);
};

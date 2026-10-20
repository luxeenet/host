import { db } from "@dokploy/server/db";
import {
	type apiCreateRedis,
	buildAppName,
	redis,
} from "@dokploy/server/db/schema";
import { generatePassword } from "@dokploy/server/templates";
import { buildRedis } from "@dokploy/server/utils/databases/redis";
import {
	pullImage,
	waitForSwarmServiceConvergence,
} from "@dokploy/server/utils/docker/utils";
import { execAsyncRemote } from "@dokploy/server/utils/process/execAsync";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { quote } from "shell-quote";
import type { z } from "zod";
import {
	resolveDatabaseImage,
	validateDatabaseImage,
} from "../utils/databases/image-resolution";
import { reconcileDatabaseSecurity } from "./database-security";
import { provisionDatabaseService } from "./database-lifecycle";
import { validUniqueServerAppName } from "./project";

export type Redis = typeof redis.$inferSelect;

// https://github.com/drizzle-team/drizzle-orm/discussions/1483#discussioncomment-7523881
export const createRedis = async (
	input: z.infer<typeof apiCreateRedis>,
	tx: any = db,
) => {
	const appName = buildAppName("redis", input.appName);

	const valid = await validUniqueServerAppName(appName);
	if (!valid) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Service with this 'AppName' already exists",
		});
	}

	const resolvedImage = resolveDatabaseImage("redis", input.dockerImage);

	const newRedis = await tx
		.insert(redis)
		.values({
			...input,
			dockerImage: resolvedImage,
			databasePassword: input.databasePassword
				? input.databasePassword
				: generatePassword(),
			appName,
		})
		.returning()
		.then((value: any) => value[0]);

	if (!newRedis) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error input: Inserting redis database",
		});
	}

	return newRedis;
};

export const findRedisById = async (redisId: string) => {
	const result = await db.query.redis.findFirst({
		where: eq(redis.redisId, redisId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
			mounts: true,
			server: true,
		},
	});
	if (!result) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Redis not found",
		});
	}
	return result;
};

export const updateRedisById = async (
	redisId: string,
	redisData: Partial<Redis>,
) => {
	const { appName, ...rest } = redisData;
	if (rest.dockerImage !== undefined) {
		const resolvedImage = resolveDatabaseImage("redis", rest.dockerImage);
		validateDatabaseImage(resolvedImage);
		rest.dockerImage = resolvedImage;
	}
	const result = await db
		.update(redis)
		.set({
			...rest,
		})
		.where(eq(redis.redisId, redisId))
		.returning();

	return result[0];
};

export const removeRedisById = async (redisId: string) => {
	const result = await db
		.delete(redis)
		.where(eq(redis.redisId, redisId))
		.returning();

	return result[0];
};

export const deployRedis = async (
	redisId: string,
	onData?: (data: any) => void,
) => {
	const redis = await findRedisById(redisId);
	await provisionDatabaseService({
		databaseId: redisId,
		engine: "redis",
		serverId: redis.serverId,
		onData,
	});
	return await findRedisById(redisId);
};

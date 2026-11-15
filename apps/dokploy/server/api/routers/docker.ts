import {
	containerKill,
	containerRemove,
	containerRestart,
	containerStart,
	containerStop,
	deleteContainerFile,
	findServerById,
	getConfig,
	getContainers,
	getContainersByAppLabel,
	getContainersByAppNameMatch,
	getDockerEvents,
	getServerHealth as getServerHealthData,
	getServiceContainersByAppName,
	getStackContainersByAppName,
	listContainerFiles,
	readContainerFile,
	uploadFileToContainer,
	writeContainerFile,
} from "@dokploy/server";
import { checkPermission } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "@/server/db/schema";
import { audit } from "@/server/api/utils/audit";
import { uploadFileToContainerSchema } from "@/utils/schema";
import { createTRPCRouter, protectedProcedure, withPermission } from "../trpc";

export const containerIdRegex = /^[a-zA-Z0-9.\-_]+$/;

const containerPathSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(path) => path.startsWith("/") && !path.includes("\0"),
		"Path must be absolute.",
	);

const ensureHostAccessOrServerOwnership = async (
	ctx: any,
	serverId?: string,
) => {
	if (!serverId) {
		if (!(ctx.user as any)?.isPlatformAdmin) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message:
					"Host Docker infrastructure access requires platform administrator privileges.",
			});
		}
		return;
	}
	const server = await findServerById(serverId);
	if (server.organizationId !== ctx.session?.activeOrganizationId) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
};

const ensureAppNameAccess = async (
	ctx: any,
	appName: string,
	serverId?: string,
) => {
	if (serverId) {
		const server = await findServerById(serverId);
		if (server.organizationId !== ctx.session?.activeOrganizationId) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
	}
	if ((ctx.user as any)?.isPlatformAdmin) {
		return;
	}

	const orgId = ctx.session?.activeOrganizationId;
	if (!orgId) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	const [app] = await db
		.select({ id: applications.applicationId })
		.from(applications)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(applications.appName, appName),
				eq(projects.organizationId, orgId),
			),
		)
		.limit(1);

	if (app) return;

	const [comp] = await db
		.select({ id: compose.composeId })
		.from(compose)
		.innerJoin(
			environments,
			eq(compose.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				eq(compose.appName, appName),
				eq(projects.organizationId, orgId),
			),
		)
		.limit(1);

	if (comp) return;

	const dbTables = [postgres, mysql, mariadb, mongo, redis, libsql] as any[];
	for (const table of dbTables) {
		const [d] = await db
			.select({ id: table.appName })
			.from(table)
			.innerJoin(
				environments,
				eq(table.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(
				and(
					eq(table.appName, appName),
					eq(projects.organizationId, orgId),
				),
			)
			.limit(1);
		if (d) return;
	}

	throw new TRPCError({
		code: "FORBIDDEN",
		message: "You do not have permission to inspect this application.",
	});
};

export const dockerRouter = createTRPCRouter({
	getContainers: withPermission("docker", "read")
		.input(
			z.object({
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (!input.serverId && !(ctx.user as any)?.isPlatformAdmin) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Host Docker infrastructure access requires platform administrator privileges.",
				});
			}
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session?.activeOrganizationId) {
					throw new TRPCError({ code: "UNAUTHORIZED" });
				}
			}
			return await getContainers(input.serverId);
		}),

	// Host-level diagnostics, so this requires docker.read AND server.read.
	getServerHealth: protectedProcedure
		.input(
			z.object({
				serverId: z.string().optional(),
				sinceHours: z.number().int().min(1).max(168).optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (!input.serverId && !(ctx.user as any)?.isPlatformAdmin) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Host server health diagnostics require platform administrator privileges.",
				});
			}
			await checkPermission(ctx, { docker: ["read"], server: ["read"] });
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session?.activeOrganizationId) {
					throw new TRPCError({ code: "UNAUTHORIZED" });
				}
			}
			return await getServerHealthData(
				ctx.session.activeOrganizationId,
				input.serverId,
				input.sinceHours,
			);
		}),

	restartContainer: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await containerRestart(input.containerId, input.serverId);
			await audit(ctx, {
				action: "start",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: input.containerId,
			});
		}),

	startContainer: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await containerStart(input.containerId, input.serverId);
			await audit(ctx, {
				action: "start",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: input.containerId,
			});
		}),

	stopContainer: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await containerStop(input.containerId, input.serverId);
			await audit(ctx, {
				action: "stop",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: input.containerId,
			});
		}),

	killContainer: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await containerKill(input.containerId, input.serverId);
			await audit(ctx, {
				action: "stop",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: input.containerId,
			});
		}),

	removeContainer: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await containerRemove(input.containerId, input.serverId);
			await audit(ctx, {
				action: "delete",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: input.containerId,
			});
		}),

	getConfig: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			return await getConfig(input.containerId, input.serverId);
		}),

	getContainersByAppNameMatch: withPermission("service", "read")
		.input(
			z.object({
				appType: z.enum(["stack", "docker-compose"]).optional(),
				appName: z.string().min(1).regex(containerIdRegex, "Invalid app name."),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureAppNameAccess(ctx, input.appName, input.serverId);
			return await getContainersByAppNameMatch(
				input.appName,
				input.appType,
				input.serverId,
			);
		}),

	getContainersByAppLabel: withPermission("docker", "read")
		.input(
			z.object({
				appName: z.string().min(1).regex(containerIdRegex, "Invalid app name."),
				serverId: z.string().optional(),
				type: z.enum(["standalone", "swarm"]),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureAppNameAccess(ctx, input.appName, input.serverId);
			return await getContainersByAppLabel(
				input.appName,
				input.type,
				input.serverId,
			);
		}),

	getStackContainersByAppName: withPermission("docker", "read")
		.input(
			z.object({
				appName: z.string().min(1).regex(containerIdRegex, "Invalid app name."),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureAppNameAccess(ctx, input.appName, input.serverId);
			return await getStackContainersByAppName(input.appName, input.serverId);
		}),

	getServiceContainersByAppName: withPermission("docker", "read")
		.input(
			z.object({
				appName: z.string().min(1).regex(containerIdRegex, "Invalid app name."),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureAppNameAccess(ctx, input.appName, input.serverId);
			return await getServiceContainersByAppName(input.appName, input.serverId);
		}),

	uploadFileToContainer: withPermission("docker", "read")
		.input(uploadFileToContainerSchema)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);

			const file = input.file;
			if (!(file instanceof File)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid file provided",
				});
			}

			// Convert File to Buffer
			const arrayBuffer = await file.arrayBuffer();
			const fileBuffer = Buffer.from(arrayBuffer);

			await uploadFileToContainer(
				input.containerId,
				fileBuffer,
				file.name,
				input.destinationPath,
				input.serverId || null,
			);

			return { success: true, message: "File uploaded successfully" };
		}),

	listContainerFiles: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				path: containerPathSchema,
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			return await listContainerFiles(
				input.containerId,
				input.path,
				input.serverId,
			);
		}),

	readContainerFile: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				path: containerPathSchema,
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			return await readContainerFile(
				input.containerId,
				input.path,
				input.serverId,
			);
		}),

	writeContainerFile: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				path: containerPathSchema,
				content: z.string(),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await writeContainerFile(
				input.containerId,
				input.path,
				input.content,
				input.serverId,
			);
			await audit(ctx, {
				action: "update",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: `${input.containerId}:${input.path}`,
			});
		}),

	deleteContainerFile: withPermission("docker", "read")
		.input(
			z.object({
				containerId: z
					.string()
					.min(1)
					.regex(containerIdRegex, "Invalid container id."),
				path: containerPathSchema.refine(
					(path) => path !== "/",
					"Cannot delete the container root.",
				),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			await deleteContainerFile(input.containerId, input.path, input.serverId);
			await audit(ctx, {
				action: "delete",
				resourceType: "docker",
				resourceId: input.containerId,
				resourceName: `${input.containerId}:${input.path}`,
			});
		}),

	getEvents: withPermission("docker", "read")
		.input(
			z.object({
				serverId: z.string().optional(),
				minutes: z.number().min(1).max(1440).default(15),
			}),
		)
		.query(async ({ input, ctx }) => {
			await ensureHostAccessOrServerOwnership(ctx, input.serverId);
			return await getDockerEvents(input.serverId, input.minutes);
		}),
});

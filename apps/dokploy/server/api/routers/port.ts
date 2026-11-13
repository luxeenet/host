import {
	createPort,
	finPortById,
	removePortById,
	updatePortById,
} from "@dokploy/server";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreatePort,
	apiFindOnePort,
	apiUpdatePort,
} from "@/server/db/schema";

const RESERVED_PORTS = new Set([
	20, 21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995,
	2222, 2375, 2376, 2377, 3000, 4000, 4500, 4789, 5432, 6379, 7946, 8080,
]);

const validatePortSecurity = (
	publishedPort: number | undefined,
	publishMode: string | undefined,
	isPlatformAdmin: boolean,
) => {
	if (!isPlatformAdmin) {
		if (publishedPort !== undefined) {
			if (publishedPort < 1024) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Privileged ports (< 1024) cannot be published directly. Please route your web service through a domain or publish on a port >= 1024.",
				});
			}
			if (RESERVED_PORTS.has(publishedPort)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Port ${publishedPort} is reserved for platform infrastructure and cannot be published.`,
				});
			}
		}
		if (publishMode === "host") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message:
					"Host publish mode is restricted to platform administrators. Please use ingress mode.",
			});
		}
	}
};

export const portRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreatePort)
		.mutation(async ({ input, ctx }) => {
			try {
				await checkServicePermissionAndAccess(ctx, input.applicationId, {
					service: ["create"],
				});
				validatePortSecurity(
					input.publishedPort,
					input.publishMode,
					Boolean((ctx.user as any)?.isPlatformAdmin),
				);
				const port = await createPort(input);
				await audit(ctx, {
					action: "create",
					resourceType: "port",
					resourceId: port.portId,
					resourceName: `${port.publishedPort}:${port.targetPort}`,
				});
				return port;
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error input: Inserting port",
					cause: error,
				});
			}
		}),
	one: protectedProcedure
		.input(apiFindOnePort)
		.query(async ({ input, ctx }) => {
			try {
				const port = await finPortById(input.portId);
				await checkServicePermissionAndAccess(
					ctx,
					port.application.applicationId,
					{ service: ["read"] },
				);
				return port;
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Port not found",
					cause: error,
				});
			}
		}),
	delete: protectedProcedure
		.input(apiFindOnePort)
		.mutation(async ({ input, ctx }) => {
			const port = await finPortById(input.portId);
			await checkServicePermissionAndAccess(
				ctx,
				port.application.applicationId,
				{ service: ["delete"] },
			);
			try {
				const result = await removePortById(input.portId);
				await audit(ctx, {
					action: "delete",
					resourceType: "port",
					resourceId: port.portId,
					resourceName: `${port.publishedPort}:${port.targetPort}`,
				});
				return result;
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				const message =
					error instanceof Error ? error.message : "Error input: Deleting port";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
	update: protectedProcedure
		.input(apiUpdatePort)
		.mutation(async ({ input, ctx }) => {
			const port = await finPortById(input.portId);
			await checkServicePermissionAndAccess(
				ctx,
				port.application.applicationId,
				{ service: ["create"] },
			);
			validatePortSecurity(
				input.publishedPort,
				input.publishMode,
				Boolean((ctx.user as any)?.isPlatformAdmin),
			);
			try {
				const result = await updatePortById(input.portId, input);
				await audit(ctx, {
					action: "update",
					resourceType: "port",
					resourceId: port.portId,
					resourceName: `${port.publishedPort}:${port.targetPort}`,
				});
				return result;
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				const message =
					error instanceof Error ? error.message : "Error updating the port";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
});

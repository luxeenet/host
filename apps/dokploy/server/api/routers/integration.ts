import {
	INTEGRATION_IDS,
	IntegrationValidationError,
	getCustomerIntegrations,
	listAdminIntegrations,
	runIntegrationTest,
	saveIntegrationSettings,
	setIntegrationEnabled,
} from "@dokploy/server";
import { createPlatformAuditLog } from "@dokploy/server/services/platform-audit";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	platformAdminProcedure,
	protectedProcedure,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";

const providerInput = z.enum(INTEGRATION_IDS);

const validationToTrpc = (error: unknown): never => {
	if (error instanceof IntegrationValidationError) {
		const details = Object.entries(error.fieldErrors)
			.map(([field, message]) => `${field}: ${message}`)
			.join("; ");
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: details ? `${error.message} ${details}` : error.message,
		});
	}
	throw error;
};

/**
 * Administrator-controlled integrations.
 *
 *  - `availability` is the ONLY procedure customers can call. It returns just
 *    {id, label, available, degraded, message} — never configuration or secrets.
 *  - Everything prefixed `admin*` requires platform administrator access,
 *    enforced here on the server.
 */
export const integrationRouter = createTRPCRouter({
	availability: protectedProcedure.query(async () => {
		return await getCustomerIntegrations();
	}),

	adminList: platformAdminProcedure.query(async () => {
		return await listAdminIntegrations();
	}),

	adminSave: platformAdminProcedure
		.input(
			z.object({
				provider: providerInput,
				config: z.record(z.string(), z.unknown()).optional(),
				secrets: z.record(z.string(), z.string().optional()).optional(),
				clearSecrets: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			let change: Awaited<ReturnType<typeof saveIntegrationSettings>>;
			try {
				change = await saveIntegrationSettings(
					input.provider,
					{
						config: input.config,
						secrets: input.secrets,
						clearSecrets: input.clearSecrets,
					},
					ctx.user.id,
				);
			} catch (error) {
				return validationToTrpc(error);
			}

			// Audit rows carry key NAMES only — never values.
			const metadata = {
				changedConfigKeys: change.changedConfigKeys,
				changedSecretKeys: change.changedSecretKeys,
				clearedSecretKeys: change.clearedSecretKeys,
			};
			await audit(ctx, {
				action: "update",
				resourceType: "integration",
				resourceId: input.provider,
				resourceName: change.view.label,
				metadata,
			});
			await createPlatformAuditLog({
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
				userRole: ctx.user.role,
				action: "integration_updated",
				resourceType: "integration",
				resourceId: input.provider,
				summary: `Updated ${change.view.label} integration settings`,
				metadata,
			});
			return change.view;
		}),

	adminSetEnabled: platformAdminProcedure
		.input(z.object({ provider: providerInput, enabled: z.boolean() }))
		.mutation(async ({ input, ctx }) => {
			const { view, previous } = await setIntegrationEnabled(
				input.provider,
				input.enabled,
				ctx.user.id,
			);
			const metadata = { enabled: input.enabled, previous };
			await audit(ctx, {
				action: "update",
				resourceType: "integration",
				resourceId: input.provider,
				resourceName: `${view.label} (${input.enabled ? "enabled" : "disabled"})`,
				metadata,
			});
			await createPlatformAuditLog({
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
				userRole: ctx.user.role,
				action: input.enabled ? "integration_enabled" : "integration_disabled",
				resourceType: "integration",
				resourceId: input.provider,
				summary: `${input.enabled ? "Enabled" : "Disabled"} ${view.label} integration`,
				metadata,
			});
			return view;
		}),

	adminTest: platformAdminProcedure
		.input(z.object({ provider: providerInput }))
		.mutation(async ({ input, ctx }) => {
			const { result, view } = await runIntegrationTest(input.provider);
			await createPlatformAuditLog({
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
				userRole: ctx.user.role,
				action: "integration_tested",
				resourceType: "integration",
				resourceId: input.provider,
				summary: `Tested ${view.label} integration: ${result.status}`,
				metadata: {
					status: result.status,
					verification: result.verification,
				},
			});
			return { result, view };
		}),
});

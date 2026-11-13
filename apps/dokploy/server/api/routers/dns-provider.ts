import {
	createDnsProvider,
	createDnsProviderRecord,
	deleteDnsProviderRecord,
	findDnsProviderInOrganization,
	findDnsProvidersByOrganizationId,
	listDnsProviderRecords,
	listDnsProviderZones,
	maskDnsProviderConfig,
	mergeDnsProviderConfig,
	removeDnsProvider,
	testDnsProviderConnection,
	updateDnsProvider,
	updateDnsProviderRecord,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateDnsProvider,
	apiCreateDnsRecord,
	apiDeleteDnsRecord,
	apiFindOneDnsProvider,
	apiListDnsRecords,
	apiListDnsZones,
	apiRemoveDnsProvider,
	apiTestDnsProvider,
	apiUpdateDnsProvider,
	apiUpdateDnsRecord,
} from "@/server/db/schema";
import { createTRPCRouter, platformAdminProcedure, protectedProcedure } from "../trpc";

export const dnsProviderRouter = createTRPCRouter({
	create: platformAdminProcedure
		.input(apiCreateDnsProvider)
		.mutation(async ({ ctx, input }) => {
			const provider = await createDnsProvider(
				input,
				ctx.session.activeOrganizationId,
			);
			await audit(ctx, {
				action: "create",
				resourceType: "dnsProvider",
				resourceId: provider.dnsProviderId,
				resourceName: provider.name,
			});
			return { ...provider, config: maskDnsProviderConfig(provider.config) };
		}),

	update: platformAdminProcedure
		.input(apiUpdateDnsProvider)
		.mutation(async ({ ctx, input }) => {
			await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			const updated = await updateDnsProvider(
				input.dnsProviderId,
				input.name,
				input.config,
			);
			await audit(ctx, {
				action: "update",
				resourceType: "dnsProvider",
				resourceId: updated.dnsProviderId,
				resourceName: updated.name,
			});
			return { ...updated, config: maskDnsProviderConfig(updated.config) };
		}),

	remove: platformAdminProcedure
		.input(apiRemoveDnsProvider)
		.mutation(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			await audit(ctx, {
				action: "delete",
				resourceType: "dnsProvider",
				resourceId: provider.dnsProviderId,
				resourceName: provider.name,
			});
			await removeDnsProvider(input.dnsProviderId);
			return true;
		}),

	all: protectedProcedure.query(async ({ ctx }) => {
		const isPlatformAdmin = Boolean((ctx.user as any)?.isPlatformAdmin);
		if (!isPlatformAdmin) {
			return [];
		}
		const providers = await findDnsProvidersByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		return providers.map((provider) => ({
			...provider,
			config: maskDnsProviderConfig(provider.config),
		}));
	}),

	one: platformAdminProcedure
		.input(apiFindOneDnsProvider)
		.query(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			return { ...provider, config: maskDnsProviderConfig(provider.config) };
		}),

	testConnection: platformAdminProcedure
		.input(apiTestDnsProvider)
		.mutation(async ({ ctx, input }) => {
			if (!input.config && !input.dnsProviderId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Provide a config or a dnsProviderId to test",
				});
			}

			let config = input.config;
			if (input.dnsProviderId) {
				const provider = await findDnsProviderInOrganization(
					input.dnsProviderId,
					ctx.session.activeOrganizationId,
				);
				config = config
					? mergeDnsProviderConfig(config, provider.config)
					: provider.config;
			}

			await testDnsProviderConnection(config!);
			return true;
		}),

	listZones: platformAdminProcedure
		.input(apiListDnsZones)
		.query(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			return await listDnsProviderZones(provider.config);
		}),

	listRecords: platformAdminProcedure
		.input(apiListDnsRecords)
		.query(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			return await listDnsProviderRecords(provider.config, input.zoneId);
		}),

	createRecord: platformAdminProcedure
		.input(apiCreateDnsRecord)
		.mutation(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			const record = await createDnsProviderRecord(provider.config, {
				zoneId: input.zoneId,
				type: input.type,
				name: input.name,
				content: input.content,
				ttl: input.ttl,
				proxied: input.proxied,
			});
			await audit(ctx, {
				action: "create",
				resourceType: "dnsProvider",
				resourceId: record.id,
				resourceName: input.name,
			});
			return record;
		}),

	updateRecord: platformAdminProcedure
		.input(apiUpdateDnsRecord)
		.mutation(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			const record = await updateDnsProviderRecord(
				provider.config,
				input.zoneId,
				input.recordId,
				{
					type: input.type,
					name: input.name,
					content: input.content,
					ttl: input.ttl,
					proxied: input.proxied,
				},
			);
			await audit(ctx, {
				action: "update",
				resourceType: "dnsProvider",
				resourceId: record.id,
				resourceName: input.name,
			});
			return record;
		}),

	deleteRecord: platformAdminProcedure
		.input(apiDeleteDnsRecord)
		.mutation(async ({ ctx, input }) => {
			const provider = await findDnsProviderInOrganization(
				input.dnsProviderId,
				ctx.session.activeOrganizationId,
			);
			await deleteDnsProviderRecord(
				provider.config,
				input.zoneId,
				input.recordId,
			);
			await audit(ctx, {
				action: "delete",
				resourceType: "dnsProvider",
				resourceId: input.recordId,
				resourceName: input.zoneId,
			});
			return true;
		}),
});

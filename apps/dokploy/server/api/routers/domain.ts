import {
	createDomain,
	findApplicationById,
	findComposeById,
	findDomainById,
	findDomainsByApplicationId,
	findDomainsByComposeId,
	findDomainsByOrganizationId,
	findPreviewDeploymentById,
	findServerById,
	generateTraefikMeDomain,
	getDnsInstructionsForDomain,
	getServerIpCandidates,
	getWebServerSettings,
	isApplicationDeployed,
	isPlatformOrTestDomain,
	manageDomain,
	removeDomain,
	removeDomainById,
	resolveCnameTargetForService,
	resolveGeneratedApplicationDomain,
	setPrimaryDomain,
	updateDomainById,
	validateDomain,
} from "@dokploy/server";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	PlanEntitlementService,
	assertEntitlement,
} from "@dokploy/server/services/plan-entitlement";
import {
	apiCreateDomain,
	apiFindCompose,
	apiFindDomain,
	apiFindOneApplication,
	apiUpdateDomain,
} from "@/server/db/schema";

export const domainRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateDomain)
		.mutation(async ({ input, ctx }) => {
			try {
				if (input.domainType === "compose" && input.composeId) {
					await checkServicePermissionAndAccess(ctx, input.composeId, {
						domain: ["create"],
					});
				} else if (input.domainType === "application" && input.applicationId) {
					await checkServicePermissionAndAccess(ctx, input.applicationId, {
						domain: ["create"],
					});

					// Intelligent default port resolution if port is omitted or left as default 3000
					try {
						const app = await findApplicationById(input.applicationId);
						if (app && (!input.port || input.port === 3000)) {
							if (app.buildType === "static") {
								input.port = 80;
							} else if (app.ports && app.ports.length > 0 && app.ports[0]?.targetPort) {
								input.port = app.ports[0].targetPort;
							} else if ((app as any).suggestedPort && (app as any).suggestedPort > 0) {
								input.port = (app as any).suggestedPort;
							}
						}
					} catch {}
				}

				// Prevent duplicate domain attachment on rapid clicks
				let previousPrimaryDomain: any = null;
				if (input.domainType === "application" && input.applicationId) {
					const existingDomains = await findDomainsByApplicationId(input.applicationId);
					const cleanHost = input.host?.trim().toLowerCase();
					const duplicate = existingDomains.find(
						(d) => d.host.trim().toLowerCase() === cleanHost,
					);
					if (duplicate) {
						const app = await findApplicationById(input.applicationId);
						return {
							...duplicate,
							replacementDeployment: {
								queued: false,
								alreadyExists: true,
								isDeployed: isApplicationDeployed(app),
								host: duplicate.host,
							},
						};
					}
					previousPrimaryDomain =
						existingDomains.find((d) => d.isPrimary) || existingDomains[0] || null;
				}

				const createdDomain = await PlanEntitlementService.withAtomicQuotaLock(
					ctx.session.activeOrganizationId,
					async (tx) => {
						// Plan entitlement — enforce custom domain quota only for customer custom domains
						if (!(await isPlatformOrTestDomain(input.host))) {
							await assertEntitlement(
								PlanEntitlementService.checkCanAddDomain(
									ctx.session.activeOrganizationId,
									tx,
								),
							);

							// If user requested Let's Encrypt / HTTPS upfront on a custom domain, check DNS first (legacy flow only)
							const { isCloudflareSaasActive } = await import("@dokploy/server");
							const saasActive = await isCloudflareSaasActive();
							if (!saasActive && (input.https || input.certificateType === "letsencrypt")) {
								let serverId: string | undefined = undefined;
								if (input.applicationId) {
									try {
										const app = await findApplicationById(input.applicationId);
										serverId = app.serverId || undefined;
									} catch {}
								}
								const expectedIps = await getServerIpCandidates(serverId);
								const expectedTarget = await resolveCnameTargetForService({ applicationId: input.applicationId, composeId: input.composeId, serverId });
								const dnsCheck = await validateDomain(input.host, expectedIps, { expectedTarget });
								if (!dnsCheck.isValid) {
									// Safely default to HTTP so Traefik ACME challenges don't fail before DNS propagates
									input.https = false;
									input.certificateType = "none";
								}
							}
						}

						const domain = await createDomain(input, tx);
						await audit(ctx, {
							action: "create",
							resourceType: "domain",
							resourceId: domain.domainId,
							resourceName: domain.host,
						});
						return domain;
					},
				);

				// Automatic Redeployment Workflow for Already Deployed Applications
				let replacementDeployment: {
					queued: boolean;
					isDeployed: boolean;
					alreadyRunning?: boolean;
					host: string;
					previousHost?: string | null;
				} = {
					queued: false,
					isDeployed: false,
					host: createdDomain.host,
					previousHost: previousPrimaryDomain?.host || null,
				};

				if (input.domainType === "application" && input.applicationId) {
					const app = await findApplicationById(input.applicationId);
					const isDeployed = isApplicationDeployed(app);
					const isCustom = !(await isPlatformOrTestDomain(createdDomain.host));

					if (isDeployed && isCustom) {
						const isAlreadyRunning = app.applicationStatus === "running";
						if (isAlreadyRunning) {
							replacementDeployment = {
								queued: true,
								alreadyRunning: true,
								isDeployed: true,
								host: createdDomain.host,
								previousHost: previousPrimaryDomain?.host || null,
							};
						} else {
							const jobData: DeploymentJob = {
								applicationId: input.applicationId,
								organizationId: ctx.session.activeOrganizationId || app.environment?.project?.organizationId,
								projectId: app.environment?.projectId,
								titleLog: `Domain replacement: ${createdDomain.host}`,
								descriptionLog: `Automated redeployment replacing primary domain with ${createdDomain.host}`,
								type: "deploy",
								applicationType: "application",
								server: !!app.serverId,
								serverId: app.serverId ?? undefined,
								domainReplacement: {
									newDomainId: createdDomain.domainId,
									previousPrimaryDomainId: previousPrimaryDomain?.domainId || null,
								},
							};

							const { IS_CLOUD } = await import("@dokploy/server");
							if (IS_CLOUD && app.serverId) {
								const { deploy } = await import("@/server/utils/deploy");
								deploy(jobData).catch((err) => {
									console.error("[Domain Replacement] Deployment error:", err);
								});
							} else {
								const { myQueue } = await import("@/server/queues/queueSetup");
								await myQueue.add(
									"deployments",
									{ ...jobData },
									{ removeOnComplete: true, removeOnFail: true },
								);
							}

							replacementDeployment = {
								queued: true,
								isDeployed: true,
								host: createdDomain.host,
								previousHost: previousPrimaryDomain?.host || null,
							};
						}
					}
				}

				return {
					...createdDomain,
					replacementDeployment,
				};
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Error creating the domain",
					cause: error,
				});
			}
		}),
	byApplicationId: protectedProcedure
		.input(apiFindOneApplication)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				domain: ["read"],
			});
			const existing = await findDomainsByApplicationId(input.applicationId);
			return existing;
		}),
	byComposeId: protectedProcedure
		.input(apiFindCompose)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.composeId, {
				domain: ["read"],
			});
			return await findDomainsByComposeId(input.composeId);
		}),
	all: protectedProcedure.query(async ({ ctx }) => {
		return await findDomainsByOrganizationId(
			ctx.session.activeOrganizationId,
		);
	}),
	generateDomain: withPermission("domain", "create")
		.input(z.object({ appName: z.string(), serverId: z.string().optional() }))
		.mutation(async ({ input, ctx }) => {
			return generateTraefikMeDomain(
				input.appName,
				ctx.user.ownerId,
				input.serverId,
			);
		}),
	canGenerateTraefikMeDomains: withPermission("domain", "read")
		.input(z.object({ serverId: z.string() }))
		.query(async ({ input }) => {
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				return server.ipAddress;
			}
			const settings = await getWebServerSettings();
			return settings?.serverIp || "";
		}),

	activateHttps: protectedProcedure
		.input(z.object({ domainId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const currentDomain = await findDomainById(input.domainId);
			const serviceId = currentDomain.applicationId || currentDomain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (currentDomain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					currentDomain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			// Enforce plan entitlement for automatic SSL
			await assertEntitlement(
				PlanEntitlementService.checkCanUseSslAuto(
					ctx.session.activeOrganizationId,
				),
			);

			let serverId: string | undefined = undefined;
			if (currentDomain.applicationId) {
				try {
					const app = await findApplicationById(currentDomain.applicationId);
					serverId = app.serverId || undefined;
				} catch {}
			}
			const expectedIps = await getServerIpCandidates(serverId);
			const { isCloudflareSaasActive, mapDomainCloudflareStatus, resolveCloudflareCnameTarget, syncCustomHostnameStatus } = await import("@dokploy/server");
			const isCfDomain = Boolean((currentDomain as any).cfHostnameId || (currentDomain as any).cfStatus) || ((await isCloudflareSaasActive()) && !(await isPlatformOrTestDomain(currentDomain.host)));
			if (isCfDomain) {
				const synced = await syncCustomHostnameStatus(input.domainId);
				const cnameTarget = await resolveCloudflareCnameTarget({ applicationId: synced.applicationId, composeId: synced.composeId });
				const lifecycle = mapDomainCloudflareStatus(synced, cnameTarget);
				return {
					...synced,
					message: lifecycle.isHttpsReady
						? `Edge HTTPS is active for ${synced.host}`
						: `Edge SSL status: ${lifecycle.stageName}. ${lifecycle.customerActionRequired}`,
				};
			}
			const expectedTarget = await resolveCnameTargetForService({ applicationId: currentDomain.applicationId, composeId: currentDomain.composeId, serverId });
			const dnsCheck = await validateDomain(currentDomain.host, expectedIps, { expectedTarget });
			if (!dnsCheck.isValid) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `DNS verification failed: "${currentDomain.host}" does not point to this server (${expectedIps.join(", ")}). Current DNS resolves to: ${dnsCheck.resolvedIp ? dnsCheck.resolvedIp : "no records found"}. Please point your DNS A record to this server first.`,
				});
			}

			const result = await updateDomainById(input.domainId, {
				https: true,
				certificateType: "letsencrypt",
			});

			const domain = await findDomainById(input.domainId);
			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: `${domain.host} (HTTPS activated)`,
			});

			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await manageDomain(application, domain);
			} else if (domain.previewDeploymentId) {
				const previewDeployment = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				const application = await findApplicationById(
					previewDeployment.applicationId,
				);
				application.appName = previewDeployment.appName;
				await manageDomain(application, domain);
			}

			return {
				...result,
				message: `HTTPS successfully activated for ${domain.host}`,
			};
		}),

	update: protectedProcedure
		.input(apiUpdateDomain)
		.mutation(async ({ input, ctx }) => {
			const currentDomain = await findDomainById(input.domainId);
			const serviceId = currentDomain.applicationId || currentDomain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (currentDomain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					currentDomain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const targetHost = input.host?.trim() || currentDomain.host;

			// If enabling HTTPS / Let's Encrypt on a custom domain, enforce DNS check and plan entitlement
			if (
				!(await isPlatformOrTestDomain(targetHost)) &&
				(input.https || input.certificateType === "letsencrypt")
			) {
				await assertEntitlement(
					PlanEntitlementService.checkCanUseSslAuto(
						ctx.session.activeOrganizationId,
					),
				);

				let serverId: string | undefined = undefined;
				if (currentDomain.applicationId) {
					try {
						const app = await findApplicationById(currentDomain.applicationId);
						serverId = app.serverId || undefined;
					} catch {}
				}
				const expectedIps = await getServerIpCandidates(serverId);
				const { isCloudflareSaasActive } = await import("@dokploy/server");
				const isCfDomain = Boolean((currentDomain as any).cfHostnameId || (currentDomain as any).cfStatus) || (await isCloudflareSaasActive());
				if (isCfDomain) {
					input.certificateType = "none";
					const isCfFullyActive = (currentDomain as any).cfStatus === "active" && (currentDomain as any).cfSslStatus === "active";
					if (!isCfFullyActive) {
						input.https = false;
					}
				} else {
					const expectedTarget = await resolveCnameTargetForService({ applicationId: currentDomain.applicationId, composeId: currentDomain.composeId, serverId });
					const dnsCheck = await validateDomain(targetHost, expectedIps, { expectedTarget });
					if (!dnsCheck.isValid) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Cannot activate HTTPS: DNS for "${targetHost}" is not pointing to this server (${expectedIps.join(", ")}). Currently resolves to: ${dnsCheck.resolvedIp ? dnsCheck.resolvedIp : "no records found"}. Please update your DNS records first.`,
						});
					}
				}
			}
			if (false) {
				const expectedIps: string[] = [];
				const dnsCheck = { isValid: true, resolvedIp: "" };
				if (!dnsCheck.isValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Cannot activate HTTPS: DNS for "${targetHost}" is not pointing to this server (${expectedIps.join(", ")}). Currently resolves to: ${dnsCheck.resolvedIp ? dnsCheck.resolvedIp : "no records found"}. Please update your DNS records first.`,
					});
				}
			}

			const result = await updateDomainById(input.domainId, input);
			const domain = await findDomainById(input.domainId);
			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await manageDomain(application, domain);
			} else if (domain.previewDeploymentId) {
				const previewDeployment = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				const application = await findApplicationById(
					previewDeployment.applicationId,
				);
				application.appName = previewDeployment.appName;
				await manageDomain(application, domain);
			}
			return result;
		}),
	toggleEnable: protectedProcedure
		.input(apiFindDomain)
		.mutation(async ({ input, ctx }) => {
			const currentDomain = await findDomainById(input.domainId);
			const serviceId = currentDomain.applicationId || currentDomain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (currentDomain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					currentDomain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const result = await updateDomainById(input.domainId, {
				enabled: !currentDomain.enabled,
			});
			const domain = await findDomainById(input.domainId);
			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});

			// Applications apply instantly through the traefik file provider:
			// manageDomain creates the router when enabled and removes it when
			// disabled. Compose domains are docker labels and only change on the
			// next deployment, so we just persist the flag here.
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await manageDomain(application, domain);
			} else if (domain.previewDeploymentId) {
				const previewDeployment = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				const application = await findApplicationById(
					previewDeployment.applicationId,
				);
				application.appName = previewDeployment.appName;
				await manageDomain(application, domain);
			}

			return {
				...result,
				requiresRedeploy: domain.domainType === "compose",
			};
		}),
	one: protectedProcedure.input(apiFindDomain).query(async ({ input, ctx }) => {
		const domain = await findDomainById(input.domainId);
		const serviceId = domain.applicationId || domain.composeId;
		if (serviceId) {
			await checkServicePermissionAndAccess(ctx, serviceId, {
				domain: ["read"],
			});
		} else if (domain.previewDeploymentId) {
			const preview = await findPreviewDeploymentById(
				domain.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(ctx, preview.applicationId, {
				domain: ["read"],
			});
		}
		return domain;
	}),
	delete: protectedProcedure
		.input(apiFindDomain)
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["delete"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["delete"],
				});
			}

			const result = await removeDomainById(input.domainId);
			await audit(ctx, {
				action: "delete",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});

			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await removeDomain(application, domain.uniqueConfigKey);
			}

			return result;
		}),

	setPrimary: protectedProcedure
		.input(apiFindDomain)
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			let previousPrimaryDomain: any = null;
			if (domain.applicationId) {
				const existingAppDomains = await findDomainsByApplicationId(domain.applicationId);
				previousPrimaryDomain = existingAppDomains.find((d) => d.isPrimary) || null;
			}

			const result = await setPrimaryDomain(input.domainId);

			if (domain.applicationId) {
				const app = await findApplicationById(domain.applicationId);
				if (isApplicationDeployed(app) && app.applicationStatus !== "running") {
					const jobData: DeploymentJob = {
						applicationId: domain.applicationId,
						organizationId: ctx.session.activeOrganizationId || app.environment?.project?.organizationId,
						projectId: app.environment?.projectId,
						titleLog: `Primary domain update: ${domain.host}`,
						descriptionLog: `Automated redeployment for primary domain change to ${domain.host}`,
						type: "deploy",
						applicationType: "application",
						server: !!app.serverId,
						serverId: app.serverId ?? undefined,
						domainReplacement: {
							newDomainId: domain.domainId,
							previousPrimaryDomainId: previousPrimaryDomain?.domainId || null,
						},
					};
					const { IS_CLOUD } = await import("@dokploy/server");
					if (IS_CLOUD && app.serverId) {
						const { deploy } = await import("@/server/utils/deploy");
						deploy(jobData).catch((err) => console.error(err));
					} else {
						const { myQueue } = await import("@/server/queues/queueSetup");
						await myQueue.add(
							"deployments",
							{ ...jobData },
							{ removeOnComplete: true, removeOnFail: true },
						);
					}
				}
			}

			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
			});

			return result;
		}),

	validateDomain: withPermission("domain", "read")
		.input(
			z.object({
				domain: z.string(),
				serverId: z.string().optional().nullable(),
				applicationId: z.string().optional().nullable(),
				composeId: z.string().optional().nullable(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this server",
					});
				}
			}

			const { isCloudflareSaasActive, resolveCloudflareCnameTarget } = await import("@dokploy/server");
			const saasActive = (await isCloudflareSaasActive()) && !(await isPlatformOrTestDomain(input.domain));
			const expectedTarget = saasActive
				? await resolveCloudflareCnameTarget({ applicationId: input.applicationId, composeId: input.composeId })
				: await resolveCnameTargetForService({
				applicationId: input.applicationId,
				composeId: input.composeId,
				serverId: input.serverId,
			});
			const expectedIps = await getServerIpCandidates(input.serverId);
			return validateDomain(input.domain, expectedIps, {
				expectedTarget,
			});
		}),

	dnsInstructions: withPermission("domain", "read")
		.input(
			z.object({
				host: z.string(),
				serverId: z.string().optional().nullable(),
				applicationId: z.string().optional().nullable(),
				composeId: z.string().optional().nullable(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this server",
					});
				}
			}
			return await getDnsInstructionsForDomain(input.host, input.serverId, {
				applicationId: input.applicationId,
				composeId: input.composeId,
			});
		}),

	verifyDomainHealth: withPermission("domain", "read")
		.input(
			z.object({
				domainId: z.string(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			let serverId: string | null | undefined = null;
			if (domain.applicationId) {
				const app = await findApplicationById(domain.applicationId);
				serverId = app.serverId;
			} else if (domain.composeId) {
				const comp = await findComposeById(domain.composeId);
				serverId = comp.serverId;
			}
			return await getDnsInstructionsForDomain(domain.host, serverId, {
				applicationId: domain.applicationId,
				composeId: domain.composeId,
			});
		}),

	getRoutingTarget: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().optional().nullable(),
				composeId: z.string().optional().nullable(),
			}),
		)
		.query(async ({ input }) => {
			const { isCloudflareSaasActive, resolveCloudflareCnameTarget } =
				await import("@dokploy/server");
			const saasActive = await isCloudflareSaasActive();
			const target = saasActive
				? await resolveCloudflareCnameTarget({
						applicationId: input.applicationId,
						composeId: input.composeId,
				  })
				: await resolveCnameTargetForService({
						applicationId: input.applicationId,
						composeId: input.composeId,
				  });
			return {
				target,
				isCloudflareSaas: saasActive,
			};
		}),

	/** On-demand live Cloudflare for SaaS custom hostname status recheck */
	recheckCloudflareStatus: protectedProcedure
		.input(z.object({ domainId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["read"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["read"],
				});
			}

			const { recheckDomainCloudflareStatus, mapDomainCloudflareStatus, resolveCloudflareCnameTarget } =
				await import("@dokploy/server");

			const updated = await recheckDomainCloudflareStatus(input.domainId);
			const cnameTarget = await resolveCloudflareCnameTarget({
				applicationId: updated.applicationId,
				composeId: updated.composeId,
			});
			const lifecycle = mapDomainCloudflareStatus(updated, cnameTarget);

			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: updated.domainId,
				resourceName: `${updated.host} (Domain status refreshed: ${lifecycle.stageName})`,
			});

			const isPlatformAdmin = Boolean(
				(ctx.session as any)?.user?.isPlatformAdmin ||
				(ctx.user as any)?.isPlatformAdmin ||
				ctx.user?.role === "owner",
			);

			const safeLifecycle = isPlatformAdmin
				? lifecycle
				: {
						...lifecycle,
						customerActionRequired: lifecycle.customerActionRequired?.replace(/cloudflare/gi, "HatDot Edge"),
						lastError: lifecycle.lastError
							? lifecycle.lastError
									.replace(/cloudflare/gi, "HatDot Edge")
									.replace(/zone\s+[a-f0-9]{32}/gi, "edge zone")
									.replace(/custom_hostname\.[a-z_]+/gi, "Domain configuration")
							: null,
				  };

			return {
				domain: updated,
				lifecycle: safeLifecycle,
			};
		}),

	/** Clean alias for domain status recheck */
	recheckStatus: protectedProcedure
		.input(z.object({ domainId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["read"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["read"],
				});
			}

			const { recheckDomainCloudflareStatus, mapDomainCloudflareStatus, resolveCloudflareCnameTarget } =
				await import("@dokploy/server");

			const updated = await recheckDomainCloudflareStatus(input.domainId);
			const cnameTarget = await resolveCloudflareCnameTarget({
				applicationId: updated.applicationId,
				composeId: updated.composeId,
			});
			const lifecycle = mapDomainCloudflareStatus(updated, cnameTarget);

			const isPlatformAdmin = Boolean(
				(ctx.session as any)?.user?.isPlatformAdmin ||
				(ctx.user as any)?.isPlatformAdmin ||
				ctx.user?.role === "owner",
			);

			const safeLifecycle = isPlatformAdmin
				? lifecycle
				: {
						...lifecycle,
						customerActionRequired: lifecycle.customerActionRequired?.replace(/cloudflare/gi, "HatDot Edge"),
						lastError: lifecycle.lastError
							? lifecycle.lastError
									.replace(/cloudflare/gi, "HatDot Edge")
									.replace(/zone\s+[a-f0-9]{32}/gi, "edge zone")
									.replace(/custom_hostname\.[a-z_]+/gi, "Domain configuration")
							: null,
				  };

			return {
				domain: updated,
				lifecycle: safeLifecycle,
			};
		}),

	/** Retry Cloudflare for SaaS custom hostname provisioning if previously failed */
	retryCloudflareProvisioning: protectedProcedure
		.input(z.object({ domainId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const { retryDomainCloudflareProvisioning, mapDomainCloudflareStatus, resolveCloudflareCnameTarget } =
				await import("@dokploy/server");

			const updated = await retryDomainCloudflareProvisioning(input.domainId);
			const cnameTarget = await resolveCloudflareCnameTarget({
				applicationId: updated.applicationId,
				composeId: updated.composeId,
			});
			const lifecycle = mapDomainCloudflareStatus(updated, cnameTarget);

			await audit(ctx, {
				action: "update",
				resourceType: "domain",
				resourceId: updated.domainId,
				resourceName: `${updated.host} (SSL provisioning retried)`,
			});

			const isPlatformAdmin = Boolean(
				(ctx.session as any)?.user?.isPlatformAdmin ||
				(ctx.user as any)?.isPlatformAdmin ||
				ctx.user?.role === "owner",
			);

			const safeLifecycle = isPlatformAdmin
				? lifecycle
				: {
						...lifecycle,
						customerActionRequired: lifecycle.customerActionRequired?.replace(/cloudflare/gi, "HatDot Edge"),
						lastError: lifecycle.lastError
							? lifecycle.lastError
									.replace(/cloudflare/gi, "HatDot Edge")
									.replace(/zone\s+[a-f0-9]{32}/gi, "edge zone")
									.replace(/custom_hostname\.[a-z_]+/gi, "Domain configuration")
							: null,
				  };

			return {
				domain: updated,
				lifecycle: safeLifecycle,
			};
		}),

	/** Clean alias for retry SSL provisioning */
	retrySsl: protectedProcedure
		.input(z.object({ domainId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const { retryDomainCloudflareProvisioning, mapDomainCloudflareStatus, resolveCloudflareCnameTarget } =
				await import("@dokploy/server");

			const updated = await retryDomainCloudflareProvisioning(input.domainId);
			const cnameTarget = await resolveCloudflareCnameTarget({
				applicationId: updated.applicationId,
				composeId: updated.composeId,
			});
			const lifecycle = mapDomainCloudflareStatus(updated, cnameTarget);

			const isPlatformAdmin = Boolean(
				(ctx.session as any)?.user?.isPlatformAdmin ||
				(ctx.user as any)?.isPlatformAdmin ||
				ctx.user?.role === "owner",
			);

			const safeLifecycle = isPlatformAdmin
				? lifecycle
				: {
						...lifecycle,
						customerActionRequired: lifecycle.customerActionRequired?.replace(/cloudflare/gi, "HatDot Edge"),
						lastError: lifecycle.lastError
							? lifecycle.lastError
									.replace(/cloudflare/gi, "HatDot Edge")
									.replace(/zone\s+[a-f0-9]{32}/gi, "edge zone")
									.replace(/custom_hostname\.[a-z_]+/gi, "Domain configuration")
							: null,
				  };

			return {
				domain: updated,
				lifecycle: safeLifecycle,
			};
		}),
});

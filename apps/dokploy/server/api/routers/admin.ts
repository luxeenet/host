import {
	getRoutingSettings,
	getWebServerSettings,
	IS_CLOUD,
	setupWebMonitoring,
	updateRoutingSettings,
	updateWebServerSettings,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import * as schema from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiUpdateWebServerMonitoring } from "@/server/db/schema";
import { createTRPCRouter, platformAdminProcedure } from "../trpc";

export const adminRouter = createTRPCRouter({
	setupMonitoring: platformAdminProcedure
		.input(apiUpdateWebServerMonitoring)
		.mutation(async ({ input }) => {
			try {
				if (IS_CLOUD) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "Feature disabled on cloud",
					});
				}

				await updateWebServerSettings({
					metricsConfig: {
						server: {
							type: "Dokploy",
							refreshRate: input.metricsConfig.server.refreshRate,
							port: input.metricsConfig.server.port,
							token: input.metricsConfig.server.token,
							cronJob: input.metricsConfig.server.cronJob,
							urlCallback: input.metricsConfig.server.urlCallback,
							retentionDays: input.metricsConfig.server.retentionDays,
							thresholds: {
								cpu: input.metricsConfig.server.thresholds.cpu,
								memory: input.metricsConfig.server.thresholds.memory,
							},
						},
						containers: {
							refreshRate: input.metricsConfig.containers.refreshRate,
							services: {
								include: input.metricsConfig.containers.services.include || [],
								exclude: input.metricsConfig.containers.services.exclude || [],
							},
						},
					},
				});

				await setupWebMonitoring();
				const settings = await getWebServerSettings();
				return settings;
			} catch (error) {
				throw error;
			}
		}),

	/** Platform Admin: Live dashboard business & cluster statistics */
	dashboardStats: platformAdminProcedure.query(async () => {
		const [
			customerCountRes,
			appCountRes,
			serverCountRes,
			deploymentCountRes,
			activeSubs,
		] = await Promise.all([
			db.select({ count: count() }).from(schema.user),
			db.select({ count: count() }).from(schema.applications),
			db.select({ count: count() }).from(schema.server),
			db.select({ count: count() }).from(schema.deployments),
			db.query.subscriptions.findMany({
				where: eq(schema.subscriptions.status, "active"),
				with: { plan: true },
			}),
		]);

		const totalCustomers = customerCountRes[0]?.count ?? 0;
		const totalApplications = appCountRes[0]?.count ?? 0;
		const totalServers = serverCountRes[0]?.count ?? 0;
		const totalDeployments = deploymentCountRes[0]?.count ?? 0;

		// Calculate MRR from active subscriptions
		let mrr = 0;
		const planCounts: Record<string, { name: string; count: number; price: number }> = {};

		for (const sub of activeSubs) {
			const price = Number.parseFloat(sub.plan.price) || 0;
			const monthlyPrice = sub.plan.billingCycle === "yearly" ? price / 12 : price;
			mrr += monthlyPrice;

			if (!planCounts[sub.plan.id]) {
				planCounts[sub.plan.id] = { name: sub.plan.name, count: 0, price: monthlyPrice };
			}
			const entry = planCounts[sub.plan.id];
			if (entry) {
				entry.count += 1;
			}
		}

		return {
			totalCustomers,
			totalApplications,
			totalServers,
			totalDeployments,
			mrr,
			arr: mrr * 12,
			activeSubscriptions: activeSubs.length,
			planDistribution: Object.values(planCounts),
		};
	}),

	/** Platform Admin: List all registered customers with hosted apps, amounts paid, and subscription plans */
	listCustomers: platformAdminProcedure.query(async () => {
		const [
			allUsers,
			allOrgs,
			allMembers,
			allProjects,
			allEnvs,
			allApps,
			allCompose,
			allDomains,
			dbsPostgres,
			dbsMysql,
			dbsMariadb,
			dbsMongo,
			dbsRedis,
			dbsLibsql,
			allSubs,
			allPayments,
		] = await Promise.all([
			db
				.select()
				.from(schema.user)
				.orderBy(desc(schema.user.createdAt)),
			db
				.select()
				.from(schema.organization)
				.catch(() => []),
			db
				.select()
				.from(schema.member)
				.catch(() => []),
			db
				.select()
				.from(schema.projects)
				.catch(() => []),
			db
				.select()
				.from(schema.environments)
				.catch(() => []),
			db
				.select()
				.from(schema.applications)
				.catch(() => []),
			db
				.select()
				.from(schema.compose)
				.catch(() => []),
			db
				.select()
				.from(schema.domains)
				.catch(() => []),
			db
				.select()
				.from(schema.postgres)
				.catch(() => []),
			db
				.select()
				.from(schema.mysql)
				.catch(() => []),
			db
				.select()
				.from(schema.mariadb)
				.catch(() => []),
			db
				.select()
				.from(schema.mongo)
				.catch(() => []),
			db
				.select()
				.from(schema.redis)
				.catch(() => []),
			db
				.select()
				.from(schema.libsql)
				.catch(() => []),
			db.query.subscriptions
				.findMany({
					with: {
						plan: true,
					},
				})
				.catch(() => []),
			db
				.select()
				.from(schema.payments)
				.where(eq(schema.payments.status, "succeeded"))
				.catch(() => []),
		]);

		// Map domains by applicationId
		const domainsByApp = new Map<string, any[]>();
		for (const d of allDomains as any[]) {
			if (!d.applicationId) continue;
			const list = domainsByApp.get(d.applicationId) || [];
			list.push(d);
			domainsByApp.set(d.applicationId, list);
		}

		// Map domains by composeId
		const domainsByCompose = new Map<string, any[]>();
		for (const d of allDomains as any[]) {
			if (!d.composeId) continue;
			const list = domainsByCompose.get(d.composeId) || [];
			list.push(d);
			domainsByCompose.set(d.composeId, list);
		}

		// Map apps by environmentId
		const appsByEnv = new Map<string, any[]>();
		for (const a of allApps as any[]) {
			if (!a.environmentId) continue;
			const list = appsByEnv.get(a.environmentId) || [];
			list.push(a);
			appsByEnv.set(a.environmentId, list);
		}

		// Map compose by environmentId
		const composeByEnv = new Map<string, any[]>();
		for (const c of allCompose as any[]) {
			if (!c.environmentId) continue;
			const list = composeByEnv.get(c.environmentId) || [];
			list.push(c);
			composeByEnv.set(c.environmentId, list);
		}

		// Map databases by environmentId
		const dbsByEnv = new Map<string, any[]>();
		const addDb = (envId: string | null | undefined, item: any) => {
			if (!envId) return;
			const list = dbsByEnv.get(envId) || [];
			list.push(item);
			dbsByEnv.set(envId, list);
		};
		for (const d of dbsPostgres as any[]) addDb(d.environmentId, { id: d.postgresId, name: d.name, appName: d.appName, type: "postgres", status: d.applicationStatus });
		for (const d of dbsMysql as any[]) addDb(d.environmentId, { id: d.mysqlId, name: d.name, appName: d.appName, type: "mysql", status: d.applicationStatus });
		for (const d of dbsMariadb as any[]) addDb(d.environmentId, { id: d.mariadbId, name: d.name, appName: d.appName, type: "mariadb", status: d.applicationStatus });
		for (const d of dbsMongo as any[]) addDb(d.environmentId, { id: d.mongoId, name: d.name, appName: d.appName, type: "mongo", status: d.applicationStatus });
		for (const d of dbsRedis as any[]) addDb(d.environmentId, { id: d.redisId, name: d.name, appName: d.appName, type: "redis", status: d.applicationStatus });
		for (const d of dbsLibsql as any[]) addDb(d.environmentId, { id: d.libsqlId, name: d.name, appName: d.appName, type: "libsql", status: d.applicationStatus });

		// Map envs by projectId
		const envsByProject = new Map<string, any[]>();
		for (const e of allEnvs as any[]) {
			if (!e.projectId) continue;
			const list = envsByProject.get(e.projectId) || [];
			list.push(e);
			envsByProject.set(e.projectId, list);
		}

		// Map projects by organizationId
		const projectsByOrg = new Map<string, any[]>();
		for (const p of allProjects as any[]) {
			if (!p.organizationId) continue;
			const list = projectsByOrg.get(p.organizationId) || [];
			list.push(p);
			projectsByOrg.set(p.organizationId, list);
		}

		// Map subs by organizationId
		const subsByOrg = new Map<string, any[]>();
		for (const s of allSubs as any[]) {
			if (!s.organizationId) continue;
			const list = subsByOrg.get(s.organizationId) || [];
			list.push(s);
			subsByOrg.set(s.organizationId, list);
		}

		// Map payments by organizationId
		const paymentsByOrg = new Map<string, any[]>();
		for (const p of allPayments as any[]) {
			if (!p.organizationId) continue;
			const list = paymentsByOrg.get(p.organizationId) || [];
			list.push(p);
			paymentsByOrg.set(p.organizationId, list);
		}

		// Map organizations by user ID (both owner and member)
		const orgsByUser = new Map<string, any[]>();
		for (const org of allOrgs as any[]) {
			if (org.ownerId) {
				const list = orgsByUser.get(org.ownerId) || [];
				if (!list.some((o: any) => o.id === org.id)) {
					list.push(org);
					orgsByUser.set(org.ownerId, list);
				}
			}
		}
		for (const m of allMembers as any[]) {
			const org = (allOrgs as any[]).find((o: any) => o.id === m.organizationId);
			if (org && m.userId) {
				const list = orgsByUser.get(m.userId) || [];
				if (!list.some((o: any) => o.id === org.id)) {
					list.push(org);
					orgsByUser.set(m.userId, list);
				}
			}
		}

		return (allUsers as any[]).map((u) => {
			const userOrgs = orgsByUser.get(u.id) || [];

			let totalPaid = 0;
			let currency = "TZS";
			let paymentCount = 0;

			for (const org of userOrgs) {
				const orgPayments = paymentsByOrg.get(org.id) || [];
				for (const p of orgPayments) {
					totalPaid += Number.parseFloat(p.amount) || 0;
					currency = p.currency || currency;
					paymentCount += 1;
				}
			}

			let primarySub: any = null;
			for (const org of userOrgs) {
				const orgSubs = subsByOrg.get(org.id) || [];
				const active =
					orgSubs.find(
						(s: any) =>
							s.status === "active" ||
							s.status === "trial" ||
							s.status === "grace_period" ||
							s.status === "past_due",
					) || orgSubs[0];
				if (active) {
					primarySub = active;
					break;
				}
			}

			const userApps: any[] = [];
			const userCompose: any[] = [];
			const userDbs: any[] = [];
			let totalProjects = 0;

			for (const org of userOrgs) {
				const projects = projectsByOrg.get(org.id) || [];
				totalProjects += projects.length;

				for (const project of projects) {
					const envs = envsByProject.get(project.projectId) || [];

					for (const env of envs) {
						const apps = appsByEnv.get(env.environmentId) || [];
						for (const app of apps) {
							const appDomains = domainsByApp.get(app.applicationId) || [];
							const primaryDomain = appDomains[0];
							const primaryUrl = primaryDomain
								? `${primaryDomain.https ? "https" : "http"}://${primaryDomain.host}${primaryDomain.path || ""}`
								: `https://${app.appName}.hatdot.cloud`;

							userApps.push({
								applicationId: app.applicationId,
								name: app.name,
								appName: app.appName,
								status: app.applicationStatus || "idle",
								createdAt: app.createdAt ? String(app.createdAt) : "",
								serverId: app.serverId,
								domains: appDomains,
								primaryUrl,
							});
						}

						const composeList = composeByEnv.get(env.environmentId) || [];
						for (const comp of composeList) {
							const compDomains = domainsByCompose.get(comp.composeId) || [];
							const primaryDomain = compDomains[0];
							const primaryUrl = primaryDomain
								? `${primaryDomain.https ? "https" : "http"}://${primaryDomain.host}${primaryDomain.path || ""}`
								: `https://${comp.appName}.hatdot.cloud`;

							userCompose.push({
								composeId: comp.composeId,
								name: comp.name,
								appName: comp.appName,
								composeType: comp.composeType,
								status: comp.composeStatus || "idle",
								createdAt: comp.createdAt ? String(comp.createdAt) : "",
								serverId: comp.serverId,
								domains: compDomains,
								primaryUrl,
							});
						}

						const dbs = dbsByEnv.get(env.environmentId) || [];
						userDbs.push(...dbs);
					}
				}
			}

			return {
				id: u.id,
				firstName: u.firstName,
				lastName: u.lastName,
				email: u.email,
				role: u.role,
				isPlatformAdmin: u.isPlatformAdmin,
				banned: u.banned ?? false,
				banReason: u.banReason,
				createdAt: u.createdAt,
				projectCount: totalProjects,
				totalAmountPaid: totalPaid,
				currency,
				paymentCount,
				subscription: primarySub
					? {
							id: primarySub.id,
							status: primarySub.status,
							planName: primarySub.plan?.name || "Free Tier",
							planPrice: primarySub.plan?.price || "0",
							billingCycle: primarySub.plan?.billingCycle || "monthly",
							currentPeriodStart: primarySub.currentPeriodStart,
							currentPeriodEnd: primarySub.currentPeriodEnd,
							gracePeriodEndsAt: primarySub.gracePeriodEndsAt,
					  }
					: null,
				applications: userApps,
				composeStacks: userCompose,
				databases: userDbs,
				totalServicesCount: userApps.length + userCompose.length + userDbs.length,
			};
		});
	}),

	/** Platform Admin: List all connected server nodes */
	listServers: platformAdminProcedure.query(async () => {
		const servers = await db.query.server.findMany({
			with: {
				capacity: true,
			},
			orderBy: (s, { desc }) => [desc(s.createdAt)],
		});

		return servers;
	}),

	/** Platform Admin: Custom domain provider-managed CNAME and routing settings */
	getRoutingSettings: platformAdminProcedure.query(async () => {
		return await getRoutingSettings();
	}),

	/** Platform Admin: Update custom domain routing and CNAME settings */
	updateRoutingSettings: platformAdminProcedure
		.input(
			z.object({
				cnameTarget: z.string().nullable().optional(),
				cnameEnabled: z.boolean().optional(),
				allowDirectIp: z.boolean().optional(),
				cloudflareProxyEnabled: z.boolean().optional(),
				cloudflareStrictSsl: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			return await updateRoutingSettings(input);
		}),

	/** Platform Admin: Get sanitized Cloudflare for SaaS settings */
	getCloudflareSaasSettings: platformAdminProcedure.query(async () => {
		const { getCloudflareSaasSettings } = await import("@dokploy/server");
		return await getCloudflareSaasSettings();
	}),

	/** Platform Admin: Update Cloudflare for SaaS configuration */
	updateCloudflareSaasSettings: platformAdminProcedure
		.input(
			z.object({
				enabled: z.boolean().optional(),
				apiToken: z.string().nullable().optional(),
				zoneId: z.string().nullable().optional(),
				cnameTarget: z.string().nullable().optional(),
				fallbackOrigin: z.string().nullable().optional(),
				defaultSslMethod: z.enum(["http", "txt", "cname"]).optional(),
				autoProvision: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { updateCloudflareSaasSettings } = await import("@dokploy/server");
			return await updateCloudflareSaasSettings(input);
		}),

	/** Platform Admin: Test Cloudflare API connection, zone, and fallback origin */
	testCloudflareSaasConnection: platformAdminProcedure
		.input(
			z.object({
				apiToken: z.string().nullable().optional(),
				zoneId: z.string().nullable().optional(),
			}).optional(),
		)
		.mutation(async ({ input }) => {
			const { testCloudflareConnection } = await import("@dokploy/server");
			return await testCloudflareConnection(input);
		}),

	/** Platform Admin: Force manual background status reconciliation for all custom hostnames */
	syncAllCloudflareHostnames: platformAdminProcedure.mutation(async () => {
		const { reconcileCloudflareHostnames } = await import("@dokploy/server");
		return await reconcileCloudflareHostnames({ forceAll: true });
	}),

	/** Platform Admin: Get sanitized SonicPesa payment gateway credentials and status */
	getSonicPesaSettings: platformAdminProcedure.query(async () => {
		const { getSonicPesaSanitizedSettings } = await import("@dokploy/server");
		return await getSonicPesaSanitizedSettings();
	}),

	/** Platform Admin: Update SonicPesa payment gateway credentials and configuration */
	updateSonicPesaSettings: platformAdminProcedure
		.input(
			z.object({
				enabled: z.boolean().optional(),
				apiKey: z.string().nullable().optional(),
				apiSecret: z.string().nullable().optional(),
				baseUrl: z.string().nullable().optional(),
				mode: z.enum(["live", "sandbox"]).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { updateSonicPesaSettings } = await import("@dokploy/server");
			return await updateSonicPesaSettings(input);
		}),

	/** Platform Admin: Test SonicPesa API credentials and connection latency */
	testSonicPesaConnection: platformAdminProcedure
		.input(
			z.object({
				apiKey: z.string().nullable().optional(),
				baseUrl: z.string().nullable().optional(),
				mode: z.enum(["live", "sandbox"]).optional(),
			}).optional(),
		)
		.mutation(async ({ input }) => {
			const { testSonicPesaConnection } = await import("@dokploy/server");
			return await testSonicPesaConnection(input);
		}),

	/** Platform Admin: Get sanitized SMTP mail delivery settings */
	getSmtpSettings: platformAdminProcedure.query(async () => {
		const { getSmtpSanitizedSettings } = await import("@dokploy/server");
		return await getSmtpSanitizedSettings();
	}),

	/** Platform Admin: Update SMTP mail delivery settings */
	updateSmtpSettings: platformAdminProcedure
		.input(
			z.object({
				host: z.string().nullable().optional(),
				port: z.number().int().positive().nullable().optional(),
				user: z.string().nullable().optional(),
				pass: z.string().nullable().optional(),
				from: z.string().nullable().optional(),
				fromName: z.string().nullable().optional(),
				secure: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { updateSmtpSettings } = await import("@dokploy/server");
			return await updateSmtpSettings(input);
		}),

	/** Platform Admin: Test SMTP mail connection and optionally dispatch a test email */
	testSmtpConnection: platformAdminProcedure
		.input(
			z
				.object({
					targetEmail: z.string().email().optional(),
				})
				.optional(),
		)
		.mutation(async ({ input }) => {
			const { testSmtpConnection } = await import("@dokploy/server");
			return await testSmtpConnection(input?.targetEmail);
		}),

	/** Platform Admin: Dispatch a sample/test notification email for any catalog template */
	sendSampleEmailNotification: platformAdminProcedure
		.input(
			z.object({
				templateId: z.string().min(1),
				targetEmail: z.string().email(),
			}),
		)
		.mutation(async ({ input }) => {
			const { sendSampleEmailNotification } = await import("@dokploy/server");
			return await sendSampleEmailNotification(
				input.templateId,
				input.targetEmail,
			);
		}),

	/** Platform Admin: Toggle customer account access (Disable / Re-enable) */
	toggleCustomerStatus: platformAdminProcedure
		.input(
			z.object({
				userId: z.string(),
				banned: z.boolean(),
				reason: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (input.userId === ctx.user.id || input.userId === process.env.USER_ADMIN_ID) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot disable your own administrator account.",
				});
			}

			await db
				.update(schema.user)
				.set({
					banned: input.banned,
					banReason: input.banned
						? input.reason || "Account deactivated by platform administrator"
						: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.user.id, input.userId));

			return { success: true, banned: input.banned };
		}),

	/** Platform Admin: Delete customer account and completely purge all applications, containers, and volumes */
	deleteCustomerAccount: platformAdminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const { purgeCustomerAccount } = await import("@dokploy/server");
			return await purgeCustomerAccount(input.userId, ctx.user.id);
		}),

	/** Platform Admin: Delete an individual customer application (containers, volumes, and routing) */
	deleteCustomerApplication: platformAdminProcedure
		.input(z.object({ applicationId: z.string() }))
		.mutation(async ({ input }) => {
			const { deleteCustomerApplication } = await import("@dokploy/server");
			return await deleteCustomerApplication(input.applicationId);
		}),

	/** Platform Admin: Delete an individual customer compose service */
	deleteCustomerCompose: platformAdminProcedure
		.input(z.object({ composeId: z.string() }))
		.mutation(async ({ input }) => {
			const { deleteCustomerCompose } = await import("@dokploy/server");
			return await deleteCustomerCompose(input.composeId);
		}),

	/** Platform Admin: List all templates (including custom templates, excluding deleted ones) */
	listTemplates: platformAdminProcedure.query(async () => {
		const { fetchTemplatesList } = await import("@dokploy/server");
		return await fetchTemplatesList();
	}),

	/** Platform Admin: Add a new custom application template */
	addTemplate: platformAdminProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1)
					.regex(
						/^[a-z0-9-_]+$/i,
						"ID must contain only letters, numbers, hyphens, and underscores",
					),
				name: z.string().min(1),
				description: z.string().min(1),
				version: z.string().default("1.0.0"),
				tags: z.array(z.string()).default([]),
				logo: z.string().optional(),
				dockerCompose: z.string().min(1),
				env: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const { saveCustomTemplate, validateSafeComposeYaml } = await import(
				"@dokploy/server"
			);
			validateSafeComposeYaml(input.dockerCompose, true);

			await saveCustomTemplate({
				id: input.id.toLowerCase().trim(),
				name: input.name.trim(),
				description: input.description.trim(),
				version: input.version || "1.0.0",
				tags: input.tags.length > 0 ? input.tags : ["Custom"],
				logo: input.logo,
				dockerCompose: input.dockerCompose,
				env: input.env,
			});

			return { success: true };
		}),

	/** Platform Admin: Delete / remove an application template */
	deleteTemplate: platformAdminProcedure
		.input(z.object({ templateId: z.string() }))
		.mutation(async ({ input }) => {
			const { deleteTemplateById } = await import("@dokploy/server");
			await deleteTemplateById(input.templateId);
			return { success: true };
		}),
});

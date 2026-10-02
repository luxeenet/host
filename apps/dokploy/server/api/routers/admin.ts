import {
	getWebServerSettings,
	IS_CLOUD,
	setupWebMonitoring,
	updateWebServerSettings,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import * as schema from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { count, eq } from "drizzle-orm";
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

	/** Platform Admin: List all registered customers */
	listCustomers: platformAdminProcedure.query(async () => {
		const users = await db.query.user.findMany({
			with: {
				organizations: {
					with: {
						projects: true,
					},
				},
			},
			orderBy: (u, { desc }) => [desc(u.createdAt)],
		});

		return users.map((u) => ({
			id: u.id,
			firstName: u.firstName,
			lastName: u.lastName,
			email: u.email,
			role: u.role,
			isPlatformAdmin: u.isPlatformAdmin,
			createdAt: u.createdAt,
			projectCount: u.organizations?.reduce((acc, org) => acc + (org.projects?.length || 0), 0) || 0,
		}));
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
});

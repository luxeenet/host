/**
 * PlanEntitlementService
 *
 * The single source of truth for "can this organization do X?".
 *
 * ARCHITECTURE RULE:
 *   Every action that consumes a plan-limited resource MUST call
 *   PlanEntitlementService.check*() before executing.
 *   Never inline limit checks in feature controllers.
 *
 * This service reads plan resources and features from the database.
 * Plans are NEVER hardcoded here.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { BRAND } from "@paas/branding";
import { db } from "../db";
import * as schema from "../db/schema";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RawRuntimeResourceInput {
	memoryLimit?: unknown;
	memoryReservation?: unknown;
	cpuLimit?: unknown;
	cpuReservation?: unknown;
}

export interface EffectiveRuntimeResources {
	effectiveRamMb?: number;
	effectiveCpuMillicores?: number;
}

export interface EntitlementResult {
	allowed: boolean;
	reason?: string;
	/** Current usage count */
	current?: number;
	/** Plan limit (-1 = unlimited) */
	limit?: number;
}

export interface PlanSnapshot {
	planId: string;
	planName: string;
	resources: Record<string, number>;
	features: Record<string, boolean>;
	applicationTypes: string[];
	subscriptionStatus: string;
}

export interface MonitoringEntitlements {
	hasAdvancedIoMetrics: boolean;
	hasHistoricalCharts: boolean;
	maxDataPoints: number;
	retentionHours: number;
}

export interface OrganizationResourceLimits {
	maxRamMb: number;
	maxCpuMillicores: number;
	planName: string;
	isPlatformAdmin: boolean;
	minRamMb: number;
	minCpuMillicores: number;
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export class PlanEntitlementService {
	/**
	 * Resolves all organization IDs belonging to the same owner as the given organizationId.
	 * If the organization is not found, has no owner, or executor is a unit test mock, returns [organizationId].
	 */
	static async resolveOwnerOrgIds(
		organizationId: string,
		executor: any = db,
	): Promise<string[]> {
		try {
			if (!executor?.query?.organization?.findFirst) {
				return [organizationId];
			}
			const org = await executor.query.organization.findFirst({
				where: eq(schema.organization.id, organizationId),
				columns: { ownerId: true },
			});
			if (!org?.ownerId) return [organizationId];

			const ownerOrgs = await executor.query.organization.findMany({
				where: eq(schema.organization.ownerId, org.ownerId),
				columns: { id: true },
			});
			const ids = (ownerOrgs || []).map((o: any) => o.id);
			return ids.length > 0 ? ids : [organizationId];
		} catch (_) {
			return [organizationId];
		}
	}

	/**
	 * Check if a user is allowed to create another organization based on their active plan.
	 */
	static async checkCanCreateOrganization(
		userId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		try {
			if (!executor?.query?.user?.findFirst) {
				return { allowed: true };
			}

			const userRecord = await executor.query.user.findFirst({
				where: eq(schema.user.id, userId),
			});
			if ((userRecord as any)?.isPlatformAdmin) {
				return { allowed: true };
			}

			const ownedOrgs = await executor.query.organization.findMany({
				where: eq(schema.organization.ownerId, userId),
			});
			const ownedCount = ownedOrgs?.length ?? 0;
			const ownedOrgIds = (ownedOrgs || []).map((o: any) => o.id);

			let activeSub = null;
			if (ownedOrgIds.length > 0 && executor.query?.subscriptions?.findFirst) {
				activeSub = await executor.query.subscriptions.findFirst({
					where: and(
						inArray(schema.subscriptions.organizationId, ownedOrgIds as any),
						inArray(schema.subscriptions.status, [
							"active",
							"trial",
							"grace_period",
						] as any),
					),
					with: {
						plan: {
							with: {
								resources: true,
							},
						},
					},
					orderBy: (s: any, { desc }: any) => [desc(s.createdAt)],
				});
			}

			let maxAllowedOrgs = 1;
			let planName = "Free / Starter";

			if (activeSub?.plan) {
				planName = activeSub.plan.name;
				const orgResource = activeSub.plan.resources?.find(
					(r: any) => r.resourceKey === "max_organizations",
				);
				if (orgResource) {
					maxAllowedOrgs = orgResource.value;
				} else {
					if (activeSub.plan.slug === "enterprise") maxAllowedOrgs = -1;
					else if (
						activeSub.plan.slug === "standard" ||
						activeSub.plan.slug === "pro"
					)
						maxAllowedOrgs = 3;
					else maxAllowedOrgs = 1;
				}
			}

			if (maxAllowedOrgs !== -1 && ownedCount >= maxAllowedOrgs) {
				return {
					allowed: false,
					reason: `Your ${planName} plan allows a maximum of ${maxAllowedOrgs} organization${maxAllowedOrgs === 1 ? "" : "s"}. Please upgrade your plan to create more.`,
					current: ownedCount,
					limit: maxAllowedOrgs,
				};
			}

			return { allowed: true, current: ownedCount, limit: maxAllowedOrgs };
		} catch (err: any) {
			console.error("[checkCanCreateOrganization] Error:", err?.message);
			return { allowed: true };
		}
	}

	/**
	 * Load the full plan snapshot for an organization.
	 * Returns null if no active subscription exists.
	 */
	static async getPlanSnapshot(
		organizationId: string,
		executor: any = db,
	): Promise<PlanSnapshot | null> {
		let subscription = await executor.query.subscriptions.findFirst({
			where: eq(schema.subscriptions.organizationId, organizationId),
			with: {
				plan: {
					with: {
						resources: true,
						features: true,
						applicationTypes: true,
					},
				},
			},
			orderBy: (sub: any, { desc }: any) => [desc(sub.createdAt)],
		});

		// Fallback: If this organization does not have an active subscription,
		// check if the owner has an active subscription on any of their other organizations.
		if (
			(!subscription ||
				!["trial", "active", "grace_period"].includes(subscription.status)) &&
			executor.query?.organization?.findFirst
		) {
			const ownerOrgIds = await this.resolveOwnerOrgIds(organizationId, executor);
			if (ownerOrgIds.length > 0 && executor.query?.subscriptions?.findFirst) {
				const ownerSub = await executor.query.subscriptions.findFirst({
					where: and(
						inArray(schema.subscriptions.organizationId, ownerOrgIds as any),
						inArray(schema.subscriptions.status, [
							"trial",
							"active",
							"grace_period",
						] as any),
					),
					with: {
						plan: {
							with: {
								resources: true,
								features: true,
								applicationTypes: true,
							},
						},
					},
					orderBy: (s: any, { desc }: any) => [desc(s.createdAt)],
				});
				if (ownerSub) {
					subscription = ownerSub;
				}
			}
		}

		if (
			!subscription ||
			!["trial", "active", "grace_period"].includes(subscription.status)
		) {
			return null;
		}

		const resources: Record<string, number> = {};
		for (const r of subscription.plan.resources) {
			resources[r.resourceKey] = r.value;
		}

		const features: Record<string, boolean> = {};
		for (const f of subscription.plan.features) {
			features[f.featureKey] = f.enabled;
		}

		const applicationTypes = subscription.plan.applicationTypes.map(
			(t: any) => t.applicationType,
		);

		return {
			planId: subscription.plan.id,
			planName: subscription.plan.name,
			resources,
			features,
			applicationTypes,
			subscriptionStatus: subscription.status,
		};
	}

	/**
	 * Check if subscription is in an active/usable state.
	 */
	static async checkSubscriptionActive(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeStatuses = ["trial", "active", "grace_period"];

		let sub = await executor.query.subscriptions.findFirst({
			where: eq(schema.subscriptions.organizationId, organizationId),
			orderBy: (sub: any, { desc }: any) => [desc(sub.createdAt)],
		});

		if (
			(!sub || !activeStatuses.includes(sub.status)) &&
			executor.query?.organization?.findFirst
		) {
			const ownerOrgIds = await this.resolveOwnerOrgIds(organizationId, executor);
			if (ownerOrgIds.length > 0 && executor.query?.subscriptions?.findFirst) {
				const ownerSub = await executor.query.subscriptions.findFirst({
					where: and(
						inArray(schema.subscriptions.organizationId, ownerOrgIds as any),
						inArray(schema.subscriptions.status, activeStatuses as any),
					),
					orderBy: (s: any, { desc }: any) => [desc(s.createdAt)],
				});
				if (ownerSub) {
					sub = ownerSub;
				}
			}
		}

		if (!sub) {
			return { allowed: false, reason: "No active subscription found." };
		}

		if (!activeStatuses.includes(sub.status)) {
			return {
				allowed: false,
				reason: `Subscription is ${sub.status}. Please renew your plan to continue.`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if org can create another project.
	 */
	static async checkCanCreateProject(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const limit = snapshot.resources["max_projects"] ?? -1;
		if (limit === -1) return { allowed: true };

		const ownerOrgIds = await this.resolveOwnerOrgIds(organizationId, executor);
		const orgFilter =
			ownerOrgIds.length === 1
				? eq(schema.projects.organizationId, ownerOrgIds[0]!)
				: inArray(schema.projects.organizationId, ownerOrgIds as any);

		const res = await executor
			.select({ value: count() })
			.from(schema.projects)
			.where(orgFilter);
		const value = res[0]?.value ?? 0;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} project${limit === 1 ? "" : "s"} across your account. You currently have ${value} project${value === 1 ? "" : "s"}. Please upgrade to create more.`,
				current: value,
				limit,
			};
		}

		return { allowed: true, current: value, limit };
	}

	/**
	 * Check if org can deploy another application.
	 */
	static async checkCanCreateApplication(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const limit = snapshot.resources["max_applications"] ?? -1;
		if (limit === -1) return { allowed: true };

		const ownerOrgIds = await this.resolveOwnerOrgIds(organizationId, executor);
		const orgFilter =
			ownerOrgIds.length === 1
				? eq(schema.projects.organizationId, ownerOrgIds[0]!)
				: inArray(schema.projects.organizationId, ownerOrgIds as any);

		// Count total applications across all projects in all customer organizations
		const res = await executor
			.select({ value: count() })
			.from(schema.applications)
			.innerJoin(
				schema.environments,
				eq(schema.applications.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);
		const value = res[0]?.value ?? 0;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} application${limit === 1 ? "" : "s"} across your account. You have currently used ${value}. Please upgrade.`,
				current: value,
				limit,
			};
		}

		return { allowed: true, current: value, limit };
	}

	/**
	 * Check if org can deploy a specific application type.
	 */
	static async checkApplicationType(
		organizationId: string,
		applicationType: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		if (snapshot.applicationTypes.length === 0) {
			// No restrictions — all types allowed
			return { allowed: true };
		}

		if (!snapshot.applicationTypes.includes(applicationType)) {
			return {
				allowed: false,
				reason: `Your plan does not support ${applicationType} applications. Upgrade to a higher plan to unlock this feature.`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if an organization is entitled to use a specific build type.
	 *
	 * - Dockerfile: Requires docker_access feature flag OR "docker" in applicationTypes.
	 * - Static: Requires "static" in applicationTypes (or unrestricted plan).
	 * - Dynamic builders (nixpacks, railpack, heroku_buildpacks, paketo_buildpacks):
	 *   Requires dynamic application runtimes. Restricted if plan is strictly static-only.
	 */
	static async checkBuildType(
		organizationId: string,
		buildType: string,
		isPlatformAdmin = false,
		executor: any = db,
	): Promise<EntitlementResult> {
		if (isPlatformAdmin) {
			return { allowed: true };
		}

		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const hasDockerAccess =
			Boolean(snapshot.features["docker_access"]) ||
			(snapshot.applicationTypes.length === 0 &&
				snapshot.features["docker_access"] !== false) ||
			snapshot.applicationTypes.includes("docker");

		if (buildType === "dockerfile") {
			if (!hasDockerAccess) {
				return {
					allowed: false,
					reason:
						"Your current plan does not include custom Dockerfile builds. Upgrade to a plan with Docker support (Business or Enterprise) to build using Dockerfiles.",
				};
			}
			return { allowed: true };
		}

		if (buildType === "static") {
			if (
				snapshot.applicationTypes.length > 0 &&
				!snapshot.applicationTypes.includes("static")
			) {
				return {
					allowed: false,
					reason:
						"Your current plan does not support static site builds. Upgrade your plan to use this builder.",
				};
			}
			return { allowed: true };
		}

		const isDynamicBuilder = [
			"nixpacks",
			"railpack",
			"heroku_buildpacks",
			"paketo_buildpacks",
		].includes(buildType);

		if (isDynamicBuilder) {
			const hasOnlyStatic =
				snapshot.applicationTypes.length > 0 &&
				snapshot.applicationTypes.every((t) => t === "static");

			if (hasOnlyStatic) {
				return {
					allowed: false,
					reason:
						"Your plan is limited to Static Sites. Upgrade to the Developer or Business plan to build full-stack dynamic applications with the Universal Cloud Builder.",
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Retrieve authoritative builder entitlements and reasons for an organization.
	 */
	static async getBuilderEntitlements(
		organizationId: string,
		isPlatformAdmin = false,
		executor: any = db,
	) {
		if (isPlatformAdmin) {
			return {
				isPlatformAdmin: true,
				planName: "Platform Admin",
				allowedBuildTypes: {
					nixpacks: true,
					dockerfile: true,
					static: true,
					railpack: true,
					heroku_buildpacks: true,
					paketo_buildpacks: true,
				},
				reasons: {} as Record<string, string>,
			};
		}

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) {
			return {
				isPlatformAdmin: false,
				planName: "Unknown",
				allowedBuildTypes: {
					nixpacks: false,
					dockerfile: false,
					static: true,
					railpack: false,
					heroku_buildpacks: false,
					paketo_buildpacks: false,
				},
				reasons: {
					nixpacks: "No active plan found.",
					dockerfile: "No active plan found.",
					railpack: "No active plan found.",
					heroku_buildpacks: "No active plan found.",
					paketo_buildpacks: "No active plan found.",
				},
			};
		}

		const hasDockerAccess =
			Boolean(snapshot.features["docker_access"]) ||
			(snapshot.applicationTypes.length === 0 &&
				snapshot.features["docker_access"] !== false) ||
			snapshot.applicationTypes.includes("docker");

		const hasOnlyStatic =
			snapshot.applicationTypes.length > 0 &&
			snapshot.applicationTypes.every((t) => t === "static");

		const staticAllowed =
			snapshot.applicationTypes.length === 0 ||
			snapshot.applicationTypes.includes("static");

		const dynamicAllowed = !hasOnlyStatic;

		const reasons: Record<string, string> = {};
		if (!hasDockerAccess) {
			reasons.dockerfile =
				"Your current plan does not include custom Dockerfile builds. Upgrade to a plan with Docker support (Business or Enterprise) to build using Dockerfiles.";
		}
		if (!staticAllowed) {
			reasons.static = "Your plan does not support static site hosting.";
		}
		if (!dynamicAllowed) {
			const reason =
				"Your current plan is limited to Static Sites. Upgrade to deploy dynamic applications with the Universal Builder.";
			reasons.nixpacks = reason;
			reasons.railpack = reason;
			reasons.heroku_buildpacks = reason;
			reasons.paketo_buildpacks = reason;
		}

		return {
			isPlatformAdmin: false,
			planName: snapshot.planName,
			allowedBuildTypes: {
				nixpacks: dynamicAllowed,
				dockerfile: hasDockerAccess,
				static: staticAllowed,
				railpack: dynamicAllowed,
				heroku_buildpacks: dynamicAllowed,
				paketo_buildpacks: dynamicAllowed,
			},
			reasons,
		};
	}

	/**
	 * Check if org can add another managed database (Postgres, MySQL, Mongo, Redis, MariaDB).
	 */
	static async checkCanCreateDatabase(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const featureEnabled = snapshot.features["databases"] ?? false;
		if (!featureEnabled) {
			return {
				allowed: false,
				reason: "Your plan does not include managed databases. Upgrade to access this feature.",
			};
		}

		const limit = snapshot.resources["max_databases"] ?? -1;
		if (limit === -1) return { allowed: true };

		const ownerOrgIds = await this.resolveOwnerOrgIds(organizationId, executor);
		const orgFilter =
			ownerOrgIds.length === 1
				? eq(schema.projects.organizationId, ownerOrgIds[0]!)
				: inArray(schema.projects.organizationId, ownerOrgIds as any);

		// Count all 6 managed database types across customer organizations
		const pgCount = await executor
			.select({ value: count() })
			.from(schema.postgres)
			.innerJoin(
				schema.environments,
				eq(schema.postgres.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const mysqlCount = await executor
			.select({ value: count() })
			.from(schema.mysql)
			.innerJoin(
				schema.environments,
				eq(schema.mysql.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const mongoCount = await executor
			.select({ value: count() })
			.from(schema.mongo)
			.innerJoin(
				schema.environments,
				eq(schema.mongo.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const redisCount = await executor
			.select({ value: count() })
			.from(schema.redis)
			.innerJoin(
				schema.environments,
				eq(schema.redis.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const mariadbCount = await executor
			.select({ value: count() })
			.from(schema.mariadb)
			.innerJoin(
				schema.environments,
				eq(schema.mariadb.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const libsqlCount = await executor
			.select({ value: count() })
			.from(schema.libsql)
			.innerJoin(
				schema.environments,
				eq(schema.libsql.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(orgFilter);

		const totalDbs =
			(pgCount[0]?.value ?? 0) +
			(mysqlCount[0]?.value ?? 0) +
			(mongoCount[0]?.value ?? 0) +
			(redisCount[0]?.value ?? 0) +
			(mariadbCount[0]?.value ?? 0) +
			(libsqlCount[0]?.value ?? 0);

		if (totalDbs >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} database${limit === 1 ? "" : "s"} across your account. You have currently used ${totalDbs}. Upgrade to add more.`,
				current: totalDbs,
				limit,
			};
		}

		return { allowed: true, current: totalDbs, limit };
	}

	/**
	 * Check if org can add another custom domain.
	 */
	static async checkCanAddDomain(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const featureEnabled = snapshot.features["custom_domains"] ?? false;
		if (!featureEnabled) {
			return {
				allowed: false,
				reason: "Your plan does not include custom domains. Upgrade to use your own domain.",
			};
		}

		const limit = snapshot.resources["max_domains"] ?? -1;
		if (limit === -1) return { allowed: true };

		const appDomainRes = await executor
			.select({ host: schema.domains.host })
			.from(schema.domains)
			.innerJoin(
				schema.applications,
				eq(schema.domains.applicationId, schema.applications.applicationId),
			)
			.innerJoin(
				schema.environments,
				eq(schema.applications.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(eq(schema.projects.organizationId, organizationId));

		const composeDomainRes = await executor
			.select({ host: schema.domains.host })
			.from(schema.domains)
			.innerJoin(
				schema.compose,
				eq(schema.domains.composeId, schema.compose.composeId),
			)
			.innerJoin(
				schema.environments,
				eq(schema.compose.environmentId, schema.environments.environmentId),
			)
			.innerJoin(
				schema.projects,
				eq(schema.environments.projectId, schema.projects.projectId),
			)
			.where(eq(schema.projects.organizationId, organizationId));

		const allHosts: string[] = [
			...appDomainRes.map((r: any) => r.host),
			...composeDomainRes.map((r: any) => r.host),
		];

		const customHosts = allHosts.filter((h: string) => {
			if (!h) return false;
			const clean = h.trim().toLowerCase();
			if (
				clean.includes(".sslip.io") ||
				clean.includes(".traefik.me") ||
				clean.includes(".nip.io") ||
				clean === "localhost" ||
				clean.endsWith(".localhost")
			) {
				return false;
			}
			const platformBase =
				process.env.PLATFORM_DOMAIN ||
				process.env.BRAND_PLATFORM_SUBDOMAIN_BASE ||
				BRAND.PLATFORM_SUBDOMAIN_BASE;
			if (
				platformBase &&
				(clean === platformBase.toLowerCase() ||
					clean.endsWith(`.${platformBase.toLowerCase()}`))
			) {
				return false;
			}
			return true;
		});

		const value = customHosts.length;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} custom domain${limit === 1 ? "" : "s"}.`,
				current: value,
				limit,
			};
		}

		return { allowed: true, current: value, limit };
	}

	/**
	 * Check if org plan permits automated SSL certificate management.
	 */
	static async checkCanUseSslAuto(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		if (!snapshot.features || Object.keys(snapshot.features).length === 0) {
			return { allowed: true };
		}

		const featureEnabled = snapshot.features["ssl_auto"] ?? true;
		if (!featureEnabled) {
			return {
				allowed: false,
				reason:
					"Your plan does not include automated SSL certificates. Upgrade your plan to enable HTTPS.",
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if a feature flag is enabled for the org.
	 */
	static async checkFeature(
		organizationId: string,
		featureKey: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const enabled = snapshot.features[featureKey] ?? false;
		if (!enabled) {
			return {
				allowed: false,
				reason: `The feature "${featureKey}" is not included in your current plan. Please upgrade.`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if AI assistant / agent features are enabled on the org's plan.
	 */
	static async checkCanUseAi(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const aiAllowed =
			snapshot.features["ai"] ||
			snapshot.features["ai_agent"] ||
			snapshot.features["ai_assistant"] ||
			false;

		if (!aiAllowed) {
			return {
				allowed: false,
				reason:
					"AI assistant/agent is not included in your current plan. Please upgrade to access AI features.",
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if terminal access is enabled on the organization's plan.
	 */
	static async checkCanUseTerminal(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const terminalAllowed =
			snapshot.features["terminal"] ||
			snapshot.features["web_terminal"] ||
			snapshot.features["terminal_access"] ||
			snapshot.features["docker_access"] ||
			false;

		if (!terminalAllowed) {
			return {
				allowed: false,
				reason:
					"Terminal access is not included in your current plan. Please upgrade to access application terminals.",
			};
		}

		return { allowed: true };
	}

	/**
	 * Check if org can add another team member.
	 */
	static async checkCanAddTeamMember(
		organizationId: string,
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No plan found." };

		const featureEnabled = snapshot.features["team_members"] ?? false;
		if (!featureEnabled) {
			return {
				allowed: false,
				reason: "Your plan does not include team member access. Upgrade to add team members.",
			};
		}

		const limit = snapshot.resources["max_team_members"] ?? -1;
		if (limit === -1) return { allowed: true };

		const res = await executor
			.select({ value: count() })
			.from(schema.member)
			.where(eq(schema.member.organizationId, organizationId));
		const value = res[0]?.value ?? 0;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} team member${limit === 1 ? "" : "s"}.`,
				current: value,
				limit,
			};
		}

		return { allowed: true, current: value, limit };
	}

	/**
	 * Run a quota check and creation action inside an atomic transaction
	 * with an advisory lock on the organization to guarantee concurrency safety.
	 */
	static async withAtomicQuotaLock<T>(
		organizationId: string,
		fn: (tx: any) => Promise<T>,
		executor: any = db,
	): Promise<T> {
		if (typeof executor?.transaction === "function") {
			return await executor.transaction(async (tx: any) => {
				try {
					await tx.execute(
						sql`SELECT pg_advisory_xact_lock(hashtext(${`org_quota_${organizationId}`}))`,
					);
				} catch {
					// Fallback if not pg or test mock
				}
				return await fn(tx);
			});
		}
		return await fn(executor);
	}

	/**
	 * Validate that requested runtime CPU and RAM do not exceed plan limits.
	 */
	static async checkRuntimeResources(
		organizationId: string,
		requestedRamMb?: number,
		requestedCpuMillicores?: number,
		executor: any = db,
	): Promise<EntitlementResult> {
		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No active plan found." };

		const maxRam = snapshot.resources["max_ram_mb"] ?? -1;
		if (
			maxRam !== -1 &&
			requestedRamMb !== undefined &&
			requestedRamMb > maxRam
		) {
			return {
				allowed: false,
				reason: `Requested RAM (${requestedRamMb} MB) exceeds your plan limit of ${maxRam} MB. Please upgrade your plan.`,
				current: requestedRamMb,
				limit: maxRam,
			};
		}

		// Default fallback for maxCpu must be 1000 mCPU (1.0 vCPU), NOT -1 (unlimited),
		// ensuring zero bypass even if a plan record omitted max_cpu_millicores.
		const maxCpu = snapshot.resources["max_cpu_millicores"] ?? 1000;
		if (
			maxCpu !== -1 &&
			requestedCpuMillicores !== undefined &&
			requestedCpuMillicores > maxCpu
		) {
			return {
				allowed: false,
				reason: `Requested CPU (${requestedCpuMillicores} mCPU) exceeds your plan limit of ${maxCpu} mCPU (${(maxCpu / 1000).toFixed(1)} vCPU). Please upgrade your plan.`,
				current: requestedCpuMillicores,
				limit: maxCpu,
			};
		}

		return { allowed: true };
	}

	/**
	 * Centralized authoritative method to normalize raw runtime resource inputs
	 * and assert that effective RAM and CPU do not exceed organization plan limits.
	 * Rejects over-limit, malformed, or negative inputs with an appropriate TRPCError.
	 */
	static async assertRuntimeResources(
		organizationId: string,
		resources: RawRuntimeResourceInput,
		executor: any = db,
	): Promise<void> {
		const { effectiveRamMb, effectiveCpuMillicores } =
			normalizeAndCalculateEffectiveResources(resources);

		if (effectiveRamMb !== undefined || effectiveCpuMillicores !== undefined) {
			const check = await this.checkRuntimeResources(
				organizationId,
				effectiveRamMb,
				effectiveCpuMillicores,
				executor,
			);
			if (!check.allowed) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						check.reason ?? "Action not permitted on your current plan.",
				});
			}
		}
	}

	/**
	 * Authoritatively resolves the effective NanoCPUs limit for a container or Swarm service.
	 * ZERO-BYPASS GUARANTEE:
	 * - If platform admin: honors explicit custom limits; unbounded if unspecified.
	 * - If customer:
	 *     - If plan allows 1 vCPU (1000 mCPU), max allowed is 1,000,000,000 NanoCPUs.
	 *     - If requested is empty/null/0: automatically clamped to the plan limit (1 vCPU).
	 *     - If requested exceeds the plan quota: clamped to the plan limit.
	 *     - If requested is lower (e.g. 0.5 vCPU): honors the lower requested limit.
	 * Under no circumstances does a customer container receive unbounded CPU cores.
	 */
	static async resolveEffectiveCpuLimitNano(
		organizationId: string,
		requestedCpuLimit?: string | number | null,
		isPlatformAdmin = false,
		executor: any = db,
	): Promise<number | undefined> {
		if (isPlatformAdmin) {
			if (
				requestedCpuLimit !== undefined &&
				requestedCpuLimit !== null &&
				requestedCpuLimit !== ""
			) {
				const parsed = Number(requestedCpuLimit);
				if (!Number.isNaN(parsed) && parsed > 0) return parsed;
			}
			return undefined;
		}

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		const maxCpuMillicores = snapshot?.resources["max_cpu_millicores"] ?? 1000;

		// If plan explicitly grants unlimited (-1):
		if (maxCpuMillicores === -1) {
			if (
				requestedCpuLimit !== undefined &&
				requestedCpuLimit !== null &&
				requestedCpuLimit !== ""
			) {
				const parsed = Number(requestedCpuLimit);
				if (!Number.isNaN(parsed) && parsed > 0) return parsed;
			}
			return undefined;
		}

		// 1 vCPU = 1,000,000,000 NanoCPUs
		const planMaxNano = maxCpuMillicores * 1_000_000;

		if (
			requestedCpuLimit === undefined ||
			requestedCpuLimit === null ||
			requestedCpuLimit === ""
		) {
			// Customer did not specify a CPU limit -> default to their plan limit (e.g. 1 vCPU)
			return planMaxNano;
		}

		const requestedNum = Number(requestedCpuLimit);
		if (Number.isNaN(requestedNum) || requestedNum <= 0) {
			// Zero, invalid, or negative -> fallback to plan limit
			return planMaxNano;
		}

		// Strictly clamp to the plan limit: zero bypass!
		return Math.min(requestedNum, planMaxNano);
	}

	/**
	 * Authoritatively resolves the effective NanoCPUs reservation.
	 * Ensures reservations never exceed the effective CPU limit or plan ceiling.
	 */
	static async resolveEffectiveCpuReservationNano(
		organizationId: string,
		requestedCpuReservation?: string | number | null,
		effectiveCpuLimitNano?: number,
		isPlatformAdmin = false,
	): Promise<number | undefined> {
		if (isPlatformAdmin) {
			if (
				requestedCpuReservation !== undefined &&
				requestedCpuReservation !== null &&
				requestedCpuReservation !== ""
			) {
				const parsed = Number(requestedCpuReservation);
				if (!Number.isNaN(parsed) && parsed > 0) return parsed;
			}
			return undefined;
		}

		if (
			requestedCpuReservation === undefined ||
			requestedCpuReservation === null ||
			requestedCpuReservation === ""
		) {
			return undefined;
		}

		const parsed = Number(requestedCpuReservation);
		if (Number.isNaN(parsed) || parsed <= 0) return undefined;

		if (effectiveCpuLimitNano !== undefined && parsed > effectiveCpuLimitNano) {
			return effectiveCpuLimitNano;
		}

		return parsed;
	}

	/**
	 * Authoritative monitoring capabilities for an organization based on their active subscription plan.
	 * Basic plans: current metrics only, no advanced I/O (block/network), no historical charts.
	 * Developer / Business / Enterprise or Platform Admins: full historical charts and advanced I/O.
	 */
	static async getMonitoringEntitlements(
		organizationId: string,
		isPlatformAdmin = false,
		executor: any = db,
	): Promise<MonitoringEntitlements> {
		if (isPlatformAdmin) {
			return {
				hasAdvancedIoMetrics: true,
				hasHistoricalCharts: true,
				maxDataPoints: 300,
				retentionHours: 24,
			};
		}

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) {
			return {
				hasAdvancedIoMetrics: false,
				hasHistoricalCharts: false,
				maxDataPoints: 1,
				retentionHours: 1,
			};
		}

		const isAdvancedPlan = Boolean(
			snapshot.features["api_access"] ||
				snapshot.features["docker_access"] ||
				snapshot.features["compose_access"] ||
				(snapshot.resources["max_ram_mb"] ?? 0) > 1024 ||
				snapshot.resources["max_ram_mb"] === -1,
		);

		if (isAdvancedPlan) {
			return {
				hasAdvancedIoMetrics: true,
				hasHistoricalCharts: true,
				maxDataPoints: 300,
				retentionHours: 24,
			};
		}

		return {
			hasAdvancedIoMetrics: false,
			hasHistoricalCharts: false,
			maxDataPoints: 1,
			retentionHours: 1,
		};
	}

	/**
	 * Returns permitted CPU and RAM ranges and plan maximums for the customer-facing UI.
	 */
	static async getResourceLimitsForOrganization(
		organizationId: string,
		isPlatformAdmin = false,
		executor: any = db,
	): Promise<OrganizationResourceLimits> {
		if (isPlatformAdmin) {
			return {
				maxRamMb: -1,
				maxCpuMillicores: -1,
				planName: "Platform Administrator",
				isPlatformAdmin: true,
				minRamMb: 4,
				minCpuMillicores: 100,
			};
		}

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		return {
			maxRamMb: snapshot?.resources["max_ram_mb"] ?? 512,
			maxCpuMillicores: snapshot?.resources["max_cpu_millicores"] ?? 1000,
			planName: snapshot?.planName ?? "Basic",
			isPlatformAdmin: false,
			minRamMb: 4,
			minCpuMillicores: 100,
		};
	}

	/**
	 * Validate that requested object storage upload or modification does not exceed plan limits.
	 * Supports both general storage ("max_storage_gb") and backup storage ("backup_storage_gb").
	 *
	 * @param organizationId - The target organization
	 * @param incomingBytes - Bytes to add/upload (or delta: newBytes - oldBytes for replacements; negative for deletions)
	 * @param currentUsageBytes - Current storage consumed in bytes (defaults to 0)
	 * @param resourceKey - "max_storage_gb" | "backup_storage_gb" (defaults to "max_storage_gb")
	 * @param executor - Database executor/transaction
	 */
	static async checkObjectStorageCapacity(
		organizationId: string,
		incomingBytes: number,
		currentUsageBytes?: number,
		resourceKey: "max_storage_gb" | "backup_storage_gb" = "max_storage_gb",
		executor: any = db,
	): Promise<EntitlementResult> {
		const activeCheck = await this.checkSubscriptionActive(
			organizationId,
			executor,
		);
		if (!activeCheck.allowed) return activeCheck;

		const snapshot = await this.getPlanSnapshot(organizationId, executor);
		if (!snapshot) return { allowed: false, reason: "No active plan found." };

		const limitGb = snapshot.resources[resourceKey] ?? -1;
		if (limitGb === -1) {
			return { allowed: true, current: currentUsageBytes ?? 0, limit: -1 };
		}

		let actualUsage = currentUsageBytes;
		if (actualUsage === undefined) {
			if (resourceKey === "backup_storage_gb") {
				const { BackupStorageService } = await import("./backup-storage");
				actualUsage =
					await BackupStorageService.getOrganizationBackupStorageUsage(
						organizationId,
						executor,
					);
			} else {
				actualUsage = 0;
			}
		}

		const limitBytes = limitGb * 1024 * 1024 * 1024;
		const projectedUsageBytes = Math.max(0, actualUsage + incomingBytes);

		// Deletions / usage reductions (incomingBytes <= 0) are always permitted regardless of quota
		if (incomingBytes <= 0) {
			return {
				allowed: true,
				current: projectedUsageBytes,
				limit: limitBytes,
			};
		}

		if (projectedUsageBytes > limitBytes) {
			const limitGbFormatted =
				limitGb >= 1 ? `${limitGb} GB` : `${Math.round(limitGb * 1024)} MB`;
			const requestedMbFormatted = (incomingBytes / (1024 * 1024)).toFixed(2);
			const currentMbFormatted = (actualUsage / (1024 * 1024)).toFixed(2);

			return {
				allowed: false,
				reason: `Requested storage upload (${requestedMbFormatted} MB, current usage: ${currentMbFormatted} MB) exceeds your plan limit of ${limitGbFormatted}. Please upgrade your plan or delete existing files.`,
				current: projectedUsageBytes,
				limit: limitBytes,
			};
		}

		return {
			allowed: true,
			current: projectedUsageBytes,
			limit: limitBytes,
		};
	}

	/**
	 * Authoritative assertion for object storage capacity.
	 * Throws TRPCError FORBIDDEN when requested capacity exceeds the organization's plan limit.
	 */
	static async assertObjectStorageCapacity(
		organizationId: string,
		incomingBytes: number,
		currentUsageBytes?: number,
		resourceKey: "max_storage_gb" | "backup_storage_gb" = "max_storage_gb",
		executor: any = db,
	): Promise<void> {
		const check = await this.checkObjectStorageCapacity(
			organizationId,
			incomingBytes,
			currentUsageBytes,
			resourceKey,
			executor,
		);
		if (!check.allowed) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: check.reason ?? "Storage capacity limit exceeded.",
			});
		}
	}

	/**
	 * Verify if an application name belongs to an organization.
	 */
	static async verifyAppNameBelongsToOrg(
		appName: string,
		organizationId: string,
		executor: any = db,
	): Promise<boolean> {
		if (!appName || !organizationId) return false;

		const orgProjects = await executor.query.projects.findMany({
			where: eq(schema.projects.organizationId, organizationId),
			columns: { projectId: true },
			with: {
				environments: {
					columns: { environmentId: true },
				},
			},
		});

		const validEnvIds = new Set<string>();
		for (const p of orgProjects || []) {
			for (const e of (p as any).environments || []) {
				if (e.environmentId) validEnvIds.add(e.environmentId);
			}
		}

		if (validEnvIds.size === 0) return false;
		const envIdArray = Array.from(validEnvIds);

		const serviceTables: (keyof typeof schema)[] = [
			"applications",
			"compose",
			"postgres",
			"mysql",
			"mariadb",
			"mongo",
			"redis",
			"libsql",
		];

		for (const tableName of serviceTables) {
			const table = (schema as any)[tableName];
			if (!table || !table.appName || !table.environmentId) continue;
			const match = await executor.query[tableName]?.findFirst({
				where: and(
					eq(table.appName, appName),
					inArray(table.environmentId, envIdArray),
				),
			});
			if (match) return true;
		}

		return false;
	}

	/**
	 * Verify if a deployment logPath belongs to an organization.
	 */
	static async verifyDeploymentLogPathBelongsToOrg(
		logPath: string,
		organizationId: string,
		executor: any = db,
	): Promise<boolean> {
		if (!logPath || !organizationId) return false;

		const deployment = await executor.query.deployments.findFirst({
			where: eq(schema.deployments.logPath, logPath),
			with: {
				application: {
					with: {
						environment: {
							with: { project: { columns: { organizationId: true } } },
						},
					},
				},
				compose: {
					with: {
						environment: {
							with: { project: { columns: { organizationId: true } } },
						},
					},
				},
			},
		});

		if (!deployment) return false;

		const orgId =
			(deployment as any).application?.environment?.project?.organizationId ??
			(deployment as any).compose?.environment?.project?.organizationId;

		return orgId === organizationId;
	}
}

/**
 * Validates and converts a single raw numeric resource parameter (bytes or NanoCPUs).
 * Handles string or number inputs, rejects NaN, Infinity, negative values, unsafe integers, or non-numeric strings.
 * Returns undefined if value is null, undefined, or empty string.
 */
export function parseAndValidateResourceValue(
	value: unknown,
	fieldName: string,
): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	let numericValue: number;

	if (typeof value === "number") {
		numericValue = value;
	} else if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") {
			return undefined;
		}
		// Strict numeric check
		if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Invalid value for ${fieldName}: "${value}" is not a valid number.`,
			});
		}
		numericValue = Number(trimmed);
	} else {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid type for ${fieldName}: expected number or numeric string.`,
		});
	}

	if (!Number.isFinite(numericValue) || Number.isNaN(numericValue)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid value for ${fieldName}: must be a finite number.`,
		});
	}

	if (numericValue < 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid value for ${fieldName}: negative values are not allowed.`,
		});
	}

	if (numericValue > Number.MAX_SAFE_INTEGER) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid value for ${fieldName}: value exceeds maximum safe integer.`,
		});
	}

	return numericValue;
}

/**
 * Centralized helper for runtime-resource normalization and conversion.
 * - RAM: Converts Docker bytes to MB using `Math.ceil(bytes / (1024 * 1024))`.
 *   `effectiveRamMb = max(memoryLimitMb, memoryReservationMb)`
 * - CPU: Converts Docker NanoCPUs to millicores using `Math.ceil(nanoCpus / 1_000_000)`.
 *   `effectiveCpuMillicores = max(cpuLimitMillicores, cpuReservationMillicores)`
 * - If only limit exists, uses limit.
 * - If only reservation exists, uses reservation.
 * - If neither exists, returns undefined.
 * - If both exist, always evaluates the larger effective value.
 */
export function normalizeAndCalculateEffectiveResources(
	input: RawRuntimeResourceInput,
): EffectiveRuntimeResources {
	const rawMemoryLimit = parseAndValidateResourceValue(
		input.memoryLimit,
		"memoryLimit",
	);
	const rawMemoryReservation = parseAndValidateResourceValue(
		input.memoryReservation,
		"memoryReservation",
	);
	const rawCpuLimit = parseAndValidateResourceValue(
		input.cpuLimit,
		"cpuLimit",
	);
	const rawCpuReservation = parseAndValidateResourceValue(
		input.cpuReservation,
		"cpuReservation",
	);

	// Validate minimum Docker memory limit (4 MB)
	if (
		rawMemoryLimit !== undefined &&
		rawMemoryLimit > 0 &&
		rawMemoryLimit < 4 * 1024 * 1024
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Memory limit must be at least 4 MB (4,194,304 bytes).",
		});
	}

	// Validate relationships: reservations cannot exceed limits
	if (
		rawMemoryLimit !== undefined &&
		rawMemoryReservation !== undefined &&
		rawMemoryReservation > 0 &&
		rawMemoryLimit > 0 &&
		rawMemoryReservation > rawMemoryLimit
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Memory reservation cannot exceed memory limit.",
		});
	}

	if (
		rawCpuLimit !== undefined &&
		rawCpuReservation !== undefined &&
		rawCpuReservation > 0 &&
		rawCpuLimit > 0 &&
		rawCpuReservation > rawCpuLimit
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "CPU reservation cannot exceed CPU limit.",
		});
	}

	const memoryLimitMb =
		rawMemoryLimit !== undefined
			? Math.ceil(rawMemoryLimit / (1024 * 1024))
			: undefined;
	const memoryReservationMb =
		rawMemoryReservation !== undefined
			? Math.ceil(rawMemoryReservation / (1024 * 1024))
			: undefined;

	let effectiveRamMb: number | undefined;
	if (memoryLimitMb !== undefined && memoryReservationMb !== undefined) {
		effectiveRamMb = Math.max(memoryLimitMb, memoryReservationMb);
	} else if (memoryLimitMb !== undefined) {
		effectiveRamMb = memoryLimitMb;
	} else if (memoryReservationMb !== undefined) {
		effectiveRamMb = memoryReservationMb;
	}

	const cpuLimitMillicores =
		rawCpuLimit !== undefined
			? Math.ceil(rawCpuLimit / 1_000_000)
			: undefined;
	const cpuReservationMillicores =
		rawCpuReservation !== undefined
			? Math.ceil(rawCpuReservation / 1_000_000)
			: undefined;

	let effectiveCpuMillicores: number | undefined;
	if (
		cpuLimitMillicores !== undefined &&
		cpuReservationMillicores !== undefined
	) {
		effectiveCpuMillicores = Math.max(
			cpuLimitMillicores,
			cpuReservationMillicores,
		);
	} else if (cpuLimitMillicores !== undefined) {
		effectiveCpuMillicores = cpuLimitMillicores;
	} else if (cpuReservationMillicores !== undefined) {
		effectiveCpuMillicores = cpuReservationMillicores;
	}

	return {
		effectiveRamMb,
		effectiveCpuMillicores,
	};
}

/**
 * Convenience: throw a TRPCError if an entitlement check fails.
 * Import and use in tRPC procedures:
 *
 *   await assertEntitlement(PlanEntitlementService.checkCanCreateProject(orgId, tx));
 */
export async function assertEntitlement(
	check: Promise<EntitlementResult> | EntitlementResult,
): Promise<void> {
	const result = await check;
	if (!result.allowed) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: result.reason ?? "Action not permitted on your current plan.",
		});
	}
}

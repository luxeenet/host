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
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export class PlanEntitlementService {
	/**
	 * Load the full plan snapshot for an organization.
	 * Returns null if no active subscription exists.
	 */
	static async getPlanSnapshot(
		organizationId: string,
		executor: any = db,
	): Promise<PlanSnapshot | null> {
		const subscription = await executor.query.subscriptions.findFirst({
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

		if (!subscription) return null;

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
		const sub = await executor.query.subscriptions.findFirst({
			where: eq(schema.subscriptions.organizationId, organizationId),
			orderBy: (sub: any, { desc }: any) => [desc(sub.createdAt)],
		});

		if (!sub) {
			return { allowed: false, reason: "No active subscription found." };
		}

		const activeStatuses = ["trial", "active", "grace_period"];
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

		const res = await executor
			.select({ value: count() })
			.from(schema.projects)
			.where(eq(schema.projects.organizationId, organizationId));
		const value = res[0]?.value ?? 0;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} project${limit === 1 ? "" : "s"}. Please upgrade to create more.`,
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

		// Count total applications across all projects in the org
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
			.where(eq(schema.projects.organizationId, organizationId));
		const value = res[0]?.value ?? 0;

		if (value >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} application${limit === 1 ? "" : "s"}. Please upgrade.`,
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

		// Count all 5 managed database types in the org
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
			.where(eq(schema.projects.organizationId, organizationId));

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
			.where(eq(schema.projects.organizationId, organizationId));

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
			.where(eq(schema.projects.organizationId, organizationId));

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
			.where(eq(schema.projects.organizationId, organizationId));

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
			.where(eq(schema.projects.organizationId, organizationId));

		const totalDbs =
			(pgCount[0]?.value ?? 0) +
			(mysqlCount[0]?.value ?? 0) +
			(mongoCount[0]?.value ?? 0) +
			(redisCount[0]?.value ?? 0) +
			(mariadbCount[0]?.value ?? 0);

		if (totalDbs >= limit) {
			return {
				allowed: false,
				reason: `Your plan allows a maximum of ${limit} database${limit === 1 ? "" : "s"}. Upgrade to add more.`,
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

		const res = await executor
			.select({ value: count() })
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
		const value = res[0]?.value ?? 0;

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
	): Promise<T> {
		return await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${`org_quota_${organizationId}`}))`,
			);
			return await fn(tx);
		});
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
		if (maxRam !== -1 && requestedRamMb && requestedRamMb > maxRam) {
			return {
				allowed: false,
				reason: `Requested RAM (${requestedRamMb} MB) exceeds your plan limit of ${maxRam} MB. Please upgrade your plan.`,
				current: requestedRamMb,
				limit: maxRam,
			};
		}

		const maxCpu = snapshot.resources["max_cpu_millicores"] ?? -1;
		if (
			maxCpu !== -1 &&
			requestedCpuMillicores &&
			requestedCpuMillicores > maxCpu
		) {
			return {
				allowed: false,
				reason: `Requested CPU (${requestedCpuMillicores} mCPU) exceeds your plan limit of ${maxCpu} mCPU. Please upgrade your plan.`,
				current: requestedCpuMillicores,
				limit: maxCpu,
			};
		}

		return { allowed: true };
	}
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
		const { TRPCError } = await import("@trpc/server");
		throw new TRPCError({
			code: "FORBIDDEN",
			message: result.reason ?? "Action not permitted on your current plan.",
		});
	}
}

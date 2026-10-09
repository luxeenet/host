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
			.where(eq(schema.projects.organizationId, organizationId));

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

		const appDomainRes = await executor
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

		const composeDomainRes = await executor
			.select({ value: count() })
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

		const value =
			(appDomainRes[0]?.value ?? 0) + (composeDomainRes[0]?.value ?? 0);

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
					"Terminal access is not included in your current plan. Please upgrade to access container terminals.",
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

		const maxCpu = snapshot.resources["max_cpu_millicores"] ?? -1;
		if (
			maxCpu !== -1 &&
			requestedCpuMillicores !== undefined &&
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

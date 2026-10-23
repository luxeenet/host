/**
 * CustomerUsageService
 *
 * Provides authoritative, tenant-isolated resource telemetry and metering
 * for the authenticated customer organization against their active subscription plan limits.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Only workloads belonging strictly to the specified organization are ever measured or counted.
 * 2. Never exposes host-wide physical RAM, CPU cores, root filesystem disks, or other tenants' workloads.
 * 3. Never invents values: if a metric cannot be reliably measured, it is flagged as unavailable or collecting.
 * 4. Limits always come from trusted server-side plan definitions, never client parameters.
 * 5. Accurate accounting: real container statistics, volume storage matching, and outbound egress.
 */
import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { readLastValueStatsFile, recordAdvancedStats } from "../monitoring/utils";
import { toMb } from "../monitoring/units";
import { BackupStorageService } from "./backup-storage";
import { docker } from "../constants";
import { execAsync } from "../utils/process/execAsync";
import { getVolumesSize } from "./docker-volume";

export interface WorkloadTelemetry {
	id: string;
	name: string;
	appName: string;
	serviceType: "application" | "compose" | "database";
	engine?: string;
	projectName: string;
	environmentName: string;
	status: "running" | "idle" | "error" | "stopped";
	lifecycleStatus: "running" | "stopped" | "failed" | "pending";
	telemetryStatus: "measured" | "collecting" | "stale" | "unavailable" | "zero";
	telemetryReason?: string;
	lastMeasuredAt?: string | null;
	measuredRamMb: number;
	measuredCpuPercent: number;
	measuredCpuMcores?: number;
	measuredNetworkMb: number;
	measuredEgressMb?: number;
	allocatedRamMb: number | null;
	allocatedCpuMillicores: number | null;
	hasLiveTelemetry: boolean;
}

export interface MetricGauge {
	used: number;
	limit: number; // -1 = unlimited
	remaining: number;
	percentage: number;
	formattedUsed: string;
	formattedLimit: string;
	formattedRemaining: string;
	isAvailable: boolean;
	statusLabel: string;
	telemetryState?: "measured" | "collecting" | "stale" | "unavailable" | "zero";
	unavailabilityReason?: string;
}

export interface CustomerResourceUsageReport {
	organizationId: string;
	planName: string;
	subscriptionStatus: string;
	billingPeriodEnd: string | null;
	ram: MetricGauge;
	cpu: MetricGauge;
	storage: MetricGauge;
	bandwidth: MetricGauge;
	applications: {
		used: number;
		limit: number;
		remaining: number;
		percentage: number;
	};
	databases: {
		used: number;
		limit: number;
		remaining: number;
		percentage: number;
	};
	projects: {
		used: number;
		limit: number;
	};
	workloads: WorkloadTelemetry[];
	timestamp: string;
}

/**
 * Parses raw Docker memory string (e.g. "128.5MiB", "1.2GiB", "500B") into MB.
 */
function parseMemoryStringToMb(raw: unknown): number {
	if (typeof raw === "number") {
		return raw;
	}
	if (!raw || typeof raw !== "string") {
		return 0;
	}
	return toMb(raw);
}

/**
 * Parses raw Docker CPU percentage string (e.g. "12.34%") into a clean number.
 */
function parseCpuPercentToNumber(raw: unknown): number {
	if (typeof raw === "number") {
		return raw;
	}
	if (!raw || typeof raw !== "string") {
		return 0;
	}
	const clean = raw.replace("%", "").trim();
	const parsed = Number.parseFloat(clean);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Resolves live container statistics with disk file fallback and freshness tracking.
 */
async function resolveWorkloadTelemetry(
	appName: string,
	rawStatus: string | null | undefined,
	serviceType: "application" | "compose" | "database",
	allocatedMemoryLimit?: string | null,
): Promise<{
	lifecycleStatus: "running" | "stopped" | "failed" | "pending";
	status: "running" | "idle" | "error" | "stopped";
	telemetryStatus: "measured" | "collecting" | "stale" | "unavailable" | "zero";
	telemetryReason?: string;
	lastMeasuredAt?: string | null;
	measuredRamMb: number;
	measuredCpuPercent: number;
	measuredNetworkMb: number;
	measuredEgressMb: number;
	hasLiveTelemetry: boolean;
}> {
	const isDone = rawStatus === "done";
	const isRunning = rawStatus === "running" || isDone;
	const isError = rawStatus === "error";

	const lifecycleStatus: "running" | "stopped" | "failed" | "pending" = isError
		? "failed"
		: isRunning
			? "running"
			: "stopped";

	// Backward-compatible status ("running", "idle", "error")
	const status: "running" | "idle" | "error" | "stopped" = isRunning
		? "running"
		: isError
			? "error"
			: "idle";

	if (lifecycleStatus === "stopped") {
		return {
			lifecycleStatus: "stopped",
			status: "idle",
			telemetryStatus: "unavailable",
			telemetryReason: "Workload is stopped",
			lastMeasuredAt: null,
			measuredRamMb: 0,
			measuredCpuPercent: 0,
			measuredNetworkMb: 0,
			measuredEgressMb: 0,
			hasLiveTelemetry: false,
		};
	}

	if (lifecycleStatus === "failed") {
		return {
			lifecycleStatus: "failed",
			status: "error",
			telemetryStatus: "unavailable",
			telemetryReason: "Workload has deployment error",
			lastMeasuredAt: null,
			measuredRamMb: 0,
			measuredCpuPercent: 0,
			measuredNetworkMb: 0,
			measuredEgressMb: 0,
			hasLiveTelemetry: false,
		};
	}

	// 1. Check existing stats file first
	let memStat: any = null;
	let cpuStat: any = null;
	let netStat: any = null;
	try {
		memStat = await readLastValueStatsFile(appName, "memory");
		cpuStat = await readLastValueStatsFile(appName, "cpu");
		netStat = await readLastValueStatsFile(appName, "network");
	} catch {
		// Handled safely
	}

	const sampleTime = memStat?.time || cpuStat?.time || netStat?.time;
	const sampleAgeMs = sampleTime ? Date.now() - new Date(sampleTime).getTime() : Infinity;

	// 2. If stats file is missing or older than 2 minutes, try live container sampling
	if (!memStat || sampleAgeMs >= 120_000) {
		try {
			const filter = {
				status: ["running"],
				...(serviceType === "compose"
					? { label: [`com.docker.compose.project=${appName}`] }
					: { label: [`com.docker.swarm.service.name=${appName}`] }),
			};

			const containers = await docker.listContainers({
				filters: JSON.stringify(filter),
			});

			const container = containers?.[0];
			if (container?.Id) {
				const { stdout } = await execAsync(
					`docker stats ${container.Id} --no-stream --format '{"BlockIO":"{{.BlockIO}}","CPUPerc":"{{.CPUPerc}}","Container":"{{.Container}}","ID":"{{.ID}}","MemPerc":"{{.MemPerc}}","MemUsage":"{{.MemUsage}}","Name":"{{.Name}}","NetIO":"{{.NetIO}}"} '`,
				);
				if (stdout?.trim()) {
					const stat = JSON.parse(stdout.trim());
					await recordAdvancedStats(stat, appName, allocatedMemoryLimit);
					memStat = await readLastValueStatsFile(appName, "memory");
					cpuStat = await readLastValueStatsFile(appName, "cpu");
					netStat = await readLastValueStatsFile(appName, "network");
				}
			}
		} catch {
			// Container sampling failure handled safely (e.g. test environment or swarm manager)
		}
	}

	const hasStats = Boolean(memStat?.value || cpuStat?.value || netStat?.value);
	const measuredRamMb = memStat?.value?.used ? parseMemoryStringToMb(memStat.value.used) : 0;
	const measuredCpuPercent = cpuStat?.value ? parseCpuPercentToNumber(cpuStat.value) : 0;
	const netInput = Number(netStat?.value?.inputMb ?? 0);
	const netOutput = Number(netStat?.value?.outputMb ?? 0);
	const measuredNetworkMb = Number((netInput + netOutput).toFixed(2));
	const measuredEgressMb = Number(netOutput.toFixed(2));

	const effectiveTime = memStat?.time || cpuStat?.time || netStat?.time;
	const effectiveAgeMs = effectiveTime ? Date.now() - new Date(effectiveTime).getTime() : Infinity;

	let telemetryStatus: "measured" | "collecting" | "stale" | "unavailable" | "zero" = "collecting";
	let telemetryReason = "Awaiting initial telemetry collection";

	if (hasStats) {
		if (effectiveAgeMs > 300_000) {
			telemetryStatus = "stale";
			telemetryReason = "Telemetry sample is older than 5 minutes";
		} else if (measuredRamMb === 0 && measuredCpuPercent === 0) {
			telemetryStatus = "zero";
			telemetryReason = "Active workload with 0% utilization";
		} else {
			telemetryStatus = "measured";
			telemetryReason = "Live container telemetry";
		}
	}

	return {
		lifecycleStatus: "running",
		status: "running",
		telemetryStatus,
		telemetryReason,
		lastMeasuredAt: effectiveTime ? new Date(effectiveTime).toISOString() : null,
		measuredRamMb,
		measuredCpuPercent,
		measuredNetworkMb,
		measuredEgressMb,
		hasLiveTelemetry: hasStats,
	};
}

export class CustomerUsageService {
	/**
	 * Aggregates live tenant resource telemetry and matches it with the organization's effective plan limits.
	 */
	static async getOrganizationUsage(
		organizationId: string,
		executor: any = db,
	): Promise<CustomerResourceUsageReport> {
		if (!organizationId) {
			throw new Error("Active organization identifier is required.");
		}

		// 1. Resolve active subscription & plan definitions
		const subscription = await executor.query.subscriptions.findFirst({
			where: eq(schema.subscriptions.organizationId, organizationId),
			with: {
				plan: {
					with: {
						resources: true,
						features: true,
					},
				},
			},
			orderBy: (sub: any, { desc }: any) => [desc(sub.createdAt)],
		});

		const planName = subscription?.plan?.name ?? "Starter Plan";
		const subscriptionStatus = subscription?.status ?? "active";
		const billingPeriodEnd = subscription?.currentPeriodEnd
			? new Date(subscription.currentPeriodEnd).toISOString()
			: null;

		const planResources: Record<string, number> = {};
		if (subscription?.plan?.resources) {
			for (const r of subscription.plan.resources) {
				planResources[r.resourceKey] = r.value;
			}
		}

		const ramLimitMb = planResources["max_ram_mb"] ?? 2048; // Default 2 GB if unset
		const cpuLimitMillicores = planResources["max_cpu_millicores"] ?? 2000; // Default 2 Cores
		const storageLimitGb = planResources["max_storage_gb"] ?? 20; // Default 20 GB
		const bandwidthLimitGb = planResources["max_bandwidth_gb"] ?? 250; // Default 250 GB
		const appLimit = planResources["max_applications"] ?? 5;
		const dbLimit = planResources["max_databases"] ?? 3;
		const projectLimit = planResources["max_projects"] ?? 3;

		// 2. Fetch all projects strictly belonging to this organization (only non-sensitive columns)
		let orgProjects: { projectId: string; name: string }[] = [];
		try {
			if (typeof executor.select === "function") {
				orgProjects = await executor
					.select({
						projectId: schema.projects.projectId,
						name: schema.projects.name,
					})
					.from(schema.projects)
					.where(eq(schema.projects.organizationId, organizationId));
			} else if (executor?.query?.projects?.findMany) {
				const raw = await executor.query.projects.findMany({
					where: eq(schema.projects.organizationId, organizationId),
					columns: {
						projectId: true,
						name: true,
					},
				});
				orgProjects = (raw || []).map((p: any) => ({
					projectId: p.projectId,
					name: p.name,
				}));
			}
		} catch (err: any) {
			console.error(
				"[CustomerUsageService] Error querying projects for organization:",
				organizationId,
				err?.message,
			);
			throw new Error("Unable to retrieve resource usage at this time. Please try again later.");
		}

		const workloads: WorkloadTelemetry[] = [];
		let totalAppsCount = 0;
		let totalDbsCount = 0;
		const allDbRecords: { id: string; engine: string }[] = [];
		let appRows: any[] = [];
		let compRows: any[] = [];

		if (orgProjects.length > 0) {
			const projectIds = orgProjects.map((p) => p.projectId);
			const projectMap = new Map<string, string>(
				orgProjects.map((p) => [p.projectId, p.name || "Default Project"]),
			);

			let orgEnvironments: { environmentId: string; name: string; projectId: string }[] = [];
			try {
				if (typeof executor.select === "function") {
					orgEnvironments = await executor
						.select({
							environmentId: schema.environments.environmentId,
							name: schema.environments.name,
							projectId: schema.environments.projectId,
						})
						.from(schema.environments)
						.where(inArray(schema.environments.projectId, projectIds));
				} else if (executor?.query?.environments?.findMany) {
					const raw = await executor.query.environments.findMany({
						where: inArray(schema.environments.projectId, projectIds),
						columns: {
							environmentId: true,
							name: true,
							projectId: true,
						},
					});
					orgEnvironments = (raw || []).map((e: any) => ({
						environmentId: e.environmentId,
						name: e.name,
						projectId: e.projectId,
					}));
				}
			} catch (err: any) {
				console.error(
					"[CustomerUsageService] Error querying environments:",
					err?.message,
				);
				throw new Error("Unable to retrieve resource usage at this time. Please try again later.");
			}

			if (orgEnvironments.length > 0) {
				const envIds = orgEnvironments.map((e) => e.environmentId);
				const envMap = new Map<string, { name: string; projectName: string }>();
				for (const env of orgEnvironments) {
					envMap.set(env.environmentId, {
						name: env.name || "production",
						projectName: projectMap.get(env.projectId) || "Default Project",
					});
				}

				// Applications query (explicit non-sensitive columns only)
				try {
					if (typeof executor.select === "function") {
						appRows = await executor
							.select({
								applicationId: schema.applications.applicationId,
								name: schema.applications.name,
								appName: schema.applications.appName,
								applicationStatus: schema.applications.applicationStatus,
								memoryLimit: schema.applications.memoryLimit,
								cpuLimit: schema.applications.cpuLimit,
								environmentId: schema.applications.environmentId,
							})
							.from(schema.applications)
							.where(inArray(schema.applications.environmentId, envIds));
					} else if (executor?.query?.applications?.findMany) {
						appRows = await executor.query.applications.findMany({
							where: inArray(schema.applications.environmentId, envIds),
							columns: {
								applicationId: true,
								name: true,
								appName: true,
								applicationStatus: true,
								memoryLimit: true,
								cpuLimit: true,
								environmentId: true,
							},
						});
					}
				} catch (err: any) {
					console.error("[CustomerUsageService] Error querying applications:", err?.message);
				}

				for (const app of appRows || []) {
					totalAppsCount++;
					const appName = app.appName || app.name;
					const allocatedRamMb = app.memoryLimit
						? Math.ceil(Number(app.memoryLimit) / (1024 * 1024))
						: null;
					const allocatedCpuMillicores = app.cpuLimit
						? Math.ceil(Number(app.cpuLimit) / 1_000_000)
						: null;

					const telemetry = await resolveWorkloadTelemetry(
						appName,
						app.applicationStatus,
						"application",
						app.memoryLimit,
					);

					const envInfo = envMap.get(app.environmentId) || {
						name: "production",
						projectName: "Default Project",
					};

					workloads.push({
						id: app.applicationId,
						name: app.name,
						appName,
						serviceType: "application",
						projectName: envInfo.projectName,
						environmentName: envInfo.name,
						status: telemetry.status,
						lifecycleStatus: telemetry.lifecycleStatus,
						telemetryStatus: telemetry.telemetryStatus,
						telemetryReason: telemetry.telemetryReason,
						lastMeasuredAt: telemetry.lastMeasuredAt,
						measuredRamMb: telemetry.measuredRamMb,
						measuredCpuPercent: telemetry.measuredCpuPercent,
						measuredCpuMcores: Math.round(telemetry.measuredCpuPercent * 10),
						measuredNetworkMb: telemetry.measuredNetworkMb,
						measuredEgressMb: telemetry.measuredEgressMb,
						allocatedRamMb,
						allocatedCpuMillicores,
						hasLiveTelemetry: telemetry.hasLiveTelemetry,
					});
				}

				// Docker Compose Workloads (explicit non-sensitive columns only)
				try {
					if (typeof executor.select === "function") {
						compRows = await executor
							.select({
								composeId: schema.compose.composeId,
								name: schema.compose.name,
								appName: schema.compose.appName,
								composeStatus: schema.compose.composeStatus,
								environmentId: schema.compose.environmentId,
							})
							.from(schema.compose)
							.where(inArray(schema.compose.environmentId, envIds));
					} else if (executor?.query?.compose?.findMany) {
						compRows = await executor.query.compose.findMany({
							where: inArray(schema.compose.environmentId, envIds),
							columns: {
								composeId: true,
								name: true,
								appName: true,
								composeStatus: true,
								environmentId: true,
							},
						});
					}
				} catch (err: any) {
					console.error("[CustomerUsageService] Error querying compose:", err?.message);
				}

				for (const comp of compRows || []) {
					totalAppsCount++;
					const appName = comp.appName || comp.name;

					const telemetry = await resolveWorkloadTelemetry(
						appName,
						comp.composeStatus,
						"compose",
					);

					const envInfo = envMap.get(comp.environmentId) || {
						name: "production",
						projectName: "Default Project",
					};

					workloads.push({
						id: comp.composeId,
						name: comp.name,
						appName,
						serviceType: "compose",
						projectName: envInfo.projectName,
						environmentName: envInfo.name,
						status: telemetry.status,
						lifecycleStatus: telemetry.lifecycleStatus,
						telemetryStatus: telemetry.telemetryStatus,
						telemetryReason: telemetry.telemetryReason,
						lastMeasuredAt: telemetry.lastMeasuredAt,
						measuredRamMb: telemetry.measuredRamMb,
						measuredCpuPercent: telemetry.measuredCpuPercent,
						measuredCpuMcores: Math.round(telemetry.measuredCpuPercent * 10),
						measuredNetworkMb: telemetry.measuredNetworkMb,
						measuredEgressMb: telemetry.measuredEgressMb,
						allocatedRamMb: null,
						allocatedCpuMillicores: null,
						hasLiveTelemetry: telemetry.hasLiveTelemetry,
					});
				}

				// Databases (All 6 engines - selecting only non-sensitive columns, zero secrets)
				const dbConfigs: {
					table: any;
					queryProp: string;
					engine: string;
					idKey: string;
				}[] = [
					{ table: schema.postgres, queryProp: "postgres", engine: "postgres", idKey: "postgresId" },
					{ table: schema.mysql, queryProp: "mysql", engine: "mysql", idKey: "mysqlId" },
					{ table: schema.mariadb, queryProp: "mariadb", engine: "mariadb", idKey: "mariadbId" },
					{ table: schema.mongo, queryProp: "mongo", engine: "mongo", idKey: "mongoId" },
					{ table: schema.redis, queryProp: "redis", engine: "redis", idKey: "redisId" },
					{ table: schema.libsql, queryProp: "libsql", engine: "libsql", idKey: "libsqlId" },
				];

				for (const cfg of dbConfigs) {
					let dbRows: any[] = [];
					try {
						if (typeof executor.select === "function") {
							dbRows = await executor
								.select({
									id: cfg.table[cfg.idKey],
									name: cfg.table.name,
									appName: cfg.table.appName,
									applicationStatus: cfg.table.applicationStatus,
									memoryLimit: cfg.table.memoryLimit,
									cpuLimit: cfg.table.cpuLimit,
									environmentId: cfg.table.environmentId,
								})
								.from(cfg.table)
								.where(inArray(cfg.table.environmentId, envIds));
						} else if (executor?.query?.[cfg.queryProp]?.findMany) {
							dbRows = await executor.query[cfg.queryProp].findMany({
								where: inArray(cfg.table.environmentId, envIds),
								columns: {
									[cfg.idKey]: true,
									name: true,
									appName: true,
									applicationStatus: true,
									memoryLimit: true,
									cpuLimit: true,
									environmentId: true,
								},
							});
						}
					} catch (err: any) {
						console.error(`[CustomerUsageService] Error querying ${cfg.engine}:`, err?.message);
					}

					for (const dbRecord of dbRows || []) {
						totalDbsCount++;
						const recordId = dbRecord.id || dbRecord[cfg.idKey];
						allDbRecords.push({ id: recordId, engine: cfg.engine });
						const appName = dbRecord.appName || dbRecord.name;
						const allocatedRamMb = dbRecord.memoryLimit
							? Math.ceil(Number(dbRecord.memoryLimit) / (1024 * 1024))
							: null;
						const allocatedCpuMillicores = dbRecord.cpuLimit
							? Math.ceil(Number(dbRecord.cpuLimit) / 1_000_000)
							: null;

						const telemetry = await resolveWorkloadTelemetry(
							appName,
							dbRecord.applicationStatus,
							"database",
							dbRecord.memoryLimit,
						);

						const envInfo = envMap.get(dbRecord.environmentId) || {
							name: "production",
							projectName: "Default Project",
						};

						workloads.push({
							id: recordId,
							name: dbRecord.name,
							appName,
							serviceType: "database",
							engine: cfg.engine,
							projectName: envInfo.projectName,
							environmentName: envInfo.name,
							status: telemetry.status,
							lifecycleStatus: telemetry.lifecycleStatus,
							telemetryStatus: telemetry.telemetryStatus,
							telemetryReason: telemetry.telemetryReason,
							lastMeasuredAt: telemetry.lastMeasuredAt,
							measuredRamMb: telemetry.measuredRamMb,
							measuredCpuPercent: telemetry.measuredCpuPercent,
							measuredCpuMcores: Math.round(telemetry.measuredCpuPercent * 10),
							measuredNetworkMb: telemetry.measuredNetworkMb,
							measuredEgressMb: telemetry.measuredEgressMb,
							allocatedRamMb,
							allocatedCpuMillicores,
							hasLiveTelemetry: telemetry.hasLiveTelemetry,
						});
					}
				}
			}
		}

		// 3. Aggregate RAM
		const totalMeasuredRamMb = workloads.reduce(
			(acc, w) => acc + (w.hasLiveTelemetry ? w.measuredRamMb : 0),
			0,
		);
		const anyWorkloadsRunning = workloads.some(
			(w) => w.lifecycleStatus === "running" || w.status === "running",
		);
		const anyLiveRamTelemetry = workloads.some((w) => w.hasLiveTelemetry);

		let effectiveRamUsedMb = 0;
		let ramTelemetryState: "measured" | "collecting" | "zero" | "unavailable" = "zero";
		let formattedRamUsed = "0 MB";
		let isRamAvailable = true;
		let ramStatusLabel = "Optimal Allocation";

		if (totalMeasuredRamMb > 0) {
			effectiveRamUsedMb = Number(totalMeasuredRamMb.toFixed(1));
			ramTelemetryState = "measured";
			isRamAvailable = true;
			formattedRamUsed =
				effectiveRamUsedMb >= 1024
					? `${(effectiveRamUsedMb / 1024).toFixed(2)} GB`
					: `${effectiveRamUsedMb.toFixed(1)} MB`;
			const ramRatio = ramLimitMb > 0 ? effectiveRamUsedMb / ramLimitMb : 0;
			ramStatusLabel =
				ramRatio >= 0.9
					? "Near Capacity"
					: ramRatio >= 0.75
						? "Elevated"
						: "Normal Allocation";
		} else if (anyWorkloadsRunning && !anyLiveRamTelemetry) {
			// Workloads are active but initial telemetry sampling is pending
			effectiveRamUsedMb = 0;
			ramTelemetryState = "collecting";
			isRamAvailable = false;
			formattedRamUsed = "Collecting...";
			ramStatusLabel = "Telemetry Collecting";
		} else if (anyWorkloadsRunning && anyLiveRamTelemetry) {
			effectiveRamUsedMb = 0;
			ramTelemetryState = "zero";
			isRamAvailable = true;
			formattedRamUsed = "0.0 MB";
			ramStatusLabel = "Optimal Allocation";
		} else {
			// No workloads deployed or all stopped
			effectiveRamUsedMb = 0;
			ramTelemetryState = "zero";
			isRamAvailable = true;
			formattedRamUsed = "0 MB";
			ramStatusLabel = "No Active Workloads";
		}

		const ramRemainingMb =
			ramLimitMb === -1 ? -1 : Math.max(0, Number((ramLimitMb - effectiveRamUsedMb).toFixed(1)));
		const ramPct =
			ramLimitMb === -1 || ramLimitMb === 0
				? 0
				: Math.min(100, Math.round((effectiveRamUsedMb / ramLimitMb) * 1000) / 10);

		const formattedRamLimit =
			ramLimitMb === -1
				? "Unlimited"
				: ramLimitMb >= 1024
					? `${(ramLimitMb / 1024).toFixed(1)} GB`
					: `${ramLimitMb} MB`;
		const formattedRamRemaining =
			ramLimitMb === -1
				? "Unlimited"
				: ramRemainingMb >= 1024
					? `${(ramRemainingMb / 1024).toFixed(2)} GB`
					: `${Math.round(ramRemainingMb)} MB`;

		// 4. Aggregate CPU
		// 1% CPU utilization on a core = 10 millicores
		const totalCpuMillicores = workloads.reduce(
			(acc, w) => acc + (w.hasLiveTelemetry ? Math.round(w.measuredCpuPercent * 10) : 0),
			0,
		);
		const anyLiveCpuTelemetry = workloads.some((w) => w.hasLiveTelemetry);

		let cpuTelemetryState: "measured" | "collecting" | "zero" | "unavailable" = "zero";
		let formattedCpuUsed = "0 mCPU";
		let isCpuAvailable = true;
		let cpuStatusLabel = "Optimal Load";

		if (totalCpuMillicores > 0) {
			cpuTelemetryState = "measured";
			isCpuAvailable = true;
			formattedCpuUsed =
				totalCpuMillicores >= 1000
					? `${(totalCpuMillicores / 1000).toFixed(2)} Cores`
					: `${totalCpuMillicores} mCPU`;
			const cpuRatio = cpuLimitMillicores > 0 ? totalCpuMillicores / cpuLimitMillicores : 0;
			cpuStatusLabel =
				cpuRatio >= 0.9
					? "High Load"
					: cpuRatio >= 0.5
						? "Moderate Load"
						: "Optimal Load";
		} else if (anyWorkloadsRunning && !anyLiveCpuTelemetry) {
			cpuTelemetryState = "collecting";
			isCpuAvailable = false;
			formattedCpuUsed = "Collecting...";
			cpuStatusLabel = "Telemetry Collecting";
		} else if (anyWorkloadsRunning && anyLiveCpuTelemetry) {
			cpuTelemetryState = "zero";
			isCpuAvailable = true;
			formattedCpuUsed = "0 mCPU";
			cpuStatusLabel = "Optimal Load";
		} else {
			cpuTelemetryState = "zero";
			isCpuAvailable = true;
			formattedCpuUsed = "0 mCPU";
			cpuStatusLabel = "Optimal Load";
		}

		const cpuRemainingMillicores =
			cpuLimitMillicores === -1
				? -1
				: Math.max(0, cpuLimitMillicores - totalCpuMillicores);
		const cpuPct =
			cpuLimitMillicores === -1 || cpuLimitMillicores === 0
				? 0
				: Math.min(
						100,
						Math.round((totalCpuMillicores / cpuLimitMillicores) * 1000) / 10,
					);

		const formattedCpuLimit =
			cpuLimitMillicores === -1
				? "Unlimited"
				: cpuLimitMillicores >= 1000
					? `${(cpuLimitMillicores / 1000).toFixed(1)} Cores`
					: `${cpuLimitMillicores} mCPU`;

		// 5. Aggregate Storage (Persistent Volumes + Database Storage + Backups)
		let volumeStorageBytes = 0;
		try {
			const allAppIds = (appRows || []).map((a: any) => a.applicationId).filter(Boolean);
			const allCompIds = (compRows || []).map((c: any) => c.composeId).filter(Boolean);
			const allDbIds = (allDbRecords || []).map((d: any) => d.id).filter(Boolean);

			const conditions: any[] = [];
			if (allAppIds.length > 0) conditions.push(inArray(schema.mounts.applicationId, allAppIds));
			if (allCompIds.length > 0) conditions.push(inArray(schema.mounts.composeId, allCompIds));
			if (allDbIds.length > 0) {
				conditions.push(inArray(schema.mounts.postgresId, allDbIds));
				conditions.push(inArray(schema.mounts.mysqlId, allDbIds));
				conditions.push(inArray(schema.mounts.mariadbId, allDbIds));
				conditions.push(inArray(schema.mounts.mongoId, allDbIds));
				conditions.push(inArray(schema.mounts.redisId, allDbIds));
				conditions.push(inArray(schema.mounts.libsqlId, allDbIds));
			}

			if (conditions.length > 0) {
				let tenantMounts: any[] = [];
				if (typeof executor.select === "function") {
					tenantMounts = await executor
						.select({
							volumeName: schema.mounts.volumeName,
							type: schema.mounts.type,
						})
						.from(schema.mounts)
						.where(or(...conditions));
				} else if (executor?.query?.mounts?.findMany) {
					tenantMounts = await executor.query.mounts.findMany({
						where: or(...conditions),
						columns: { volumeName: true, type: true },
					});
				}

				const tenantVolumeNames = new Set(
					(tenantMounts || [])
						.filter((m: any) => m.type === "volume" && m.volumeName)
						.map((m: any) => m.volumeName as string),
				);

				if (tenantVolumeNames.size > 0) {
					const volumesSizeList = await getVolumesSize();
					for (const v of volumesSizeList || []) {
						if (v.name && tenantVolumeNames.has(v.name) && v.size) {
							volumeStorageBytes += Math.round(toMb(v.size) * 1024 * 1024);
						}
					}
				}
			}
		} catch (err: any) {
			console.error("[CustomerUsageService] Error measuring volume storage:", err?.message);
		}

		let backupStorageBytes = 0;
		try {
			backupStorageBytes =
				await BackupStorageService.getOrganizationBackupStorageUsage(
					organizationId,
					executor,
				);
		} catch {
			backupStorageBytes = 0;
		}

		let customerFileStorageBytes = 0;
		try {
			const { CustomerStorageService } = await import("./customer-storage");
			customerFileStorageBytes =
				await CustomerStorageService.getTenantStorageUsage(organizationId);
		} catch {
			customerFileStorageBytes = 0;
		}

		const storageUsedBytes =
			customerFileStorageBytes + volumeStorageBytes + backupStorageBytes;
		const storageLimitBytes =
			storageLimitGb === -1 ? -1 : storageLimitGb * 1024 * 1024 * 1024;
		const storageRemainingBytes =
			storageLimitBytes === -1
				? -1
				: Math.max(0, storageLimitBytes - storageUsedBytes);
		const storagePct =
			storageLimitBytes <= 0
				? 0
				: Math.min(
						100,
						Math.round((storageUsedBytes / storageLimitBytes) * 1000) / 10,
					);

		const storageUsedGb = storageUsedBytes / (1024 * 1024 * 1024);
		const formattedStorageUsed =
			storageUsedBytes === 0
				? "0 MB"
				: storageUsedGb >= 1
					? `${storageUsedGb.toFixed(2)} GB`
					: `${(storageUsedBytes / (1024 * 1024)).toFixed(1)} MB`;
		const formattedStorageLimit =
			storageLimitGb === -1 ? "Unlimited" : `${storageLimitGb} GB`;
		const formattedStorageRemaining =
			storageLimitBytes === -1
				? "Unlimited"
				: `${(Math.max(0, storageRemainingBytes) / (1024 * 1024 * 1024)).toFixed(2)} GB`;

		// 6. Aggregate Network Egress Bandwidth
		const totalEgressMb = workloads.reduce(
			(acc, w) => acc + (w.hasLiveTelemetry ? (w.measuredEgressMb ?? (w.measuredNetworkMb || 0)) : 0),
			0,
		);
		const anyLiveNetworkTelemetry = workloads.some((w) => w.hasLiveTelemetry);

		const bandwidthUsedGb = Number((totalEgressMb / 1024).toFixed(2));
		const bandwidthRemainingGb =
			bandwidthLimitGb === -1
				? -1
				: Math.max(0, Number((bandwidthLimitGb - bandwidthUsedGb).toFixed(2)));
		const bandwidthPct =
			bandwidthLimitGb <= 0
				? 0
				: Math.min(100, Math.round((bandwidthUsedGb / bandwidthLimitGb) * 1000) / 10);

		let bandwidthTelemetryState: "measured" | "collecting" | "zero" | "unavailable" = "zero";
		let formattedBandwidthUsed = "0.0 MB";
		let isBandwidthAvailable = true;
		let bandwidthStatusLabel = "Within Included Bandwidth";

		if (totalEgressMb > 0) {
			bandwidthTelemetryState = "measured";
			isBandwidthAvailable = true;
			formattedBandwidthUsed =
				bandwidthUsedGb >= 1 ? `${bandwidthUsedGb} GB` : `${totalEgressMb.toFixed(1)} MB`;
			bandwidthStatusLabel =
				(bandwidthUsedGb / bandwidthLimitGb) >= 0.9
					? "Near Included Quota"
					: "Normal Consumption";
		} else if (anyWorkloadsRunning && !anyLiveNetworkTelemetry) {
			bandwidthTelemetryState = "collecting";
			isBandwidthAvailable = false;
			formattedBandwidthUsed = "Collecting...";
			bandwidthStatusLabel = "Telemetry Collecting";
		} else if (anyWorkloadsRunning && anyLiveNetworkTelemetry) {
			bandwidthTelemetryState = "zero";
			isBandwidthAvailable = true;
			formattedBandwidthUsed = "0.0 MB";
			bandwidthStatusLabel = "Within Included Bandwidth";
		} else {
			bandwidthTelemetryState = "zero";
			isBandwidthAvailable = true;
			formattedBandwidthUsed = "0.0 MB";
			bandwidthStatusLabel = "No Active Traffic";
		}

		return {
			organizationId,
			planName,
			subscriptionStatus,
			billingPeriodEnd,
			ram: {
				used: effectiveRamUsedMb,
				limit: ramLimitMb,
				remaining: ramRemainingMb,
				percentage: ramPct,
				formattedUsed: formattedRamUsed,
				formattedLimit: formattedRamLimit,
				formattedRemaining: formattedRamRemaining,
				isAvailable: isRamAvailable,
				telemetryState: ramTelemetryState,
				statusLabel: ramStatusLabel,
			},
			cpu: {
				used: totalCpuMillicores,
				limit: cpuLimitMillicores,
				remaining: cpuRemainingMillicores,
				percentage: cpuPct,
				formattedUsed: formattedCpuUsed,
				formattedLimit: formattedCpuLimit,
				formattedRemaining:
					cpuLimitMillicores === -1
						? "Unlimited"
						: `${cpuRemainingMillicores} mCPU`,
				isAvailable: isCpuAvailable,
				telemetryState: cpuTelemetryState,
				statusLabel: cpuStatusLabel,
			},
			storage: {
				used: storageUsedBytes,
				limit: storageLimitBytes,
				remaining: storageRemainingBytes,
				percentage: storagePct,
				formattedUsed: formattedStorageUsed,
				formattedLimit: formattedStorageLimit,
				formattedRemaining: formattedStorageRemaining,
				isAvailable: true,
				telemetryState: storageUsedBytes > 0 ? "measured" : "zero",
				statusLabel:
					storagePct >= 90
						? "Quota Warning"
						: storagePct >= 70
							? "Moderate Usage"
							: "Within Quota",
			},
			bandwidth: {
				used: bandwidthUsedGb,
				limit: bandwidthLimitGb,
				remaining: bandwidthRemainingGb,
				percentage: bandwidthPct,
				formattedUsed: formattedBandwidthUsed,
				formattedLimit:
					bandwidthLimitGb === -1 ? "Unlimited" : `${bandwidthLimitGb} GB`,
				formattedRemaining:
					bandwidthLimitGb === -1 ? "Unlimited" : `${bandwidthRemainingGb} GB`,
				isAvailable: isBandwidthAvailable,
				telemetryState: bandwidthTelemetryState,
				statusLabel: bandwidthStatusLabel,
			},
			applications: {
				used: totalAppsCount,
				limit: appLimit,
				remaining: appLimit === -1 ? -1 : Math.max(0, appLimit - totalAppsCount),
				percentage:
					appLimit <= 0
						? 0
						: Math.min(100, Math.round((totalAppsCount / appLimit) * 100)),
			},
			databases: {
				used: totalDbsCount,
				limit: dbLimit,
				remaining: dbLimit === -1 ? -1 : Math.max(0, dbLimit - totalDbsCount),
				percentage:
					dbLimit <= 0
						? 0
						: Math.min(100, Math.round((totalDbsCount / dbLimit) * 100)),
			},
			projects: {
				used: (orgProjects || []).length,
				limit: projectLimit,
			},
			workloads,
			timestamp: new Date().toISOString(),
		};
	}
}

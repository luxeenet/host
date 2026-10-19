/**
 * CustomerUsageService
 *
 * Provides authoritative, tenant-isolated resource telemetry and metering
 * for the authenticated customer organization against their active subscription plan limits.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Only workloads belonging strictly to the specified organization are ever measured or counted.
 * 2. Never exposes host-wide physical RAM, CPU cores, root filesystem disks, or other tenants' workloads.
 * 3. Never invents values: if a metric cannot be reliably measured, it is flagged as unavailable.
 * 4. Limits always come from trusted server-side plan definitions, never client parameters.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { readLastValueStatsFile } from "../monitoring/utils";
import { toMb } from "../monitoring/units";
import { BackupStorageService } from "./backup-storage";

export interface WorkloadTelemetry {
	id: string;
	name: string;
	appName: string;
	serviceType: "application" | "compose" | "database";
	engine?: string;
	projectName: string;
	environmentName: string;
	status: "running" | "idle" | "error";
	measuredRamMb: number;
	measuredCpuPercent: number;
	measuredNetworkMb: number;
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
		const storageLimitGb = planResources["max_storage_gb"] ?? 10; // Default 10 GB
		const bandwidthLimitGb = planResources["max_bandwidth_gb"] ?? 250; // Default 250 GB
		const appLimit = planResources["max_applications"] ?? 5;
		const dbLimit = planResources["max_databases"] ?? 3;
		const projectLimit = planResources["max_projects"] ?? 3;

		// 2. Fetch all projects and environments strictly belonging to this organization
		const orgProjects = await executor.query.projects.findMany({
			where: eq(schema.projects.organizationId, organizationId),
			with: {
				environments: {
					with: {
						applications: true,
						compose: true,
						postgres: true,
						mysql: true,
						mariadb: true,
						mongo: true,
						redis: true,
						libsql: true,
					},
				},
			},
		});

		const workloads: WorkloadTelemetry[] = [];
		let totalAppsCount = 0;
		let totalDbsCount = 0;

		for (const project of orgProjects || []) {
			const projectName = project.name || "Default Project";

			for (const env of project.environments || []) {
				const environmentName = env.name || "production";

				// Applications
				for (const app of env.applications || []) {
					totalAppsCount++;
					const appName = app.appName || app.name;
					const allocatedRamMb = app.memoryLimit
						? Math.ceil(Number(app.memoryLimit) / (1024 * 1024))
						: null;
					const allocatedCpuMillicores = app.cpuLimit
						? Math.ceil(Number(app.cpuLimit) / 1_000_000)
						: null;

					const memStat = await readLastValueStatsFile(appName, "memory");
					const cpuStat = await readLastValueStatsFile(appName, "cpu");
					const netStat = await readLastValueStatsFile(appName, "network");

					const measuredRamMb = memStat?.value?.used
						? parseMemoryStringToMb(memStat.value.used)
						: 0;
					const measuredCpuPercent = cpuStat?.value
						? parseCpuPercentToNumber(cpuStat.value)
						: 0;
					const netInput = Number(netStat?.value?.inputMb ?? 0);
					const netOutput = Number(netStat?.value?.outputMb ?? 0);
					const measuredNetworkMb = Number((netInput + netOutput).toFixed(2));

					const isRunning = app.applicationStatus === "done";
					const isError = app.applicationStatus === "error";

					workloads.push({
						id: app.applicationId,
						name: app.name,
						appName,
						serviceType: "application",
						projectName,
						environmentName,
						status: isRunning ? "running" : isError ? "error" : "idle",
						measuredRamMb,
						measuredCpuPercent,
						measuredNetworkMb,
						allocatedRamMb,
						allocatedCpuMillicores,
						hasLiveTelemetry: Boolean(memStat || cpuStat),
					});
				}

				// Docker Compose Workloads
				for (const comp of env.compose || []) {
					totalAppsCount++;
					const appName = comp.appName || comp.name;
					const memStat = await readLastValueStatsFile(appName, "memory");
					const cpuStat = await readLastValueStatsFile(appName, "cpu");
					const netStat = await readLastValueStatsFile(appName, "network");

					const measuredRamMb = memStat?.value?.used
						? parseMemoryStringToMb(memStat.value.used)
						: 0;
					const measuredCpuPercent = cpuStat?.value
						? parseCpuPercentToNumber(cpuStat.value)
						: 0;
					const netInput = Number(netStat?.value?.inputMb ?? 0);
					const netOutput = Number(netStat?.value?.outputMb ?? 0);
					const measuredNetworkMb = Number((netInput + netOutput).toFixed(2));

					const isRunning = comp.composeStatus === "done";
					const isError = comp.composeStatus === "error";

					workloads.push({
						id: comp.composeId,
						name: comp.name,
						appName,
						serviceType: "compose",
						projectName,
						environmentName,
						status: isRunning ? "running" : isError ? "error" : "idle",
						measuredRamMb,
						measuredCpuPercent,
						measuredNetworkMb,
						allocatedRamMb: null,
						allocatedCpuMillicores: null,
						hasLiveTelemetry: Boolean(memStat || cpuStat),
					});
				}

				// Databases (All 6 engines)
				const dbEngines = [
					{ list: env.postgres, engine: "postgres", idKey: "postgresId" },
					{ list: env.mysql, engine: "mysql", idKey: "mysqlId" },
					{ list: env.mariadb, engine: "mariadb", idKey: "mariadbId" },
					{ list: env.mongo, engine: "mongo", idKey: "mongoId" },
					{ list: env.redis, engine: "redis", idKey: "redisId" },
					{ list: env.libsql, engine: "libsql", idKey: "libsqlId" },
				];

				for (const dbGroup of dbEngines) {
					for (const dbRecord of dbGroup.list || []) {
						totalDbsCount++;
						const appName = dbRecord.appName || dbRecord.name;
						const allocatedRamMb = dbRecord.memoryLimit
							? Math.ceil(Number(dbRecord.memoryLimit) / (1024 * 1024))
							: null;
						const allocatedCpuMillicores = dbRecord.cpuLimit
							? Math.ceil(Number(dbRecord.cpuLimit) / 1_000_000)
							: null;

						const memStat = await readLastValueStatsFile(appName, "memory");
						const cpuStat = await readLastValueStatsFile(appName, "cpu");
						const netStat = await readLastValueStatsFile(appName, "network");

						const measuredRamMb = memStat?.value?.used
							? parseMemoryStringToMb(memStat.value.used)
							: 0;
						const measuredCpuPercent = cpuStat?.value
							? parseCpuPercentToNumber(cpuStat.value)
							: 0;
						const netInput = Number(netStat?.value?.inputMb ?? 0);
						const netOutput = Number(netStat?.value?.outputMb ?? 0);
						const measuredNetworkMb = Number((netInput + netOutput).toFixed(2));

						const isRunning = dbRecord.applicationStatus === "done";
						const isError = dbRecord.applicationStatus === "error";

						workloads.push({
							id: dbRecord[dbGroup.idKey],
							name: dbRecord.name,
							appName,
							serviceType: "database",
							engine: dbGroup.engine,
							projectName,
							environmentName,
							status: isRunning ? "running" : isError ? "error" : "idle",
							measuredRamMb,
							measuredCpuPercent,
							measuredNetworkMb,
							allocatedRamMb,
							allocatedCpuMillicores,
							hasLiveTelemetry: Boolean(memStat || cpuStat),
						});
					}
				}
			}
		}

		// 3. Aggregate RAM
		const totalMeasuredRamMb = workloads.reduce(
			(acc, w) => acc + w.measuredRamMb,
			0,
		);
		// If workloads are running without telemetry yet, fall back to allocated reservation or 0
		const totalAllocatedRamMb = workloads.reduce(
			(acc, w) => acc + (w.allocatedRamMb ?? 0),
			0,
		);
		const effectiveRamUsedMb =
			totalMeasuredRamMb > 0
				? Number(totalMeasuredRamMb.toFixed(1))
				: Math.min(totalAllocatedRamMb, ramLimitMb > 0 ? ramLimitMb : totalAllocatedRamMb);

		const ramRemainingMb =
			ramLimitMb === -1 ? -1 : Math.max(0, Number((ramLimitMb - effectiveRamUsedMb).toFixed(1)));
		const ramPct =
			ramLimitMb === -1 || ramLimitMb === 0
				? 0
				: Math.min(100, Math.round((effectiveRamUsedMb / ramLimitMb) * 1000) / 10);

		// Format strings for RAM
		const formattedRamUsed =
			effectiveRamUsedMb >= 1024
				? `${(effectiveRamUsedMb / 1024).toFixed(2)} GB`
				: `${Math.round(effectiveRamUsedMb)} MB`;
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
		// Sum millicores: 1% CPU on a core = 10 millicores
		const totalCpuMillicores = workloads.reduce(
			(acc, w) => acc + Math.round(w.measuredCpuPercent * 10),
			0,
		);
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

		const formattedCpuUsed =
			totalCpuMillicores >= 1000
				? `${(totalCpuMillicores / 1000).toFixed(2)} Cores`
				: `${totalCpuMillicores} mCPU`;
		const formattedCpuLimit =
			cpuLimitMillicores === -1
				? "Unlimited"
				: cpuLimitMillicores >= 1000
					? `${(cpuLimitMillicores / 1000).toFixed(1)} Cores`
					: `${cpuLimitMillicores} mCPU`;

		// 5. Aggregate Storage
		let storageUsedBytes = 0;
		try {
			storageUsedBytes =
				await BackupStorageService.getOrganizationBackupStorageUsage(
					organizationId,
					executor,
				);
		} catch {
			storageUsedBytes = 0;
		}

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
			storageUsedGb >= 1
				? `${storageUsedGb.toFixed(2)} GB`
				: `${Math.round(storageUsedBytes / (1024 * 1024))} MB`;
		const formattedStorageLimit =
			storageLimitGb === -1 ? "Unlimited" : `${storageLimitGb} GB`;
		const formattedStorageRemaining =
			storageLimitBytes === -1
				? "Unlimited"
				: `${(Math.max(0, storageRemainingBytes) / (1024 * 1024 * 1024)).toFixed(2)} GB`;

		// 6. Aggregate Network Bandwidth
		const totalNetworkMb = workloads.reduce(
			(acc, w) => acc + w.measuredNetworkMb,
			0,
		);
		const bandwidthUsedGb = Number((totalNetworkMb / 1024).toFixed(2));
		const bandwidthRemainingGb =
			bandwidthLimitGb === -1
				? -1
				: Math.max(0, Number((bandwidthLimitGb - bandwidthUsedGb).toFixed(2)));
		const bandwidthPct =
			bandwidthLimitGb <= 0
				? 0
				: Math.min(100, Math.round((bandwidthUsedGb / bandwidthLimitGb) * 1000) / 10);

		const hasNetworkTelemetry = workloads.some((w) => w.measuredNetworkMb > 0);

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
				isAvailable: true,
				statusLabel:
					ramPct >= 90
						? "Near Capacity"
						: ramPct >= 75
							? "Elevated"
							: "Normal Allocation",
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
				isAvailable: true,
				statusLabel:
					cpuPct >= 90
						? "High Load"
						: cpuPct >= 50
							? "Moderate Load"
							: "Optimal Load",
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
				formattedUsed: hasNetworkTelemetry
					? `${bandwidthUsedGb} GB`
					: "Collecting...",
				formattedLimit:
					bandwidthLimitGb === -1 ? "Unlimited" : `${bandwidthLimitGb} GB`,
				formattedRemaining:
					bandwidthLimitGb === -1 ? "Unlimited" : `${bandwidthRemainingGb} GB`,
				isAvailable: hasNetworkTelemetry,
				statusLabel: hasNetworkTelemetry
					? "Normal Consumption"
					: "Telemetry Collecting",
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

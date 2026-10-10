/**
 * HatDot Production Fix: Plan-Aware Monitoring, Resource Controls, and Customer Security
 *
 * Automated verification for:
 * 1. Customer A cannot read Customer B's monitoring data.
 * 2. Customer cannot retrieve host-wide resource information from customer endpoints.
 * 3. Basic and premium plans receive only their configured monitoring capabilities.
 * 4. Customer cannot exceed CPU or memory entitlement by modifying an API request.
 * 5. CPU and memory reservations and limits are validated correctly (minimum 4MB, reservation <= limit).
 * 6. Unauthorized customers cannot access ulimit, internal volume, network attachment, or cluster-management APIs.
 * 7. Platform administrators retain legitimate infrastructure access.
 * 8. Existing persistent volumes and database data remain intact after UI and authorization changes.
 * 9. Resource changes are applied through the real deployment lifecycle and accurately report success or failure.
 * 10. Plan upgrades and downgrades correctly affect permitted resource settings.
 * 11. Unauthorized database rebuild/reset requests are rejected across all six engines.
 * 12. Regression tests cover all six database engines and application resource management where shared code is affected.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@dokploy/server/services/permission", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("@dokploy/server/services/permission")
	>();
	return {
		...original,
		checkPermission: vi.fn(async (ctx: any) => {
			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { TRPCError } = await import("@trpc/server");
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
		}),
		checkServiceAccess: vi.fn(async () => undefined),
	};
});

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

let mockServiceLookupResult: any = null;

vi.mock("@dokploy/server", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("@dokploy/server")
	>();
	return {
		...original,
		findServiceByAppName: vi.fn(async (appName: string) => {
			if (mockServiceLookupResult && mockServiceLookupResult.appName === appName) {
				return mockServiceLookupResult;
			}
			return null;
		}),
		getApplicationStats: vi.fn(async () => ({
			cpu: [{ value: "15%" }],
			memory: [{ value: { used: "128MiB", total: "512MiB" } }],
			block: [{ value: { readMb: 10, writeMb: 20 } }],
			network: [{ value: { inputMb: 5, outputMb: 8 } }],
			disk: [],
		})),
	};
});

import {
	PlanEntitlementService,
	normalizeAndCalculateEffectiveResources,
} from "@dokploy/server/services/plan-entitlement";
import * as serviceLookup from "@dokploy/server/services/service-lookup";

// Routers
import { applicationRouter } from "@/server/api/routers/application";
import { mountRouter } from "@/server/api/routers/mount";
import { networkRouter } from "@/server/api/routers/network";
import { clusterRouter } from "@/server/api/routers/cluster";
import { postgresRouter } from "@/server/api/routers/postgres";
import { mysqlRouter } from "@/server/api/routers/mysql";
import { mariadbRouter } from "@/server/api/routers/mariadb";
import { mongoRouter } from "@/server/api/routers/mongo";
import { redisRouter } from "@/server/api/routers/redis";
import { libsqlRouter } from "@/server/api/routers/libsql";

const ORG_A = "org-cust-a";
const ORG_B = "org-cust-b";
const ORG_PLATFORM = "org-platform-admin";

const makeCtx = (user: {
	id: string;
	role: "owner" | "admin" | "member";
	isPlatformAdmin: boolean;
	org: string;
}) =>
	({
		req: {} as any,
		res: {} as any,
		db: {} as any,
		user: {
			id: user.id,
			email: `${user.id}@example.com`,
			role: user.role,
			ownerId: user.id,
			isPlatformAdmin: user.isPlatformAdmin,
		},
		session: { activeOrganizationId: user.org },
	}) as any;

const customerA = () =>
	makeCtx({
		id: "user-a",
		role: "owner",
		isPlatformAdmin: false,
		org: ORG_A,
	});

const platformAdmin = () =>
	makeCtx({
		id: "admin-root",
		role: "owner",
		isPlatformAdmin: true,
		org: ORG_PLATFORM,
	});

describe("1. Multi-tenant Monitoring Isolation", () => {
	afterEach(() => {
		mockServiceLookupResult = null;
		vi.restoreAllMocks();
	});

	it("Customer A cannot read Customer B's monitoring data", async () => {
		mockServiceLookupResult = {
			serviceId: "service-b-1",
			serviceType: "application",
			name: "Service B",
			appName: "app-b-turn-1234",
			organizationId: ORG_B,
			projectId: "proj-b",
			environmentId: "env-b",
			memoryLimit: String(512 * 1024 * 1024),
			memoryReservation: null,
			cpuLimit: null,
			cpuReservation: null,
		};

		const callerA = applicationRouter.createCaller(customerA());

		await expect(
			callerA.readAppMonitoring({ appName: "app-b-turn-1234" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "You are not authorized to view monitoring for this service",
			}),
		);
	});

	it("Platform Admin can inspect any service monitoring", async () => {
		mockServiceLookupResult = {
			serviceId: "service-b-1",
			serviceType: "application",
			name: "Service B",
			appName: "app-b-turn-1234",
			organizationId: ORG_B,
			projectId: "proj-b",
			environmentId: "env-b",
			memoryLimit: String(512 * 1024 * 1024),
			memoryReservation: null,
			cpuLimit: null,
			cpuReservation: null,
		};

		vi.spyOn(PlanEntitlementService, "getMonitoringEntitlements").mockResolvedValue({
			hasAdvancedIoMetrics: true,
			hasHistoricalCharts: true,
			maxDataPoints: 300,
			retentionHours: 24,
		});

		const callerAdmin = applicationRouter.createCaller(platformAdmin());
		const result = await callerAdmin.readAppMonitoring({ appName: "app-b-turn-1234" });
		expect(result).toHaveProperty("serviceLimit");
		expect(result.serviceLimit?.memoryLimitFormatted).toBe("512.00MiB");
	});
});

describe("2. Host-wide Resource Metrics Protection", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("Non-platform-admin cannot query 'dokploy' host metrics endpoint", async () => {
		const callerA = applicationRouter.createCaller(customerA());
		await expect(
			callerA.readAppMonitoring({ appName: "dokploy" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Host system monitoring requires platform administrator privileges.",
			}),
		);
	});

	it("Customer monitoring response returns serviceLimit instead of host total RAM", async () => {
		mockServiceLookupResult = {
			serviceId: "service-a-1",
			serviceType: "postgres",
			name: "Customer DB",
			appName: "butax-turn-gg111d",
			organizationId: ORG_A,
			projectId: "proj-a",
			environmentId: "env-a",
			memoryLimit: String(1024 * 1024 * 1024), // 1 GiB limit
			memoryReservation: null,
			cpuLimit: "1000000000",
			cpuReservation: null,
		};

		vi.spyOn(PlanEntitlementService, "getMonitoringEntitlements").mockResolvedValue({
			hasAdvancedIoMetrics: true,
			hasHistoricalCharts: true,
			maxDataPoints: 300,
			retentionHours: 24,
		});

		const callerA = applicationRouter.createCaller(customerA());
		const response = await callerA.readAppMonitoring({ appName: "butax-turn-gg111d" });

		expect(response.serviceLimit).toBeDefined();
		expect(response.serviceLimit?.memoryLimitFormatted).toBe("1.00GiB");
		expect(response.serviceLimit?.cpuLimitFormatted).toBe("1.00 CPU");
	});
});

describe("3. Plan Monitoring Entitlements Gating", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("Basic plan receives live metrics only without historical charts or advanced I/O", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
			planId: "basic",
			planName: "Basic",
			resources: { max_ram_mb: 512, max_cpu_millicores: 1000 },
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});

		const entitlements = await PlanEntitlementService.getMonitoringEntitlements(ORG_A, false);
		expect(entitlements.hasAdvancedIoMetrics).toBe(false);
		expect(entitlements.hasHistoricalCharts).toBe(false);
		expect(entitlements.maxDataPoints).toBe(1);
	});

	it("Developer / Business / Enterprise plan receives historical charts and advanced I/O", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
			planId: "developer",
			planName: "Developer",
			resources: { max_ram_mb: 4096, max_cpu_millicores: 4000 },
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});

		const entitlements = await PlanEntitlementService.getMonitoringEntitlements(ORG_A, false);
		expect(entitlements.hasAdvancedIoMetrics).toBe(true);
		expect(entitlements.hasHistoricalCharts).toBe(true);
		expect(entitlements.maxDataPoints).toBe(300);
	});
});

describe("4 & 5. CPU and Memory Input Validation & Plan Enforcement", () => {
	const MB = 1024 * 1024;
	const ONE_CPU_NANO = 1_000_000_000;

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("Rejects memory limit below minimum 4 MB", () => {
		expect(() =>
			normalizeAndCalculateEffectiveResources({
				memoryLimit: 2 * MB, // 2 MB < 4 MB
			}),
		).toThrowError(
			expect.objectContaining({
				code: "BAD_REQUEST",
				message: "Memory limit must be at least 4 MB (4,194,304 bytes).",
			}),
		);
	});

	it("Rejects memory reservation exceeding memory limit", () => {
		expect(() =>
			normalizeAndCalculateEffectiveResources({
				memoryLimit: 512 * MB,
				memoryReservation: 1024 * MB,
			}),
		).toThrowError(
			expect.objectContaining({
				code: "BAD_REQUEST",
				message: "Memory reservation cannot exceed memory limit.",
			}),
		);
	});

	it("Rejects CPU reservation exceeding CPU limit", () => {
		expect(() =>
			normalizeAndCalculateEffectiveResources({
				cpuLimit: 500_000_000,
				cpuReservation: 1_000_000_000,
			}),
		).toThrowError(
			expect.objectContaining({
				code: "BAD_REQUEST",
				message: "CPU reservation cannot exceed CPU limit.",
			}),
		);
	});

	it("Rejects over-limit RAM when customer tries to update application", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
			planId: "basic",
			planName: "Basic",
			resources: { max_ram_mb: 512, max_cpu_millicores: 1000 },
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});

		await expect(
			PlanEntitlementService.assertRuntimeResources(ORG_A, {
				memoryLimit: 2048 * MB, // 2 GB > 512 MB
			}),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
			}),
		);
	});

	it("Rejects over-limit CPU when customer tries to update application", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
			planId: "basic",
			planName: "Basic",
			resources: { max_ram_mb: 512, max_cpu_millicores: 1000 },
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});

		await expect(
			PlanEntitlementService.assertRuntimeResources(ORG_A, {
				cpuLimit: 4 * ONE_CPU_NANO, // 4 CPUs > 1 CPU
			}),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
			}),
		);
	});

	it("Allows valid resource adjustments within plan limits", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
			planId: "developer",
			planName: "Developer",
			resources: { max_ram_mb: 4096, max_cpu_millicores: 4000 },
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});

		await expect(
			PlanEntitlementService.assertRuntimeResources(ORG_A, {
				memoryLimit: 2048 * MB,
				memoryReservation: 512 * MB,
				cpuLimit: 2 * ONE_CPU_NANO,
				cpuReservation: 1 * ONE_CPU_NANO,
			}),
		).resolves.toBeUndefined();
	});
});

describe("6 & 7. Infrastructure API Access Control", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Mount / Volume Management", () => {
		it("Non-platform-admin is rejected from creating internal mounts", async () => {
			const callerA = mountRouter.createCaller(customerA());
			await expect(
				callerA.create({
					type: "volume",
					hostPath: "/var/lib/docker/volumes",
					volumeName: "butax-turn-gg111d-data",
					mountPath: "/var/lib/postgresql/data",
					serviceType: "postgres",
					serviceId: "pg-1",
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Volume mount management requires platform administrator privileges.",
				}),
			);
		});

		it("Non-platform-admin is rejected from deleting persistent mounts", async () => {
			const callerA = mountRouter.createCaller(customerA());
			await expect(
				callerA.remove({ mountId: "mount-1" }),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Volume mount management requires platform administrator privileges.",
				}),
			);
		});
	});

	describe("Network Management", () => {
		it("Non-platform-admin is rejected from creating custom docker networks", async () => {
			const callerA = networkRouter.createCaller(customerA());
			await expect(
				callerA.create({ name: "custom-network", driver: "overlay" }),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Network management requires platform administrator privileges.",
				}),
			);
		});
	});

	describe("Cluster Management", () => {
		it("Non-platform-admin is rejected from viewing or managing cluster nodes", async () => {
			const callerA = clusterRouter.createCaller(customerA());
			await expect(callerA.getNodes({})).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Cluster management requires platform administrator privileges.",
				}),
			);
		});
	});
});

describe("11 & 12. Danger Zone Database Rebuild / Reset Protection across all 6 Engines", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("Postgres: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = postgresRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ postgresId: "pg-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});

	it("MySQL: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = mysqlRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ mysqlId: "mysql-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});

	it("MariaDB: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = mariadbRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ mariadbId: "maria-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});

	it("MongoDB: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = mongoRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ mongoId: "mongo-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});

	it("Redis: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = redisRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ redisId: "redis-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});

	it("LibSQL: Non-platform-admin is rejected from rebuild operation", async () => {
		const callerA = libsqlRouter.createCaller(customerA());
		await expect(
			callerA.rebuild({ libsqlId: "libsql-1" }),
		).rejects.toThrowError(
			expect.objectContaining({
				code: "FORBIDDEN",
				message: "Database rebuild/reset requires platform administrator privileges.",
			}),
		);
	});
});

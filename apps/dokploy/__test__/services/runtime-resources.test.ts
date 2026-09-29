import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
	PlanEntitlementService,
	normalizeAndCalculateEffectiveResources,
	parseAndValidateResourceValue,
} from "@dokploy/server/services/plan-entitlement";

describe("Runtime Resource Normalization and Validation", () => {
	describe("parseAndValidateResourceValue", () => {
		it("should return undefined for null, undefined, or empty string", () => {
			expect(parseAndValidateResourceValue(undefined, "memoryLimit")).toBeUndefined();
			expect(parseAndValidateResourceValue(null, "memoryLimit")).toBeUndefined();
			expect(parseAndValidateResourceValue("", "memoryLimit")).toBeUndefined();
			expect(parseAndValidateResourceValue("   ", "memoryLimit")).toBeUndefined();
		});

		it("should parse valid numbers and numeric strings", () => {
			expect(parseAndValidateResourceValue(536870912, "memoryLimit")).toBe(536870912);
			expect(parseAndValidateResourceValue("536870912", "memoryLimit")).toBe(536870912);
			expect(parseAndValidateResourceValue("1000000000", "cpuLimit")).toBe(1000000000);
			expect(parseAndValidateResourceValue(0, "memoryLimit")).toBe(0);
			expect(parseAndValidateResourceValue("0", "memoryLimit")).toBe(0);
		});

		it("should reject non-numeric strings with BAD_REQUEST", () => {
			expect(() => parseAndValidateResourceValue("abc", "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("123abc", "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("12.34.56", "memoryLimit")).toThrow(
				TRPCError,
			);
		});

		it("should reject NaN, Infinity, -Infinity", () => {
			expect(() => parseAndValidateResourceValue(Number.NaN, "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("NaN", "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue(Infinity, "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("Infinity", "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue(-Infinity, "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("-Infinity", "memoryLimit")).toThrow(
				TRPCError,
			);
		});

		it("should reject negative values", () => {
			expect(() => parseAndValidateResourceValue(-1, "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue("-500", "memoryLimit")).toThrow(
				TRPCError,
			);
		});

		it("should reject unsafe numbers", () => {
			expect(() =>
				parseAndValidateResourceValue(Number.MAX_SAFE_INTEGER + 1000, "memoryLimit"),
			).toThrow(TRPCError);
		});

		it("should reject non-number/non-string types", () => {
			expect(() => parseAndValidateResourceValue(true, "memoryLimit")).toThrow(
				TRPCError,
			);
			expect(() => parseAndValidateResourceValue({}, "memoryLimit")).toThrow(
				TRPCError,
			);
		});
	});

	describe("normalizeAndCalculateEffectiveResources", () => {
		const MB = 1024 * 1024;
		const ONE_CPU_NANO = 1_000_000_000;

		it("should return undefined effective values when neither limit nor reservation is provided", () => {
			const result = normalizeAndCalculateEffectiveResources({});
			expect(result.effectiveRamMb).toBeUndefined();
			expect(result.effectiveCpuMillicores).toBeUndefined();
		});

		it("should calculate effective RAM when only limit exists", () => {
			const result = normalizeAndCalculateEffectiveResources({
				memoryLimit: 512 * MB,
			});
			expect(result.effectiveRamMb).toBe(512);
			expect(result.effectiveCpuMillicores).toBeUndefined();
		});

		it("should calculate effective RAM when only reservation exists", () => {
			const result = normalizeAndCalculateEffectiveResources({
				memoryReservation: 1024 * MB,
			});
			expect(result.effectiveRamMb).toBe(1024);
		});

		it("should calculate effective RAM using ceiling of Docker bytes", () => {
			const result = normalizeAndCalculateEffectiveResources({
				memoryLimit: 512 * MB + 1, // 512 MB + 1 byte -> 513 MB
			});
			expect(result.effectiveRamMb).toBe(513);
		});

		it("should calculate effective CPU when only limit exists", () => {
			const result = normalizeAndCalculateEffectiveResources({
				cpuLimit: 500_000_000, // 0.5 CPU = 500 mCPU
			});
			expect(result.effectiveCpuMillicores).toBe(500);
		});

		it("should calculate effective CPU when only reservation exists", () => {
			const result = normalizeAndCalculateEffectiveResources({
				cpuReservation: 1500_000_000, // 1.5 CPU = 1500 mCPU
			});
			expect(result.effectiveCpuMillicores).toBe(1500);
		});

		it("should calculate effective CPU using ceiling of Docker NanoCPUs", () => {
			const result = normalizeAndCalculateEffectiveResources({
				cpuLimit: 1_000_000_001, // 1000 mCPU + 1 nanoCPU -> 1001 mCPU
			});
			expect(result.effectiveCpuMillicores).toBe(1001);
		});

		it("should choose limit when both exist and limit is greater", () => {
			const result = normalizeAndCalculateEffectiveResources({
				memoryLimit: 2048 * MB,
				memoryReservation: 512 * MB,
				cpuLimit: 2 * ONE_CPU_NANO, // 2000 mCPU
				cpuReservation: 0.5 * ONE_CPU_NANO, // 500 mCPU
			});
			expect(result.effectiveRamMb).toBe(2048);
			expect(result.effectiveCpuMillicores).toBe(2000);
		});

		it("should choose reservation when both exist and reservation is greater", () => {
			const result = normalizeAndCalculateEffectiveResources({
				memoryLimit: 512 * MB,
				memoryReservation: 2048 * MB,
				cpuLimit: 500_000_000, // 500 mCPU
				cpuReservation: 1500_000_000, // 1500 mCPU
			});
			expect(result.effectiveRamMb).toBe(2048);
			expect(result.effectiveCpuMillicores).toBe(1500);
		});
	});

	describe("PlanEntitlementService runtime checks", () => {
		const MB = 1024 * 1024;
		const ONE_CPU_NANO = 1_000_000_000;

		it("should allow any resource on unlimited plan (-1)", async () => {
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "unlimited",
				planName: "Unlimited",
				resources: {
					max_ram_mb: -1,
					max_cpu_millicores: -1,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			const check = await PlanEntitlementService.checkRuntimeResources(
				"org-1",
				65536, // 64 GB
				32000, // 32 CPUs
			);
			expect(check.allowed).toBe(true);
		});

		it("should allow resources within plan limits", async () => {
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_ram_mb: 1024,
					max_cpu_millicores: 1000,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			const check = await PlanEntitlementService.checkRuntimeResources(
				"org-1",
				512,
				500,
			);
			expect(check.allowed).toBe(true);
		});

		it("should reject when memoryLimit exceeds plan limit", async () => {
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_ram_mb: 512,
					max_cpu_millicores: 1000,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			await expect(
				PlanEntitlementService.assertRuntimeResources("org-1", {
					memoryLimit: 1024 * MB,
				}),
			).rejects.toThrow(TRPCError);
		});

		it("should reject when memoryReservation exceeds plan limit even if memoryLimit is within plan", async () => {
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_ram_mb: 512,
					max_cpu_millicores: 1000,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			// User provides memoryLimit = 512 MB (within plan), but memoryReservation = 2048 MB (exceeds plan)
			await expect(
				PlanEntitlementService.assertRuntimeResources("org-1", {
					memoryLimit: 512 * MB,
					memoryReservation: 2048 * MB,
				}),
			).rejects.toThrow(TRPCError);
		});

		it("should reject when cpuReservation exceeds plan limit even if cpuLimit is within plan", async () => {
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_ram_mb: 1024,
					max_cpu_millicores: 1000,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			// User provides cpuLimit = 500 mCPU, cpuReservation = 1500 mCPU
			await expect(
				PlanEntitlementService.assertRuntimeResources("org-1", {
					cpuLimit: 500_000_000,
					cpuReservation: 1500_000_000,
				}),
			).rejects.toThrow(TRPCError);
		});

		it("should reject deployment if existing resources exceed downgraded plan limits", async () => {
			// Existing resource was created under a higher plan (2048 MB RAM)
			const existingApp = {
				memoryLimit: String(2048 * MB),
				memoryReservation: String(1024 * MB),
			};

			// Customer has downgraded to Starter (512 MB RAM)
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_ram_mb: 512,
					max_cpu_millicores: 1000,
				},
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			// On deployment, existingApp resources are checked and must be rejected
			await expect(
				PlanEntitlementService.assertRuntimeResources("org-1", existingApp),
			).rejects.toThrow(TRPCError);
		});
	});
});

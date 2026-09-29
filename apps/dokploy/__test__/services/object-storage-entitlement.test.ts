import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";

describe("Object Storage Entitlement Enforcement", () => {
	const GB = 1024 * 1024 * 1024;
	const MB = 1024 * 1024;

	it("Case A — Below limit: Current 5GB + Upload 2GB on 10GB limit is allowed", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "pro",
			planName: "Pro",
			resources: {
				max_storage_gb: 10,
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		const check = await PlanEntitlementService.checkObjectStorageCapacity(
			"org-1",
			2 * GB, // 2 GB upload
			5 * GB, // 5 GB current
			"max_storage_gb",
		);

		expect(check.allowed).toBe(true);
		expect(check.current).toBe(7 * GB);
		expect(check.limit).toBe(10 * GB);
	});

	it("Case B — Exactly at limit: Current 8GB + Upload 2GB on 10GB limit is allowed", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "pro",
			planName: "Pro",
			resources: {
				max_storage_gb: 10,
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		const check = await PlanEntitlementService.checkObjectStorageCapacity(
			"org-1",
			2 * GB, // 2 GB upload
			8 * GB, // 8 GB current
			"max_storage_gb",
		);

		expect(check.allowed).toBe(true);
		expect(check.current).toBe(10 * GB);
		expect(check.limit).toBe(10 * GB);
	});

	it("Case C — Exceeds limit: Current 8GB + Upload 3GB on 10GB limit is rejected with FORBIDDEN", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "pro",
			planName: "Pro",
			resources: {
				max_storage_gb: 10,
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		await expect(
			PlanEntitlementService.assertObjectStorageCapacity(
				"org-1",
				3 * GB, // 3 GB upload
				8 * GB, // 8 GB current
				"max_storage_gb",
			),
		).rejects.toThrow(TRPCError);
	});

	it("Case D — Unlimited: Large upload on unlimited plan (-1) is allowed", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "enterprise",
			planName: "Enterprise",
			resources: {
				max_storage_gb: -1,
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		const check = await PlanEntitlementService.checkObjectStorageCapacity(
			"org-1",
			500 * GB, // 500 GB upload
			1000 * GB, // 1000 GB current
			"max_storage_gb",
		);

		expect(check.allowed).toBe(true);
		expect(check.limit).toBe(-1);
	});

	it("Case E — Replacement upload: 700MB replacing 500MB (delta +200MB) checks delta", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "basic",
			planName: "Basic",
			resources: {
				max_storage_gb: 5, // 5 GB limit
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		const existingSize = 500 * MB;
		const newSize = 700 * MB;
		const delta = newSize - existingSize; // +200 MB
		const currentUsage = 4.9 * GB; // 4.9 GB out of 5 GB

		// Delta of 200 MB on 4.9 GB = 5.1 GB (exceeds 5 GB)
		await expect(
			PlanEntitlementService.assertObjectStorageCapacity(
				"org-1",
				delta,
				currentUsage,
				"max_storage_gb",
			),
		).rejects.toThrow(TRPCError);
	});

	it("Case F — Delete/Reduction: Current 5GB and deleting 2GB (delta -2GB) is allowed", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "starter",
			planName: "Starter",
			resources: {
				max_storage_gb: 1, // Plan is over quota
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		const check = await PlanEntitlementService.checkObjectStorageCapacity(
			"org-1",
			-2 * GB, // deleting 2 GB
			5 * GB, // current 5 GB
			"max_storage_gb",
		);

		expect(check.allowed).toBe(true);
		expect(check.current).toBe(3 * GB);
	});

	it("Case G — Dedicated backup storage quota (backup_storage_gb) is checked correctly", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValueOnce({
			planId: "developer",
			planName: "Developer",
			resources: {
				max_storage_gb: 20,
				backup_storage_gb: 10,
			},
			features: {},
			applicationTypes: [],
			subscriptionStatus: "active",
		});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValueOnce({
			allowed: true,
		});

		// 12 GB backup exceeds 10 GB backup_storage_gb
		await expect(
			PlanEntitlementService.assertObjectStorageCapacity(
				"org-1",
				12 * GB,
				0,
				"backup_storage_gb",
			),
		).rejects.toThrow(TRPCError);
	});
});

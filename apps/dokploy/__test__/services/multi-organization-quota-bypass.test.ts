import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import { CustomerUsageService } from "@dokploy/server/services/customer-usage";

describe("Multi-Organization Quota Bypass & Usage Protection", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe("1. Organization Creation Limits by Plan Tier", () => {
		it("blocks a Free / Starter user from creating a second organization", async () => {
			const mockExecutor = {
				query: {
					user: {
						findFirst: vi.fn().mockResolvedValue({ id: "user-1", isPlatformAdmin: false }),
					},
					organization: {
						findMany: vi.fn().mockResolvedValue([
							{ id: "org-1", ownerId: "user-1", name: "Personal Workspace" },
						]),
					},
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue(null), // Free tier / no active sub
					},
				},
			};

			const result = await PlanEntitlementService.checkCanCreateOrganization("user-1", mockExecutor);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("maximum of 1 organization");
		});

		it("allows a Pro plan user to create up to 3 organizations", async () => {
			const mockExecutor = {
				query: {
					user: {
						findFirst: vi.fn().mockResolvedValue({ id: "user-pro", isPlatformAdmin: false }),
					},
					organization: {
						findMany: vi.fn().mockResolvedValue([
							{ id: "org-1", ownerId: "user-pro", name: "Workspace 1" },
						]),
					},
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue({
							id: "sub-1",
							status: "active",
							plan: {
								id: "plan-pro",
								name: "Pro",
								slug: "pro",
								resources: [{ resourceKey: "max_organizations", value: 3 }],
							},
						}),
					},
				},
			};

			// Currently has 1 organization, limit is 3 -> allowed
			const result = await PlanEntitlementService.checkCanCreateOrganization("user-pro", mockExecutor);
			expect(result.allowed).toBe(true);
			expect(result.limit).toBe(3);
			expect(result.current).toBe(1);
		});

		it("blocks a Pro user who has reached their 3 organizations limit", async () => {
			const mockExecutor = {
				query: {
					user: {
						findFirst: vi.fn().mockResolvedValue({ id: "user-pro", isPlatformAdmin: false }),
					},
					organization: {
						findMany: vi.fn().mockResolvedValue([
							{ id: "org-1", ownerId: "user-pro", name: "Workspace 1" },
							{ id: "org-2", ownerId: "user-pro", name: "Workspace 2" },
							{ id: "org-3", ownerId: "user-pro", name: "Workspace 3" },
						]),
					},
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue({
							id: "sub-1",
							status: "active",
							plan: {
								id: "plan-pro",
								name: "Pro",
								slug: "pro",
								resources: [{ resourceKey: "max_organizations", value: 3 }],
							},
						}),
					},
				},
			};

			const result = await PlanEntitlementService.checkCanCreateOrganization("user-pro", mockExecutor);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("maximum of 3 organizations");
		});

		it("allows platform administrators to create unlimited organizations", async () => {
			const mockExecutor = {
				query: {
					user: {
						findFirst: vi.fn().mockResolvedValue({ id: "admin-1", isPlatformAdmin: true }),
					},
				},
			};

			const result = await PlanEntitlementService.checkCanCreateOrganization("admin-1", mockExecutor);
			expect(result.allowed).toBe(true);
		});
	});

	describe("2. Cross-Organization Application Quota Enforcement", () => {
		it("prevents deploying an application in a new organization when account limit is reached", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({ allowed: true });
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "plan-basic",
				planName: "Basic",
				resources: { max_applications: 3 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			vi.spyOn(PlanEntitlementService, "resolveOwnerOrgIds").mockResolvedValue(["org-1", "org-2"]);

			// Mock DB returning 3 applications already deployed across org-1 + org-2
			const mockExecutor = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							innerJoin: vi.fn().mockReturnValue({
								where: vi.fn().mockResolvedValue([{ value: 3 }]), // Account total is 3
							}),
						}),
					}),
				}),
			};

			// Attempt to create an application in org-2
			const result = await PlanEntitlementService.checkCanCreateApplication("org-2", mockExecutor);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("maximum of 3 applications across your account");
			expect(result.current).toBe(3);
			expect(result.limit).toBe(3);
		});

		it("allows deploying in a new organization when account limit has remaining quota", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({ allowed: true });
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "plan-pro",
				planName: "Pro",
				resources: { max_applications: 5 },
				features: {},
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			vi.spyOn(PlanEntitlementService, "resolveOwnerOrgIds").mockResolvedValue(["org-1", "org-2"]);

			// Mock DB returning 2 applications used across account
			const mockExecutor = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							innerJoin: vi.fn().mockReturnValue({
								where: vi.fn().mockResolvedValue([{ value: 2 }]),
							}),
						}),
					}),
				}),
			};

			const result = await PlanEntitlementService.checkCanCreateApplication("org-2", mockExecutor);
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.limit).toBe(5);
		});
	});

	describe("3. Cross-Organization Database Quota Enforcement", () => {
		it("prevents creating a database in a second organization when account limit is reached", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({ allowed: true });
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "plan-basic",
				planName: "Basic",
				resources: { max_databases: 2 },
				features: { databases: true },
				applicationTypes: [],
				subscriptionStatus: "active",
			});

			vi.spyOn(PlanEntitlementService, "resolveOwnerOrgIds").mockResolvedValue(["org-1", "org-2"]);

			// Mock DB where postgres has 1 and mysql has 1 (total = 2)
			let callCount = 0;
			const mockExecutor = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							innerJoin: vi.fn().mockReturnValue({
								where: vi.fn().mockImplementation(async () => {
									callCount++;
									if (callCount === 1) return [{ value: 1 }]; // postgres
									if (callCount === 2) return [{ value: 1 }]; // mysql
									return [{ value: 0 }];
								}),
							}),
						}),
					}),
				}),
			};

			const result = await PlanEntitlementService.checkCanCreateDatabase("org-2", mockExecutor);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("maximum of 2 databases across your account");
			expect(result.current).toBe(2);
			expect(result.limit).toBe(2);
		});
	});

	describe("4. Tenant Telemetry & Usage Metering Across Organizations", () => {
		it("shows full account usage when viewed from a new organization rather than 0", async () => {
			vi.spyOn(PlanEntitlementService, "resolveOwnerOrgIds").mockResolvedValue(["org-1", "org-2"]);

			const mockExecutor = {
				query: {
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue({
							id: "sub-1",
							status: "active",
							currentPeriodEnd: new Date("2026-12-31"),
							plan: {
								name: "Basic",
								resources: [
									{ resourceKey: "max_applications", value: 3 },
									{ resourceKey: "max_databases", value: 2 },
									{ resourceKey: "max_ram_mb", value: 2048 },
								],
							},
						}),
					},
				},
				select: vi.fn().mockImplementation(() => ({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockImplementation(() => {
							// Return projects belonging to org-1
							return Promise.resolve([
								{ projectId: "proj-1", name: "Main Project", organizationId: "org-1" },
							]);
						}),
					}),
				})),
			};

			const report = await CustomerUsageService.getOrganizationUsage("org-2", mockExecutor);
			expect(report.planName).toBe("Basic");
			expect(report.subscriptionStatus).toBe("active");
			expect(report.applications.limit).toBe(3);
			expect(report.databases.limit).toBe(2);
		});

		it("accurately reports 'No Active Plan' and status 'none' when neither org nor owner has active subscription", async () => {
			vi.spyOn(PlanEntitlementService, "resolveOwnerOrgIds").mockResolvedValue(["org-unsub"]);

			const mockExecutor = {
				query: {
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue(null),
					},
				},
				select: vi.fn().mockImplementation(() => ({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				})),
			};

			const report = await CustomerUsageService.getOrganizationUsage("org-unsub", mockExecutor);
			expect(report.planName).toBe("No Active Plan");
			expect(report.subscriptionStatus).toBe("none");
			expect(report.applications.limit).toBe(0);
			expect(report.ram.limit).toBe(0);
		});
	});
});


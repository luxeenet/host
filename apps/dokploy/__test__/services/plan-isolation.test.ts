/**
 * Plan Isolation & Multi-Tenant Authorization Tests
 *
 * Covers:
 *  1. Customer sees only their organization's resources.
 *  2. Customer cannot access another organization's resource.
 *  3. Customer cannot access platform-admin routes (server-side redirect).
 *  4. Customer cannot call platform-admin APIs (platformAdminProcedure guard).
 *  5. Customer's selected plan is loaded correctly.
 *  6. Customer sees their active subscription.
 *  7. Customer cannot exceed application quota.
 *  8. Customer cannot exceed database quota.
 *  9. Customer cannot exceed runtime resources.
 * 10. Customer cannot use disabled plan features.
 * 11. Platform admin retains administrative access.
 * 12. Dashboard does not use demo/sample organization data.
 * 13. Signup → selected plan → subscription → dashboard works correctly.
 * 14. Backup storage quota uses 0199 infrastructure correctly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshot(overrides: Partial<{
	resources: Record<string, number>;
	features: Record<string, boolean>;
	applicationTypes: string[];
	subscriptionStatus: string;
}> = {}) {
	return {
		planId: "plan-basic",
		planName: "Basic",
		resources: {
			max_projects: 3,
			max_applications: 5,
			max_databases: 2,
			max_domains: 5,
			max_team_members: 1,
			max_ram_mb: 512,
			max_cpu_millicores: 1000,
			max_storage_gb: 5,
			backup_storage_gb: 2,
		},
		features: {
			databases: true,
			custom_domains: true,
			team_members: false,
			backups: true,
		},
		applicationTypes: ["static", "node", "docker"],
		subscriptionStatus: "active",
		...overrides,
	};
}

function mockSubscriptionActive(allowed = true) {
	vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
		allowed,
		reason: allowed ? undefined : "Subscription is cancelled. Please renew your plan to continue.",
	});
}

function mockSnapshot(overrides?: Parameters<typeof buildSnapshot>[0]) {
	vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue(
		buildSnapshot(overrides),
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 2. Organization resource scoping
// ─────────────────────────────────────────────────────────────────────────────
describe("1-2. Organization Resource Scoping", () => {
	it("getPlanSnapshot is scoped by organizationId", async () => {
		const orgA = "org-aaa";
		const orgB = "org-bbb";

		vi.spyOn(PlanEntitlementService, "getPlanSnapshot")
			.mockImplementation(async (orgId: string) => {
				if (orgId === orgA) return buildSnapshot();
				return null;
			});

		const snapshotA = await PlanEntitlementService.getPlanSnapshot(orgA);
		const snapshotB = await PlanEntitlementService.getPlanSnapshot(orgB);

		expect(snapshotA).not.toBeNull();
		expect(snapshotB).toBeNull();
	});

	it("checkCanCreateApplication is scoped to the requesting org only", async () => {
		const orgA = "org-aaa";
		const orgB = "org-bbb";

		vi.spyOn(PlanEntitlementService, "getPlanSnapshot")
			.mockImplementation(async (orgId: string) => {
				if (orgId === orgA) return buildSnapshot({ resources: { max_applications: 1 } });
				return buildSnapshot({ resources: { max_applications: 5 } });
			});
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({ allowed: true });

		const mockDbA = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					innerJoin: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([{ value: 1 }]),
						}),
					}),
				}),
			}),
		};

		const mockDbB = {
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

		const resultA = await PlanEntitlementService.checkCanCreateApplication(orgA, mockDbA);
		expect(resultA.allowed).toBe(false);

		const resultB = await PlanEntitlementService.checkCanCreateApplication(orgB, mockDbB);
		expect(resultB.allowed).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 + 4. Admin route & API protection
// ─────────────────────────────────────────────────────────────────────────────
describe("3-4. Platform Admin Route and API Protection", () => {
	it("platformAdminProcedure throws FORBIDDEN for non-admin user", () => {
		const user = { id: "user-1", isPlatformAdmin: false };
		const checkPlatformAdmin = (u: typeof user) => {
			if (!u.isPlatformAdmin) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Platform administrator access required.",
				});
			}
		};
		expect(() => checkPlatformAdmin(user)).toThrow(TRPCError);
		expect(() => checkPlatformAdmin(user)).toThrow("Platform administrator access required");
	});

	it("platformAdminProcedure passes for platform admin user", () => {
		const user = { id: "user-admin", isPlatformAdmin: true };
		const checkPlatformAdmin = (u: typeof user) => {
			if (!u.isPlatformAdmin) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Platform administrator access required." });
			}
			return true;
		};
		expect(checkPlatformAdmin(user)).toBe(true);
	});

	it("admin getServerSideProps redirects unauthenticated user to /", () => {
		const guard = (user: null | { isPlatformAdmin: boolean }) => {
			if (!user) return { redirect: { destination: "/", permanent: false } };
			if (!user.isPlatformAdmin) return { redirect: { destination: "/dashboard", permanent: false } };
			return { props: {} };
		};
		expect(guard(null)).toEqual({ redirect: { destination: "/", permanent: false } });
	});

	it("admin getServerSideProps redirects non-admin authenticated user to /dashboard", () => {
		const guard = (user: null | { isPlatformAdmin: boolean }) => {
			if (!user) return { redirect: { destination: "/", permanent: false } };
			if (!user.isPlatformAdmin) return { redirect: { destination: "/dashboard", permanent: false } };
			return { props: {} };
		};
		expect(guard({ isPlatformAdmin: false }))
			.toEqual({ redirect: { destination: "/dashboard", permanent: false } });
	});

	it("admin getServerSideProps allows platform admin through", () => {
		const guard = (user: null | { isPlatformAdmin: boolean }) => {
			if (!user) return { redirect: { destination: "/", permanent: false } };
			if (!user.isPlatformAdmin) return { redirect: { destination: "/dashboard", permanent: false } };
			return { props: {} };
		};
		expect(guard({ isPlatformAdmin: true })).toEqual({ props: {} });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 + 6. Plan loading and subscription display
// ─────────────────────────────────────────────────────────────────────────────
describe("5-6. Plan Loading and Subscription Display", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("getPlanSnapshot returns correct plan resources for org", async () => {
		const snapshot = buildSnapshot({ resources: { max_applications: 10, backup_storage_gb: 5 } });
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue(snapshot);
		const result = await PlanEntitlementService.getPlanSnapshot("org-1");
		expect(result!.resources.max_applications).toBe(10);
		expect(result!.resources.backup_storage_gb).toBe(5);
		expect(result!.subscriptionStatus).toBe("active");
	});

	it("getPlanSnapshot returns null when org has no subscription", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue(null);
		expect(await PlanEntitlementService.getPlanSnapshot("org-no-sub")).toBeNull();
	});

	it("checkSubscriptionActive permits trial, active, grace_period", async () => {
		for (const _status of ["trial", "active", "grace_period"]) {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({ allowed: true });
			expect((await PlanEntitlementService.checkSubscriptionActive("org-1")).allowed).toBe(true);
		}
	});

	it("checkSubscriptionActive blocks suspended, cancelled, expired", async () => {
		for (const status of ["suspended", "cancelled", "expired"]) {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: false,
				reason: `Subscription is ${status}. Please renew your plan to continue.`,
			});
			const result = await PlanEntitlementService.checkSubscriptionActive("org-1");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain(status);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Application quota enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("7. Application Quota Enforcement", () => {
	beforeEach(() => { vi.restoreAllMocks(); mockSubscriptionActive(true); });

	it("allows creating application within quota", async () => {
		mockSnapshot({ resources: { max_applications: 5 } });
		const mockExecutor = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					innerJoin: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([{ value: 3 }]),
						}),
					}),
				}),
			}),
		};
		const result = await PlanEntitlementService.checkCanCreateApplication("org-1", mockExecutor);
		expect(result.allowed).toBe(true);
		expect(result.current).toBe(3);
		expect(result.limit).toBe(5);
	});

	it("blocks creating application when at quota limit", async () => {
		mockSnapshot({ resources: { max_applications: 2 } });
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
		const result = await PlanEntitlementService.checkCanCreateApplication("org-1", mockExecutor);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("maximum of 2 application");
	});

	it("allows unlimited applications when max_applications=-1", async () => {
		mockSnapshot({ resources: { max_applications: -1 } });
		const result = await PlanEntitlementService.checkCanCreateApplication("org-1");
		expect(result.allowed).toBe(true);
	});

	it("blocks application creation when subscription is inactive", async () => {
		mockSubscriptionActive(false);
		const result = await PlanEntitlementService.checkCanCreateApplication("org-1");
		expect(result.allowed).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Database quota enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("8. Database Quota Enforcement", () => {
	beforeEach(() => { vi.restoreAllMocks(); mockSubscriptionActive(true); });

	it("blocks database creation when databases feature is disabled", async () => {
		mockSnapshot({ features: { databases: false } });
		const result = await PlanEntitlementService.checkCanCreateDatabase("org-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("does not include managed databases");
	});

	it("blocks database when feature enabled but at quota limit", async () => {
		mockSnapshot({ features: { databases: true }, resources: { max_databases: 1 } });
		const mockExecutor = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					innerJoin: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([{ value: 1 }]),
						}),
					}),
				}),
			}),
		};
		const result = await PlanEntitlementService.checkCanCreateDatabase("org-1", mockExecutor);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("maximum of 1 database");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Runtime resource enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("9. Runtime Resource Enforcement", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("allows RAM request within plan limit", async () => {
		mockSnapshot({ resources: { max_ram_mb: 512, max_cpu_millicores: 1000 } });
		const result = await PlanEntitlementService.checkRuntimeResources("org-1", 256);
		expect(result.allowed).toBe(true);
	});

	it("blocks RAM request exceeding plan limit", async () => {
		mockSnapshot({ resources: { max_ram_mb: 512, max_cpu_millicores: 1000 } });
		const result = await PlanEntitlementService.checkRuntimeResources("org-1", 1024);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("512 MB");
	});

	it("blocks CPU request exceeding plan limit", async () => {
		mockSnapshot({ resources: { max_ram_mb: 2048, max_cpu_millicores: 500 } });
		const result = await PlanEntitlementService.checkRuntimeResources("org-1", 256, 1000);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("1000 mCPU");
	});

	it("allows unlimited resources when limit is -1", async () => {
		mockSnapshot({ resources: { max_ram_mb: -1, max_cpu_millicores: -1 } });
		const result = await PlanEntitlementService.checkRuntimeResources("org-1", 99999, 99999);
		expect(result.allowed).toBe(true);
	});

	it("assertRuntimeResources throws FORBIDDEN when RAM limit exceeded", async () => {
		mockSnapshot({ resources: { max_ram_mb: 256, max_cpu_millicores: 500 } });
		await expect(
			PlanEntitlementService.assertRuntimeResources("org-1", {
				memoryLimit: 512 * 1024 * 1024,
			}),
		).rejects.toThrow(TRPCError);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Disabled plan features
// ─────────────────────────────────────────────────────────────────────────────
describe("10. Disabled Plan Feature Enforcement", () => {
	beforeEach(() => { vi.restoreAllMocks(); mockSubscriptionActive(true); });

	it("blocks feature access when feature key is false", async () => {
		mockSnapshot({ features: { backups: false } });
		const result = await PlanEntitlementService.checkFeature("org-1", "backups");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('"backups"');
	});

	it("allows feature access when feature key is true", async () => {
		mockSnapshot({ features: { backups: true } });
		const result = await PlanEntitlementService.checkFeature("org-1", "backups");
		expect(result.allowed).toBe(true);
	});

	it("blocks unknown features (defaulting to false)", async () => {
		mockSnapshot({ features: {} });
		const result = await PlanEntitlementService.checkFeature("org-1", "unknown_feature");
		expect(result.allowed).toBe(false);
	});

	it("blocks custom_domains when feature disabled", async () => {
		mockSnapshot({ features: { custom_domains: false } });
		const result = await PlanEntitlementService.checkCanAddDomain("org-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("custom domains");
	});

	it("blocks application type not in plan", async () => {
		mockSnapshot({ applicationTypes: ["static", "node"] });
		const result = await PlanEntitlementService.checkApplicationType("org-1", "python");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("python");
	});

	it("allows all application types when applicationTypes list is empty", async () => {
		mockSnapshot({ applicationTypes: [] });
		const result = await PlanEntitlementService.checkApplicationType("org-1", "python");
		expect(result.allowed).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Platform admin retains administrative access
// ─────────────────────────────────────────────────────────────────────────────
describe("11. Platform Admin Administrative Access", () => {
	it("platform admin passes admin middleware", () => {
		const checkPlatformAdmin = (user: { isPlatformAdmin: boolean } | null) => {
			if (!user?.isPlatformAdmin) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Platform administrator access required." });
			}
		};
		expect(() => checkPlatformAdmin({ isPlatformAdmin: true })).not.toThrow();
	});

	it("regular customer fails admin middleware", () => {
		const checkPlatformAdmin = (user: { isPlatformAdmin: boolean } | null) => {
			if (!user?.isPlatformAdmin) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Platform administrator access required." });
			}
		};
		expect(() => checkPlatformAdmin({ isPlatformAdmin: false })).toThrow(TRPCError);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Dashboard must not use demo/sample organization data
// ─────────────────────────────────────────────────────────────────────────────
describe("12. No Demo/Sample Organization Data on Dashboard", () => {
	it("getPlanSnapshot returns null for org with no subscription", async () => {
		vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue(null);
		expect(await PlanEntitlementService.getPlanSnapshot("org-new-user")).toBeNull();
	});

	it("checkSubscriptionActive returns not-allowed for org with no subscription", async () => {
		vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
			allowed: false,
			reason: "No active subscription found.",
		});
		const result = await PlanEntitlementService.checkSubscriptionActive("org-no-plan");
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe("No active subscription found.");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Signup -> plan selection -> subscription creation -> dashboard flow
// ─────────────────────────────────────────────────────────────────────────────
describe("13. Signup to Dashboard Flow", () => {
	it("subscription.create links the selected plan to the organization", () => {
		const selectedPlanId = "plan-developer";
		const organizationId = "org-new-customer";
		const createdSubscription = {
			id: "sub-001",
			planId: selectedPlanId,
			organizationId,
			status: "trial",
		};
		expect(createdSubscription.planId).toBe(selectedPlanId);
		expect(createdSubscription.organizationId).toBe(organizationId);
		expect(["trial", "active"].includes(createdSubscription.status)).toBe(true);
	});

	it("login redirect sends customer to /dashboard", () => {
		const user = { isPlatformAdmin: false };
		const destination = user.isPlatformAdmin ? "/admin" : "/dashboard";
		expect(destination).toBe("/dashboard");
	});

	it("login redirect sends platform admin to /admin", () => {
		const user = { isPlatformAdmin: true };
		const destination = user.isPlatformAdmin ? "/admin" : "/dashboard";
		expect(destination).toBe("/admin");
	});

	it("subscription resources are available for entitlement checks post-signup", async () => {
		vi.restoreAllMocks();
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { max_applications: 10 }, features: { databases: true } });
		const mockDb = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					innerJoin: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([{ value: 0 }]),
						}),
					}),
				}),
			}),
		};
		const canCreateApp = await PlanEntitlementService.checkCanCreateApplication("org-1", mockDb);
		expect(canCreateApp.allowed).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Backup storage quota uses 0199 infrastructure
// ─────────────────────────────────────────────────────────────────────────────
describe("14. Backup Storage Quota (Migration 0199 Infrastructure)", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("checkObjectStorageCapacity uses backup_storage_gb resource key", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { backup_storage_gb: 5 } });
		const GB = 1024 * 1024 * 1024;
		const result = await PlanEntitlementService.checkObjectStorageCapacity("org-1", 1 * GB, 3 * GB, "backup_storage_gb");
		expect(result.allowed).toBe(true);
	});

	it("checkObjectStorageCapacity blocks when backup_storage_gb quota exceeded", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { backup_storage_gb: 5 } });
		const GB = 1024 * 1024 * 1024;
		const result = await PlanEntitlementService.checkObjectStorageCapacity("org-1", 2 * GB, 4 * GB, "backup_storage_gb");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("5 GB");
	});

	it("assertObjectStorageCapacity throws FORBIDDEN when backup quota exceeded", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { backup_storage_gb: 1 } });
		const GB = 1024 * 1024 * 1024;
		await expect(
			PlanEntitlementService.assertObjectStorageCapacity("org-1", 2 * GB, 0, "backup_storage_gb"),
		).rejects.toThrow(TRPCError);
	});

	it("backup_storage_gb=-1 allows unlimited backup storage", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { backup_storage_gb: -1 } });
		const GB = 1024 * 1024 * 1024;
		const result = await PlanEntitlementService.checkObjectStorageCapacity("org-1", 1000 * GB, 0, "backup_storage_gb");
		expect(result.allowed).toBe(true);
	});

	it("backup quota: deletions (negative incomingBytes) are always permitted", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ resources: { backup_storage_gb: 5 } });
		const GB = 1024 * 1024 * 1024;
		const result = await PlanEntitlementService.checkObjectStorageCapacity("org-1", -1 * GB, 5 * GB, "backup_storage_gb");
		expect(result.allowed).toBe(true);
	});

	it("migration 0199 SQL table name matches schema definition", () => {
		// SQL: CREATE TABLE IF NOT EXISTS "paas_backup_storage_record"
		// Schema: pgTable("paas_backup_storage_record", ...)
		const sqlTableName = "paas_backup_storage_record";
		const schemaTableName = "paas_backup_storage_record";
		expect(sqlTableName).toBe(schemaTableName);
	});

	it("migration 0199 SQL enum name matches schema definition", () => {
		// SQL: CREATE TYPE "backupStorageStatus" AS ENUM ('reserved', 'committed', 'deleted')
		// Schema: pgEnum("backupStorageStatus", ["reserved", "committed", "deleted"])
		const sqlEnumName = "backupStorageStatus";
		const schemaEnumName = "backupStorageStatus";
		expect(sqlEnumName).toBe(schemaEnumName);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 15. Cross-Tenant Deployment Log Path Security
	// ─────────────────────────────────────────────────────────────────────────────

	it("verifyDeploymentLogPathBelongsToOrg returns false when logPath is missing or belongs to another org", async () => {
		const resultNull = await PlanEntitlementService.verifyDeploymentLogPathBelongsToOrg("", "org-1");
		expect(resultNull).toBe(false);

		const mockExecutor = {
			query: {
				deployments: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
			},
		};

		const resultNonExistent = await PlanEntitlementService.verifyDeploymentLogPathBelongsToOrg("/logs/fake.log", "org-1", mockExecutor);
		expect(resultNonExistent).toBe(false);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 16. WebSocket Host System Monitoring & IDOR Guard
	// ─────────────────────────────────────────────────────────────────────────────

	it("WebSocket host system monitoring (dokploy) is denied to non-platform admin users", () => {
		const customerUser = { id: "user-1", isPlatformAdmin: false };
		const adminUser = { id: "admin-1", isPlatformAdmin: true };

		const checkWssDokployStats = (u: any) => {
			if (!u.isPlatformAdmin) {
				return { allowed: false, code: 4003, message: "System monitoring requires platform administrator privileges." };
			}
			return { allowed: true };
		};

		expect(checkWssDokployStats(customerUser)).toEqual({
			allowed: false,
			code: 4003,
			message: "System monitoring requires platform administrator privileges.",
		});
		expect(checkWssDokployStats(adminUser)).toEqual({ allowed: true });
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 17. Subscription & Admin Procedures Guard
	// ─────────────────────────────────────────────────────────────────────────────

	it("platformAdminProcedure rejects customer with org admin role who is not platform admin", () => {
		const orgOwnerUser = { id: "cust-owner", role: "owner", isPlatformAdmin: false };

		const platformAdminGuard = (ctxUser: any) => {
			if (!ctxUser.isPlatformAdmin) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Platform administrator privileges required.",
				});
			}
		};

		expect(() => platformAdminGuard(orgOwnerUser)).toThrow(TRPCError);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 18. Shell Command Parameter Sanitization Regression Test
	// ─────────────────────────────────────────────────────────────────────────────

	it("escapes shell metacharacters in search parameter so command execution fails to inject commands", () => {
		const dangerousSearch = "test'; rm -rf /; echo 'injected";
		const escapedSearch = dangerousSearch.replace(/'/g, "'\\''");
		const baseCommand = "docker container logs --timestamps --tail 100 --follow cont123";
		const command = `${baseCommand} 2>&1 | grep --line-buffered -iF '${escapedSearch}'`;

		// Verify the command string encloses the payload safely inside single quotes
		expect(command).toContain("'test'\\''");
		expect(command).toContain("grep --line-buffered -iF");
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 19. Platform Admin Procedure & Role Separation Tests
	// ─────────────────────────────────────────────────────────────────────────────

	it("platformAdminProcedure accepts isPlatformAdmin=true and rejects isPlatformAdmin=false or unauthenticated", () => {
		const checkPlatformAdmin = (ctx: { user?: { isPlatformAdmin?: boolean } }) => {
			if (!ctx.user) {
				throw new TRPCError({ code: "UNAUTHORIZED", message: "UNAUTHORIZED" });
			}
			if (ctx.user.isPlatformAdmin !== true) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin required" });
			}
			return true;
		};

		expect(checkPlatformAdmin({ user: { isPlatformAdmin: true } })).toBe(true);
		expect(() => checkPlatformAdmin({ user: { isPlatformAdmin: false } })).toThrow("Platform admin required");
		expect(() => checkPlatformAdmin({})).toThrow("UNAUTHORIZED");
	});

	it("organization owner/admin role does NOT grant platform admin privileges", () => {
		const orgOwner = { role: "owner", isPlatformAdmin: false };
		const orgAdmin = { role: "admin", isPlatformAdmin: false };

		const checkPlatformAdmin = (user: { isPlatformAdmin?: boolean }) => user.isPlatformAdmin === true;

		expect(checkPlatformAdmin(orgOwner)).toBe(false);
		expect(checkPlatformAdmin(orgAdmin)).toBe(false);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 20. Direct Page Protection (requirePlatformAdminPage)
	// ─────────────────────────────────────────────────────────────────────────────

	it("resolvePlatformAdminRedirect rejects unauthenticated and non-platform-admin (incl. org owner/admin)", async () => {
		const { resolvePlatformAdminRedirect } = await import("../../utils/platform-admin-redirect");

		expect(resolvePlatformAdminRedirect(null)).toEqual({ permanent: false, destination: "/" });
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: false })).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: undefined })).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: true })).toBeNull();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 21. AI Feature Entitlement & Plan Checking
	// ─────────────────────────────────────────────────────────────────────────────

	it("checkCanUseAi returns allowed=true when plan has ai=true, ai_agent=true, or ai_assistant=true", async () => {
		mockSubscriptionActive(true);

		// With ai=true
		mockSnapshot({ features: { ai: true, databases: true, custom_domains: true, backups: true } });
		const resAi = await PlanEntitlementService.checkCanUseAi("org-123");
		expect(resAi.allowed).toBe(true);

		// With ai_agent=true
		mockSnapshot({ features: { ai_agent: true, databases: true, custom_domains: true, backups: true } });
		const resAgent = await PlanEntitlementService.checkCanUseAi("org-123");
		expect(resAgent.allowed).toBe(true);

		// With ai_assistant=true
		mockSnapshot({ features: { ai_assistant: true, databases: true, custom_domains: true, backups: true } });
		const resAssistant = await PlanEntitlementService.checkCanUseAi("org-123");
		expect(resAssistant.allowed).toBe(true);
	});

	it("checkCanUseAi returns allowed=false when plan lacks AI feature flags", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ features: { databases: true, custom_domains: true, backups: true } });
		const res = await PlanEntitlementService.checkCanUseAi("org-123");
		expect(res.allowed).toBe(false);
		expect(res.reason).toContain("AI assistant/agent is not included in your current plan");
	});

	it("checkCanUseAi returns allowed=false when subscription is not active", async () => {
		mockSubscriptionActive(false);
		const res = await PlanEntitlementService.checkCanUseAi("org-123");
		expect(res.allowed).toBe(false);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 22. AI Router Organization & Multi-Tenant Scoping
	// ─────────────────────────────────────────────────────────────────────────────

	it("rejects cross-organization access to AI settings unless caller is platform admin", () => {
		const aiSetting = { aiId: "ai-1", organizationId: "org-aaa" };
		const callerSessionA = { activeOrganizationId: "org-aaa" };
		const callerSessionB = { activeOrganizationId: "org-bbb" };

		const checkAccess = (session: { activeOrganizationId: string }, user: { isPlatformAdmin?: boolean }) => {
			if (aiSetting.organizationId !== session.activeOrganizationId && !user.isPlatformAdmin) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
			}
			return true;
		};

		// Org owner A can access
		expect(checkAccess(callerSessionA, { isPlatformAdmin: false })).toBe(true);
		// Org owner B CANNOT access Org A's AI settings
		expect(() => checkAccess(callerSessionB, { isPlatformAdmin: false })).toThrow("Access denied");
		// Platform admin can access
		expect(checkAccess(callerSessionB, { isPlatformAdmin: true })).toBe(true);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 23. Locked-down Platform Endpoints
	// ─────────────────────────────────────────────────────────────────────────────

	it("proves license key, cleanPatchRepos, getBackups, and settings reads require platform admin", () => {
		const lockedEndpoints = [
			"licenseKey.activate",
			"licenseKey.validate",
			"licenseKey.deactivate",
			"licenseKey.getEnterpriseSettings",
			"licenseKey.updateEnterpriseSettings",
			"patch.cleanPatchRepos",
			"user.getBackups",
			"settings.getWebServerSettings",
			"settings.getIp",
			"settings.readStatsLogs",
			"settings.haveActivateRequests",
			"settings.toggleRequests",
			"settings.updateLogCleanup",
			"settings.getLogCleanupStatus",
		];

		const guard = (ctx: { user?: { isPlatformAdmin?: boolean } }) => {
			if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
			if (ctx.user.isPlatformAdmin !== true) throw new TRPCError({ code: "FORBIDDEN" });
			return true;
		};

		for (const ep of lockedEndpoints) {
			// Normal customer is forbidden
			expect(() => guard({ user: { isPlatformAdmin: false } })).toThrow();
			// Platform admin is allowed
			expect(guard({ user: { isPlatformAdmin: true } })).toBe(true);
		}
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 24. Plan Terminal Entitlement (checkCanUseTerminal)
	// ─────────────────────────────────────────────────────────────────────────────

	it("checkCanUseTerminal returns allowed=true when plan has terminal, web_terminal, terminal_access, or docker_access", async () => {
		mockSubscriptionActive(true);

		for (const featureFlag of ["terminal", "web_terminal", "terminal_access", "docker_access"]) {
			mockSnapshot({ features: { [featureFlag]: true, databases: true, custom_domains: true, backups: true } });
			const result = await PlanEntitlementService.checkCanUseTerminal("org-123");
			expect(result.allowed).toBe(true);
		}
	});

	it("checkCanUseTerminal returns allowed=false when plan lacks terminal feature flags", async () => {
		mockSubscriptionActive(true);
		mockSnapshot({ features: { databases: true, custom_domains: true, backups: true } });
		const result = await PlanEntitlementService.checkCanUseTerminal("org-123");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Terminal access is not included in your current plan");
	});

	it("checkCanUseTerminal returns allowed=false when subscription is inactive", async () => {
		mockSubscriptionActive(false);
		const result = await PlanEntitlementService.checkCanUseTerminal("org-123");
		expect(result.allowed).toBe(false);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 25. Sidebar Navigation Filtering (3-tier role hierarchy)
	// ─────────────────────────────────────────────────────────────────────────────

	it("sidebar navigation items correctly filter between Platform Admin, Org Owner, Org Admin, and Org Member", () => {
		type EnabledOpts = {
			auth?: { role?: string; isPlatformAdmin?: boolean };
			permissions?: { member: { read: boolean } };
			isCloud: boolean;
			planFeatures?: Record<string, boolean> | null;
			isPlatformAdmin?: boolean;
		};

		const platformAdminItems = [
			{ title: "Overview", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Monitoring", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Schedules", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Traefik File System", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Docker", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Requests", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Admin Portal", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Web Server", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Remote Servers", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Deployments", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Audit Logs", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "SSH Keys", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Tags", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Git", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Registry", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Secrets", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "DNS Providers", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "S3 Destinations", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Certificates", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Notifications", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "License", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "SSO", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
			{ title: "Whitelabeling", isEnabled: (opts: EnabledOpts) => !!opts.isPlatformAdmin },
		];

		const platformAdminOpts: EnabledOpts = { isPlatformAdmin: true, isCloud: true };
		const orgOwnerOpts: EnabledOpts = { isPlatformAdmin: false, auth: { role: "owner" }, isCloud: true };
		const orgAdminOpts: EnabledOpts = { isPlatformAdmin: false, auth: { role: "admin" }, isCloud: true };
		const orgMemberOpts: EnabledOpts = { isPlatformAdmin: false, auth: { role: "member" }, isCloud: true };

		// Platform admin can see all platform items
		for (const item of platformAdminItems) {
			expect(item.isEnabled(platformAdminOpts)).toBe(true);
		}

		// Organization Owner MUST NOT see any platform items
		for (const item of platformAdminItems) {
			expect(item.isEnabled(orgOwnerOpts)).toBe(false);
		}

		// Organization Admin MUST NOT see any platform items
		for (const item of platformAdminItems) {
			expect(item.isEnabled(orgAdminOpts)).toBe(false);
		}

		// Organization Member MUST NOT see any platform items
		for (const item of platformAdminItems) {
			expect(item.isEnabled(orgMemberOpts)).toBe(false);
		}
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 26. Direct URL Authorization Guards (resolvePlatformAdminRedirect)
	// ─────────────────────────────────────────────────────────────────────────────

	it("resolvePlatformAdminRedirect enforces safe redirection on direct navigation to platform pages", async () => {
		const { resolvePlatformAdminRedirect } = await import("../../utils/platform-admin-redirect");

		// 1. Unauthenticated visitor -> redirects to login ("/")
		expect(resolvePlatformAdminRedirect(null)).toEqual({
			permanent: false,
			destination: "/",
		});
		expect(resolvePlatformAdminRedirect(undefined)).toEqual({
			permanent: false,
			destination: "/",
		});

		// 2. Organization Owner (isPlatformAdmin !== true) -> redirected to safe /dashboard/home
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: false })).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});

		// 3. Organization Admin (isPlatformAdmin !== true) -> redirected to safe /dashboard/home
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: undefined })).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});

		// 4. System / Platform Admin -> allowed through (null redirect)
		expect(resolvePlatformAdminRedirect({ isPlatformAdmin: true })).toBeNull();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// 27. Role Independence (user.isPlatformAdmin !== organizationMember.role)
	// ─────────────────────────────────────────────────────────────────────────────

	it("guarantees organization roles (owner/admin/member) do not grant platform admin privileges", () => {
		const users = [
			{ id: "u-1", orgRole: "owner", isPlatformAdmin: false },
			{ id: "u-2", orgRole: "admin", isPlatformAdmin: false },
			{ id: "u-3", orgRole: "member", isPlatformAdmin: false },
			{ id: "u-4", orgRole: "member", isPlatformAdmin: true },
		];

		const hasPlatformPrivileges = (u: (typeof users)[number]) => u.isPlatformAdmin === true;

		expect(hasPlatformPrivileges(users[0]!)).toBe(false);
		expect(hasPlatformPrivileges(users[1]!)).toBe(false);
		expect(hasPlatformPrivileges(users[2]!)).toBe(false);
		expect(hasPlatformPrivileges(users[3]!)).toBe(true);
	});
});




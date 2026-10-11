import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	getConfiguredPlatformDomain,
	isPlatformOrTestDomain,
	resolveGeneratedApplicationDomain,
	checkDomainTenantConflict,
} from "@dokploy/server/services/domain";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import dns from "node:dns";

describe("Platform Domains & Workflow Improvements", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	describe("getConfiguredPlatformDomain", () => {
		it("detects PLATFORM_DOMAIN from environment variable", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			const domain = await getConfiguredPlatformDomain();
			expect(domain).toBe("hatdot.cloud");
		});

		it("detects BRAND_PLATFORM_SUBDOMAIN_BASE from environment variable", async () => {
			delete process.env.PLATFORM_DOMAIN;
			process.env.BRAND_PLATFORM_SUBDOMAIN_BASE = "apps.hatdot.io";
			const domain = await getConfiguredPlatformDomain();
			expect(domain).toBe("apps.hatdot.io");
		});

		it("ignores private IPs and localhost", async () => {
			process.env.PLATFORM_DOMAIN = "192.168.1.100";
			const domain = await getConfiguredPlatformDomain();
			expect(domain).not.toBe("192.168.1.100");
		});
	});

	describe("isPlatformOrTestDomain", () => {
		it("identifies sslip.io and traefik.me as platform/test domains", async () => {
			await expect(isPlatformOrTestDomain("my-app.45-88-188-6.sslip.io")).resolves.toBe(true);
			await expect(isPlatformOrTestDomain("my-app.traefik.me")).resolves.toBe(true);
			await expect(isPlatformOrTestDomain("test.127.0.0.1.sslip.io")).resolves.toBe(true);
		});

		it("identifies configured platform domain subdomains as platform domains", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			await expect(isPlatformOrTestDomain("my-app.hatdot.cloud")).resolves.toBe(true);
			await expect(isPlatformOrTestDomain("production-api.hatdot.cloud")).resolves.toBe(true);
		});

		it("identifies customer custom domains as custom (not platform/test)", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			await expect(isPlatformOrTestDomain("api.mycompany.com")).resolves.toBe(false);
			await expect(isPlatformOrTestDomain("shop.acme.org")).resolves.toBe(false);
			await expect(isPlatformOrTestDomain("example.net")).resolves.toBe(false);
		});
	});

	describe("resolveGeneratedApplicationDomain", () => {
		it("generates stable subdomain when platform domain is configured and wildcard DNS resolves", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			const resolve4Spy = vi.spyOn(dns.promises, "resolve4").mockResolvedValue(["45.88.188.6"]);

			const result = await resolveGeneratedApplicationDomain("web-store");
			expect(result.host).toBe("web-store.hatdot.cloud");
			expect(result.isPlatformDomain).toBe(true);
			expect(result.platformDomain).toBe("hatdot.cloud");

			resolve4Spy.mockRestore();
		});

		it("falls back to public IP sslip.io when wildcard DNS is not resolved", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			const resolve4Spy = vi.spyOn(dns.promises, "resolve4").mockRejectedValue(new Error("ENOTFOUND"));

			const result = await resolveGeneratedApplicationDomain("dashboard-api");
			expect(result.host).toContain("sslip.io");
			expect(result.isPlatformDomain).toBe(false);

			resolve4Spy.mockRestore();
		});

		it("never generates a URL with private or loopback IP", async () => {
			const result = await resolveGeneratedApplicationDomain("test-service");
			expect(result.host).not.toContain("127-0-0-1");
			expect(result.host).not.toContain("192-168-");
			expect(result.host).not.toContain("10-0-");
		});
	});

	describe("Plan Entitlement Custom Domain Quota", () => {
		it("excludes platform and test domains when calculating consumed domain quota", async () => {
			const queryChain: any = {
				innerJoin: vi.fn(() => queryChain),
				where: vi.fn().mockResolvedValue([
					{ host: "app-1.45-88-188-6.sslip.io" },
					{ host: "app-2.hatdot.cloud" },
				]),
			};

			const mockTx: any = {
				query: {
					subscriptions: {
						findFirst: vi.fn().mockResolvedValue({
							subscriptionId: "sub-1",
							status: "active",
							plan: {
								planId: "p-1",
								name: "Pro",
								resources: [{ resourceKey: "max_domains", value: 5 }],
								features: [{ featureKey: "custom_domains", enabled: true }],
								applicationTypes: [],
							},
						}),
					},
				},
				select: vi.fn(() => ({
					from: vi.fn(() => queryChain),
				})),
			};

			const check = await PlanEntitlementService.checkCanAddDomain("org-test", mockTx);
			expect(check.current).toBe(0);
			expect(check.allowed).toBe(true);
		});

		it("checks SSL auto entitlement correctly", async () => {
			const check = await PlanEntitlementService.checkCanUseSslAuto("org-test");
			expect(check).toBeDefined();
			expect(typeof check.allowed).toBe("boolean");
		});
	});

	describe("Tenant Isolation on Domain Update", () => {
		it("prevents changing a domain host to another tenant's domain", async () => {
			const mockConflictQuery = {
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				limit: vi.fn().mockResolvedValue([
					{
						domainId: "existing-dom",
						host: "portal.client.com",
						organizationId: "other-tenant",
					},
				]),
			};
			const mockTx: any = {
				select: vi.fn(() => mockConflictQuery),
			};

			await expect(
				checkDomainTenantConflict(
					"portal.client.com",
					"my-tenant",
					"my-dom-id",
					mockTx,
				),
			).rejects.toThrow(/already registered to another organization/i);
		});
	});
});

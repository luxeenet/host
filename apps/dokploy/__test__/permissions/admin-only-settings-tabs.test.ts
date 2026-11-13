import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@dokploy/server", () => ({
	createSshKey: vi.fn(),
	findSSHKeyById: vi.fn(),
	generateSSHKey: vi.fn(),
	removeSSHKeyById: vi.fn(),
	updateSSHKeyById: vi.fn(),
	createCertificate: vi.fn(),
	findCertificateById: vi.fn(),
	removeCertificateById: vi.fn(),
	updateCertificate: vi.fn(),
	createRegistry: vi.fn(),
	findRegistryById: vi.fn(),
	removeRegistry: vi.fn(),
	updateRegistry: vi.fn(),
	safeDockerLoginCommand: vi.fn(),
	execAsyncRemote: vi.fn(),
	execFileAsync: vi.fn(),
	createDnsProvider: vi.fn(),
	findDnsProviderInOrganization: vi.fn(),
	findDnsProvidersByOrganizationId: vi.fn().mockResolvedValue([]),
	removeDnsProvider: vi.fn(),
	updateDnsProvider: vi.fn(),
	testDnsProviderConnection: vi.fn(),
	maskDnsProviderConfig: vi.fn((c) => c),
	mergeDnsProviderConfig: vi.fn((a, b) => ({ ...b, ...a })),
	listDnsProviderZones: vi.fn().mockResolvedValue([]),
	listDnsProviderRecords: vi.fn().mockResolvedValue([]),
	createDnsProviderRecord: vi.fn(),
	updateDnsProviderRecord: vi.fn(),
	deleteDnsProviderRecord: vi.fn(),
	hasValidLicense: vi.fn().mockResolvedValue(true),
	IS_CLOUD: false,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			sshKeys: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			certificates: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			registry: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue(null),
			},
			organizationRole: {
				findMany: vi.fn().mockResolvedValue([]),
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	},
}));

vi.mock("@dokploy/server/services/ai", () => ({
	saveAiSettings: vi.fn(),
	getAiSettingsByOrganizationId: vi.fn().mockResolvedValue([]),
	getAiSettingById: vi.fn(),
	deleteAiSettings: vi.fn(),
	getCustomAiProviders: vi.fn().mockResolvedValue([]),
	saveCustomAiProviders: vi.fn(),
}));

vi.mock("@dokploy/server/services/proprietary/audit-log", () => ({
	getAuditLogs: vi.fn().mockResolvedValue([]),
	createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn().mockResolvedValue(true),
}));

import { sshRouter } from "../../server/api/routers/ssh-key";
import { aiRouter } from "../../server/api/routers/ai";
import { auditLogRouter } from "../../server/api/routers/proprietary/audit-log";
import { certificateRouter } from "../../server/api/routers/certificate";
import { registryRouter } from "../../server/api/routers/registry";
import { dnsProviderRouter } from "../../server/api/routers/dns-provider";
import { customRoleRouter } from "../../server/api/routers/proprietary/custom-role";
import { requirePlatformAdminSession } from "../../utils/server-auth-guards";
import { MENU } from "../../components/layouts/side";

describe("Admin-Only Settings Tabs (AI, SSH Keys, Audit Logs)", () => {
	const customerCtx = {
		user: {
			id: "cust-1",
			email: "customer@company.com",
			role: "owner" as const,
			isPlatformAdmin: false,
		},
		session: {
			id: "sess-1",
			userId: "cust-1",
			activeOrganizationId: "org-cust-1",
		},
	};

	const adminCtx = {
		user: {
			id: "admin-1",
			email: "admin@hatdot.com",
			role: "owner" as const,
			isPlatformAdmin: true,
		},
		session: {
			id: "sess-admin",
			userId: "admin-1",
			activeOrganizationId: "org-admin-1",
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Page-level Server-Side Guards (requirePlatformAdminSession)", () => {
		it("redirects regular customer to /dashboard/home", async () => {
			const mockCtx = {
				req: {} as any,
			} as any;

			// Mock validateRequest in auth
			const authModule = await import("@dokploy/server/lib/auth");
			vi.spyOn(authModule, "validateRequest").mockResolvedValueOnce({
				user: customerCtx.user as any,
				session: customerCtx.session as any,
			});

			const result = await requirePlatformAdminSession(mockCtx);
			expect(result).toEqual({
				redirect: {
					permanent: false,
					destination: "/dashboard/home",
				},
			});
		});

		it("allows system admin to access the page", async () => {
			const mockCtx = {
				req: {} as any,
			} as any;

			const authModule = await import("@dokploy/server/lib/auth");
			vi.spyOn(authModule, "validateRequest").mockResolvedValueOnce({
				user: adminCtx.user as any,
				session: adminCtx.session as any,
			});

			const result = await requirePlatformAdminSession(mockCtx);
			expect(result).not.toHaveProperty("redirect");
			expect((result as any).user.isPlatformAdmin).toBe(true);
		});
	});

	describe("SSH Keys Router (sshRouter) Access Control", () => {
		it("strictly denies non-platform admin from listing SSH keys", async () => {
			const caller = sshRouter.createCaller(customerCtx as any);
			await expect(caller.all()).rejects.toThrowError(TRPCError);
			await expect(caller.all()).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("strictly denies non-platform admin from creating SSH keys", async () => {
			const caller = sshRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					name: "my-key",
					publicKey: "ssh-rsa AAA...",
					privateKey: "private...",
					organizationId: "org-cust-1",
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("strictly denies non-platform admin from generating SSH keys", async () => {
			const caller = sshRouter.createCaller(customerCtx as any);
			await expect(caller.generate({ type: "rsa" })).rejects.toThrowError(
				TRPCError,
			);
		});

		it("allows platform admin to list SSH keys", async () => {
			const caller = sshRouter.createCaller(adminCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});
	});

	describe("AI Settings Router (aiRouter) Access Control", () => {
		it("strictly denies non-platform admin from listing all AI settings", async () => {
			const caller = aiRouter.createCaller(customerCtx as any);
			await expect(caller.getAll()).rejects.toThrowError(TRPCError);
			await expect(caller.getAll()).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("strictly denies non-platform admin from creating AI settings", async () => {
			const caller = aiRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					name: "OpenAI",
					model: "gpt-4o",
					apiKey: "sk-...",
					isEnabled: true,
				} as any),
			).rejects.toThrowError(TRPCError);
		});

		it("strictly denies non-platform admin from saving custom AI providers", async () => {
			const caller = aiRouter.createCaller(customerCtx as any);
			await expect(
				caller.saveCustomProviders({
					providers: [],
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("allows platform admin to query AI settings", async () => {
			const caller = aiRouter.createCaller(adminCtx as any);
			const result = await caller.getAll();
			expect(result).toEqual([]);
		});
	});

	describe("Audit Logs Router (auditLogRouter) Access Control", () => {
		it("strictly denies non-platform admin from reading audit logs", async () => {
			const caller = auditLogRouter.createCaller(customerCtx as any);
			await expect(caller.all({})).rejects.toThrowError(TRPCError);
			await expect(caller.all({})).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("allows platform admin to read audit logs", async () => {
			const caller = auditLogRouter.createCaller(adminCtx as any);
			const result = await caller.all({});
			expect(result).toEqual([]);
		});
	});

	describe("Certificates Router (certificateRouter) Access Control", () => {
		it("strictly denies non-platform admin from listing certificates", async () => {
			const caller = certificateRouter.createCaller(customerCtx as any);
			await expect(caller.all()).rejects.toThrowError(TRPCError);
			await expect(caller.all()).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("strictly denies non-platform admin from creating certificates in Traefik directory", async () => {
			const caller = certificateRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					name: "wildcard-cert",
					certificateData: "-----BEGIN CERTIFICATE-----...",
					privateKey: "-----BEGIN PRIVATE KEY-----...",
					organizationId: "org-cust-1",
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("allows platform admin to list certificates", async () => {
			const caller = certificateRouter.createCaller(adminCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});
	});

	describe("Registry Router (registryRouter) Access Control", () => {
		it("returns empty array for non-platform admin when listing registries", async () => {
			const caller = registryRouter.createCaller(customerCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});

		it("strictly denies non-platform admin from creating a registry (docker login on host)", async () => {
			const caller = registryRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					registryName: "Docker Hub",
					username: "myuser",
					password: "mypassword",
					registryUrl: "docker.io",
					registryType: "cloud",
					imagePrefix: null,
				}),
			).rejects.toThrowError(TRPCError);
			await expect(
				caller.create({
					registryName: "Docker Hub",
					username: "myuser",
					password: "mypassword",
					registryUrl: "docker.io",
					registryType: "cloud",
					imagePrefix: null,
				}),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("strictly denies non-platform admin from removing a registry (docker logout on host)", async () => {
			const caller = registryRouter.createCaller(customerCtx as any);
			await expect(
				caller.remove({
					registryId: "reg-1",
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("strictly denies non-platform admin from testing a registry", async () => {
			const caller = registryRouter.createCaller(customerCtx as any);
			await expect(
				caller.testRegistry({
					username: "myuser",
					password: "mypassword",
					registryUrl: "docker.io",
					registryType: "cloud",
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("allows platform admin to list registries", async () => {
			const caller = registryRouter.createCaller(adminCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});
	});

	describe("DNS Provider Router (dnsProviderRouter) Access Control", () => {
		it("returns empty array for non-platform admin when listing DNS providers", async () => {
			const caller = dnsProviderRouter.createCaller(customerCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});

		it("strictly denies non-platform admin from creating a DNS provider", async () => {
			const caller = dnsProviderRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					name: "My Cloudflare",
					config: {
						providerType: "cloudflare",
						apiToken: "cf-token",
					},
				}),
			).rejects.toThrowError(TRPCError);
			await expect(
				caller.create({
					name: "My Cloudflare",
					config: {
						providerType: "cloudflare",
						apiToken: "cf-token",
					},
				}),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Platform administrator access required.",
			});
		});

		it("strictly denies non-platform admin from testing a DNS provider connection", async () => {
			const caller = dnsProviderRouter.createCaller(customerCtx as any);
			await expect(
				caller.testConnection({
					config: {
						providerType: "cloudflare",
						apiToken: "cf-token",
					},
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("strictly denies non-platform admin from creating a DNS record", async () => {
			const caller = dnsProviderRouter.createCaller(customerCtx as any);
			await expect(
				caller.createRecord({
					dnsProviderId: "dns-1",
					zoneId: "zone-1",
					name: "app.example.com",
					type: "A",
					content: "1.2.3.4",
					ttl: 300,
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("allows platform admin to list DNS providers", async () => {
			const caller = dnsProviderRouter.createCaller(adminCtx as any);
			const result = await caller.all();
			expect(result).toEqual([]);
		});
	});

	describe("Settings Menu Security & Hygiene", () => {
		it("does not expose DNS Providers tab to regular customers", () => {
			const dnsItem = MENU.settings.find((item) => item.title === "DNS Providers");
			expect(dnsItem).toBeDefined();
			expect(dnsItem?.isEnabled?.({ isPlatformAdmin: false, isCloud: true })).toBe(false);
			expect(dnsItem?.isEnabled?.({ isPlatformAdmin: true, isCloud: true })).toBe(true);
		});

		it("does not expose Registry tab to regular customers", () => {
			const regItem = MENU.settings.find((item) => item.title === "Registry");
			expect(regItem).toBeDefined();
			expect(regItem?.isEnabled?.({ isPlatformAdmin: false, isCloud: true })).toBe(false);
			expect(regItem?.isEnabled?.({ isPlatformAdmin: true, isCloud: true })).toBe(true);
		});

		it("points Billing to canonical /dashboard/billing without obsolete separate Invoices tab", () => {
			const billingItem = MENU.settings.find((item) => item.title === "Billing");
			expect(billingItem && "url" in billingItem ? billingItem.url : "").toBe("/dashboard/billing");

			const invoicesItem = MENU.settings.find((item) => item.title === "Invoices");
			expect(invoicesItem).toBeUndefined();
		});
	});

	describe("Custom Roles & Member Permissions Tenant Isolation", () => {
		it("strictly sanitizes getStatements for non-platform admin, omitting infrastructure resources", async () => {
			const caller = customRoleRouter.createCaller(customerCtx as any);
			const statements = await caller.getStatements();
			expect(statements).not.toHaveProperty("docker");
			expect(statements).not.toHaveProperty("traefikFiles");
			expect(statements).not.toHaveProperty("sshKeys");
			expect(statements).not.toHaveProperty("server");
			expect(statements).not.toHaveProperty("registry");
			expect(statements).not.toHaveProperty("certificate");
		});

		it("allows platform admin to see all statements including infrastructure resources", async () => {
			const caller = customRoleRouter.createCaller(adminCtx as any);
			const statements = await caller.getStatements();
			expect(statements).toHaveProperty("docker");
			expect(statements).toHaveProperty("traefikFiles");
			expect(statements).toHaveProperty("sshKeys");
			expect(statements).toHaveProperty("server");
			expect(statements).toHaveProperty("registry");
			expect(statements).toHaveProperty("certificate");
		});

		it("strictly denies non-platform admin from creating a role with docker or server infrastructure permissions", async () => {
			const caller = customRoleRouter.createCaller(customerCtx as any);
			await expect(
				caller.create({
					roleName: "hacker-role",
					permissions: {
						docker: ["read"],
					},
				}),
			).rejects.toThrowError(TRPCError);
			await expect(
				caller.create({
					roleName: "hacker-role",
					permissions: {
						docker: ["read"],
					},
				}),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: 'Resource "docker" cannot be assigned to custom roles',
			});
		});
	});
});


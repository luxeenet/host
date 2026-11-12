import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@dokploy/server", () => ({
	createSshKey: vi.fn(),
	findSSHKeyById: vi.fn(),
	generateSSHKey: vi.fn(),
	removeSSHKeyById: vi.fn(),
	updateSSHKeyById: vi.fn(),
	IS_CLOUD: false,
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			sshKeys: {
				findMany: vi.fn().mockResolvedValue([]),
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
import { requirePlatformAdminSession } from "../../utils/server-auth-guards";

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
});


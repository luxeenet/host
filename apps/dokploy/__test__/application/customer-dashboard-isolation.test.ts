import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock @dokploy/server
vi.mock("@dokploy/server", () => {
	return {
		findApplicationById: vi.fn(),
		findRedirectById: vi.fn(),
		findSecurityById: vi.fn(),
		createRedirect: vi.fn(),
		updateRedirectById: vi.fn(),
		removeRedirectById: vi.fn(),
		createSecurity: vi.fn(),
		updateSecurityById: vi.fn(),
		deleteSecurityById: vi.fn(),
		readConfig: vi.fn().mockReturnValue("http:\n  routers:\n    internal-router:\n"),
		writeConfig: vi.fn(),
		readRemoteConfig: vi.fn(),
		writeConfigRemote: vi.fn(),
		execAsync: vi.fn(),
		execAsyncRemote: vi.fn(),
		IS_CLOUD: false,
	};
});

// Mock permission checking
vi.mock("@dokploy/server/services/permission", () => ({
	checkServiceAccess: vi.fn().mockResolvedValue(true),
	checkServicePermissionAndAccess: vi.fn().mockResolvedValue(true),
	findMemberByUserId: vi.fn().mockResolvedValue(null),
}));

// Mock git provider access
vi.mock("@dokploy/server/services/git-provider", () => ({
	canEditDeployGitSource: vi.fn().mockResolvedValue(true),
}));

// Mock plan entitlement
vi.mock("@dokploy/server/services/plan-entitlement", () => ({
	PlanEntitlementService: {
		checkSubscriptionActive: vi.fn().mockResolvedValue({ allowed: true }),
		assertRuntimeResources: vi.fn().mockResolvedValue(true),
		withAtomicQuotaLock: vi.fn().mockImplementation((_, fn) => fn({})),
		checkCanCreateApplication: vi.fn().mockResolvedValue({ allowed: true }),
	},
	assertEntitlement: vi.fn().mockResolvedValue(true),
}));

// Mock audit
vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn().mockResolvedValue(undefined),
}));

import {
	findApplicationById,
	findRedirectById,
	findSecurityById,
	updateSecurityById,
	readConfig,
	execAsync,
} from "@dokploy/server";
import { applicationRouter } from "@/server/api/routers/application";
import { redirectsRouter } from "@/server/api/routers/redirects";
import { securityRouter } from "@/server/api/routers/security";

describe("HatDot Customer Dashboard Simplification & Infrastructure Isolation", () => {
	const customerCtx = {
		user: {
			id: "customer-user-1",
			email: "customer@tenant.com",
			role: "owner" as const,
			ownerId: "customer-user-1",
			enableEnterpriseFeatures: true,
			isValidEnterpriseLicense: true,
			isPlatformAdmin: false, // Standard customer, NOT a platform admin
		},
		session: {
			id: "session-1",
			userId: "customer-user-1",
			activeOrganizationId: "org-customer-tenant",
			expiresAt: new Date(Date.now() + 3600000),
		},
		db: {} as any,
		req: {} as any,
		res: {} as any,
	};

	const platformAdminCtx = {
		...customerCtx,
		user: {
			...customerCtx.user,
			id: "admin-user-1",
			email: "admin@hatdot.com",
			isPlatformAdmin: true, // Platform administrator
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(readConfig).mockReturnValue("http:\n  routers:\n    internal-router:\n");
	});

	describe("1. Traefik Infrastructure Lockdown (Platform Admin Only)", () => {
		it("should reject standard customer from reading Traefik configuration with 403 Forbidden", async () => {
			const caller = applicationRouter.createCaller(customerCtx as any);

			await expect(
				caller.readTraefikConfig({ applicationId: "app-123" }),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Platform administrator access required.",
				}),
			);
		});

		it("should reject standard customer from modifying Traefik configuration with 403 Forbidden", async () => {
			const caller = applicationRouter.createCaller(customerCtx as any);

			await expect(
				caller.updateTraefikConfig({
					applicationId: "app-123",
					traefikConfig: "http:\n  routers:\n    leaked-router:\n",
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Platform administrator access required.",
				}),
			);
		});

		it("should allow platform administrator to read Traefik configuration", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				appName: "customer-app-prod",
				serverId: null,
			} as any);

			const caller = applicationRouter.createCaller(platformAdminCtx as any);
			const result = await caller.readTraefikConfig({ applicationId: "app-123" });
			expect(result).toBeDefined();
			expect(result).toContain("http:");
		});
	});

	describe("2. Security & Basic Auth Credential Masking", () => {
		it("should mask security passwords in security.one query", async () => {
			vi.mocked(findSecurityById).mockResolvedValueOnce({
				securityId: "sec-1",
				applicationId: "app-123",
				username: "developer",
				password: "rawSuperSecretPassword123!",
			} as any);

			const caller = securityRouter.createCaller(customerCtx as any);
			const result = await caller.one({ securityId: "sec-1" });

			expect(result.password).toBe("••••••••");
			expect(result.password).not.toContain("rawSuperSecretPassword");
		});

		it("should mask security passwords in application.one query", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				name: "My Web App",
				appName: "my-web-app",
				sourceType: "github",
				environment: {
					projectId: "proj-1",
					project: {
						organizationId: "org-customer-tenant",
					},
				},
				security: [
					{
						securityId: "sec-1",
						applicationId: "app-123",
						username: "admin_user",
						password: "unmasked_secret_password_here",
					},
				],
			} as any);

			const caller = applicationRouter.createCaller(customerCtx as any);
			const result = await caller.one({ applicationId: "app-123" });

			expect(result.security).toBeDefined();
			expect(result.security?.[0]?.password).toBe("••••••••");
			expect(result.security?.[0]?.password).not.toContain("unmasked_secret");
		});

		it("should not overwrite existing password when masked bullets are submitted on update", async () => {
			vi.mocked(findSecurityById).mockResolvedValueOnce({
				securityId: "sec-1",
				applicationId: "app-123",
				username: "developer",
				password: "stored_hashed_or_plain_password",
			} as any);

			const caller = securityRouter.createCaller(customerCtx as any);
			await caller.update({
				securityId: "sec-1",
				username: "developer_updated",
				password: "••••••••",
			});

			expect(updateSecurityById).toHaveBeenCalledWith(
				"sec-1",
				expect.not.objectContaining({ password: "••••••••" }),
			);
		});
	});

	describe("3. Redirects Validation & Infinite Loop Prevention", () => {
		it("should reject redirect when regex pattern is invalid syntax", async () => {
			const caller = redirectsRouter.createCaller(customerCtx as any);

			await expect(
				caller.create({
					applicationId: "app-123",
					regex: "[unclosed-bracket",
					replacement: "/clean",
					permanent: false,
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "BAD_REQUEST",
					message: expect.stringContaining("Invalid regular expression pattern"),
				}),
			);
		});

		it("should reject self-referencing redirect rules (identical source and destination)", async () => {
			const caller = redirectsRouter.createCaller(customerCtx as any);

			await expect(
				caller.create({
					applicationId: "app-123",
					regex: "/api/v1",
					replacement: "/api/v1",
					permanent: false,
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "BAD_REQUEST",
					message: "Redirect source and target cannot be identical (would cause an infinite loop).",
				}),
			);
		});

		it("should reject self-matching patterns where target matches source without variable capture", async () => {
			const caller = redirectsRouter.createCaller(customerCtx as any);

			await expect(
				caller.create({
					applicationId: "app-123",
					regex: "^/blog",
					replacement: "/blog/post",
					permanent: false,
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "BAD_REQUEST",
					message: expect.stringContaining("Target replacement matches the source pattern without group substitution"),
				}),
			);
		});

		it("should reject circular redirect loops with existing rules (A -> B and B -> A)", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				redirects: [
					{
						redirectId: "red-existing",
						regex: "/old-page",
						replacement: "/new-page",
						permanent: true,
					},
				],
			} as any);

			const caller = redirectsRouter.createCaller(customerCtx as any);

			await expect(
				caller.create({
					applicationId: "app-123",
					regex: "/new-page",
					replacement: "/old-page",
					permanent: false,
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "BAD_REQUEST",
					message: "This redirect rule forms a circular loop with an existing redirect rule.",
				}),
			);
		});

		it("should accept valid non-looping redirect rules with capture groups", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				redirects: [],
			} as any);

			const caller = redirectsRouter.createCaller(customerCtx as any);

			const result = await caller.create({
				applicationId: "app-123",
				regex: "^/legacy/(.*)",
				replacement: "/modern/$1",
				permanent: true,
			});

			expect(result).toBe(true);
		});
	});

	describe("4. Container Run Command Execution & Tenant Isolation", () => {
		it("should reject cross-tenant command execution with UNAUTHORIZED", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-victim",
				appName: "victim-app",
				environment: {
					project: {
						organizationId: "org-other-customer", // Different tenant!
					},
				},
			} as any);

			const caller = applicationRouter.createCaller(customerCtx as any);

			await expect(
				caller.runContainerCommand({
					applicationId: "app-victim",
					command: "npm run migrate",
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "UNAUTHORIZED",
				}),
			);
		});

		it("should reject command execution if application container is not running", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				appName: "my-stopped-app",
				environment: {
					project: {
						organizationId: "org-customer-tenant",
					},
				},
			} as any);

			// Docker ps returns empty string (container not running)
			vi.mocked(execAsync).mockResolvedValue({ stdout: "", stderr: "" });

			const caller = applicationRouter.createCaller(customerCtx as any);

			await expect(
				caller.runContainerCommand({
					applicationId: "app-123",
					command: "npm run migrate",
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "PRECONDITION_FAILED",
					message: expect.stringContaining("container is not currently running"),
				}),
			);
		});

		it("should execute command inside container and enforce 100KB output limit", async () => {
			vi.mocked(findApplicationById).mockResolvedValueOnce({
				applicationId: "app-123",
				appName: "my-running-app",
				environment: {
					project: {
						organizationId: "org-customer-tenant",
					},
				},
			} as any);

			const largeOutput = "X".repeat(150 * 1024);

			// 1. Docker ps finds container id
			// 2. Command executes and returns large output
			vi.mocked(execAsync).mockImplementation(async (cmd: string) => {
				if (cmd.includes("docker ps")) {
					return { stdout: "a1b2c3d4e5f6\n", stderr: "" };
				}
				if (cmd.includes("docker exec")) {
					return { stdout: largeOutput, stderr: "" };
				}
				return { stdout: "", stderr: "" };
			});

			const caller = applicationRouter.createCaller(customerCtx as any);
			const result = await caller.runContainerCommand({
				applicationId: "app-123",
				command: "cat large_log_file.txt",
			});

			expect(result.exitCode).toBe(0);
			expect(result.truncated).toBe(true);
			expect(result.stdout).toContain("[Output truncated - exceeded 100KB limit]");
			expect(result.stdout.length).toBeLessThan(120 * 1024);
		});
	});
});

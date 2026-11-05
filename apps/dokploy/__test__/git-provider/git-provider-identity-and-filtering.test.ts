import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock variables
const mockGetIntegrationState = vi.hoisted(() => vi.fn());
const mockGetPlatformGithubIntegration = vi.hoisted(() => vi.fn());
const mockGetPlatformGithubInstallationUrl = vi.hoisted(() => vi.fn());
const mockGetAccessibleGitProviderIds = vi.hoisted(() => vi.fn());
const mockAssertIntegrationAvailable = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => ({
	gitProvider: {
		findMany: vi.fn(),
	},
	github: {
		findMany: vi.fn(),
	},
	gitlab: {
		findMany: vi.fn(),
	},
	bitbucket: {
		findMany: vi.fn(),
	},
	gitea: {
		findMany: vi.fn(),
	},
}));

vi.mock("@dokploy/server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dokploy/server")>();
	return {
		...actual,
		getIntegrationState: mockGetIntegrationState,
		getPlatformGithubIntegration: mockGetPlatformGithubIntegration,
		getPlatformGithubInstallationUrl: mockGetPlatformGithubInstallationUrl,
		getAccessibleGitProviderIds: mockGetAccessibleGitProviderIds,
		assertIntegrationAvailable: mockAssertIntegrationAvailable,
	};
});

vi.mock("@dokploy/server/db", () => {
	const createChain = () => {
		const chain: any = {
			set: () => chain,
			where: () => chain,
			values: () => chain,
			returning: () => Promise.resolve([{}]),
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			rightJoin: () => chain,
			fullJoin: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			offset: () => chain,
			groupBy: () => chain,
			having: () => chain,
			onConflictDoUpdate: () => chain,
			onConflictDoNothing: () => chain,
			then: (resolve: (value: unknown) => void) => {
				resolve([]);
			},
		};
		return chain;
	};

	return {
		db: {
			select: vi.fn(() => createChain()),
			query: mockDbQuery,
		},
	};
});

vi.mock("@/server/api/trpc", async () => {
	const proc: any = {
		use: () => proc,
		input: () => proc,
		query: (fn: any) => fn,
		mutation: (fn: any) => fn,
	};
	return {
		createTRPCRouter: (routes: any) => routes,
		protectedProcedure: proc,
		withPermission: () => proc,
	};
});

import { gitProviderRouter } from "@/server/api/routers/git-provider";
import { githubRouter } from "@/server/api/routers/github";
import { gitlabRouter } from "@/server/api/routers/gitlab";
import { bitbucketRouter } from "@/server/api/routers/bitbucket";
import { giteaRouter } from "@/server/api/routers/gitea";
import { verifyOAuthState } from "@dokploy/server";

describe("HatDot Git Provider Single Source of Truth & Identity Resolution", () => {
	const sessionTenant1 = {
		userId: "user-1",
		activeOrganizationId: "org-1",
	};

	const sessionTenant2 = {
		userId: "user-2",
		activeOrganizationId: "org-2",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAccessibleGitProviderIds.mockResolvedValue(
			new Set(["gp-gh-1", "gp-gl-1", "gp-bb-1", "gp-gt-1"]),
		);
		mockAssertIntegrationAvailable.mockResolvedValue(undefined);
	});

	describe("1. gitProviderRouter.getAll respects admin enabled/disabled settings", () => {
		it("returns only GitHub when GitLab, Bitbucket, and Gitea are disabled by admin", async () => {
			mockGetIntegrationState.mockImplementation(async (type: string) => {
				if (type === "github") return "enabled";
				if (type === "gitlab") return "disabled";
				if (type === "bitbucket") return "disabled";
				if (type === "gitea") return "disabled";
				return "disabled";
			});

			mockDbQuery.gitProvider.findMany.mockResolvedValue([
				{ gitProviderId: "gp-gh-1", providerType: "github", name: "Official GitHub" },
				{ gitProviderId: "gp-gl-1", providerType: "gitlab", name: "GitLab Instance" },
				{ gitProviderId: "gp-bb-1", providerType: "bitbucket", name: "Bitbucket Team" },
				{ gitProviderId: "gp-gt-1", providerType: "gitea", name: "Gitea Server" },
			]);

			const result = await (gitProviderRouter.getAll as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toHaveLength(1);
			expect(result[0].providerType).toBe("github");
			expect(result[0].gitProviderId).toBe("gp-gh-1");
		});

		it("returns empty array if GitHub is also disabled", async () => {
			mockGetIntegrationState.mockResolvedValue("disabled");

			mockDbQuery.gitProvider.findMany.mockResolvedValue([
				{ gitProviderId: "gp-gh-1", providerType: "github", name: "Official GitHub" },
			]);

			const result = await (gitProviderRouter.getAll as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toEqual([]);
		});
	});

	describe("2. Provider-specific routers gated by admin enablement", () => {
		it("githubProviders returns empty array when GitHub is disabled", async () => {
			mockGetIntegrationState.mockResolvedValue("disabled");

			const result = await (githubRouter.githubProviders as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toEqual([]);
			expect(mockDbQuery.github.findMany).not.toHaveBeenCalled();
		});

		it("gitlabProviders returns empty array when GitLab is disabled", async () => {
			mockGetIntegrationState.mockResolvedValue("disabled");

			const result = await (gitlabRouter.gitlabProviders as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toEqual([]);
			expect(mockDbQuery.gitlab.findMany).not.toHaveBeenCalled();
		});

		it("bitbucketProviders returns empty array when Bitbucket is disabled", async () => {
			mockGetIntegrationState.mockResolvedValue("disabled");

			const result = await (bitbucketRouter.bitbucketProviders as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toEqual([]);
			expect(mockDbQuery.bitbucket.findMany).not.toHaveBeenCalled();
		});

		it("giteaProviders returns empty array when Gitea is disabled", async () => {
			mockGetIntegrationState.mockResolvedValue("disabled");

			const result = await (giteaRouter.giteaProviders as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result).toEqual([]);
			expect(mockDbQuery.gitea.findMany).not.toHaveBeenCalled();
		});
	});

	describe("3. HatDot GitHub App Identity & Dynamic App ID Resolution", () => {
		it("resolves the official HatDot GitHub App URL and appName dynamically", async () => {
			mockGetPlatformGithubIntegration.mockResolvedValue({
				appId: 987654,
				appSlug: "hatdot-cloud",
				organization: "HatDot",
			});

			mockGetPlatformGithubInstallationUrl.mockImplementation(
				async (state: string) => `https://github.com/apps/hatdot-cloud/installations/new?state=${state}`,
			);

			const result = await (githubRouter.getInstallationUrl as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result.appName).toBe("hatdot-cloud");
			expect(result.appId).toBe(987654);
			expect(result.url).toContain("https://github.com/apps/hatdot-cloud/installations/new?state=");

			// Extract state from the URL and verify cryptographic HMAC CSRF token
			const state = new URL(result.url).searchParams.get("state");
			expect(state).toBeTruthy();

			const payload = verifyOAuthState(state!, {
				provider: "github",
				userId: "user-1",
				organizationId: "org-1",
				providerId: "987654",
			});
			expect(payload.p).toBe("github");
			expect(payload.i).toBe("987654");
			expect(payload.u).toBe("user-1");
			expect(payload.o).toBe("org-1");
		});

		it("throws PRECONDITION_FAILED if platform GitHub App is not configured in admin settings", async () => {
			mockGetPlatformGithubIntegration.mockResolvedValue(null);

			await expect(
				(githubRouter.getInstallationUrl as any)({
					ctx: { session: sessionTenant1 },
				}),
			).rejects.toThrowError(TRPCError);

			await expect(
				(githubRouter.getInstallationUrl as any)({
					ctx: { session: sessionTenant1 },
				}),
			).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("HatDot GitHub App has not been configured"),
			});
		});

		it("throws PRECONDITION_FAILED if platform GitHub App slug is missing", async () => {
			mockGetPlatformGithubIntegration.mockResolvedValue({
				appId: 987654,
				appSlug: undefined,
			});
			mockGetPlatformGithubInstallationUrl.mockResolvedValue(null);

			await expect(
				(githubRouter.getInstallationUrl as any)({
					ctx: { session: sessionTenant1 },
				}),
			).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("App slug is missing"),
			});
		});

		it("never uses Dokploy branding or hardcoded numeric ID 65554", async () => {
			mockGetPlatformGithubIntegration.mockResolvedValue({
				appId: 445566,
				appSlug: "hatdot-hosting-app",
			});
			mockGetPlatformGithubInstallationUrl.mockImplementation(
				async (state: string) => `https://github.com/apps/hatdot-hosting-app/installations/new?state=${state}`,
			);

			const result = await (githubRouter.getInstallationUrl as any)({
				ctx: { session: sessionTenant1 },
			});

			expect(result.appName).not.toContain("dokploy");
			expect(result.appName).not.toContain("Dokploy");
			expect(result.appId).not.toBe(65554);
			expect(result.url).not.toContain("65554");
			expect(result.url).not.toContain("dokploy");
		});
	});

	describe("4. Multi-Tenant CSRF & Installation Isolation", () => {
		it("generates distinct isolated state tokens for different tenant sessions for the same platform App ID", async () => {
			mockGetPlatformGithubIntegration.mockResolvedValue({
				appId: 100200,
				appSlug: "hatdot-official",
			});
			mockGetPlatformGithubInstallationUrl.mockImplementation(
				async (state: string) => `https://github.com/apps/hatdot-official/installations/new?state=${state}`,
			);

			const resultTenant1 = await (githubRouter.getInstallationUrl as any)({
				ctx: { session: sessionTenant1 },
			});
			const resultTenant2 = await (githubRouter.getInstallationUrl as any)({
				ctx: { session: sessionTenant2 },
			});

			const state1 = new URL(resultTenant1.url).searchParams.get("state")!;
			const state2 = new URL(resultTenant2.url).searchParams.get("state")!;

			expect(state1).not.toBe(state2);

			const payload1 = verifyOAuthState(state1, {
				provider: "github",
				userId: "user-1",
				organizationId: "org-1",
				providerId: "100200",
			});
			const payload2 = verifyOAuthState(state2, {
				provider: "github",
				userId: "user-2",
				organizationId: "org-2",
				providerId: "100200",
			});

			expect(payload1.o).toBe("org-1");
			expect(payload1.u).toBe("user-1");

			expect(payload2.o).toBe("org-2");
			expect(payload2.u).toBe("user-2");
		});
	});
});

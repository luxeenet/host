import { createHmac } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateRequest = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn());
const mockCreateGithub = vi.hoisted(() => vi.fn());
const mockOctokitRequest = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => ({
	github: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
	},
	applications: {
		findMany: vi.fn(),
	},
	compose: {
		findMany: vi.fn(),
	},
}));
const mockQueueAdd = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());
const mockShouldDeploy = vi.hoisted(() => vi.fn(() => true));

vi.mock("@dokploy/server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dokploy/server")>();
	return {
		...actual,
		validateRequest: mockValidateRequest,
		createGithub: mockCreateGithub,
		shouldDeploy: mockShouldDeploy,
	};
});

vi.mock("@dokploy/server/services/permission", () => ({
	hasPermission: mockHasPermission,
}));

vi.mock("@dokploy/server/services/integration-settings", () => ({
	assertIntegrationAvailable: vi.fn().mockResolvedValue(undefined),
	getPlatformGithubIntegration: vi.fn().mockResolvedValue(null),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: mockDbQuery,
		update: () => ({
			set: () => ({
				where: () => ({
					returning: mockDbUpdate,
				}),
			}),
		}),
	},
}));

vi.mock("octokit", () => ({
	Octokit: class {
		request = mockOctokitRequest;
	},
}));

vi.mock("@octokit/webhooks", () => ({
	Webhooks: vi.fn().mockImplementation(function Webhooks() {
		return {
			verify: mockVerify,
		};
	}),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	myQueue: {
		add: mockQueueAdd,
	},
}));

import setupHandler from "@/pages/api/providers/github/setup";
import webhookHandler from "@/pages/api/deploy/github";
import {
	authGithub,
	cloneGithubRepository,
} from "@dokploy/server/utils/providers/github";
import { _clearDeliveryCacheForTesting } from "@dokploy/server/utils/providers/github-delivery-dedup";

const ORG = "org-test-123";
const USER = "user-test-456";

const buildRes = () => {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		redirectedTo: undefined as string | undefined,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(payload: unknown) {
			res.body = payload;
			return res;
		},
		redirect(_code: number, url: string) {
			res.redirectedTo = url;
			return res;
		},
	};
	return res;
};

describe("GitHub Integration Hardening & Gap Fixes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_clearDeliveryCacheForTesting();
		mockValidateRequest.mockResolvedValue({
			user: { id: USER },
			session: { activeOrganizationId: ORG },
		});
		mockHasPermission.mockResolvedValue(true);
		mockDbUpdate.mockResolvedValue([{ githubId: "gh-1" }]);
	});

	// 1. Standard GitHub App installation redirect without code
	it("1. Allows standard GitHub App installation redirect without code (gh_setup)", async () => {
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-1",
			gitProvider: { organizationId: ORG },
		});

		const req = {
			query: {
				installation_id: "inst-99999",
				setup_action: "install",
				state: "gh_setup:gh-1",
			},
			headers: {},
		} as unknown as NextApiRequest;

		const res = buildRes();
		await setupHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(200);
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
		expect(mockDbQuery.github.findFirst).toHaveBeenCalled();
	});

	// 2. Reject cross-tenant installation attempt
	it("2. Rejects GitHub App installation for another tenant's provider ID", async () => {
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-other-org",
			gitProvider: { organizationId: "other-org-id" }, // Cross-tenant!
		});

		const req = {
			query: {
				installation_id: "inst-99999",
				setup_action: "install",
				state: "gh_setup:gh-other-org",
			},
			headers: {},
		} as unknown as NextApiRequest;

		const res = buildRes();
		await setupHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({ error: "Github provider not found" });
	});

	// 3. Manifest conversion flow with valid code
	it("3. Successfully converts manifest flow when code and state match current tenant", async () => {
		mockOctokitRequest.mockResolvedValue({
			data: {
				name: "HatDot-App",
				html_url: "https://github.com/apps/hatdot-app",
				id: 12345,
				client_id: "cid-123",
				client_secret: "csec-456",
				webhook_secret: "wsec-789",
				pem: "test-pem-key",
			},
		});

		const req = {
			query: {
				code: "manifest-valid-code",
				state: `gh_init:${ORG}:${USER}`,
			},
			headers: {},
		} as unknown as NextApiRequest;

		const res = buildRes();
		await setupHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(200);
		expect(res.redirectedTo).toBe("/dashboard/settings/git-providers");
		expect(mockCreateGithub).toHaveBeenCalledWith(
			expect.objectContaining({
				githubAppId: 12345,
				githubClientId: "cid-123",
			}),
			ORG,
			USER,
		);
	});

	// 4. Rejection of gh_init without code
	it("4. Rejects manifest conversion (gh_init) if code is missing", async () => {
		const req = {
			query: {
				state: `gh_init:${ORG}:${USER}`,
			},
			headers: {},
		} as unknown as NextApiRequest;

		const res = buildRes();
		await setupHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({ error: "Missing code parameter" });
	});

	// 5. Rejection of gh_init with mismatched tenant state
	it("5. Rejects manifest conversion if state organization does not match session", async () => {
		const req = {
			query: {
				code: "manifest-valid-code",
				state: `gh_init:attacker-org:${USER}`,
			},
			headers: {},
		} as unknown as NextApiRequest;

		const res = buildRes();
		await setupHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({
			error: "State organization mismatch: request not authorized",
		});
	});

	// 6. Webhook verification with raw request body
	it("6. Verifies webhook using raw request payload", async () => {
		mockVerify.mockResolvedValue(true);
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-provider-id",
			githubInstallationId: "inst-123",
			githubWebhookSecret: "secret-abc",
		});
		mockDbQuery.applications.findMany.mockResolvedValue([]);
		mockDbQuery.compose.findMany.mockResolvedValue([]);

		const payload = {
			installation: { id: "inst-123" },
			repository: { name: "my-repo", owner: { login: "my-org" } },
			ref: "refs/heads/main",
			head_commit: { message: "feat: initial commit", id: "sha-123456" },
			commits: [
				{
					id: "sha-123456",
					message: "feat: initial commit",
					added: ["index.js"],
					modified: [],
					removed: [],
				},
			],
		};

		const req = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=validsig",
				"x-github-event": "push",
				"x-github-delivery": "delivery-uuid-1",
			},
			body: payload,
		} as unknown as NextApiRequest;

		const res = buildRes();
		await webhookHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(200);
		expect(mockVerify).toHaveBeenCalled();
	});

	// 7. Reject webhook when signature header is missing or verification fails
	it("7. Rejects webhook with 401 when signature is missing or invalid", async () => {
		// Missing signature
		const reqNoSig = {
			method: "POST",
			headers: {},
			body: {},
		} as unknown as NextApiRequest;

		const resNoSig = buildRes();
		await webhookHandler(reqNoSig, resNoSig as unknown as NextApiResponse);
		expect(resNoSig.statusCode).toBe(401);

		// Invalid signature
		mockVerify.mockResolvedValue(false);
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-provider-id",
			githubInstallationId: "inst-123",
			githubWebhookSecret: "secret-abc",
		});

		const reqBadSig = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=invalid",
				"x-github-event": "push",
			},
			body: { installation: { id: "inst-123" } },
		} as unknown as NextApiRequest;

		const resBadSig = buildRes();
		await webhookHandler(reqBadSig, resBadSig as unknown as NextApiResponse);
		expect(resBadSig.statusCode).toBe(401);
		expect(resBadSig.body).toEqual({ message: "Unauthorized" });
	});

	// 8. Durable webhook delivery deduplication
	it("8. Deduplicates webhook deliveries using x-github-delivery UUID header", async () => {
		mockVerify.mockResolvedValue(true);
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-provider-id",
			githubInstallationId: "inst-123",
			githubWebhookSecret: "secret-abc",
		});
		mockDbQuery.applications.findMany.mockResolvedValue([
			{
				applicationId: "app-1",
				name: "my-app",
				autoDeploy: true,
				triggerType: "push",
				branch: "main",
				repository: "my-repo",
				owner: "my-org",
				sourceType: "github",
				githubId: "gh-provider-id",
			},
		]);
		mockDbQuery.compose.findMany.mockResolvedValue([]);

		const payload = {
			installation: { id: "inst-123" },
			repository: { name: "my-repo", owner: { login: "my-org" } },
			ref: "refs/heads/main",
			head_commit: { message: "feat: initial commit", id: "sha-123456" },
			commits: [
				{
					id: "sha-123456",
					message: "feat: initial commit",
					added: ["index.js"],
					modified: [],
					removed: [],
				},
			],
		};

		const deliveryUUID = "test-delivery-uuid-999";

		const reqFirst = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=validsig",
				"x-github-event": "push",
				"x-github-delivery": deliveryUUID,
			},
			body: payload,
		} as unknown as NextApiRequest;

		// First delivery
		const resFirst = buildRes();
		await webhookHandler(reqFirst, resFirst as unknown as NextApiResponse);
		if (resFirst.statusCode !== 200) {
			console.log("resFirst failed with body:", resFirst.body);
		}
		expect(resFirst.statusCode).toBe(200);
		expect(mockQueueAdd).toHaveBeenCalledTimes(1);

		// Second duplicate delivery with the exact same UUID
		const reqDuplicate = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=validsig",
				"x-github-event": "push",
				"x-github-delivery": deliveryUUID,
			},
			body: payload,
		} as unknown as NextApiRequest;

		const resDuplicate = buildRes();
		await webhookHandler(
			reqDuplicate,
			resDuplicate as unknown as NextApiResponse,
		);

		expect(resDuplicate.statusCode).toBe(200);
		expect(resDuplicate.body).toEqual({
			message: "Delivery already processed",
			deliveryId: deliveryUUID,
		});
		// Should NOT enqueue another job!
		expect(mockQueueAdd).toHaveBeenCalledTimes(1);
	});

	// 9. Auth error when installationId is missing
	it("9. Produces clear user-friendly error when GitHub App installationId is missing", () => {
		const providerWithoutInstall = {
			githubId: "gh-1",
			githubAppId: 12345,
			githubPrivateKey: "private-key-test",
			githubInstallationId: null, // missing!
			githubUrl: "https://github.com",
			gitProviderId: "gp-1",
			githubAppName: "test",
			githubClientId: "cid",
			githubClientSecret: "csec",
			githubWebhookSecret: "wsec",
		};

		expect(() => authGithub(providerWithoutInstall as any)).toThrowError(
			/GitHub App is not installed yet/i,
		);
	});

	// 10. Auth error when App ID or Private Key is missing
	it("10. Produces clear error when App ID or Private Key is missing", () => {
		const providerWithoutKey = {
			githubId: "gh-1",
			githubAppId: 12345,
			githubPrivateKey: null, // missing!
			githubInstallationId: "inst-123",
			githubUrl: "https://github.com",
			gitProviderId: "gp-1",
			githubAppName: "test",
			githubClientId: "cid",
			githubClientSecret: "csec",
			githubWebhookSecret: "wsec",
		};

		expect(() => authGithub(providerWithoutKey as any)).toThrowError(
			/GitHub App credentials are incomplete/i,
		);
	});

	// 11. cloneGithubRepository handles auth failure cleanly
	it("11. cloneGithubRepository outputs safe error message without leaking secrets", async () => {
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-broken",
			githubAppId: 12345,
			githubPrivateKey: null, // Will cause auth to fail
			githubInstallationId: null,
			gitProviderId: "gp-1",
		});

		const cmd = await cloneGithubRepository({
			appName: "test-app",
			owner: "test-owner",
			repository: "test-repo",
			branch: "main",
			githubId: "gh-broken",
			enableSubmodules: false,
			serverId: null,
		});

		expect(cmd).toContain("Error: ❌");
		expect(cmd).toContain("exit 1;");
		// Ensure private keys are not exposed
		expect(cmd).not.toContain("BEGIN RSA PRIVATE KEY");
	});

	// 12. Queue failure prevents delivery from being marked processed, enabling safe retries
	it("12. Queue failure does not mark delivery as processed, allowing retry to succeed", async () => {
		mockVerify.mockResolvedValue(true);
		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-provider-id",
			githubInstallationId: "inst-123",
			githubWebhookSecret: "secret-abc",
		});
		mockDbQuery.applications.findMany.mockResolvedValue([
			{
				applicationId: "app-retry",
				name: "retry-app",
				autoDeploy: true,
				triggerType: "push",
				branch: "main",
				repository: "my-repo",
				owner: "my-org",
				sourceType: "github",
				githubId: "gh-provider-id",
			},
		]);
		mockDbQuery.compose.findMany.mockResolvedValue([]);

		const payload = {
			installation: { id: "inst-123" },
			repository: { name: "my-repo", owner: { login: "my-org" } },
			ref: "refs/heads/main",
			head_commit: { message: "fix: retry test", id: "sha-retry" },
			commits: [
				{
					id: "sha-retry",
					message: "fix: retry test",
					added: ["app.js"],
					modified: [],
					removed: [],
				},
			],
		};

		const retryDeliveryUUID = "retry-delivery-uuid-555";

		// Attempt 1: Queue fails
		mockQueueAdd.mockRejectedValueOnce(new Error("Redis connection dropped"));

		const reqFail = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=validsig",
				"x-github-event": "push",
				"x-github-delivery": retryDeliveryUUID,
			},
			body: payload,
		} as unknown as NextApiRequest;

		const resFail = buildRes();
		await webhookHandler(reqFail, resFail as unknown as NextApiResponse);
		expect(resFail.statusCode).toBe(400);

		// Attempt 2: GitHub automatic retry with same delivery UUID succeeds
		mockQueueAdd.mockResolvedValueOnce({ id: "job-retry-success" });

		const reqSuccess = {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=validsig",
				"x-github-event": "push",
				"x-github-delivery": retryDeliveryUUID,
			},
			body: payload,
		} as unknown as NextApiRequest;

		const resSuccess = buildRes();
		await webhookHandler(reqSuccess, resSuccess as unknown as NextApiResponse);
		expect(resSuccess.statusCode).toBe(200);
		expect(resSuccess.body).toEqual({ message: "Deployed 1 apps" });
		expect(mockQueueAdd).toHaveBeenCalledTimes(2);
	});
});

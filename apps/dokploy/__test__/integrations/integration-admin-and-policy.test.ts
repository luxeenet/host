import { describe, expect, it, vi } from "vitest";
import {
	validateIntegrationConfig,
	validateSecretValue,
	redactSecrets,
	computeIntegrationState,
	toCustomerView,
	type IntegrationRowLike,
	createOAuthState,
	verifyOAuthState,
	buildNonceCookie,
	readNonceCookie,
	testIntegrationConnection,
} from "@dokploy/server";

const TEST_SECRET = "super-secret-key-32-chars-long!!";

describe("Integration Policy & Secret Management", () => {
	it("should validate required config fields correctly", () => {
		// Validating gitlab with invalid URL format throws
		expect(() =>
			validateIntegrationConfig("gitlab", { instanceUrl: "not-a-valid-url" }),
		).toThrow();

		// Valid configuration passes
		const clean = validateIntegrationConfig("gitlab", {
			instanceUrl: "https://gitlab.example.com",
			applicationId: "app-123",
		});
		expect(clean.instanceUrl).toBe("https://gitlab.example.com");
	});

	it("should validate secrets and redact them safely", () => {
		expect(() =>
			validateSecretValue("github", "clientSecret", "   "),
		).toThrow();
		expect(
			validateSecretValue("github", "clientSecret", "valid-secret"),
		).toBe("valid-secret");

		const textWithKey =
			"Token is ghp_1234567890123456 and secret is topsecret123";
		const redacted = redactSecrets(textWithKey, ["topsecret123"]);
		expect(redacted).not.toContain("ghp_1234567890123456");
		expect(redacted).not.toContain("topsecret123");
		expect(redacted).toContain("[redacted]");
	});

	it("should compute integration state transitions correctly", () => {
		const baseRow: IntegrationRowLike = {
			enabled: true,
			config: { instanceUrl: "https://gitlab.example.com" },
			secretsConfigured: {},
			lastTestStatus: null,
			lastTestedAt: null,
			testedFingerprint: null,
			currentFingerprint: "fp-1",
		};

		// Disabled
		expect(
			computeIntegrationState("gitlab", {
				...baseRow,
				enabled: false,
			}),
		).toBe("disabled");

		// Missing required field (empty instanceUrl)
		expect(
			computeIntegrationState("gitlab", {
				...baseRow,
				config: { instanceUrl: "" },
			}),
		).toBe("not_configured");

		// Configured without test
		expect(computeIntegrationState("gitlab", baseRow)).toBe("configured");

		// Ready with successful test
		expect(
			computeIntegrationState("gitlab", {
				...baseRow,
				lastTestStatus: "verified",
				lastTestedAt: new Date(),
				testedFingerprint: "fp-1",
			}),
		).toBe("ready");

		// Failing with failed test
		expect(
			computeIntegrationState("gitlab", {
				...baseRow,
				lastTestStatus: "failed",
				lastTestedAt: new Date(),
				testedFingerprint: "fp-1",
			}),
		).toBe("failing");

		// Self-contained (drop / git) is ready when enabled and configured
		expect(
			computeIntegrationState("drop", {
				enabled: true,
				config: {},
				secretsConfigured: {},
				lastTestStatus: null,
				lastTestedAt: null,
				testedFingerprint: null,
				currentFingerprint: "fp-drop",
			}),
		).toBe("ready");
	});

	it("should project customer-safe views without leaking internal URLs or secrets", () => {
		const customerView = toCustomerView("gitlab", "disabled");

		expect(customerView.id).toBe("gitlab");
		expect(customerView.label).toBe("GitLab");
		expect(customerView.available).toBe(false);
		expect(customerView.message).toContain("currently unavailable");
		expect((customerView as any).secrets).toBeUndefined();
		expect((customerView as any).config).toBeUndefined();
	});
});

describe("OAuth State Security (HMAC + Nonce)", () => {
	it("should generate and verify signed OAuth state with matching nonce and context", () => {
		const orgId = "org-tenant-1";
		const userId = "user-123";
		const provider = "gitea";
		const providerId = "provider-gitea-1";

		const { state, nonce } = createOAuthState(
			{
				provider,
				providerId,
				userId,
				organizationId: orgId,
			},
			{ secret: TEST_SECRET },
		);

		expect(state).toBeDefined();
		expect(nonce).toBeDefined();

		const result = verifyOAuthState(
			state,
			{
				provider,
				providerId,
				userId,
				organizationId: orgId,
				nonce,
			},
			{ secret: TEST_SECRET },
		);

		expect(result.p).toBe(provider);
		expect(result.o).toBe(orgId);
		expect(result.u).toBe(userId);
	});

	it("should reject tampered OAuth states or mismatched nonces", () => {
		const orgId = "org-tenant-1";
		const userId = "user-123";
		const provider = "gitea";
		const providerId = "provider-gitea-1";

		const { state, nonce } = createOAuthState(
			{
				provider,
				providerId,
				userId,
				organizationId: orgId,
			},
			{ secret: TEST_SECRET },
		);

		// Tampered state string
		const tamperedState = state.slice(0, -3) + "abc";
		expect(() =>
			verifyOAuthState(
				tamperedState,
				{
					provider,
					providerId,
					userId,
					organizationId: orgId,
					nonce,
				},
				{ secret: TEST_SECRET },
			),
		).toThrow(/Invalid authorization state/);

		// Wrong nonce
		expect(() =>
			verifyOAuthState(
				state,
				{
					provider,
					providerId,
					userId,
					organizationId: orgId,
					nonce: "wrong-nonce-1234567890123456",
				},
				{ secret: TEST_SECRET },
			),
		).toThrow(/does not belong to your session/);

		// Cross-tenant attack: different organizationId
		expect(() =>
			verifyOAuthState(
				state,
				{
					provider,
					providerId,
					userId,
					organizationId: "attacker-org-id",
					nonce,
				},
				{ secret: TEST_SECRET },
			),
		).toThrow(/does not belong to your session/);
	});

	it("should format and parse nonce cookies correctly", () => {
		const cookieHeader = buildNonceCookie("secret-nonce-123");
		expect(cookieHeader).toContain("hd_oauth_nonce=secret-nonce-123");
		expect(cookieHeader).toContain("HttpOnly");

		const parsed = readNonceCookie(
			"foo=bar; hd_oauth_nonce=secret-nonce-123; other=123",
		);
		expect(parsed).toBe("secret-nonce-123");
	});
});

describe("Integration Connectivity Testing", () => {
	it("should return failure when endpoint is unreachable", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
		const result = await testIntegrationConnection(
			"gitlab",
			{ instanceUrl: "https://unreachable.example.com" },
			{},
			{ fetch: mockFetch as any },
		);
		expect(result.status).toBe("failed");
	});

	it("should test GitLab connectivity with valid access token", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 1, username: "admin" }),
		});

		const result = await testIntegrationConnection(
			"gitlab",
			{ instanceUrl: "https://gitlab.example.com" },
			{ accessToken: "valid-token" },
			{ fetch: mockFetch as any },
		);

		expect(result.status).toBe("verified");
		expect(result.message).toContain("Authenticated as @admin");
	});

	it("should test Docker Registry connectivity using custom fetch", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			status: 200,
			headers: new Headers(),
		});

		const result = await testIntegrationConnection(
			"docker",
			{ registryEndpoint: "https://registry.example.com" },
			{},
			{ fetch: mockFetch as any },
		);

		expect(result.status).toBe("verified");
		expect(result.message).toContain("Registry is reachable (anonymous access allowed)");
	});

	it("should test Drop provider and return configuration level", async () => {
		const result = await testIntegrationConnection("drop", {}, {});
		expect(result.verification).toBe("configuration");
		expect(result.message).toContain("Drop uploads need no external connection");
	});
});

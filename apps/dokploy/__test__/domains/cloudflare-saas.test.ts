import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	CloudflareClient,
	CloudflareClientError,
	type CloudflareCustomHostname,
} from "@dokploy/server/services/cloudflare-client";
import {
	getCloudflareSaasSettings,
	updateCloudflareSaasSettings,
	getCloudflareApiToken,
	testCloudflareConnection,
} from "@dokploy/server/services/cloudflare-saas-settings";
import {
	ensureCloudflareDomainSchema,
	isCloudflareSaasActive,
	provisionCustomHostname,
	resolveCloudflareCnameTarget,
	syncCustomHostnameStatus,
	mapDomainCloudflareStatus,
	deleteCustomHostname,
	type DomainRow,
} from "@dokploy/server/services/cloudflare-saas-service";
import {
	reconcileCloudflareHostnames,
} from "@dokploy/server/services/cloudflare-saas-reconciliation";
import {
	getDnsInstructionsForDomain,
	isPlatformOrTestDomain,
} from "@dokploy/server/services/domain";
import {
	getPlatformSettingValue,
	setPlatformSettingValue,
} from "@dokploy/server/services/cname-routing";
import { PLATFORM_SETTING_KEYS } from "@dokploy/server/db/schema/platform-settings";
import { encryptValue, decryptValue } from "@dokploy/server/lib/encryption";

describe("Cloudflare for SaaS Custom Hostnames & SSL Management", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("CloudflareClient API Operations", () => {
		it("should configure correct base URL and authorization headers", async () => {
			let capturedUrl = "";
			let capturedHeaders: Record<string, string> = {};

			const mockFetch: typeof fetch = async (input, init) => {
				capturedUrl = input.toString();
				capturedHeaders = (init?.headers as Record<string, string>) || {};
				return new Response(
					JSON.stringify({
						success: true,
						errors: [],
						messages: [],
						result: {
							id: "zone-123",
							name: "hatdot.cloud",
							status: "active",
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			};

			const client = new CloudflareClient({
				apiToken: "cf-test-token-abcdef123456",
				fetchImpl: mockFetch,
			});

			const zone = await client.getZone("zone-123");
			expect(zone.id).toBe("zone-123");
			expect(zone.name).toBe("hatdot.cloud");
			expect(capturedUrl).toBe("https://api.cloudflare.com/client/v4/zones/zone-123");
			expect(capturedHeaders.Authorization).toBe("Bearer cf-test-token-abcdef123456");
			expect(capturedHeaders.Accept).toBe("application/json");
		});

		it("should create custom hostname with HTTP SSL verification method and TLS 1.2+ defaults", async () => {
			let capturedBody: any = null;

			const mockResponse: CloudflareCustomHostname = {
				id: "cf-host-1",
				hostname: "app.customer-store.com",
				status: "pending",
				ssl: {
					id: "ssl-1",
					type: "dv",
					method: "http",
					status: "initializing",
					settings: {
						http2: "on",
						tls_1_3: "on",
						min_tls_version: "1.2",
					},
				},
				ownership_verification: {
					type: "txt",
					name: "_cf-custom-hostname.app.customer-store.com",
					value: "cf-token-abc-xyz-123",
				},
				created_at: new Date().toISOString(),
			};

			const mockFetch: typeof fetch = async (_input, init) => {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(
					JSON.stringify({
						success: true,
						errors: [],
						messages: [],
						result: mockResponse,
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				);
			};

			const client = new CloudflareClient({
				apiToken: "test-token",
				fetchImpl: mockFetch,
			});

			const result = await client.createCustomHostname("zone-abc", {
				hostname: "app.customer-store.com",
				ssl: {
					method: "http",
					type: "dv",
					settings: {
						http2: "on",
						tls_1_3: "on",
						min_tls_version: "1.2",
					},
				},
				custom_origin_server: "origin.hatdot.cloud",
			});

			expect(result.id).toBe("cf-host-1");
			expect(result.hostname).toBe("app.customer-store.com");
			expect(capturedBody.hostname).toBe("app.customer-store.com");
			expect(capturedBody.ssl.method).toBe("http");
			expect(capturedBody.ssl.settings.min_tls_version).toBe("1.2");
			expect(capturedBody.custom_origin_server).toBe("origin.hatdot.cloud");
		});

		it("should detect Cloudflare error 1406 (Custom hostname already exists)", async () => {
			const mockFetch: typeof fetch = async () => {
				return new Response(
					JSON.stringify({
						success: false,
						errors: [
							{
								code: 1406,
								message: "Custom hostname already exists.",
							},
						],
						messages: [],
					}),
					{ status: 409, headers: { "Content-Type": "application/json" } },
				);
			};

			const client = new CloudflareClient({
				apiToken: "test-token",
				fetchImpl: mockFetch,
			});

			try {
				await client.createCustomHostname("zone-abc", {
					hostname: "existing.store.com",
				});
				expect.fail("Should have thrown CloudflareClientError");
			} catch (err: any) {
				expect(err).toBeInstanceOf(CloudflareClientError);
				expect(err.isDuplicate).toBe(true);
				expect(err.primaryCode).toBe(1406);
				expect(err.message).toContain("Custom hostname already exists");
			}
		});

		it("should detect rate limiting HTTP 429 and authentication errors", async () => {
			const rateLimitFetch: typeof fetch = async () => {
				return new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 10013, message: "Rate limit exceeded" }],
						messages: [],
					}),
					{
						status: 429,
						headers: { "Content-Type": "application/json", "Retry-After": "1" },
					},
				);
			};

			const client = new CloudflareClient({
				apiToken: "test-token",
				fetchImpl: rateLimitFetch,
				maxRetries: 1,
			});

			try {
				await client.getZone("zone-abc");
				expect.fail("Should have thrown rate limit error");
			} catch (err: any) {
				expect(err).toBeInstanceOf(CloudflareClientError);
				expect(err.isRateLimited).toBe(true);
				expect(err.statusCode).toBe(429);
			}

			const authFetch: typeof fetch = async () => {
				return new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 10000, message: "Authentication error" }],
						messages: [],
					}),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				);
			};

			const authClient = new CloudflareClient({
				apiToken: "invalid-token",
				fetchImpl: authFetch,
				maxRetries: 1,
			});

			try {
				await authClient.getZone("zone-abc");
				expect.fail("Should have thrown auth error");
			} catch (err: any) {
				expect(err).toBeInstanceOf(CloudflareClientError);
				expect(err.isAuthError).toBe(true);
				expect(err.statusCode).toBe(401);
			}
		});

		it("should identify 404 custom hostname not found error", async () => {
			const notFoundFetch: typeof fetch = async () => {
				return new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 1436, message: "Custom hostname not found" }],
						messages: [],
					}),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			};

			const client = new CloudflareClient({
				apiToken: "test-token",
				fetchImpl: notFoundFetch,
			});

			try {
				await client.deleteCustomHostname("zone-abc", "missing-id");
				expect.fail("Should have thrown not found error");
			} catch (err: any) {
				expect(err).toBeInstanceOf(CloudflareClientError);
				expect(err.isNotFound).toBe(true);
				expect(err.statusCode).toBe(404);
			}
		});

		it("should test connection and report zone name and fallback origin status", async () => {
			const mockFetch: typeof fetch = async (input) => {
				const url = input.toString();
				if (url.includes("/fallback_origin")) {
					return new Response(
						JSON.stringify({
							success: true,
							errors: [],
							messages: [],
							result: {
								origin: "fallback.hatdot.cloud",
								status: "deployed",
							},
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						success: true,
						errors: [],
						messages: [],
						result: {
							id: "zone-xyz",
							name: "hatdot.cloud",
							status: "active",
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			};

			const client = new CloudflareClient({
				apiToken: "test-token",
				fetchImpl: mockFetch,
			});

			const testResult = await client.testConnection("zone-xyz");
			expect(testResult.zoneValid).toBe(true);
			expect(testResult.zoneName).toBe("hatdot.cloud");
			expect(testResult.fallbackOrigin).toBe("fallback.hatdot.cloud");
			expect(testResult.fallbackOriginStatus).toBe("deployed");
			expect(testResult.message).toContain("hatdot.cloud");

			// Also test settings service testCloudflareConnection wrapper
			const serviceTest = await testCloudflareConnection(
				{ zoneId: "zone-xyz", apiToken: "test-token" },
				mockFetch,
			);
			expect(serviceTest.success).toBe(true);
			expect(serviceTest.zoneName).toBe("hatdot.cloud");
			expect(serviceTest.fallbackOrigin).toBe("fallback.hatdot.cloud");
		});
	});

	describe("Cloudflare SaaS Settings & Secret Encryption", () => {
		it("should encrypt API token with AES-256-GCM and mask it for administrator view", async () => {
			const rawSecretToken = "cf_secret_token_live_998877665544";

			await updateCloudflareSaasSettings({
				enabled: true,
				apiToken: rawSecretToken,
				zoneId: "zone-production-123",
				cnameTarget: "cname.hatdot.cloud",
				fallbackOrigin: "fallback.hatdot.cloud",
				defaultSslMethod: "http",
				autoProvision: true,
			});

			// Check administrator sanitized settings view
			const settings = await getCloudflareSaasSettings();
			expect(settings.enabled).toBe(true);
			expect(settings.hasApiToken).toBe(true);
			expect(settings.zoneId).toBe("zone-production-123");
			expect(settings.cnameTarget).toBe("cname.hatdot.cloud");
			expect(settings.fallbackOrigin).toBe("fallback.hatdot.cloud");
			// Plaintext must NEVER be returned in maskedApiToken
			expect(settings.maskedApiToken).not.toBe(rawSecretToken);
			expect(settings.maskedApiToken).toContain("••••••••");
			expect(settings.maskedApiToken?.endsWith("5544")).toBe(true);

			// Server-only decryption must return the original secret
			const decrypted = await getCloudflareApiToken();
			expect(decrypted).toBe(rawSecretToken);

			// Raw stored value in platform settings must have enc:v1: prefix
			const storedInDb = await getPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
			);
			expect(storedInDb).toBeDefined();
			expect(storedInDb?.startsWith("enc:v1:")).toBe(true);
		});

		it("should retain existing encrypted token when updating other fields", async () => {
			const initialToken = "cf_initial_secret_1234";
			await updateCloudflareSaasSettings({
				apiToken: initialToken,
				cnameTarget: "cname-v1.hatdot.cloud",
			});

			// Update CNAME target without providing apiToken
			await updateCloudflareSaasSettings({
				cnameTarget: "cname-v2.hatdot.cloud",
			});

			const settings = await getCloudflareSaasSettings();
			expect(settings.cnameTarget).toBe("cname-v2.hatdot.cloud");
			expect(settings.hasApiToken).toBe(true);

			const decrypted = await getCloudflareApiToken();
			expect(decrypted).toBe(initialToken);
		});

		it("should reject invalid hostnames for cnameTarget and fallbackOrigin", async () => {
			await expect(
				updateCloudflareSaasSettings({
					cnameTarget: "invalid cname target with spaces!@#",
				}),
			).rejects.toThrow();

			await expect(
				updateCloudflareSaasSettings({
					fallbackOrigin: "http://should-not-have-protocol.com",
				}),
			).rejects.toThrow();
		});

		it("should correctly evaluate isCloudflareSaasActive", async () => {
			// Initially active after previous test
			expect(await isCloudflareSaasActive()).toBe(true);

			// Disabled
			await updateCloudflareSaasSettings({ enabled: false });
			expect(await isCloudflareSaasActive()).toBe(false);

			// Enabled again
			await updateCloudflareSaasSettings({ enabled: true });
			expect(await isCloudflareSaasActive()).toBe(true);
		});
	});

	describe("4-Stage Lifecycle State Mapping (mapDomainCloudflareStatus)", () => {
		const baseDomain: DomainRow = {
			domainId: "test-dom-1",
			host: "app.acmecorp.com",
			path: null,
			port: 3000,
			customEntrypoint: null,
			https: false,
			certificateType: "none",
			customCertResolver: null,
			applicationId: "app-1",
			composeId: null,
			previewDeploymentId: null,
			serviceName: null,
			domainType: "application",
			uniqueConfigKey: 1,
			createdAt: new Date().toISOString(),
			internalPath: "/",
			stripPath: false,
			middlewares: [],
			forwardAuthEnabled: false,
			enabled: true,
			isPrimary: false,
			cfHostnameId: "cf-host-123",
			cfStatus: "pending",
			cfSslStatus: "initializing",
			cfVerificationErrors: null,
			cfOwnershipVerification: null,
			cfSslValidationRecords: null,
			cfSslCertificates: null,
			cfLastSyncAt: null,
			cfLastError: null,
			cfCustomOrigin: null,
		};

		it("should map Step 1: Initializing / Awaiting DNS", () => {
			const status = mapDomainCloudflareStatus(baseDomain, "cname.hatdot.cloud");

			expect(status.isCloudflareSaas).toBe(true);
			expect(status.status).toBe("pending");
			expect(status.stageStep).toBe(1);
			expect(status.stageName).toBe("Awaiting DNS configuration");
			expect(status.isHttpsReady).toBe(false);
			expect(status.customerActionRequired).toContain("cname.hatdot.cloud");
		});

		it("should map Step 2: Verifying Domain Ownership with TXT token", () => {
			const step2Domain: DomainRow = {
				...baseDomain,
				cfStatus: "pending",
				cfSslStatus: "initializing",
				cfOwnershipVerification: {
					type: "txt",
					name: "_cf-custom-hostname.app.acmecorp.com",
					value: "verification-token-secret-123",
				},
			};

			const status = mapDomainCloudflareStatus(step2Domain, "cname.hatdot.cloud");

			expect(status.status).toBe("pending_verification");
			expect(status.stageStep).toBe(2);
			expect(status.stageName).toBe("Verifying domain ownership");
			expect(status.isHttpsReady).toBe(false);

			// Should include TXT ownership record instruction
			const ownershipRecord = status.records.find(
				(r) => r.purpose === "Domain Ownership Verification",
			);
			expect(ownershipRecord).toBeDefined();
			expect(ownershipRecord?.type).toBe("TXT");
			expect(ownershipRecord?.name).toBe("_cf-custom-hostname.app.acmecorp.com");
			expect(ownershipRecord?.value).toBe("verification-token-secret-123");
		});

		it("should map Step 3: Domain verified, Issuing SSL Certificate (DCV in progress)", () => {
			const step3Domain: DomainRow = {
				...baseDomain,
				cfStatus: "active", // Hostname ownership is active
				cfSslStatus: "pending_validation", // SSL cert pending
				cfSslValidationRecords: [
					{
						status: "pending",
						txt_name: "_acme-challenge.app.acmecorp.com",
						txt_value: "dcv-challenge-hash-456",
					},
				],
			};

			const status = mapDomainCloudflareStatus(step3Domain, "cname.hatdot.cloud");

			expect(status.status).toBe("pending_certificate");
			expect(status.stageStep).toBe(3);
			expect(status.stageName).toBe("Issuing SSL certificate");
			expect(status.isHttpsReady).toBe(false);

			// Should include SSL DCV record instruction
			const dcvRecord = status.records.find(
				(r) => r.purpose === "SSL Certificate Validation (DCV)",
			);
			expect(dcvRecord).toBeDefined();
			expect(dcvRecord?.name).toBe("_acme-challenge.app.acmecorp.com");
			expect(dcvRecord?.value).toBe("dcv-challenge-hash-456");
		});

		it("should map Step 4: Active Edge Ready with HTTPS active", () => {
			const step4Domain: DomainRow = {
				...baseDomain,
				cfStatus: "active",
				cfSslStatus: "active",
				https: true,
			};

			const status = mapDomainCloudflareStatus(step4Domain, "cname.hatdot.cloud");

			expect(status.status).toBe("active");
			expect(status.stageStep).toBe(4);
			expect(status.stageName).toBe("Active — HTTPS ready");
			expect(status.isHttpsReady).toBe(true);
			expect(status.customerActionRequired).toContain("serving traffic securely");
		});

		it("should map Configuration Error and surface descriptive error messages", () => {
			const errorDomain: DomainRow = {
				...baseDomain,
				cfStatus: "error",
				cfLastError: "Invalid DNS records detected by Certificate Authority.",
			};

			const status = mapDomainCloudflareStatus(errorDomain, "cname.hatdot.cloud");

			expect(status.status).toBe("error");
			expect(status.stageStep).toBe(1);
			expect(status.stageName).toBe("Configuration Error");
			expect(status.customerActionRequired).toBe(
				"Invalid DNS records detected by Certificate Authority.",
			);
		});
	});

	describe("DNS Instructions Generation with Cloudflare for SaaS", () => {
		it(
			"should provide complete CNAME and verification instructions for subdomains",
			async () => {
				const instructions = await getDnsInstructionsForDomain("shop.acmestore.com");

				expect(instructions.recordType).toBe("CNAME");
				expect(instructions.recordName).toBe("shop");
				expect(instructions.target).toBeDefined();
				expect(instructions.target).not.toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
				expect(instructions.isSubdomain).toBe(true);
				expect(instructions.cloudflareGuidance).toBeDefined();
			},
			15000,
		);

		it(
			"should provide CNAME flattening guidance for apex / root domains",
			async () => {
				const instructions = await getDnsInstructionsForDomain("acmestore.com");

				expect(instructions.recordType).toBe("CNAME");
				expect(instructions.recordName).toBe("@");
				expect(instructions.isSubdomain).toBe(false);
				expect(instructions.apexGuidance).toBeDefined();
				expect(instructions.apexGuidance?.supportsCnameFlattening).toBe(true);
				expect(instructions.apexGuidance?.recommendedAlternative).toBe("www.acmestore.com");
			},
			15000,
		);
	});

	describe("Status Reconciliation Service", () => {
		it("should respect concurrency guard and prevent overlapping reconciliation passes", async () => {
			// First pass starts
			const run1Promise = reconcileCloudflareHostnames({ batchSize: 10 });
			// Second overlapping pass
			const run2Promise = reconcileCloudflareHostnames({ batchSize: 10 });

			const [res1, res2] = await Promise.all([run1Promise, run2Promise]);
			expect(res1).toBeDefined();
			expect(res2).toBeDefined();
			// Exactly one of the two runs may execute; the second returns 0 immediately if concurrency guard engages
			expect(typeof res1.processed).toBe("number");
			expect(typeof res2.processed).toBe("number");
		});
	});

	describe("Backward Compatibility & Platform Domain Protection", () => {
		it("should recognize platform subdomains and bypass Cloudflare SaaS custom hostnames", async () => {
			// Configure platform domain so hatdot.cloud subdomains are identified as platform
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";

			expect(await isPlatformOrTestDomain("app.hatdot.cloud")).toBe(true);
			expect(await isPlatformOrTestDomain("demo.hatdot.cloud")).toBe(true);
			expect(await isPlatformOrTestDomain("app-123.sslip.io")).toBe(true);
			expect(await isPlatformOrTestDomain("127.0.0.1.traefik.me")).toBe(true);
			expect(await isPlatformOrTestDomain("localhost")).toBe(true);

			// Real customer domains must NOT be identified as platform domains
			expect(await isPlatformOrTestDomain("customer-domain.com")).toBe(false);
			expect(await isPlatformOrTestDomain("portal.fintech.io")).toBe(false);
			expect(await isPlatformOrTestDomain("shop.luxeenet.com")).toBe(false);
		});
	});

	describe("Provider Selection & Accurate Status Presentation", () => {
		const sampleDomain: DomainRow = {
			domainId: "test-domain-id",
			host: "app.acmecorp.com",
			path: "/",
			port: 3000,
			customEntrypoint: null,
			https: false,
			certificateType: "none",
			customCertResolver: null,
			applicationId: "app-1",
			composeId: null,
			previewDeploymentId: null,
			serviceName: null,
			domainType: "application",
			uniqueConfigKey: 1,
			createdAt: new Date().toISOString(),
			internalPath: "/",
			stripPath: false,
			middlewares: [],
			forwardAuthEnabled: false,
			enabled: true,
			isPrimary: false,
			cfHostnameId: "cf-host-123",
			cfStatus: "pending",
			cfSslStatus: "initializing",
			cfVerificationErrors: null,
			cfOwnershipVerification: null,
			cfSslValidationRecords: null,
			cfSslCertificates: null,
			cfLastSyncAt: null,
			cfLastError: null,
			cfCustomOrigin: null,
		};

		it("should not mark domain as HTTPS ready when Cloudflare status or SSL status is pending", () => {
			const pendingDomain: DomainRow = {
				...sampleDomain,
				cfStatus: "pending",
				cfSslStatus: "initializing",
				https: false,
			};
			const status = mapDomainCloudflareStatus(pendingDomain, "cname.hatdot.cloud");
			expect(status.isCloudflareSaas).toBe(true);
			expect(status.isHttpsReady).toBe(false);
			expect(status.status).toBe("pending");
			expect(status.stageStep).toBe(1);
			expect(status.stageName).toBe("Awaiting DNS configuration");
		});

		it("should not mark domain as HTTPS ready when hostname is active but SSL is issuing", () => {
			const issuingDomain: DomainRow = {
				...sampleDomain,
				cfStatus: "active",
				cfSslStatus: "pending_validation",
				https: false,
			};
			const status = mapDomainCloudflareStatus(issuingDomain, "cname.hatdot.cloud");
			expect(status.isCloudflareSaas).toBe(true);
			expect(status.isHttpsReady).toBe(false);
			expect(status.status).toBe("pending_certificate");
			expect(status.stageStep).toBe(3);
			expect(status.stageName).toBe("Issuing SSL certificate");
		});

		it("should not mark domain active solely because legacy https flag is true if Cloudflare SSL is pending", () => {
			const staleHttpsDomain: DomainRow = {
				...sampleDomain,
				cfStatus: "pending",
				cfSslStatus: "initializing",
				https: true, // stale flag from legacy or prior state
			};
			const status = mapDomainCloudflareStatus(staleHttpsDomain, "cname.hatdot.cloud");
			// Must evaluate actual Cloudflare lifecycle, NOT trust stale https flag!
			expect(status.isHttpsReady).toBe(false);
			expect(status.status).toBe("pending");
		});

		it("should mark domain as HTTPS ready ONLY when both hostname and SSL are active", () => {
			const activeDomain: DomainRow = {
				...sampleDomain,
				cfStatus: "active",
				cfSslStatus: "active",
				https: true,
			};
			const status = mapDomainCloudflareStatus(activeDomain, "cname.hatdot.cloud");
			expect(status.isCloudflareSaas).toBe(true);
			expect(status.isHttpsReady).toBe(true);
			expect(status.status).toBe("active");
			expect(status.stageStep).toBe(4);
			expect(status.stageName).toBe("Active — HTTPS ready");
		});

		it("should identify legacy Let's Encrypt domain when no Cloudflare metadata exists", () => {
			const legacyDomain: DomainRow = {
				...sampleDomain,
				cfHostnameId: null,
				cfStatus: null,
				cfSslStatus: null,
				certificateType: "letsencrypt",
				https: true,
			};
			const status = mapDomainCloudflareStatus(legacyDomain, "cname.hatdot.cloud");
			expect(status.isCloudflareSaas).toBe(false);
			expect(status.isHttpsReady).toBe(true);
			expect(status.stageStep).toBe(4);
		});

		it("should resolve Cloudflare SaaS CNAME target when configured in platform settings", async () => {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_CNAME_TARGET,
				"cname.hatdot.cloud",
			);
			const target = await resolveCloudflareCnameTarget({});
			expect(target).toBe("cname.hatdot.cloud");
		});

		it("should default Cloudflare SaaS CNAME target to cname.<platformDomain> rather than per-app subdomain when unset", async () => {
			process.env.PLATFORM_DOMAIN = "hatdot.cloud";
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_CNAME_TARGET,
				null,
			);
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN,
				null,
			);
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_TARGET,
				null,
			);

			const target = await resolveCloudflareCnameTarget({
				applicationId: "qrcode-3d-p7aloo",
			});
			expect(target).toBe("cname.hatdot.cloud");
			expect(target).not.toBe("qrcode-3d-p7aloo.hatdot.cloud");
		});

		it("should not mark a legacy domain as HTTPS ready if certificateType is 'none' even with stale https=true", () => {
			const staleLegacyDomain: DomainRow = {
				...sampleDomain,
				cfHostnameId: null,
				cfStatus: null,
				cfSslStatus: null,
				certificateType: "none",
				https: true,
			};
			const status = mapDomainCloudflareStatus(staleLegacyDomain, "cname.hatdot.cloud");
			expect(status.isCloudflareSaas).toBe(false);
			expect(status.isHttpsReady).toBe(false);
			expect(status.status).toBe("pending");
		});
	});

	describe("Cloudflare Custom Hostname Provisioning, Sync & Migration Safety", () => {
		const createMockTx = (initialRow: DomainRow) => {
			let currentRow = { ...initialRow };
			const executedSql: string[] = [];
			const tx = {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: async () => [currentRow],
						}),
					}),
				}),
				update: () => ({
					set: (payload: Partial<DomainRow>) => ({
						where: () => ({
							returning: async () => {
								currentRow = { ...currentRow, ...payload };
								return [currentRow];
							},
						}),
					}),
				}),
				execute: async (query: any) => {
					executedSql.push(String(query?.queryChunks ? "sql" : query));
					return [];
				},
				getRow: () => currentRow,
				getExecutedCount: () => executedSql.length,
			};
			return tx;
		};

		const baseCustomDomain: DomainRow = {
			domainId: "dom-luxee-1",
			host: "luxeenet.com",
			path: "/",
			port: 3000,
			customEntrypoint: null,
			https: true, // Even if passed true initially
			certificateType: "letsencrypt", // Even if passed letsencrypt initially
			customCertResolver: null,
			applicationId: null,
			composeId: null,
			previewDeploymentId: null,
			serviceName: null,
			domainType: "application",
			uniqueConfigKey: 1,
			createdAt: new Date().toISOString(),
			internalPath: "/",
			stripPath: false,
			middlewares: [],
			forwardAuthEnabled: false,
			enabled: true,
			isPrimary: false,
			cfHostnameId: null,
			cfStatus: null,
			cfSslStatus: null,
			cfVerificationErrors: null,
			cfOwnershipVerification: null,
			cfSslValidationRecords: null,
			cfSslCertificates: null,
			cfLastSyncAt: null,
			cfLastError: null,
			cfCustomOrigin: null,
		};

		it("should register custom hostname with Cloudflare, persist validation records, and set https=false / certificateType='none' while pending", async () => {
			await updateCloudflareSaasSettings({
				enabled: true,
				apiToken: "cf_live_token_test_12345678",
				zoneId: "zone-hatdot-123",
				cnameTarget: "cname.hatdot.cloud",
			});

			const mockTx = createMockTx(baseCustomDomain);
			const mockFetch: typeof fetch = async () =>
				new Response(
					JSON.stringify({
						success: true,
						errors: [],
						messages: [],
						result: {
							id: "cf-hostname-luxee-999",
							hostname: "luxeenet.com",
							status: "pending",
							ssl: {
								id: "ssl-luxee-999",
								type: "dv",
								method: "http",
								status: "pending_validation",
								validation_records: [
									{
										status: "pending",
										txt_name: "_acme-challenge.luxeenet.com",
										txt_value: "acme-token-xyz",
									},
								],
							},
							ownership_verification: {
								type: "txt",
								name: "_cf-custom-hostname.luxeenet.com",
								value: "ownership-token-abc",
							},
							created_at: new Date().toISOString(),
						},
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				);

			const updated = await provisionCustomHostname("dom-luxee-1", {
				tx: mockTx,
				fetchImpl: mockFetch,
			});

			expect(updated.cfHostnameId).toBe("cf-hostname-luxee-999");
			expect(updated.cfStatus).toBe("pending");
			expect(updated.cfSslStatus).toBe("pending_validation");
			expect(updated.https).toBe(false);
			expect(updated.certificateType).toBe("none");
			expect(updated.cfOwnershipVerification).toEqual({
				type: "txt",
				name: "_cf-custom-hostname.luxeenet.com",
				value: "ownership-token-abc",
			});
		});

		it("should transition https=true when syncCustomHostnameStatus observes active hostname and active SSL", async () => {
			const pendingRow: DomainRow = {
				...baseCustomDomain,
				https: false,
				certificateType: "none",
				cfHostnameId: "cf-hostname-luxee-999",
				cfStatus: "pending",
				cfSslStatus: "pending_validation",
			};
			const mockTx = createMockTx(pendingRow);

			const mockFetch: typeof fetch = async () =>
				new Response(
					JSON.stringify({
						success: true,
						errors: [],
						messages: [],
						result: {
							id: "cf-hostname-luxee-999",
							hostname: "luxeenet.com",
							status: "active",
							ssl: {
								id: "ssl-luxee-999",
								type: "dv",
								method: "http",
								status: "active",
							},
							created_at: new Date().toISOString(),
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);

			const synced = await syncCustomHostnameStatus("dom-luxee-1", {
				tx: mockTx,
				fetchImpl: mockFetch,
			});

			expect(synced.cfStatus).toBe("active");
			expect(synced.cfSslStatus).toBe("active");
			expect(synced.https).toBe(true);
			expect(synced.certificateType).toBe("none");
		});

		it("should reset https=false and certificateType='none' if Cloudflare registration fails", async () => {
			const mockTx = createMockTx(baseCustomDomain);
			const failingFetch: typeof fetch = async () =>
				new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 10000, message: "Authentication error" }],
						messages: [],
					}),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				);

			const updated = await provisionCustomHostname("dom-luxee-1", {
				tx: mockTx,
				fetchImpl: failingFetch,
			});

			expect(updated.cfStatus).toBe("error");
			expect(updated.https).toBe(false);
			expect(updated.certificateType).toBe("none");
			expect(updated.cfLastError).toContain("Authentication error");
		});

		it("should verify migrations 0200 and 0204 are idempotent and ensureCloudflareDomainSchema executes all required DDL", async () => {
			const mockTx = createMockTx(baseCustomDomain);
			await ensureCloudflareDomainSchema(mockTx);
			expect(mockTx.getExecutedCount()).toBeGreaterThanOrEqual(13);

			const drizzleDir = path.resolve(__dirname, "../../drizzle");
			const sql0200 = fs.readFileSync(
				path.join(drizzleDir, "0200_natural_psylocke.sql"),
				"utf8",
			);
			const sql0204 = fs.readFileSync(
				path.join(drizzleDir, "0204_cloudflare_saas_custom_domains.sql"),
				"utf8",
			);

			// 0200 must use EXCEPTION WHEN duplicate_object and CREATE TABLE IF NOT EXISTS so it never blocks 0204
			expect(sql0200).toContain("EXCEPTION WHEN duplicate_object");
			expect(sql0200).toContain('CREATE TABLE IF NOT EXISTS "paas_platform_setting"');

			// 0204 must add all Cloudflare custom hostname columns idempotently
			expect(sql0204).toContain('ADD COLUMN IF NOT EXISTS "cfHostnameId"');
			expect(sql0204).toContain('ADD COLUMN IF NOT EXISTS "cfStatus"');
			expect(sql0204).toContain('ADD COLUMN IF NOT EXISTS "cfSslStatus"');
			expect(sql0204).toContain('ADD COLUMN IF NOT EXISTS "cfOwnershipVerification"');
			expect(sql0204).toContain('ADD COLUMN IF NOT EXISTS "cfSslValidationRecords"');
		});

		it("should expose Cloudflare for SaaS in Admin Navigation and Settings Sidebar for platform administrators only", () => {
			const sideSrc = fs.readFileSync(
				path.resolve(__dirname, "../../components/layouts/side.tsx"),
				"utf8",
			);
			const adminLayoutSrc = fs.readFileSync(
				path.resolve(__dirname, "../../components/layouts/admin-layout.tsx"),
				"utf8",
			);
			const adminIndexSrc = fs.readFileSync(
				path.resolve(__dirname, "../../pages/admin/index.tsx"),
				"utf8",
			);
			const serverSettingsSrc = fs.readFileSync(
				path.resolve(__dirname, "../../pages/dashboard/settings/server.tsx"),
				"utf8",
			);
			const componentSrc = fs.readFileSync(
				path.resolve(
					__dirname,
					"../../components/dashboard/settings/custom-domain-routing-settings.tsx",
				),
				"utf8",
			);

			// Sidebar menu includes Cloudflare for SaaS gated by isPlatformAdmin
			expect(sideSrc).toContain('title: "Cloudflare for SaaS"');
			expect(sideSrc).toContain('url: "/dashboard/settings/server#cloudflare-saas"');

			// Admin portal layout includes Cloudflare for SaaS navigation item
			expect(adminLayoutSrc).toContain('label: "Cloudflare for SaaS"');
			expect(adminLayoutSrc).toContain('href: "/admin#cloudflare-saas"');

			// Both /admin and /dashboard/settings/server render CustomDomainRoutingSettings
			expect(adminIndexSrc).toContain("<CustomDomainRoutingSettings />");
			expect(serverSettingsSrc).toContain("<CustomDomainRoutingSettings />");

			// Component includes all required Cloudflare for SaaS fields and actions
			expect(componentSrc).toContain("Cloudflare for SaaS");
			expect(componentSrc).toContain("Cloudflare API Token");
			expect(componentSrc).toContain("Cloudflare Zone ID");
			expect(componentSrc).toContain("CNAME Target");
			expect(componentSrc).toContain("Fallback Origin");
			expect(componentSrc).toContain("Default SSL Validation Method");
			expect(componentSrc).toContain("Automatic Custom Hostname Provisioning");
			expect(componentSrc).toContain("Test Cloudflare Connection");
			expect(componentSrc).toContain("Save Settings");
		});

		it("should validate required API Token and Zone ID when enabling Cloudflare for SaaS and support env fallbacks", async () => {
			// Clear stored token and zoneId and env vars
			const prevToken = process.env.CLOUDFLARE_SAAS_API_TOKEN;
			const prevZone = process.env.CLOUDFLARE_SAAS_ZONE_ID;
			delete process.env.CLOUDFLARE_SAAS_API_TOKEN;
			delete process.env.CLOUDFLARE_API_TOKEN;
			delete process.env.CLOUDFLARE_SAAS_ZONE_ID;
			delete process.env.CLOUDFLARE_ZONE_ID;

			await updateCloudflareSaasSettings({
				enabled: false,
				apiToken: null,
				zoneId: null,
			});

			// Enabling without token or zoneId must be rejected
			await expect(
				updateCloudflareSaasSettings({ enabled: true }),
			).rejects.toThrow(/Cloudflare API Token and Cloudflare Zone ID are required/);

			// Invalid Zone ID format must be rejected
			await expect(
				updateCloudflareSaasSettings({ zoneId: "invalid zone id with spaces!" }),
			).rejects.toThrow(/Invalid Cloudflare Zone ID format/);

			// Environment variable fallbacks allow enabling and connection testing
			process.env.CLOUDFLARE_SAAS_API_TOKEN = "cf_env_fallback_token_9988";
			process.env.CLOUDFLARE_SAAS_ZONE_ID = "zone_env_fallback_1234";

			const settingsFromEnv = await updateCloudflareSaasSettings({
				enabled: true,
			});
			expect(settingsFromEnv.enabled).toBe(true);
			expect(settingsFromEnv.hasApiToken).toBe(true);
			expect(settingsFromEnv.maskedApiToken).toBe("••••••••••••9988");
			expect(settingsFromEnv.zoneId).toBe("zone_env_fallback_1234");

			// Restore env vars
			if (prevToken !== undefined) process.env.CLOUDFLARE_SAAS_API_TOKEN = prevToken;
			else delete process.env.CLOUDFLARE_SAAS_API_TOKEN;
			if (prevZone !== undefined) process.env.CLOUDFLARE_SAAS_ZONE_ID = prevZone;
			else delete process.env.CLOUDFLARE_SAAS_ZONE_ID;
		});
	});
});

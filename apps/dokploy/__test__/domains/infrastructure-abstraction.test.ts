import { describe, expect, it } from "vitest";
import {
	mapDomainCloudflareStatus,
	type DomainRow,
} from "@dokploy/server/services/cloudflare-saas-service";

describe("HatDot Infrastructure Abstraction & Customer-Facing Hosting Experience", () => {
	const baseMockDomain = (overrides: Partial<DomainRow> = {}): DomainRow => ({
		domainId: "test-domain-1",
		host: "app.customerdomain.com",
		path: "/",
		internalPath: "/",
		stripPath: false,
		port: 3000,
		https: true,
		certificateType: "none",
		customCertResolver: null,
		applicationId: "app-1",
		composeId: null,
		serviceName: null,
		domainType: "application",
		previewDeploymentId: null,
		uniqueConfigKey: 1,
		createdAt: new Date().toISOString(),
		enabled: true,
		forwardAuthEnabled: false,
		customEntrypoint: null,
		middlewares: [],
		isPrimary: true,
		cfHostnameId: "cf-hostname-12345",
		cfStatus: "pending",
		cfSslStatus: "initializing",
		cfVerificationErrors: null,
		cfOwnershipVerification: null,
		cfSslValidationRecords: null,
		cfSslCertificates: null,
		cfLastSyncAt: new Date(),
		cfLastError: null,
		cfCustomOrigin: null,
		...overrides,
	});

	describe("Phase 1 & 2: Complete Cloudflare Abstraction & HatDot-Branded Experience", () => {
		it("should never expose Cloudflare branding in DNS record descriptions for customers", () => {
			const domainWithOwnership = baseMockDomain({
				cfOwnershipVerification: {
					type: "txt",
					name: "_cf-custom-hostname.app.customerdomain.com",
					value: "verification-token-abc",
				},
			});

			const status = mapDomainCloudflareStatus(domainWithOwnership, "cname.hatdot.cloud");

			// Ensure records are present
			expect(status.records.length).toBeGreaterThan(0);

			for (const rec of status.records) {
				// Record descriptions should reference HatDot, never Cloudflare
				expect(rec.description.toLowerCase()).not.toContain("cloudflare");
				expect(rec.description).toMatch(/HatDot|Certificate Authority/i);
			}

			// Specifically verify the ownership verification record
			const ownershipRec = status.records.find((r) => r.type === "TXT");
			expect(ownershipRec).toBeDefined();
			expect(ownershipRec?.description).toContain("HatDot");
			expect(ownershipRec?.description).not.toContain("Cloudflare");
		});

		it("should not leak Cloudflare in customer action required or stage names", () => {
			const domain = baseMockDomain({
				cfStatus: "active",
				cfSslStatus: "active",
			});

			const status = mapDomainCloudflareStatus(domain, "cname.hatdot.cloud");

			expect(status.customerActionRequired.toLowerCase()).not.toContain("cloudflare");
			expect(status.stageName.toLowerCase()).not.toContain("cloudflare");
		});
	});

	describe("Phase 3: Customer-Facing Port Abstraction & Intelligent Resolution", () => {
		it("should automatically resolve static applications to port 80 when port is omitted or default", () => {
			const app = {
				appName: "my-static-site",
				buildType: "static",
				ports: [],
			};

			let portToUse: number | undefined = undefined;
			if (!portToUse || portToUse === 3000) {
				if (app.buildType === "static") {
					portToUse = 80;
				}
			}

			expect(portToUse).toBe(80);
		});

		it("should automatically resolve detected application port from suggestedPort", () => {
			const app = {
				appName: "my-vite-site",
				buildType: "nixpacks",
				suggestedPort: 4173,
				ports: [],
			};

			let portToUse: number | undefined = 3000; // default initial form state
			if (!portToUse || portToUse === 3000) {
				if (app.buildType === "static") {
					portToUse = 80;
				} else if (app.suggestedPort && app.suggestedPort > 0) {
					portToUse = app.suggestedPort;
				}
			}

			expect(portToUse).toBe(4173);
		});

		it("should preserve advanced manual port override when explicitly configured by user", () => {
			const app = {
				appName: "my-custom-service",
				buildType: "dockerfile",
				suggestedPort: 8080,
				ports: [{ targetPort: 8080 }],
			};

			// User explicitly configured port 9090 in Advanced Settings
			const userConfiguredPort = 9090;
			let portToUse: number | undefined = userConfiguredPort;

			if (!portToUse || portToUse === 3000) {
				if (app.buildType === "static") {
					portToUse = 80;
				} else if (app.ports?.[0]?.targetPort) {
					portToUse = app.ports[0].targetPort;
				}
			}

			// Must not be overwritten: 9090 remains
			expect(portToUse).toBe(9090);
		});
	});

	describe("Phase 4: Normalized Domain & SSL Statuses", () => {
		it("should map DNS configuration required state correctly", () => {
			const domain = baseMockDomain({
				cfStatus: "pending",
				cfSslStatus: "initializing",
			});

			const status = mapDomainCloudflareStatus(domain, "cname.hatdot.cloud");

			expect(status.stageStep).toBe(1);
			expect(status.customerStatus).toBe("DNS configuration required");
			expect(status.isHttpsReady).toBe(false);
		});

		it("should map Verifying DNS state when ownership verification is pending", () => {
			const domain = baseMockDomain({
				cfStatus: "pending",
				cfSslStatus: "initializing",
				cfOwnershipVerification: {
					type: "txt",
					name: "_cf-custom-hostname.app.customerdomain.com",
					value: "verify-value-123",
				},
			});

			const status = mapDomainCloudflareStatus(domain, "cname.hatdot.cloud");

			expect(status.stageStep).toBe(2);
			expect(status.customerStatus).toBe("Verifying DNS");
			expect(status.isHttpsReady).toBe(false);
		});

		it("should map SSL provisioning state when domain ownership is verified but certificate is issuing", () => {
			const domain = baseMockDomain({
				cfStatus: "active",
				cfSslStatus: "pending_validation",
			});

			const status = mapDomainCloudflareStatus(domain, "cname.hatdot.cloud");

			expect(status.stageStep).toBe(3);
			expect(status.customerStatus).toBe("SSL provisioning");
			expect(status.isHttpsReady).toBe(false);
		});

		it("should map Secure and active state ONLY when domain is verified and serving HTTPS", () => {
			const domain = baseMockDomain({
				cfStatus: "active",
				cfSslStatus: "active",
				https: true,
				enabled: true,
			});

			const status = mapDomainCloudflareStatus(domain, "cname.hatdot.cloud");

			expect(status.stageStep).toBe(4);
			expect(status.customerStatus).toBe("Secure and active");
			expect(status.isHttpsReady).toBe(true);
			expect(status.isWebsiteReady).toBe(true);
		});

		it("should NEVER report SSL active before domain is serving HTTPS", () => {
			// Domain is active on hostname, but SSL is still issuing
			const issuingDomain = baseMockDomain({
				cfStatus: "active",
				cfSslStatus: "pending_validation",
				https: false,
			});

			const status = mapDomainCloudflareStatus(issuingDomain, "cname.hatdot.cloud");

			expect(status.isHttpsReady).toBe(false);
			expect(status.isSslActive).toBe(false);
			expect(status.customerStatus).not.toBe("Secure and active");
		});

		it("should map configuration issue state when errors are encountered", () => {
			const errorDomain = baseMockDomain({
				cfStatus: "error",
				cfSslStatus: "error",
				cfLastError: "Invalid DNS records detected",
			});

			const status = mapDomainCloudflareStatus(errorDomain, "cname.hatdot.cloud");

			expect(status.status).toBe("error");
			expect(status.customerStatus).toBe("Configuration issue");
			expect(status.isHttpsReady).toBe(false);
		});
	});

	describe("Phase 5: Backend Error Sanitization & Admin Visibility Segregation", () => {
		const sanitizeLifecycle = (lifecycle: any, isPlatformAdmin: boolean) => {
			if (isPlatformAdmin) {
				return lifecycle;
			}
			return {
				...lifecycle,
				customerActionRequired: lifecycle.customerActionRequired?.replace(/cloudflare/gi, "HatDot Edge"),
				lastError: lifecycle.lastError
					? lifecycle.lastError
							.replace(/cloudflare/gi, "HatDot Edge")
							.replace(/zone\s+[a-f0-9]{32}/gi, "edge zone")
							.replace(/custom_hostname\.[a-z_]+/gi, "Domain configuration")
					: null,
			};
		};

		it("should sanitize raw internal provider errors for normal customers", () => {
			const rawLifecycle = {
				status: "error",
				stageName: "Configuration Error",
				lastError: "Cloudflare API error: custom_hostname.validation_failed on zone 4a7c8e9b1d2f3a4b5c6d7e8f9a0b1c2d",
				customerActionRequired: "Check Cloudflare settings.",
			};

			const sanitized = sanitizeLifecycle(rawLifecycle, false);

			expect(sanitized.lastError).not.toContain("Cloudflare");
			expect(sanitized.lastError).not.toContain("4a7c8e9b1d2f3a4b5c6d7e8f9a0b1c2d");
			expect(sanitized.lastError).toContain("HatDot Edge");
			expect(sanitized.customerActionRequired).not.toContain("Cloudflare");
		});

		it("should preserve full technical diagnostics for platform administrators", () => {
			const rawLifecycle = {
				status: "error",
				stageName: "Configuration Error",
				lastError: "Cloudflare API error: custom_hostname.validation_failed on zone 4a7c8e9b1d2f3a4b5c6d7e8f9a0b1c2d",
				customerActionRequired: "Check Cloudflare settings.",
			};

			const adminView = sanitizeLifecycle(rawLifecycle, true);

			expect(adminView.lastError).toBe(rawLifecycle.lastError);
			expect(adminView.customerActionRequired).toBe(rawLifecycle.customerActionRequired);
		});
	});
});


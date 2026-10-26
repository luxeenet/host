import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	resolveCnameTargetForService,
	verifyDomainCname,
	getRoutingSettings,
	updateRoutingSettings,
	checkTargetDnsStatus,
} from "@dokploy/server";
import {
	getDnsInstructionsForDomain,
	validateDomain,
} from "@dokploy/server/services/domain";

describe("Provider-Managed CNAME Targets & Origin Protection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Target Selection (resolveCnameTargetForService)", () => {
		it("should use the configured platform domain or application hostname as CNAME target", async () => {
			const target = await resolveCnameTargetForService({});
			expect(target).toBeDefined();
			expect(typeof target).toBe("string");
			// Target should not be an IP address when hostname is configured
			expect(target).not.toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
		});

		it("should prioritize administrator-configured custom CNAME target when present", async () => {
			await updateRoutingSettings({
				cnameTarget: "cname.hatdot.cloud",
			});

			const target = await resolveCnameTargetForService({});
			expect(target).toBe("cname.hatdot.cloud");

			// Clean up by clearing back to default
			await updateRoutingSettings({
				cnameTarget: null,
			});
		});

		it("should reject invalid hostnames for custom CNAME target", async () => {
			await expect(
				updateRoutingSettings({
					cnameTarget: "invalid hostname with spaces!#$",
				}),
			).rejects.toThrow();
		});
	});

	describe("DNS Instructions Generation (getDnsInstructionsForDomain)", () => {
		it("should generate CNAME instructions for customer subdomains", async () => {
			const instructions = await getDnsInstructionsForDomain("app.customer-store.com");

			expect(instructions.recordType).toBe("CNAME");
			expect(instructions.recordName).toBe("app");
			expect(instructions.isSubdomain).toBe(true);
			expect(instructions.target).toBeDefined();
			expect(instructions.recordValue).toBe(instructions.target);
		});

		it("should provide apex domain guidance for root domains", async () => {
			const instructions = await getDnsInstructionsForDomain("customer-store.com");

			expect(instructions.recordType).toBe("CNAME");
			expect(instructions.recordName).toBe("@");
			expect(instructions.isSubdomain).toBe(false);
			expect(instructions.apexGuidance).toBeDefined();
			expect(instructions.apexGuidance?.supportsCnameFlattening).toBe(true);
			expect(instructions.apexGuidance?.recommendedAlternative).toBe("www.customer-store.com");
		});

		it("should include Cloudflare proxy and TLS mode guidance", async () => {
			const instructions = await getDnsInstructionsForDomain("shop.brand.com");

			expect(instructions.cloudflareGuidance).toBeDefined();
			expect(instructions.cloudflareGuidance?.proxyRecommended).toBe(true);
			expect(instructions.cloudflareGuidance?.sslMode).toBe("Full (strict)");
			expect(instructions.cloudflareGuidance?.initialSetupNote).toContain("DNS-only");
		});

		it("should redact origin IP 45.88.188.6 when direct IP disclosure is disabled", async () => {
			// Ensure direct IP is disabled
			await updateRoutingSettings({ allowDirectIp: false });

			const instructions = await getDnsInstructionsForDomain("portal.acme.com");

			expect(instructions.originIpProtected).toBe(true);
			expect(instructions.serverIp).toBeUndefined();
			expect(instructions.recordValue).not.toBe("45.88.188.6");
			expect(instructions.message).not.toContain("45.88.188.6");
		});
	});

	describe("Validation & Origin-IP Redaction (validateDomain)", () => {
		it("should not disclose origin IP 45.88.188.6 in customer-visible error messages", async () => {
			const result = await validateDomain("unconfigured-domain-xyz987.org", ["45.88.188.6"], {
				expectedTarget: "cname.hatdot.cloud",
				allowDirectIp: false,
			});

			if (!result.isValid) {
				expect(result.error).toBeDefined();
				expect(result.error).not.toContain("45.88.188.6");
				expect(result.error).toContain("cname.hatdot.cloud");
			}
		});

		it("should recognize Cloudflare CDN proxying as valid configuration", async () => {
			const cfResult = await verifyDomainCname("cloudflare.com", "cname.hatdot.cloud", []);
			expect(cfResult.isValid).toBe(true);
			expect(cfResult.isCloudflare).toBe(true);
			expect(cfResult.cdnProvider).toBe("Cloudflare");
		});
	});

	describe("Administrator Controls (getRoutingSettings & updateRoutingSettings)", () => {
		it("should fetch complete routing settings including TLS readiness", async () => {
			const settings = await getRoutingSettings();

			expect(settings).toHaveProperty("cnameEnabled");
			expect(settings).toHaveProperty("allowDirectIp");
			expect(settings).toHaveProperty("cloudflareProxyEnabled");
			expect(settings).toHaveProperty("effectiveTarget");
			expect(settings).toHaveProperty("tlsReadiness");
			expect(settings.tlsReadiness.autoSslEnabled).toBe(true);
			expect(settings.tlsReadiness.certResolver).toBe("letsencrypt");
		});

		it("should persist routing toggles cleanly", async () => {
			await updateRoutingSettings({
				cnameEnabled: true,
				allowDirectIp: false,
				cloudflareProxyEnabled: true,
				cloudflareStrictSsl: true,
			});

			const updated = await getRoutingSettings();
			expect(updated.cnameEnabled).toBe(true);
			expect(updated.allowDirectIp).toBe(false);
			expect(updated.cloudflareProxyEnabled).toBe(true);
			expect(updated.cloudflareStrictSsl).toBe(true);
		});
	});
});

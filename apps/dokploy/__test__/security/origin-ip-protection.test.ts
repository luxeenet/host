import {
	ALL_CLOUDFLARE_CIDRS,
	CLOUDFLARE_IPV4_CIDRS,
	CLOUDFLARE_IPV6_CIDRS,
	LOCAL_AND_PRIVATE_CIDRS,
	OriginProtectionService,
	TRAEFIK_DEFAULT_TRUSTED_IPS,
	assessDomainIngress,
	detectCDNProvider,
	extractTrustedClientIp,
	generateIptablesLockdownCommands,
	generateRollbackScript,
	generateUfwLockdownScript,
	getDefaultServerTraefikConfig,
	getDefaultTraefikConfig,
	isCloudflareIp,
	isIPv4InCIDR,
	isIPv6InCIDR,
	isIpInCIDR,
	isTrustedProxyIp,
} from "@dokploy/server";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("Origin IP Protection & Ingress Security Suite", () => {
	describe("1. Cloudflare IPv4 & IPv6 CIDR Verification", () => {
		it("should accurately identify official Cloudflare IPv4 addresses", () => {
			const validCloudflareIps = [
				"173.245.48.1",
				"103.21.244.50",
				"103.22.200.254",
				"103.31.4.10",
				"141.101.64.5",
				"108.162.192.100",
				"190.93.240.2",
				"188.114.96.15",
				"197.234.240.88",
				"198.41.128.20",
				"162.158.0.1",
				"104.16.0.1",
				"104.24.10.15",
				"172.64.0.100",
				"131.0.72.5",
			];

			for (const ip of validCloudflareIps) {
				expect(isCloudflareIp(ip), `Expected ${ip} to be identified as Cloudflare`).toBe(true);
			}
		});

		it("should accurately identify official Cloudflare IPv6 addresses", () => {
			const validCloudflareIpv6 = [
				"2400:cb00::1",
				"2400:cb00:2048:1::c629:d7a2",
				"2606:4700::1",
				"2606:4700:4700::1111",
				"2803:f800:50::1",
				"2405:b500:10::5",
				"2405:8100:20::a",
				"2a06:98c0:3600::103",
				"2c0f:f248::1",
			];

			for (const ip of validCloudflareIpv6) {
				expect(isCloudflareIp(ip), `Expected ${ip} to be identified as Cloudflare IPv6`).toBe(true);
			}
		});

		it("should reject non-Cloudflare public IPv4 addresses", () => {
			const nonCloudflareIps = [
				"8.8.8.8", // Google DNS
				"8.8.4.4",
				"208.67.222.222", // OpenDNS
				"194.163.150.100", // Contabo sample origin
				"144.76.10.20", // Hetzner
				"203.0.113.195", // RFC5737 TEST-NET-3
				"198.51.100.42", // RFC5737 TEST-NET-2
			];

			for (const ip of nonCloudflareIps) {
				expect(isCloudflareIp(ip), `Expected ${ip} NOT to be Cloudflare`).toBe(false);
			}
		});

		it("should reject non-Cloudflare public IPv6 addresses", () => {
			const nonCloudflareIpv6 = [
				"2001:4860:4860::8888", // Google Public DNS
				"2001:4860:4860::8844",
				"2600:1f18::1", // AWS
				"2a02:c205::1", // Contabo IPv6 sample
				"fe80::1", // Link-local
			];

			for (const ip of nonCloudflareIpv6) {
				expect(isCloudflareIp(ip), `Expected ${ip} NOT to be Cloudflare IPv6`).toBe(false);
			}
		});

		it("should test CIDR helper functions directly", () => {
			expect(isIPv4InCIDR("104.16.1.1", "104.16.0.0/13")).toBe(true);
			expect(isIPv4InCIDR("104.32.1.1", "104.16.0.0/13")).toBe(false);
			expect(isIPv4InCIDR("invalid-ip", "104.16.0.0/13")).toBe(false);
			expect(isIPv4InCIDR("104.16.1.1", "invalid-cidr")).toBe(false);

			expect(isIPv6InCIDR("2606:4700::1", "2606:4700::/32")).toBe(true);
			expect(isIPv6InCIDR("2607:4700::1", "2606:4700::/32")).toBe(false);

			expect(isIpInCIDR("104.16.1.1", "104.16.0.0/13")).toBe(true);
			expect(isIpInCIDR("2606:4700::1", "2606:4700::/32")).toBe(true);
			expect(isIpInCIDR("104.16.1.1", "2606:4700::/32")).toBe(false);
		});
	});

	describe("2. Traefik Entrypoints & Trusted Proxy Ranges", () => {
		it("should include all Cloudflare CIDRs and private subnets in TRAEFIK_DEFAULT_TRUSTED_IPS", () => {
			expect(ALL_CLOUDFLARE_CIDRS.length).toBe(
				CLOUDFLARE_IPV4_CIDRS.length + CLOUDFLARE_IPV6_CIDRS.length,
			);
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS.length).toBeGreaterThan(
				ALL_CLOUDFLARE_CIDRS.length,
			);

			// Must include local & Docker overlay ranges
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS).toContain("127.0.0.1/32");
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS).toContain("::1/128");
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS).toContain("10.0.0.0/8");
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS).toContain("172.16.0.0/12");
			expect(TRAEFIK_DEFAULT_TRUSTED_IPS).toContain("192.168.0.0/16");
		});

		it("should configure forwardedHeaders.trustedIPs in getDefaultTraefikConfig()", () => {
			const yamlConfig = getDefaultTraefikConfig();
			const parsed = parse(yamlConfig);

			expect(parsed.entryPoints).toBeDefined();
			expect(parsed.entryPoints.web).toBeDefined();
			expect(parsed.entryPoints.web.forwardedHeaders).toBeDefined();
			expect(parsed.entryPoints.web.forwardedHeaders.trustedIPs).toEqual(
				expect.arrayContaining([...TRAEFIK_DEFAULT_TRUSTED_IPS]),
			);

			expect(parsed.entryPoints.websecure).toBeDefined();
			expect(parsed.entryPoints.websecure.forwardedHeaders).toBeDefined();
			expect(parsed.entryPoints.websecure.forwardedHeaders.trustedIPs).toEqual(
				expect.arrayContaining([...TRAEFIK_DEFAULT_TRUSTED_IPS]),
			);
		});

		it("should configure forwardedHeaders.trustedIPs in getDefaultServerTraefikConfig()", () => {
			const yamlConfig = getDefaultServerTraefikConfig();
			const parsed = parse(yamlConfig);

			expect(parsed.entryPoints.web.forwardedHeaders.trustedIPs).toEqual(
				expect.arrayContaining([...TRAEFIK_DEFAULT_TRUSTED_IPS]),
			);
			expect(parsed.entryPoints.websecure.forwardedHeaders.trustedIPs).toEqual(
				expect.arrayContaining([...TRAEFIK_DEFAULT_TRUSTED_IPS]),
			);
		});
	});

	describe("3. Real Client IP Extraction & Forwarded Header Trust", () => {
		it("should trust CF-Connecting-IP when peer is a verified Cloudflare proxy", () => {
			const headers = {
				"cf-connecting-ip": "203.0.113.195",
				"x-forwarded-for": "203.0.113.195, 173.245.48.50",
			};
			const remoteAddress = "173.245.48.50"; // Valid Cloudflare IPv4

			const result = extractTrustedClientIp(headers, remoteAddress);
			expect(result.clientIp).toBe("203.0.113.195");
			expect(result.isProxiedByCloudflare).toBe(true);
			expect(result.isDirectConnection).toBe(false);
		});

		it("should trust CF-Connecting-IP when peer is a verified Cloudflare IPv6 proxy", () => {
			const headers = {
				"cf-connecting-ip": "198.51.100.77",
			};
			const remoteAddress = "2606:4700::10"; // Valid Cloudflare IPv6

			const result = extractTrustedClientIp(headers, remoteAddress);
			expect(result.clientIp).toBe("198.51.100.77");
			expect(result.isProxiedByCloudflare).toBe(true);
			expect(result.isDirectConnection).toBe(false);
		});

		it("should reject CF-Connecting-IP if connection is direct from an untrusted peer", () => {
			const headers = {
				"cf-connecting-ip": "1.2.3.4", // Spoofed header by direct attacker
			};
			const remoteAddress = "194.163.150.55"; // Untrusted external IP

			const result = extractTrustedClientIp(headers, remoteAddress);
			// Must NOT trust the spoofed 1.2.3.4
			expect(result.clientIp).toBe("194.163.150.55");
			expect(result.isProxiedByCloudflare).toBe(false);
			expect(result.isDirectConnection).toBe(true);
		});

		it("should trust X-Forwarded-For when forwarded through internal Docker overlay network", () => {
			const headers = {
				"x-forwarded-for": "203.0.113.99, 10.0.0.2",
			};
			const remoteAddress = "10.0.0.2"; // Swarm internal overlay IP

			const result = extractTrustedClientIp(headers, remoteAddress);
			expect(result.clientIp).toBe("203.0.113.99");
			expect(result.isDirectConnection).toBe(false);
		});
	});

	describe("4. Domain Ingress Assessment", () => {
		const originIps = ["194.163.150.100", "2a02:c205:1:2::1"];

		it("should classify domain as PROXIED_CLOUDFLARE when all resolved IPs are Cloudflare", () => {
			const resolvedIps = ["104.21.45.12", "172.67.150.88"];
			const assessment = assessDomainIngress("app.hatdot.cloud", resolvedIps, originIps);

			expect(assessment.status).toBe("PROXIED_CLOUDFLARE");
			expect(assessment.isOriginHidden).toBe(true);
			expect(assessment.warningMessage).toBeUndefined();
			expect(assessment.recommendations).toEqual(
				expect.arrayContaining([expect.stringContaining("Full (strict)")]),
			);
		});

		it("should classify domain as DIRECT_ORIGIN_EXPOSED when it resolves to origin IP", () => {
			const resolvedIps = ["194.163.150.100"];
			const assessment = assessDomainIngress("panel.hatdot.cloud", resolvedIps, originIps);

			expect(assessment.status).toBe("DIRECT_ORIGIN_EXPOSED");
			expect(assessment.isOriginHidden).toBe(false);
			expect(assessment.warningMessage).toBeDefined();
			expect(assessment.warningMessage).toContain("CRITICAL: Domain points directly to the Contabo origin server IP");
		});

		it("should classify third-party unproxied domains accurately", () => {
			const resolvedIps = ["185.199.108.153"];
			const assessment = assessDomainIngress("external-client.com", resolvedIps, originIps);

			expect(assessment.status).toBe("THIRD_PARTY_UNPROXIED");
			expect(assessment.isOriginHidden).toBe(false);
		});

		it("should handle empty or unresolved domain lists gracefully", () => {
			const assessment = assessDomainIngress("nonexistent.hatdot.cloud", [], originIps);
			expect(assessment.status).toBe("UNRESOLVED");
			expect(assessment.isOriginHidden).toBe(false);
		});
	});

	describe("5. Staged Origin Firewall Lockdown Script Generator", () => {
		it("should generate a complete, reversible UFW lockdown script", () => {
			const script = generateUfwLockdownScript({
				sshPort: 2222,
				watchdogTimeoutSeconds: 300,
			});

			// Safety checks & backup
			expect(script).toContain("#!/usr/bin/env bash");
			expect(script).toContain("set -euo pipefail");
			expect(script).toContain('id -u');
			expect(script).toContain("ufw status verbose > /etc/dokploy/security/ufw-status-backup.txt");
			expect(script).toContain("iptables-save > /etc/dokploy/security/iptables-backup.rules");
			expect(script).toContain("ip6tables-save > /etc/dokploy/security/ip6tables-backup.rules");

			// Safety watchdog
			expect(script).toContain("sleep 300 && ufw --force disable");

			// IPv6 parity
			expect(script).toContain("sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw");

			// SSH Preservation
			expect(script).toContain("ufw allow 2222/tcp");

			// Docker Swarm Overlay mesh
			expect(script).toContain("2377");
			expect(script).toContain("7946");
			expect(script).toContain("4789");

			// Cloudflare IPv4 rules for ports 80 & 443
			for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
				expect(script).toContain(`ufw allow from ${cidr} to any port 80 proto tcp`);
				expect(script).toContain(`ufw allow from ${cidr} to any port 443 proto tcp`);
			}

			// Cloudflare IPv6 rules for ports 80 & 443
			for (const cidr of CLOUDFLARE_IPV6_CIDRS) {
				expect(script).toContain(`ufw allow from ${cidr} to any port 80 proto tcp`);
				expect(script).toContain(`ufw allow from ${cidr} to any port 443 proto tcp`);
			}

			// Direct database port blocks
			expect(script).toContain("ufw deny 5432 comment 'Deny Public Postgres'");
			expect(script).toContain("ufw deny 3306 comment 'Deny Public MySQL/MariaDB'");
			expect(script).toContain("ufw deny 6379 comment 'Deny Public Redis'");
			expect(script).toContain("ufw deny 27017 comment 'Deny Public MongoDB'");
			expect(script).toContain("ufw deny 2375:2376/tcp comment 'Deny Public Docker Daemon API'");
			expect(script).toContain("ufw deny 8080/tcp comment 'Deny Public Traefik Dashboard'");
		});

		it("should generate emergency rollback script", () => {
			const rollback = generateRollbackScript();
			expect(rollback).toContain("ufw --force disable");
			expect(rollback).toContain("iptables-restore < /etc/dokploy/security/iptables-backup.rules");
			expect(rollback).toContain("ip6tables-restore < /etc/dokploy/security/ip6tables-backup.rules");
		});

		it("should generate iptables / ip6tables custom chain commands", () => {
			const iptablesScript = generateIptablesLockdownCommands({ sshPort: 22 });
			expect(iptablesScript).toContain("iptables -N CLOUDFLARE_HTTP");
			expect(iptablesScript).toContain("ip6tables -N CLOUDFLARE_HTTP");
			expect(iptablesScript).toContain("104.16.0.0/13");
			expect(iptablesScript).toContain("2606:4700::/32");
			expect(iptablesScript).toContain("iptables -I INPUT -p tcp --dport 22 -j ACCEPT");
		});
	});

	describe("6. CDN Service IPv6 Integration", () => {
		it("should recognize Cloudflare for IPv4 via detectCDNProvider", () => {
			const provider = detectCDNProvider("104.16.50.10");
			expect(provider).not.toBeNull();
			expect(provider?.name).toBe("cloudflare");
			expect(provider?.displayName).toBe("Cloudflare");
		});

		it("should recognize Cloudflare for IPv6 via detectCDNProvider", () => {
			const provider = detectCDNProvider("2606:4700:4700::1111");
			expect(provider).not.toBeNull();
			expect(provider?.name).toBe("cloudflare");
			expect(provider?.displayName).toBe("Cloudflare");
		});

		it("should return null for non-CDN IP", () => {
			const provider = detectCDNProvider("8.8.8.8");
			expect(provider).toBeNull();
		});
	});
});

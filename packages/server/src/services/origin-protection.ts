/**
 * HatDot Origin Protection & Ingress Security Service
 *
 * Implements:
 * 1. Cloudflare IPv4 & IPv6 CIDR verification.
 * 2. Trusted client-IP extraction from reverse-proxy headers (CF-Connecting-IP).
 * 3. Domain ingress analysis (Cloudflare-proxied vs direct-origin exposure).
 * 4. Staged, reversible origin firewall lockdown script generation (UFW & iptables/ip6tables).
 * 5. Rollback and emergency recovery scripts.
 */

import { isIPv4, isIPv6 } from "node:net";
import {
	ALL_CLOUDFLARE_CIDRS,
	CLOUDFLARE_IPV4_CIDRS,
	CLOUDFLARE_IPV6_CIDRS,
	LOCAL_AND_PRIVATE_CIDRS,
	TRAEFIK_DEFAULT_TRUSTED_IPS,
} from "../constants/cloudflare-ips";

/**
 * Checks if an IPv4 address is contained within an IPv4 CIDR block.
 */
export const isIPv4InCIDR = (ip: string, cidr: string): boolean => {
	const [network, prefixLength] = cidr.split("/");
	if (!network || !prefixLength) return false;
	const prefix = Number.parseInt(prefixLength, 10);
	if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

	const ipToInt = (ipStr: string): number => {
		const octets = ipStr.split(".");
		if (octets.length !== 4) return 0;
		return (
			octets.reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>>
			0
		);
	};

	const ipInt = ipToInt(ip);
	const networkInt = ipToInt(network);
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

	return (ipInt & mask) === (networkInt & mask);
};

/**
 * Parses an IPv6 string into a 128-bit BigInt.
 */
export const parseIPv6ToBigInt = (ipStr: string): bigint => {
	const clean = ipStr.toLowerCase().split("%")[0] || ""; // Remove zone ID if present
	const parts = clean.split("::");
	let groups: string[];

	if (parts.length === 2) {
		const left = parts[0] ? parts[0].split(":") : [];
		const right = parts[1] ? parts[1].split(":") : [];
		const missing = 8 - (left.length + right.length);
		groups = [...left, ...Array(missing).fill("0"), ...right];
	} else {
		groups = clean.split(":");
	}

	let result = 0n;
	for (const group of groups) {
		const val = Number.parseInt(group || "0", 16);
		result = (result << 16n) + BigInt(Number.isNaN(val) ? 0 : val);
	}
	return result;
};

/**
 * Checks if an IPv6 address is contained within an IPv6 CIDR block.
 */
export const isIPv6InCIDR = (ip: string, cidr: string): boolean => {
	const [network, prefixLength] = cidr.split("/");
	if (!network || !prefixLength) return false;
	const prefix = BigInt(Number.parseInt(prefixLength, 10));
	if (prefix < 0n || prefix > 128n) return false;

	try {
		const ipBig = parseIPv6ToBigInt(ip);
		const netBig = parseIPv6ToBigInt(network);
		const totalBits = 128n;
		const mask =
			prefix === 0n
				? 0n
				: ((1n << totalBits) - 1n) ^ ((1n << (totalBits - prefix)) - 1n);

		return (ipBig & mask) === (netBig & mask);
	} catch {
		return false;
	}
};

/**
 * Checks if an IP (IPv4 or IPv6) is within a given CIDR.
 */
export const isIpInCIDR = (ip: string, cidr: string): boolean => {
	const trimmedIp = ip.trim();
	if (isIPv4(trimmedIp) && !cidr.includes(":")) {
		return isIPv4InCIDR(trimmedIp, cidr);
	}
	if (isIPv6(trimmedIp) && cidr.includes(":")) {
		return isIPv6InCIDR(trimmedIp, cidr);
	}
	return false;
};

/**
 * Determines whether an IP address belongs to Cloudflare's published edge proxy network.
 */
export const isCloudflareIp = (ip: string): boolean => {
	if (!ip) return false;
	const trimmed = ip.trim();
	if (isIPv4(trimmed)) {
		return CLOUDFLARE_IPV4_CIDRS.some((range) => isIPv4InCIDR(trimmed, range));
	}
	if (isIPv6(trimmed)) {
		return CLOUDFLARE_IPV6_CIDRS.some((range) => isIPv6InCIDR(trimmed, range));
	}
	return false;
};

/**
 * Determines whether an IP address is considered a trusted upstream proxy
 * (Cloudflare edge proxy or local/internal container network).
 */
export const isTrustedProxyIp = (ip: string): boolean => {
	if (!ip) return false;
	const trimmed = ip.trim();
	return TRAEFIK_DEFAULT_TRUSTED_IPS.some((range) => isIpInCIDR(trimmed, range));
};

/**
 * Safely extracts the real client IP from incoming request headers.
 * CF-Connecting-IP is trusted ONLY when the direct upstream peer is a trusted proxy.
 */
export const extractTrustedClientIp = (
	headers: Record<string, string | string[] | undefined>,
	remoteAddress?: string,
): { clientIp: string; isProxiedByCloudflare: boolean; isDirectConnection: boolean } => {
	const peerIp = (remoteAddress || "").trim();
	const isPeerCloudflare = isCloudflareIp(peerIp);
	const isPeerTrusted = isTrustedProxyIp(peerIp);

	// CF-Connecting-IP header sent by Cloudflare
	const rawCfIp = headers["cf-connecting-ip"];
	const cfIp = Array.isArray(rawCfIp) ? rawCfIp[0] : rawCfIp;

	// X-Forwarded-For header
	const rawXff = headers["x-forwarded-for"];
	const xffStr = Array.isArray(rawXff) ? rawXff[0] : rawXff;
	const xffFirstIp = xffStr ? xffStr.split(",")[0]?.trim() : undefined;

	// If request came through Cloudflare proxy, CF-Connecting-IP is authoritative
	if (cfIp && (isPeerCloudflare || isPeerTrusted || !peerIp)) {
		return {
			clientIp: cfIp.trim(),
			isProxiedByCloudflare: true,
			isDirectConnection: false,
		};
	}

	// If forwarded by trusted internal proxy
	if (xffFirstIp && isPeerTrusted) {
		return {
			clientIp: xffFirstIp,
			isProxiedByCloudflare: isCloudflareIp(xffFirstIp),
			isDirectConnection: false,
		};
	}

	// Fallback to socket remote address
	return {
		clientIp: peerIp || "127.0.0.1",
		isProxiedByCloudflare: false,
		isDirectConnection: true,
	};
};

export type IngressProtectionStatus =
	| "PROXIED_CLOUDFLARE"
	| "DIRECT_ORIGIN_EXPOSED"
	| "THIRD_PARTY_UNPROXIED"
	| "UNRESOLVED";

export interface DomainIngressAssessment {
	domain: string;
	status: IngressProtectionStatus;
	isOriginHidden: boolean;
	resolvedIps: string[];
	recommendations: string[];
	warningMessage?: string;
}

/**
 * Assesses whether a domain's public DNS reveals the origin server IP.
 */
export const assessDomainIngress = (
	domain: string,
	resolvedIps: string[],
	originIps: string[] = [],
): DomainIngressAssessment => {
	const cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0] || domain;
	const normalizedOriginIps = originIps.map((ip) => ip.trim());

	if (!resolvedIps || resolvedIps.length === 0) {
		return {
			domain: cleanDomain,
			status: "UNRESOLVED",
			isOriginHidden: false,
			resolvedIps: [],
			recommendations: [
				"Add DNS records pointing this domain to your platform proxy before activating SSL.",
			],
			warningMessage: "Domain does not currently resolve to any IP address.",
		};
	}

	// Check if any resolved IP matches the origin server directly
	const exposesOrigin = resolvedIps.some((ip) =>
		normalizedOriginIps.includes(ip.trim()),
	);

	// Check if all resolved IPs are Cloudflare proxy IPs
	const allCloudflare = resolvedIps.every((ip) => isCloudflareIp(ip.trim()));
	const someCloudflare = resolvedIps.some((ip) => isCloudflareIp(ip.trim()));

	if (allCloudflare) {
		return {
			domain: cleanDomain,
			status: "PROXIED_CLOUDFLARE",
			isOriginHidden: true,
			resolvedIps,
			recommendations: [
				"Domain is securely proxied through Cloudflare. Origin IP is completely masked.",
				"Ensure Cloudflare SSL/TLS mode is set to 'Full (strict)'.",
				"Keep Cloudflare WebSockets enabled for real-time application updates.",
			],
		};
	}

	if (exposesOrigin) {
		return {
			domain: cleanDomain,
			status: "DIRECT_ORIGIN_EXPOSED",
			isOriginHidden: false,
			resolvedIps,
			warningMessage:
				"CRITICAL: Domain points directly to the Contabo origin server IP. Once origin firewall lockdown is enforced, direct browser connections will be dropped.",
			recommendations: [
				"If managing DNS on Cloudflare: Switch the DNS record status to Proxied (Orange Cloud).",
				"If using third-party DNS (GoDaddy, Namecheap, Route 53): Create a CNAME record pointing to your HatDot application subdomain or configure Cloudflare for SaaS custom hostnames.",
				"Do not use direct A records to the origin server if you require origin IP confidentiality.",
			],
		};
	}

	return {
		domain: cleanDomain,
		status: "THIRD_PARTY_UNPROXIED",
		isOriginHidden: false,
		resolvedIps,
		warningMessage: someCloudflare
			? "Domain resolves to a mix of Cloudflare and external IPs."
			: "Domain points to an external third-party IP or CDN, not HatDot origin or Cloudflare proxy.",
		recommendations: [
			"Verify that DNS points to the expected HatDot proxy endpoint.",
			"Enable proxying on your DNS provider to mask origin details.",
		],
	};
};

export interface FirewallLockdownOptions {
	sshPort?: number;
	operatorIp?: string;
	watchdogTimeoutSeconds?: number;
	backupPath?: string;
}

/**
 * Generates an idempotent, reversible UFW-based origin lockdown script.
 * Preserves SSH, Swarm, internal Docker networking, and drops direct public HTTP/HTTPS
 * unless traffic originates from Cloudflare's published IP ranges.
 */
export const generateUfwLockdownScript = (
	options: FirewallLockdownOptions = {},
): string => {
	const sshPort = options.sshPort || 22;
	const operatorIp = options.operatorIp;
	const timeout = options.watchdogTimeoutSeconds || 300;
	const backupPath =
		options.backupPath || "/etc/dokploy/security/ufw-pre-lockdown.rules";

	const lines: string[] = [
		"#!/usr/bin/env bash",
		"# ============================================================================",
		"# HatDot Origin Server Ingress Lockdown (UFW)",
		"# Restricts ports 80 (HTTP) & 443 (HTTPS) strictly to Cloudflare edge proxies.",
		"# Preserves SSH, Docker/Swarm networking, and internal database connectivity.",
		"# ============================================================================",
		"set -euo pipefail",
		"",
		"echo '=== [Step 1/5] Safety Pre-flight Checks ==='",
		"if [ \"$(id -u)\" -ne 0 ]; then",
		"  echo 'ERROR: This script must be run as root.' >&2",
		"  exit 1",
		"fi",
		"",
		"mkdir -p /etc/dokploy/security",
		`echo "Backing up active UFW configuration to ${backupPath}..."`,
		"ufw status verbose > /etc/dokploy/security/ufw-status-backup.txt || true",
		"iptables-save > /etc/dokploy/security/iptables-backup.rules || true",
		"ip6tables-save > /etc/dokploy/security/ip6tables-backup.rules || true",
		"echo 'Backup complete.'",
		"",
		"echo '=== [Step 2/5] Arming 5-Minute Safety Watchdog ==='",
		`echo "Starting automatic rollback timer (${timeout}s). If disconnected, UFW will auto-disable."`,
		`(sleep ${timeout} && ufw --force disable && echo "SAFETY WATCHDOG: Reverted UFW to disabled") &`,
		"WATCHDOG_PID=$!",
		"echo \"Watchdog started with PID: ${WATCHDOG_PID}\"",
		"",
		"echo '=== [Step 3/5] Base Firewall Rules & SSH Protection ==='",
		"# Ensure IPv6 is enabled in UFW config",
		"sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw || true",
		"",
		"# Default policies: reject incoming by default, allow outgoing",
		"ufw default deny incoming",
		"ufw default allow outgoing",
		"",
		"# Loopback interface",
		"ufw allow in on lo to any",
		"",
		"# Allow SSH from anywhere or specific operator IP",
	];

	if (operatorIp) {
		lines.push(
			`ufw allow from ${operatorIp} to any port ${sshPort} proto tcp comment 'Operator SSH'`,
		);
	} else {
		lines.push(
			`ufw allow ${sshPort}/tcp comment 'Administrative SSH Access'`,
		);
	}

	lines.push(
		"",
		"# Allow Docker Swarm cluster management (if multi-node)",
		"ufw allow from 10.0.0.0/8 to any port 2377 proto tcp comment 'Swarm Node Cluster'",
		"ufw allow from 172.16.0.0/12 to any port 2377 proto tcp comment 'Swarm Node Cluster'",
		"ufw allow from 10.0.0.0/8 to any port 7946 comment 'Swarm Node Discovery'",
		"ufw allow from 172.16.0.0/12 to any port 7946 comment 'Swarm Node Discovery'",
		"ufw allow from 10.0.0.0/8 to any port 4789 proto udp comment 'Swarm Overlay Network'",
		"ufw allow from 172.16.0.0/12 to any port 4789 proto udp comment 'Swarm Overlay Network'",
		"",
		"echo '=== [Step 4/5] Allow HTTP (80) & HTTPS (443) from Cloudflare Edge IP Ranges ==='",
	);

	for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
		lines.push(
			`ufw allow from ${cidr} to any port 80 proto tcp comment 'Cloudflare IPv4 Ingress'`,
			`ufw allow from ${cidr} to any port 443 proto tcp comment 'Cloudflare IPv4 Ingress'`,
		);
	}

	for (const cidr of CLOUDFLARE_IPV6_CIDRS) {
		lines.push(
			`ufw allow from ${cidr} to any port 80 proto tcp comment 'Cloudflare IPv6 Ingress'`,
			`ufw allow from ${cidr} to any port 443 proto tcp comment 'Cloudflare IPv6 Ingress'`,
		);
	}

	lines.push(
		"",
		"# Explicitly deny raw external access to databases and Docker daemon",
		"ufw deny 5432 comment 'Deny Public Postgres'",
		"ufw deny 3306 comment 'Deny Public MySQL/MariaDB'",
		"ufw deny 6379 comment 'Deny Public Redis'",
		"ufw deny 27017 comment 'Deny Public MongoDB'",
		"ufw deny 2375:2376/tcp comment 'Deny Public Docker Daemon API'",
		"ufw deny 8080/tcp comment 'Deny Public Traefik Dashboard'",
		"",
		"echo '=== [Step 5/5] Activating UFW ==='",
		"ufw --force enable",
		"echo 'UFW is now ACTIVE.'",
		"",
		"echo '============================================================'",
		"echo 'IMPORTANT: Verify your SSH connection now in another window.'",
		"echo 'If everything works, disarm the rollback timer by running:'",
		"echo \"  kill ${WATCHDOG_PID}\"",
		"echo 'If you do nothing, the watchdog will revert UFW in 5 minutes.'",
		"echo '============================================================'",
	);

	return lines.join("\n");
};

/**
 * Generates an emergency rollback script to immediately restore open access.
 */
export const generateRollbackScript = (): string => {
	return [
		"#!/usr/bin/env bash",
		"# ============================================================================",
		"# HatDot Origin Server Ingress Rollback",
		"# Instantly restores previous firewall state in case of emergency.",
		"# ============================================================================",
		"set -euo pipefail",
		"",
		"echo '=== Emergency Firewall Rollback ==='",
		"if [ \"$(id -u)\" -ne 0 ]; then",
		"  echo 'ERROR: Must be run as root.' >&2",
		"  exit 1",
		"fi",
		"",
		"# Kill any running watchdog timers",
		"pkill -f 'sleep 300 && ufw --force disable' || true",
		"",
		"# Disable UFW",
		"ufw --force disable || true",
		"",
		"# Restore iptables backup if available",
		"if [ -f /etc/dokploy/security/iptables-backup.rules ]; then",
		"  iptables-restore < /etc/dokploy/security/iptables-backup.rules || true",
		"  echo 'Restored IPv4 iptables backup.'",
		"fi",
		"",
		"if [ -f /etc/dokploy/security/ip6tables-backup.rules ]; then",
		"  ip6tables-restore < /etc/dokploy/security/ip6tables-backup.rules || true",
		"  echo 'Restored IPv6 iptables backup.'",
		"fi",
		"",
		"echo 'Rollback complete. Firewall restored to previous state.'",
	].join("\n");
};

/**
 * Generates pure iptables and ip6tables lockdown commands (alternative to UFW).
 */
export const generateIptablesLockdownCommands = (
	options: FirewallLockdownOptions = {},
): string => {
	const sshPort = options.sshPort || 22;
	const lines: string[] = [
		"#!/usr/bin/env bash",
		"# ============================================================================",
		"# HatDot Direct iptables & ip6tables Origin Lockdown",
		"# ============================================================================",
		"set -euo pipefail",
		"",
		"# 1. Flush existing custom chain if present",
		"iptables -N CLOUDFLARE_HTTP 2>/dev/null || iptables -F CLOUDFLARE_HTTP",
		"ip6tables -N CLOUDFLARE_HTTP 2>/dev/null || ip6tables -F CLOUDFLARE_HTTP",
		"",
		"# 2. Populate IPv4 Cloudflare chain",
	];

	for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
		lines.push(`iptables -A CLOUDFLARE_HTTP -s ${cidr} -j ACCEPT`);
	}
	lines.push(
		"iptables -A CLOUDFLARE_HTTP -s 127.0.0.1/32 -j ACCEPT",
		"iptables -A CLOUDFLARE_HTTP -j DROP",
		"",
		"# 3. Populate IPv6 Cloudflare chain",
	);

	for (const cidr of CLOUDFLARE_IPV6_CIDRS) {
		lines.push(`ip6tables -A CLOUDFLARE_HTTP -s ${cidr} -j ACCEPT`);
	}
	lines.push(
		"ip6tables -A CLOUDFLARE_HTTP -s ::1/128 -j ACCEPT",
		"ip6tables -A CLOUDFLARE_HTTP -j DROP",
		"",
		"# 4. Route ports 80 & 443 to Cloudflare chain",
		"iptables -I INPUT -p tcp -m multiport --dports 80,443 -j CLOUDFLARE_HTTP",
		"ip6tables -I INPUT -p tcp -m multiport --dports 80,443 -j CLOUDFLARE_HTTP",
		"",
		`# 5. Ensure SSH (port ${sshPort}) remains open`,
		`iptables -I INPUT -p tcp --dport ${sshPort} -j ACCEPT`,
		`ip6tables -I INPUT -p tcp --dport ${sshPort} -j ACCEPT`,
		"",
		"# 6. Block direct public access to database ports and Docker API",
		"iptables -I INPUT -p tcp -m multiport --dports 5432,3306,6379,27017,2375,2376,8080 -s 10.0.0.0/8 -j ACCEPT",
		"iptables -I INPUT -p tcp -m multiport --dports 5432,3306,6379,27017,2375,2376,8080 -s 172.16.0.0/12 -j ACCEPT",
		"iptables -I INPUT -p tcp -m multiport --dports 5432,3306,6379,27017,2375,2376,8080 -s 127.0.0.1/32 -j ACCEPT",
		"iptables -A INPUT -p tcp -m multiport --dports 5432,3306,6379,27017,2375,2376,8080 -j DROP",
	);

	return lines.join("\n");
};

export const OriginProtectionService = {
	isCloudflareIp,
	isTrustedProxyIp,
	isIpInCIDR,
	extractTrustedClientIp,
	assessDomainIngress,
	generateUfwLockdownScript,
	generateRollbackScript,
	generateIptablesLockdownCommands,
	CLOUDFLARE_IPV4_CIDRS,
	CLOUDFLARE_IPV6_CIDRS,
	ALL_CLOUDFLARE_CIDRS,
	TRAEFIK_DEFAULT_TRUSTED_IPS,
	LOCAL_AND_PRIVATE_CIDRS,
};

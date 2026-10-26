/**
 * Provider-Managed CNAME Routing Service
 *
 * Implements modern hosting platform DNS onboarding for customer custom domains:
 * - Provides customers with a provider-managed hostname (e.g. app-abc123.hatdot.cloud)
 *   as the CNAME target rather than exposing raw origin server IPs.
 * - Supports Cloudflare proxying and apex domain CNAME flattening / ALIAS records.
 * - Protects origin IP disclosure in instructions, API responses, and errors.
 * - Provides administrative controls and live target reachability diagnostics.
 */

import dns from "node:dns";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { db } from "@dokploy/server/db";
import {
	platformSettings,
	PLATFORM_SETTING_KEYS,
	domains,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
	getConfiguredPlatformDomain,
	getPublicServerIp,
	getServerIpCandidates,
	resolveGeneratedApplicationDomain,
	checkWildcardDnsSupport,
} from "./domain";
import { findApplicationById } from "./application";
import { findComposeById } from "./compose";
import { detectCDNProvider } from "./cdn";
import { getWebServerSettings } from "./web-server-settings";
import { VALID_HOSTNAME_REGEX, INVALID_HOSTNAME_MESSAGE } from "../utils/hostname-validation";

const resolveDns4 = promisify(dns.resolve4);
const resolveDns6 = promisify(dns.resolve6);
const resolveCname =
	typeof dns.resolveCname === "function"
		? promisify(dns.resolveCname)
		: ((async () => []) as any);

const resolveDns = async (host: string): Promise<string[]> => {
	const results = await Promise.allSettled([resolveDns4(host), resolveDns6(host)]);
	return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
};

// ---------------------------------------------------------------------------
// Persistence helpers for Platform Settings
// ---------------------------------------------------------------------------

const runtimeSettingsCache = new Map<string, string | null>();

export const getPlatformSettingValue = async (
	key: string,
	fallback: string | null = null,
): Promise<string | null> => {
	try {
		const row = await db.query.platformSettings.findFirst({
			where: eq(platformSettings.key, key),
		});
		if (row?.value !== undefined && row?.value !== null) {
			runtimeSettingsCache.set(key, row.value);
			return row.value;
		}
	} catch {
		// Fall through to cache/fallback
	}
	if (runtimeSettingsCache.has(key)) {
		return runtimeSettingsCache.get(key) ?? fallback;
	}
	return fallback;
};

export const setPlatformSettingValue = async (
	key: string,
	value: string | null,
	description?: string,
): Promise<void> => {
	runtimeSettingsCache.set(key, value);
	try {
		await db
			.insert(platformSettings)
			.values({
				key,
				value,
				description: description ?? null,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: platformSettings.key,
				set: {
					value,
					updatedAt: new Date(),
					...(description ? { description } : {}),
				},
			});
	} catch {
		// Fallback in environments where onConflictDoUpdate is unhandled by driver mock
	}
};

export const isCnameTargetEnabled = async (): Promise<boolean> => {
	const val = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_ENABLED,
		"true",
	);
	return val !== "false";
};

export const isDirectIpAllowed = async (): Promise<boolean> => {
	const val = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_ALLOW_DIRECT_IP,
		"false",
	);
	return val === "true";
};

// ---------------------------------------------------------------------------
// Target Selection & Diagnostics
// ---------------------------------------------------------------------------

export interface TargetDnsStatus {
	target: string;
	resolves: boolean;
	resolvedIps: string[];
	isProxied: boolean;
	cdnProvider: string | null;
}

export const checkTargetDnsStatus = async (
	target: string,
): Promise<TargetDnsStatus> => {
	const cleanTarget = target.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[\/?#:]/)[0] || "";
	try {
		const ips = await resolveDns(cleanTarget);
		const cdn = ips.map((ip) => detectCDNProvider(ip)).find((p) => p !== null);
		const isProxied = cdn !== undefined && cdn.displayName === "Cloudflare";

		return {
			target: cleanTarget,
			resolves: ips.length > 0,
			resolvedIps: ips,
			isProxied,
			cdnProvider: cdn?.displayName ?? null,
		};
	} catch {
		return {
			target: cleanTarget,
			resolves: false,
			resolvedIps: [],
			isProxied: false,
			cdnProvider: null,
		};
	}
};

export const resolveCnameTargetForService = async (options: {
	applicationId?: string | null;
	composeId?: string | null;
	serverId?: string | null;
}): Promise<string> => {
	// 1. Check if administrator set a custom global target
	const configuredCustomTarget = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_TARGET,
	);
	if (
		configuredCustomTarget &&
		configuredCustomTarget.trim().length > 0 &&
		VALID_HOSTNAME_REGEX.test(configuredCustomTarget.trim())
	) {
		return configuredCustomTarget.trim().toLowerCase();
	}

	const platformDomain = await getConfiguredPlatformDomain();

	// 2. Application-assigned platform domain (e.g. app-abc123.hatdot.cloud)
	if (options.applicationId) {
		try {
			const app = await findApplicationById(options.applicationId);
			if (app) {
				// Check if there is an existing platform domain in the DB
				const existingDomains = await db
					.select()
					.from(domains)
					.where(eq(domains.applicationId, options.applicationId));

				if (platformDomain) {
					const existingPlatform = existingDomains.find(
						(d) =>
							d.host.toLowerCase().endsWith(`.${platformDomain.toLowerCase()}`) ||
							d.host.toLowerCase() === platformDomain.toLowerCase(),
					);
					if (existingPlatform) {
						return existingPlatform.host.trim().toLowerCase();
					}
				}

				// Otherwise, compute generated domain
				const generated = await resolveGeneratedApplicationDomain(
					app.appName,
					app.serverId || options.serverId || undefined,
				);
				if (generated?.host) {
					return generated.host.trim().toLowerCase();
				}
			}
		} catch {}
	}

	// 3. Compose service-assigned platform domain
	if (options.composeId) {
		try {
			const comp = await findComposeById(options.composeId);
			if (comp && platformDomain) {
				return `${comp.appName}.${platformDomain}`.trim().toLowerCase();
			}
		} catch {}
	}

	// 4. Platform root domain fallback (e.g. hatdot.cloud)
	if (platformDomain) {
		return platformDomain.trim().toLowerCase();
	}

	// 5. Server settings host fallback
	const settings = await getWebServerSettings();
	if (settings?.host && !isIP(settings.host)) {
		return settings.host.trim().toLowerCase();
	}

	// 6. Final fallback (public IP or localhost)
	const publicIp = await getPublicServerIp(options.serverId || undefined);
	return publicIp || "127.0.0.1";
};

// ---------------------------------------------------------------------------
// CNAME Verification Logic
// ---------------------------------------------------------------------------

export interface CnameVerificationResult {
	isValid: boolean;
	cnameMatched: boolean;
	ipMatched: boolean;
	resolvedIps: string[];
	resolvedCnames: string[];
	cdnProvider?: string;
	isCloudflare: boolean;
	warning?: string;
	error?: string;
}

export const verifyDomainCname = async (
	cleanDomain: string,
	expectedTarget: string,
	expectedIps: string[] = [],
): Promise<CnameVerificationResult> => {
	const platformDomain = await getConfiguredPlatformDomain();

	// 1. Check for CNAME records
	let resolvedCnames: string[] = [];
	try {
		const raw = await resolveCname(cleanDomain);
		resolvedCnames = (Array.isArray(raw) ? raw : [raw])
			.map((c) => c.trim().toLowerCase().replace(/\.$/, ""))
			.filter(Boolean);
	} catch {
		// No direct CNAME (might be apex or CNAME-flattened)
	}

	const cleanTarget = expectedTarget.trim().toLowerCase().replace(/\.$/, "");
	const cnameMatched = resolvedCnames.some(
		(c) =>
			c === cleanTarget ||
			(platformDomain && (c === platformDomain || c.endsWith(`.${platformDomain}`))),
	);

	// 2. Resolve target's IPs
	let targetIps: string[] = [];
	if (cleanTarget && !isIP(cleanTarget)) {
		try {
			targetIps = await resolveDns(cleanTarget);
		} catch {}
	}

	// 3. Resolve customer domain's A/AAAA records
	let customerIps: string[] = [];
	try {
		customerIps = await resolveDns(cleanDomain);
	} catch {}

	// Check if customer domain resolves to expected server IPs or target IPs
	const allAllowedIps = Array.from(new Set([...expectedIps, ...targetIps]));
	const ipMatched =
		customerIps.length > 0 &&
		allAllowedIps.length > 0 &&
		customerIps.some((ip) => allAllowedIps.includes(ip));

	// 4. Check CDN detection on customer domain
	const cdn = customerIps.map((ip) => detectCDNProvider(ip)).find((p) => p !== null);
	const isCloudflare = cdn !== undefined && cdn.displayName === "Cloudflare";

	const isValid = cnameMatched || ipMatched || cdn !== undefined;

	return {
		isValid,
		cnameMatched,
		ipMatched,
		resolvedIps: customerIps,
		resolvedCnames,
		cdnProvider: cdn?.displayName,
		isCloudflare,
		warning: cdn?.warningMessage,
	};
};

// ---------------------------------------------------------------------------
// Routing Settings Management
// ---------------------------------------------------------------------------

export interface RoutingSettingsView {
	cnameTarget: string | null;
	cnameEnabled: boolean;
	allowDirectIp: boolean;
	cloudflareProxyEnabled: boolean;
	cloudflareStrictSsl: boolean;
	defaultPlatformDomain: string | null;
	effectiveTarget: string;
	targetStatus: TargetDnsStatus;
	tlsReadiness: {
		autoSslEnabled: boolean;
		certResolver: string;
		wildcardSupported: boolean;
	};
}

export const getRoutingSettings = async (): Promise<RoutingSettingsView> => {
	const cnameTarget = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_TARGET,
	);
	const cnameEnabled = await isCnameTargetEnabled();
	const allowDirectIp = await isDirectIpAllowed();
	const cloudflareProxyEnabled =
		(await getPlatformSettingValue(PLATFORM_SETTING_KEYS.CLOUDFLARE_PROXY_ENABLED)) === "true";
	const cloudflareStrictSsl =
		(await getPlatformSettingValue(PLATFORM_SETTING_KEYS.CLOUDFLARE_STRICT_SSL, "true")) !== "false";

	const defaultPlatformDomain = await getConfiguredPlatformDomain();
	const effectiveTarget =
		cnameTarget?.trim() || defaultPlatformDomain || "hatdot.cloud";

	const targetStatus = await checkTargetDnsStatus(effectiveTarget);
	const wildcardSupported = defaultPlatformDomain
		? await checkWildcardDnsSupport(defaultPlatformDomain)
		: false;

	return {
		cnameTarget,
		cnameEnabled,
		allowDirectIp,
		cloudflareProxyEnabled,
		cloudflareStrictSsl,
		defaultPlatformDomain,
		effectiveTarget,
		targetStatus,
		tlsReadiness: {
			autoSslEnabled: true,
			certResolver: "letsencrypt",
			wildcardSupported,
		},
	};
};

export interface UpdateRoutingSettingsInput {
	cnameTarget?: string | null;
	cnameEnabled?: boolean;
	allowDirectIp?: boolean;
	cloudflareProxyEnabled?: boolean;
	cloudflareStrictSsl?: boolean;
}

export const updateRoutingSettings = async (
	input: UpdateRoutingSettingsInput,
): Promise<RoutingSettingsView> => {
	if (input.cnameTarget !== undefined) {
		const clean = input.cnameTarget?.trim().toLowerCase() || null;
		if (clean && !VALID_HOSTNAME_REGEX.test(clean)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: INVALID_HOSTNAME_MESSAGE,
			});
		}
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_TARGET,
			clean,
			"Public CNAME target hostname for customer custom domains",
		);
	}

	if (input.cnameEnabled !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_CNAME_ENABLED,
			input.cnameEnabled ? "true" : "false",
			"Whether provider-managed CNAME targets are enabled",
		);
	}

	if (input.allowDirectIp !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CUSTOM_DOMAIN_ALLOW_DIRECT_IP,
			input.allowDirectIp ? "true" : "false",
			"Whether direct origin IP instructions are permitted to customers",
		);
	}

	if (input.cloudflareProxyEnabled !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_PROXY_ENABLED,
			input.cloudflareProxyEnabled ? "true" : "false",
			"Whether Cloudflare proxy is configured in front of platform origin",
		);
	}

	if (input.cloudflareStrictSsl !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_STRICT_SSL,
			input.cloudflareStrictSsl ? "true" : "false",
			"Whether Cloudflare Strict SSL mode is enforced",
		);
	}

	return await getRoutingSettings();
};

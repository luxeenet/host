/**
 * Cloudflare for SaaS Administrator Settings Service
 *
 * Manages configuration, secure secret persistence with AES-256-GCM encryption,
 * token masking, and connection diagnostics for Cloudflare for SaaS.
 */

import { TRPCError } from "@trpc/server";
import { PLATFORM_SETTING_KEYS } from "../db/schema/platform-settings";
import {
	getPlatformSettingValue,
	setPlatformSettingValue,
} from "./cname-routing";
import { decryptValue, encryptValue, isEncrypted } from "../lib/encryption";
import {
	CloudflareClient,
	CloudflareClientError,
} from "./cloudflare-client";
import { VALID_HOSTNAME_REGEX, INVALID_HOSTNAME_MESSAGE } from "../utils/hostname-validation";

export interface CloudflareSaasSettingsView {
	enabled: boolean;
	hasApiToken: boolean;
	maskedApiToken: string | null;
	zoneId: string | null;
	cnameTarget: string | null;
	fallbackOrigin: string | null;
	fallbackOriginStatus: string | null;
	defaultSslMethod: "http" | "txt" | "cname";
	autoProvision: boolean;
}

export interface UpdateCloudflareSaasSettingsInput {
	enabled?: boolean;
	apiToken?: string | null;
	zoneId?: string | null;
	cnameTarget?: string | null;
	fallbackOrigin?: string | null;
	defaultSslMethod?: "http" | "txt" | "cname";
	autoProvision?: boolean;
}

export interface CloudflareConnectionTestResult {
	success: boolean;
	zoneName?: string;
	fallbackOrigin?: string | null;
	fallbackOriginStatus?: string | null;
	message: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const maskToken = (token: string): string => {
	const clean = token.trim();
	if (clean.length <= 8) {
		return "••••••••";
	}
	const lastFour = clean.slice(-4);
	return `••••••••••••${lastFour}`;
};

/**
 * Load the decrypted Cloudflare API token. Server-side only!
 * Never expose the result of this function to client payloads.
 */
export const getCloudflareApiToken = async (): Promise<string | null> => {
	const stored = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
	);
	if (!stored || stored.trim().length === 0) {
		// Environment fallback if configured
		const envToken = process.env.CLOUDFLARE_API_TOKEN;
		return envToken && envToken.trim().length > 0 ? envToken.trim() : null;
	}
	try {
		return decryptValue(stored).trim();
	} catch (err) {
		// If decryption fails, check if plaintext (e.g. pre-migration or dev setup)
		if (!isEncrypted(stored)) {
			// Transparently re-encrypt
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
				encryptValue(stored.trim()),
			);
			return stored.trim();
		}
		return null;
	}
};

/**
 * Instantiate a server-side CloudflareClient using stored credentials.
 */
export const getCloudflareClient = async (
	overrideToken?: string | null,
	fetchImpl?: typeof fetch,
): Promise<CloudflareClient | null> => {
	const token = overrideToken?.trim() || (await getCloudflareApiToken());
	if (!token) {
		return null;
	}
	return new CloudflareClient({
		apiToken: token,
		fetchImpl,
	});
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve sanitized Cloudflare for SaaS settings for administrator view.
 * Redacts secrets completely.
 */
export const getCloudflareSaasSettings = async (): Promise<CloudflareSaasSettingsView> => {
	const enabled =
		(await getPlatformSettingValue(PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_ENABLED)) === "true";
	const storedToken = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
	);
	const zoneId = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_ZONE_ID,
	);
	const cnameTarget = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_CNAME_TARGET,
	);
	const fallbackOrigin = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN,
	);
	const fallbackOriginStatus = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN_STATUS,
	);
	const rawSslMethod = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_DEFAULT_SSL_METHOD,
		"http",
	);
	const defaultSslMethod: "http" | "txt" | "cname" =
		rawSslMethod === "txt" || rawSslMethod === "cname" ? rawSslMethod : "http";

	const autoProvision =
		(await getPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_AUTO_PROVISION,
			"true",
		)) !== "false";

	const hasApiToken = Boolean(storedToken && storedToken.trim().length > 0) ||
		Boolean(process.env.CLOUDFLARE_API_TOKEN);

	let maskedApiToken: string | null = null;
	if (hasApiToken) {
		const decrypted = await getCloudflareApiToken();
		maskedApiToken = decrypted ? maskToken(decrypted) : "••••••••";
	}

	return {
		enabled,
		hasApiToken,
		maskedApiToken,
		zoneId,
		cnameTarget,
		fallbackOrigin,
		fallbackOriginStatus,
		defaultSslMethod,
		autoProvision,
	};
};

/**
 * Update Cloudflare for SaaS administrator settings with encrypted secret persistence.
 */
export const updateCloudflareSaasSettings = async (
	input: UpdateCloudflareSaasSettingsInput,
): Promise<CloudflareSaasSettingsView> => {
	if (input.enabled !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_ENABLED,
			input.enabled ? "true" : "false",
			"Whether Cloudflare for SaaS custom hostname automation is enabled",
		);
	}

	if (input.apiToken !== undefined) {
		if (input.apiToken && input.apiToken.trim().length > 0) {
			const clean = input.apiToken.trim();
			// Store AES-256-GCM encrypted
			const encrypted = encryptValue(clean);
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
				encrypted,
				"Cloudflare API Bearer token for Custom Hostnames (encrypted)",
			);
		} else if (input.apiToken === null || input.apiToken === "") {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_API_TOKEN,
				null,
			);
		}
	}

	if (input.zoneId !== undefined) {
		const cleanZoneId = input.zoneId?.trim() || null;
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_ZONE_ID,
			cleanZoneId,
			"Cloudflare Zone ID for platform apex domain",
		);
	}

	if (input.cnameTarget !== undefined) {
		const clean = input.cnameTarget?.trim().toLowerCase() || null;
		if (clean && !VALID_HOSTNAME_REGEX.test(clean)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: INVALID_HOSTNAME_MESSAGE,
			});
		}
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_CNAME_TARGET,
			clean,
			"Provider-managed customer CNAME target hostname",
		);
	}

	if (input.fallbackOrigin !== undefined) {
		const clean = input.fallbackOrigin?.trim().toLowerCase() || null;
		if (clean && !VALID_HOSTNAME_REGEX.test(clean)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: INVALID_HOSTNAME_MESSAGE,
			});
		}
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN,
			clean,
			"Cloudflare for SaaS Fallback Origin hostname",
		);
	}

	if (input.defaultSslMethod !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_DEFAULT_SSL_METHOD,
			input.defaultSslMethod,
			"Default SSL validation method for Custom Hostnames (http, txt, cname)",
		);
	}

	if (input.autoProvision !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_AUTO_PROVISION,
			input.autoProvision ? "true" : "false",
			"Whether to automatically provision custom hostnames on domain creation",
		);
	}

	return await getCloudflareSaasSettings();
};

/**
 * Test connectivity, permissions, zone access, and fallback origin configuration.
 * Sanitizes errors to ensure no tokens or internal secrets are exposed.
 */
export const testCloudflareConnection = async (
	options?: {
		apiToken?: string | null;
		zoneId?: string | null;
	},
	fetchImpl?: typeof fetch,
): Promise<CloudflareConnectionTestResult> => {
	const token = options?.apiToken?.trim() || (await getCloudflareApiToken());
	if (!token) {
		return {
			success: false,
			message: "No Cloudflare API token configured.",
			error: "Please enter and save a valid Cloudflare API Bearer token.",
		};
	}

	const zoneId =
		options?.zoneId?.trim() ||
		(await getPlatformSettingValue(
			PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_ZONE_ID,
		));

	if (!zoneId) {
		return {
			success: false,
			message: "No Cloudflare Zone ID configured.",
			error: "Please enter the Zone ID for your platform domain (e.g. hatdot.cloud).",
		};
	}

	try {
		const client = new CloudflareClient({
			apiToken: token,
			fetchImpl,
		});

		const testRes = await client.testConnection(zoneId);

		// Cache verified fallback origin status
		if (testRes.fallbackOriginStatus) {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN_STATUS,
				testRes.fallbackOriginStatus,
			);
		}

		return {
			success: true,
			zoneName: testRes.zoneName,
			fallbackOrigin: testRes.fallbackOrigin,
			fallbackOriginStatus: testRes.fallbackOriginStatus,
			message: testRes.message,
		};
	} catch (err: any) {
		const msg =
			err instanceof CloudflareClientError
				? err.message
				: err instanceof Error
				? err.message
				: "Unknown connection error";

		let actionable = msg;
		if (msg.includes("10000") || msg.includes("Authentication error") || err?.statusCode === 401) {
			actionable = "Invalid API token. Verify token permissions (Zone.Custom Hostnames: Edit, Zone: Read).";
		} else if (msg.includes("7003") || msg.includes("Zone not found") || err?.statusCode === 404) {
			actionable = `Zone "${zoneId}" not found or token does not have access to this zone.`;
		}

		return {
			success: false,
			message: "Connection test failed.",
			error: actionable,
		};
	}
};

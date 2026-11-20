/**
 * SonicPesa Credentials & Settings Service — Hatdot PaaS
 *
 * Secure management of SonicPesa payment gateway credentials.
 * Credentials are stored in `paas_platform_setting` table with environment fallback.
 * Plaintext secrets are strictly protected and never exposed to client or non-admin roles.
 */
import { PLATFORM_SETTING_KEYS } from "../db/schema/platform-settings";
import { getPlatformSettingValue, setPlatformSettingValue } from "./cname-routing";

export interface SonicPesaSanitizedSettings {
	enabled: boolean;
	hasApiKey: boolean;
	hasApiSecret: boolean;
	maskedApiKey: string;
	maskedApiSecret: string;
	baseUrl: string;
	mode: "live" | "sandbox";
}

export interface SonicPesaResolvedCredentials {
	enabled: boolean;
	apiKey: string;
	apiSecret: string;
	baseUrl: string;
	mode: "live" | "sandbox";
}

export interface UpdateSonicPesaSettingsInput {
	enabled?: boolean;
	apiKey?: string | null;
	apiSecret?: string | null;
	baseUrl?: string | null;
	mode?: "live" | "sandbox";
}

export interface TestSonicPesaResult {
	success: boolean;
	message: string;
	status?: number;
	mode: "live" | "sandbox";
	latencyMs: number;
}

const maskString = (val?: string | null): string => {
	if (!val) return "";
	const trimmed = val.trim();
	if (trimmed.length <= 6) {
		return "••••••••";
	}
	const prefix = trimmed.slice(0, 3);
	const suffix = trimmed.slice(-4);
	return `${prefix}••••••••${suffix}`;
};

/**
 * Resolves live credentials with DB precedence over process.env.
 * Used internally by payment provider, service, and webhook verification.
 */
export async function getSonicPesaResolvedCredentials(): Promise<SonicPesaResolvedCredentials> {
	const dbEnabled = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SONICPESA_ENABLED, null);
	const dbApiKey = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SONICPESA_API_KEY, null);
	const dbApiSecret = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SONICPESA_API_SECRET, null);
	const dbBaseUrl = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SONICPESA_BASE_URL, null);
	const dbMode = (await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SONICPESA_MODE, null)) as "live" | "sandbox" | null;

	const apiKey = dbApiKey?.trim() || process.env.SONICPESA_API_KEY?.trim() || "";
	const apiSecret = dbApiSecret?.trim() || process.env.SONICPESA_API_SECRET?.trim() || "";
	const mode: "live" | "sandbox" = dbMode || (process.env.SONICPESA_MODE === "sandbox" ? "sandbox" : "live");
	
	const defaultBaseUrl = mode === "sandbox" 
		? "https://sandbox.sonicpesa.com/api/v1" 
		: "https://api.sonicpesa.com/api/v1";

	const baseUrl = dbBaseUrl?.trim() || process.env.SONICPESA_BASE_URL?.trim() || defaultBaseUrl;

	const enabled = dbEnabled !== null
		? dbEnabled === "true"
		: Boolean(apiKey && process.env.SONICPESA_ENABLED !== "false");

	return {
		enabled,
		apiKey,
		apiSecret,
		baseUrl: baseUrl.replace(/\/+$/, ""),
		mode,
	};
}

/**
 * Returns masked settings safe for admin dashboard UI.
 */
export async function getSonicPesaSanitizedSettings(): Promise<SonicPesaSanitizedSettings> {
	const creds = await getSonicPesaResolvedCredentials();

	return {
		enabled: creds.enabled,
		hasApiKey: Boolean(creds.apiKey),
		hasApiSecret: Boolean(creds.apiSecret),
		maskedApiKey: maskString(creds.apiKey),
		maskedApiSecret: maskString(creds.apiSecret),
		baseUrl: creds.baseUrl,
		mode: creds.mode,
	};
}

/**
 * Updates SonicPesa settings in the database.
 * Preserves existing credentials if masked placeholder is passed.
 */
export async function updateSonicPesaSettings(
	input: UpdateSonicPesaSettingsInput,
): Promise<SonicPesaSanitizedSettings> {
	if (input.enabled !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SONICPESA_ENABLED,
			input.enabled ? "true" : "false",
			"Enable or disable SonicPesa payment gateway",
		);
	}

	if (input.mode !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SONICPESA_MODE,
			input.mode,
			"SonicPesa gateway operational mode (live or sandbox)",
		);
	}

	if (input.baseUrl !== undefined) {
		const cleanUrl = input.baseUrl ? input.baseUrl.trim().replace(/\/+$/, "") : null;
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SONICPESA_BASE_URL,
			cleanUrl,
			"SonicPesa API base endpoint URL",
		);
	}

	// Update API Key only if user entered a new unmasked value
	if (input.apiKey !== undefined && input.apiKey !== null) {
		const trimmedKey = input.apiKey.trim();
		if (trimmedKey && !trimmedKey.includes("••")) {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SONICPESA_API_KEY,
				trimmedKey,
				"SonicPesa API Key for USSD push and order creation",
			);
		} else if (trimmedKey === "") {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SONICPESA_API_KEY,
				null,
				"SonicPesa API Key",
			);
		}
	}

	// Update API Secret only if user entered a new unmasked value
	if (input.apiSecret !== undefined && input.apiSecret !== null) {
		const trimmedSecret = input.apiSecret.trim();
		if (trimmedSecret && !trimmedSecret.includes("••")) {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SONICPESA_API_SECRET,
				trimmedSecret,
				"SonicPesa API Secret for HMAC webhook verification",
			);
		} else if (trimmedSecret === "") {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SONICPESA_API_SECRET,
				null,
				"SonicPesa API Secret",
			);
		}
	}

	return await getSonicPesaSanitizedSettings();
}

/**
 * Tests connection and authentication against SonicPesa API.
 */
export async function testSonicPesaConnection(input?: {
	apiKey?: string | null;
	apiSecret?: string | null;
	baseUrl?: string | null;
	mode?: "live" | "sandbox";
}): Promise<TestSonicPesaResult> {
	const current = await getSonicPesaResolvedCredentials();
	const apiKey =
		input?.apiKey && !input.apiKey.includes("••")
			? input.apiKey.trim()
			: current.apiKey;
	const apiSecret =
		input?.apiSecret && !input.apiSecret.includes("••")
			? input.apiSecret.trim()
			: current.apiSecret;
	const mode = input?.mode || current.mode;
	const defaultBaseUrl = mode === "sandbox"
		? "https://sandbox.sonicpesa.com/api/v1"
		: "https://api.sonicpesa.com/api/v1";
	const baseUrl = (input?.baseUrl?.trim() || current.baseUrl || defaultBaseUrl).replace(/\/+$/, "");

	if (!apiKey) {
		return {
			success: false,
			message: "SonicPesa API Key is empty or missing. Please enter a valid API key.",
			mode,
			latencyMs: 0,
		};
	}

	const startTime = Date.now();
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-API-KEY": apiKey,
		};
		if (apiSecret) {
			headers["X-API-SECRET"] = apiSecret;
		}

		// Probe order_status endpoint with test probe ID
		const res = await fetch(`${baseUrl}/payment/order_status`, {
			method: "POST",
			headers,
			body: JSON.stringify({ order_id: "probe-connection-check" }),
			signal: AbortSignal.timeout(8000),
		});

		const latencyMs = Date.now() - startTime;
		const rawText = await res.text();
		let data: any = {};
		try {
			data = JSON.parse(rawText);
		} catch {
			// Non-JSON response
		}

		if (res.status === 401 || res.status === 403 || data?.message?.toLowerCase()?.includes("invalid api key") || data?.message?.toLowerCase()?.includes("unauthorized")) {
			return {
				success: false,
				message: `Authentication failed: ${data?.message || "Invalid SonicPesa API Key or unauthorized"}`,
				status: res.status,
				mode,
				latencyMs,
			};
		}

		// A 200 with order not found or general response means the API key was authenticated by SonicPesa
		return {
			success: true,
			message: `SonicPesa API connected and authenticated successfully (${latencyMs}ms). Gateway is ready to process payments.`,
			status: res.status,
			mode,
			latencyMs,
		};
	} catch (err: any) {
		const latencyMs = Date.now() - startTime;
		return {
			success: false,
			message: `Connection error: ${err?.message || "Failed to reach SonicPesa server"} (${baseUrl})`,
			mode,
			latencyMs,
		};
	}
}


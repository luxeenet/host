/**
 * Cloudflare for SaaS Official API Client
 *
 * Implements typed, server-side communication with Cloudflare API v4
 * for Custom Hostnames management and Fallback Origin configuration.
 *
 * Official Reference:
 * - https://developers.cloudflare.com/api/resources/custom_hostnames/
 * - https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 */

import { z } from "zod";

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

// ---------------------------------------------------------------------------
// Zod Schemas for Runtime Validation
// ---------------------------------------------------------------------------

export const CloudflareApiErrorSchema = z.object({
	code: z.number(),
	message: z.string(),
	error_chain: z
		.array(
			z.object({
				code: z.number(),
				message: z.string(),
			}),
		)
		.optional(),
});

export type CloudflareApiError = z.infer<typeof CloudflareApiErrorSchema>;

export const CloudflareEnvelopeSchema = <T extends z.ZodTypeAny>(resultSchema: T) =>
	z.object({
		success: z.boolean(),
		errors: z.array(CloudflareApiErrorSchema).default([]),
		messages: z.array(z.string()).default([]),
		result: resultSchema.nullable().optional(),
		result_info: z
			.object({
				page: z.number().optional(),
				per_page: z.number().optional(),
				count: z.number().optional(),
				total_count: z.number().optional(),
				total_pages: z.number().optional(),
			})
			.optional(),
	});

export const CloudflareOwnershipVerificationSchema = z.object({
	type: z.string().optional(),
	name: z.string().optional(),
	value: z.string().optional(),
});

export const CloudflareOwnershipVerificationHttpSchema = z.object({
	http_url: z.string().optional(),
	http_body: z.string().optional(),
});

export const CloudflareSslValidationRecordSchema = z.object({
	status: z.string().optional(),
	txt_name: z.string().optional(),
	txt_value: z.string().optional(),
	http_url: z.string().optional(),
	http_body: z.string().optional(),
	cname: z.string().optional(),
	cname_target: z.string().optional(),
	emails: z.array(z.string()).optional(),
});

export const CloudflareSslCertificateSchema = z.object({
	id: z.string().optional(),
	issuer: z.string().optional(),
	serial_number: z.string().optional(),
	signature: z.string().optional(),
	expires_on: z.string().optional(),
	issued_on: z.string().optional(),
	fingerprint_sha256: z.string().optional(),
});

export const CloudflareSslSettingsSchema = z.object({
	http2: z.enum(["on", "off"]).optional(),
	tls_1_3: z.enum(["on", "off"]).optional(),
	min_tls_version: z.enum(["1.0", "1.1", "1.2", "1.3"]).optional(),
	ciphers: z.array(z.string()).optional(),
});

export const CloudflareCustomHostnameSslSchema = z.object({
	id: z.string().optional(),
	type: z.string().optional(),
	method: z.enum(["http", "txt", "cname", "email"]).optional(),
	status: z.string().optional(),
	hosts: z.array(z.string()).optional(),
	validation_records: z.array(CloudflareSslValidationRecordSchema).optional(),
	validation_errors: z.array(z.record(z.string(), z.unknown())).optional(),
	certificates: z.array(CloudflareSslCertificateSchema).optional(),
	settings: CloudflareSslSettingsSchema.optional(),
	wildcard: z.boolean().optional(),
	certificate_authority: z.string().optional(),
});

export const CloudflareCustomHostnameSchema = z.object({
	id: z.string(),
	hostname: z.string(),
	status: z.string(),
	custom_origin_server: z.string().optional().nullable(),
	verification_errors: z.array(z.string()).optional(),
	ownership_verification: CloudflareOwnershipVerificationSchema.optional().nullable(),
	ownership_verification_http:
		CloudflareOwnershipVerificationHttpSchema.optional().nullable(),
	ssl: CloudflareCustomHostnameSslSchema.optional().nullable(),
	created_at: z.string().optional(),
});

export type CloudflareCustomHostname = z.infer<typeof CloudflareCustomHostnameSchema>;
export type CloudflareSslValidationRecord = z.infer<
	typeof CloudflareSslValidationRecordSchema
>;
export type CloudflareSslCertificate = z.infer<typeof CloudflareSslCertificateSchema>;
export type CloudflareOwnershipVerification = z.infer<
	typeof CloudflareOwnershipVerificationSchema
>;

export const CloudflareFallbackOriginSchema = z.object({
	origin: z.string(),
	status: z.string(),
	errors: z.array(z.string()).optional(),
});

export type CloudflareFallbackOrigin = z.infer<typeof CloudflareFallbackOriginSchema>;

export const CloudflareZoneSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	paused: z.boolean().optional(),
	type: z.string().optional(),
});

export type CloudflareZone = z.infer<typeof CloudflareZoneSchema>;

// ---------------------------------------------------------------------------
// Client Request Interfaces
// ---------------------------------------------------------------------------

export interface CreateCustomHostnameOptions {
	hostname: string;
	ssl?: {
		method?: "http" | "txt" | "cname";
		type?: "dv";
		settings?: {
			http2?: "on" | "off";
			tls_1_3?: "on" | "off";
			min_tls_version?: "1.0" | "1.1" | "1.2" | "1.3";
			ciphers?: string[];
		};
		wildcard?: boolean;
		certificate_authority?: "lets_encrypt" | "google" | "ssl_com";
	};
	custom_origin_server?: string;
}

export interface UpdateCustomHostnameOptions {
	ssl?: {
		method?: "http" | "txt" | "cname";
		settings?: {
			http2?: "on" | "off";
			tls_1_3?: "on" | "off";
			min_tls_version?: "1.0" | "1.1" | "1.2" | "1.3";
		};
	};
	custom_origin_server?: string | null;
}

export interface ListCustomHostnamesOptions {
	hostname?: string;
	page?: number;
	per_page?: number;
	order?: "hostname" | "status" | "ssl.status" | "created_at";
	direction?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Error Class
// ---------------------------------------------------------------------------

export class CloudflareClientError extends Error {
	public readonly statusCode: number;
	public readonly errors: CloudflareApiError[];
	public readonly primaryCode?: number;

	constructor(
		message: string,
		statusCode: number,
		errors: CloudflareApiError[] = [],
	) {
		super(message);
		this.name = "CloudflareClientError";
		this.statusCode = statusCode;
		this.errors = errors;
		this.primaryCode = errors[0]?.code;
	}

	get isRateLimited(): boolean {
		return this.statusCode === 429;
	}

	get isNotFound(): boolean {
		return this.statusCode === 404 || this.primaryCode === 1436;
	}

	get isDuplicate(): boolean {
		// Cloudflare code 1406: "Custom hostname already exists."
		return this.primaryCode === 1406;
	}

	get isAuthError(): boolean {
		return (
			this.statusCode === 401 ||
			this.statusCode === 403 ||
			this.primaryCode === 10000 ||
			this.primaryCode === 9109
		);
	}
}

// ---------------------------------------------------------------------------
// Cloudflare Client Implementation
// ---------------------------------------------------------------------------

export interface CloudflareClientConfig {
	apiToken: string;
	baseUrl?: string;
	timeoutMs?: number;
	maxRetries?: number;
	fetchImpl?: typeof fetch;
}

export class CloudflareClient {
	private readonly apiToken: string;
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly maxRetries: number;
	private readonly customFetch?: typeof fetch;

	constructor(config: CloudflareClientConfig) {
		if (!config.apiToken || config.apiToken.trim().length === 0) {
			throw new Error("Cloudflare API token is required.");
		}
		this.apiToken = config.apiToken.trim();
		this.baseUrl = (config.baseUrl || CLOUDFLARE_API_BASE).replace(/\/$/, "");
		this.timeoutMs = config.timeoutMs ?? 15000;
		this.maxRetries = config.maxRetries ?? 2;
		this.customFetch = config.fetchImpl;
	}

	/**
	 * Low-level HTTP request dispatcher with Bearer auth, timeout,
	 * exponential backoff on HTTP 429 rate limits, and typed response validation.
	 */
	private async request<T>(
		path: string,
		options: {
			method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
			body?: unknown;
			schema: z.ZodType<T>;
		},
	): Promise<{ result: T; resultInfo?: any; messages: string[] }> {
		const method = options.method || "GET";
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiToken}`,
			Accept: "application/json",
		};
		if (options.body) {
			headers["Content-Type"] = "application/json";
		}

		const fetchFn = this.customFetch || fetch;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			let timeoutId: NodeJS.Timeout | undefined;
			try {
				const controller = new AbortController();
				timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

				const response = await fetchFn(url, {
					method,
					headers,
					body: options.body ? JSON.stringify(options.body) : undefined,
					signal: controller.signal,
				});

				// Rate limiting backoff
				if (response.status === 429 && attempt < this.maxRetries) {
					const retryAfterHeader = response.headers?.get?.("Retry-After");
					const retrySeconds = retryAfterHeader
						? Number.parseInt(retryAfterHeader, 10) || 2
						: Math.pow(2, attempt) + 1;
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(retrySeconds * 1000, 10000)),
					);
					continue;
				}

				let rawBody: any;
				const text = await response.text();
				try {
					rawBody = JSON.parse(text);
				} catch {
					throw new CloudflareClientError(
						`Cloudflare API returned non-JSON response (HTTP ${response.status}): ${text.slice(0, 150)}`,
						response.status,
					);
				}

				const envelopeSchema = CloudflareEnvelopeSchema(options.schema);
				const parsed = envelopeSchema.safeParse(rawBody);

				if (!parsed.success) {
					// Check if envelope indicates failure even if schema failed
					const rawErrors = Array.isArray(rawBody?.errors)
						? rawBody.errors.map((e: any) => ({
								code: typeof e?.code === "number" ? e.code : response.status,
								message: e?.message || "Unknown Cloudflare error",
						  }))
						: [];
					const errorMsg =
						rawErrors[0]?.message ||
						`Failed to parse Cloudflare API response: ${parsed.error.message}`;
					throw new CloudflareClientError(errorMsg, response.status, rawErrors);
				}

				const envelope = parsed.data;

				if (!response.ok || !envelope.success) {
					const primary = envelope.errors[0];
					const msg =
						primary?.message ||
						`Cloudflare request failed with HTTP ${response.status}`;
					throw new CloudflareClientError(
						msg,
						response.status,
						envelope.errors,
					);
				}

				return {
					result: envelope.result as T,
					resultInfo: envelope.result_info,
					messages: envelope.messages,
				};
			} catch (err: any) {
				lastError = err;
				if (err instanceof CloudflareClientError) {
					// Don't retry non-rate-limit 4xx client errors
					if (err.statusCode >= 400 && err.statusCode < 500 && !err.isRateLimited) {
						throw err;
					}
				}
				if (attempt < this.maxRetries) {
					const backoff = (attempt + 1) * 1000;
					await new Promise((r) => setTimeout(r, backoff));
				}
			} finally {
				if (timeoutId) clearTimeout(timeoutId);
			}
		}

		throw (
			lastError ||
			new CloudflareClientError("Cloudflare request timed out or failed", 500)
		);
	}

	// -----------------------------------------------------------------------
	// Custom Hostnames API Operations
	// -----------------------------------------------------------------------

	/**
	 * POST /zones/{zone_id}/custom_hostnames
	 * Register a new custom hostname in Cloudflare for SaaS.
	 */
	async createCustomHostname(
		zoneId: string,
		options: CreateCustomHostnameOptions,
	): Promise<CloudflareCustomHostname> {
		const cleanZoneId = zoneId.trim();
		const body: Record<string, unknown> = {
			hostname: options.hostname.trim().toLowerCase(),
		};

		if (options.ssl) {
			body.ssl = {
				method: options.ssl.method || "http",
				type: options.ssl.type || "dv",
				...(options.ssl.settings ? { settings: options.ssl.settings } : {}),
				...(options.ssl.wildcard !== undefined
					? { wildcard: options.ssl.wildcard }
					: {}),
				...(options.ssl.certificate_authority
					? { certificate_authority: options.ssl.certificate_authority }
					: {}),
			};
		} else {
			body.ssl = {
				method: "http",
				type: "dv",
				settings: {
					http2: "on",
					tls_1_3: "on",
					min_tls_version: "1.2",
				},
			};
		}

		if (options.custom_origin_server) {
			body.custom_origin_server = options.custom_origin_server.trim();
		}

		const res = await this.request(
			`/zones/${cleanZoneId}/custom_hostnames`,
			{
				method: "POST",
				body,
				schema: CloudflareCustomHostnameSchema,
			},
		);

		return res.result;
	}

	/**
	 * GET /zones/{zone_id}/custom_hostnames/{custom_hostname_id}
	 * Retrieve current details, validation records, and SSL status of a custom hostname.
	 */
	async getCustomHostname(
		zoneId: string,
		customHostnameId: string,
	): Promise<CloudflareCustomHostname> {
		const res = await this.request(
			`/zones/${zoneId.trim()}/custom_hostnames/${customHostnameId.trim()}`,
			{
				method: "GET",
				schema: CloudflareCustomHostnameSchema,
			},
		);
		return res.result;
	}

	/**
	 * GET /zones/{zone_id}/custom_hostnames
	 * List custom hostnames, optionally filtered by hostname.
	 */
	async listCustomHostnames(
		zoneId: string,
		options: ListCustomHostnamesOptions = {},
	): Promise<{
		hostnames: CloudflareCustomHostname[];
		resultInfo?: any;
	}> {
		const params = new URLSearchParams();
		if (options.hostname) {
			params.set("hostname", options.hostname.trim().toLowerCase());
		}
		if (options.page) {
			params.set("page", String(options.page));
		}
		if (options.per_page) {
			params.set("per_page", String(options.per_page));
		}
		if (options.order) {
			params.set("order", options.order);
		}
		if (options.direction) {
			params.set("direction", options.direction);
		}

		const queryString = params.toString();
		const path = `/zones/${zoneId.trim()}/custom_hostnames${queryString ? `?${queryString}` : ""}`;

		const res = await this.request(path, {
			method: "GET",
			schema: z.array(CloudflareCustomHostnameSchema),
		});

		return {
			hostnames: res.result,
			resultInfo: res.resultInfo,
		};
	}

	/**
	 * PATCH /zones/{zone_id}/custom_hostnames/{custom_hostname_id}
	 * Modify SSL settings or origin server of a custom hostname.
	 */
	async updateCustomHostname(
		zoneId: string,
		customHostnameId: string,
		options: UpdateCustomHostnameOptions,
	): Promise<CloudflareCustomHostname> {
		const body: Record<string, unknown> = {};
		if (options.ssl) {
			body.ssl = options.ssl;
		}
		if (options.custom_origin_server !== undefined) {
			body.custom_origin_server = options.custom_origin_server;
		}

		const res = await this.request(
			`/zones/${zoneId.trim()}/custom_hostnames/${customHostnameId.trim()}`,
			{
				method: "PATCH",
				body,
				schema: CloudflareCustomHostnameSchema,
			},
		);

		return res.result;
	}

	/**
	 * DELETE /zones/{zone_id}/custom_hostnames/{custom_hostname_id}
	 * Delete a custom hostname from Cloudflare for SaaS.
	 */
	async deleteCustomHostname(
		zoneId: string,
		customHostnameId: string,
	): Promise<{ id: string }> {
		const res = await this.request(
			`/zones/${zoneId.trim()}/custom_hostnames/${customHostnameId.trim()}`,
			{
				method: "DELETE",
				schema: z.object({ id: z.string() }),
			},
		);
		return res.result;
	}

	// -----------------------------------------------------------------------
	// Fallback Origin Operations
	// -----------------------------------------------------------------------

	/**
	 * GET /zones/{zone_id}/custom_hostnames/fallback_origin
	 * Retrieve current fallback origin configuration and deployment status.
	 */
	async getFallbackOrigin(zoneId: string): Promise<CloudflareFallbackOrigin> {
		const res = await this.request(
			`/zones/${zoneId.trim()}/custom_hostnames/fallback_origin`,
			{
				method: "GET",
				schema: CloudflareFallbackOriginSchema,
			},
		);
		return res.result;
	}

	/**
	 * PUT /zones/{zone_id}/custom_hostnames/fallback_origin
	 * Set or update the fallback origin hostname for Cloudflare for SaaS.
	 */
	async setFallbackOrigin(
		zoneId: string,
		origin: string,
	): Promise<CloudflareFallbackOrigin> {
		const res = await this.request(
			`/zones/${zoneId.trim()}/custom_hostnames/fallback_origin`,
			{
				method: "PUT",
				body: { origin: origin.trim().toLowerCase() },
				schema: CloudflareFallbackOriginSchema,
			},
		);
		return res.result;
	}

	// -----------------------------------------------------------------------
	// Zone Information & Access Verification
	// -----------------------------------------------------------------------

	/**
	 * GET /zones/{zone_id}
	 * Retrieve zone metadata to verify token permissions and zone existence.
	 */
	async getZone(zoneId: string): Promise<CloudflareZone> {
		const res = await this.request(`/zones/${zoneId.trim()}`, {
			method: "GET",
			schema: CloudflareZoneSchema,
		});
		return res.result;
	}

	/**
	 * Validate connection: verifies zone access and checks fallback origin status.
	 */
	async testConnection(zoneId: string): Promise<{
		zoneValid: boolean;
		zoneName: string;
		fallbackOrigin: string | null;
		fallbackOriginStatus: string | null;
		message: string;
	}> {
		const zone = await this.getZone(zoneId);
		let fallbackOrigin: string | null = null;
		let fallbackOriginStatus: string | null = null;

		try {
			const fallback = await this.getFallbackOrigin(zoneId);
			fallbackOrigin = fallback.origin;
			fallbackOriginStatus = fallback.status;
		} catch (err: any) {
			// Fallback origin may not be configured yet on Cloudflare side
			fallbackOriginStatus = "not_configured";
		}

		let message = `Connected to zone "${zone.name}".`;
		if (fallbackOrigin && fallbackOriginStatus === "active") {
			message += ` Fallback origin "${fallbackOrigin}" is active.`;
		} else if (fallbackOrigin) {
			message += ` Fallback origin "${fallbackOrigin}" status: ${fallbackOriginStatus}.`;
		} else {
			message += ` Warning: Fallback origin is not configured on Cloudflare yet.`;
		}

		return {
			zoneValid: true,
			zoneName: zone.name,
			fallbackOrigin,
			fallbackOriginStatus,
			message,
		};
	}
}

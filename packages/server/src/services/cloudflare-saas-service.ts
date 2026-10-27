/**
 * Cloudflare for SaaS Custom Hostname Lifecycle Service
 *
 * Implements automatic Cloudflare Custom Hostname provisioning, verification tracking,
 * certificate issuance reconciliation, and safe lifecycle cleanup.
 */

import { db } from "@dokploy/server/db";
import { domains } from "../db/schema/domain";
import { PLATFORM_SETTING_KEYS } from "../db/schema/platform-settings";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
	getPlatformSettingValue,
	resolveCnameTargetForService,
} from "./cname-routing";
import {
	getCloudflareApiToken,
	getCloudflareClient,
	getCloudflareSaasSettings,
} from "./cloudflare-saas-settings";
import {
	CloudflareClient,
	CloudflareClientError,
	type CloudflareCustomHostname,
	type CloudflareSslValidationRecord,
} from "./cloudflare-client";
import { isPlatformOrTestDomain } from "./domain";
import { findApplicationById } from "./application";
import { manageDomain } from "../utils/traefik/domain";

export type DomainRow = typeof domains.$inferSelect;

export interface CloudflareDnsRecordInstruction {
	type: "CNAME" | "TXT" | "HTTP";
	name: string;
	value: string;
	purpose: "Traffic Routing" | "Domain Ownership Verification" | "SSL Certificate Validation (DCV)";
	status: "active" | "pending" | "required" | "verified";
	description: string;
}

export interface CloudflareDomainLifecycleStatus {
	isCloudflareSaas: boolean;
	hostnameId: string | null;
	status: "pending" | "pending_verification" | "pending_certificate" | "active" | "error";
	stageName:
		| "Awaiting DNS configuration"
		| "Verifying domain ownership"
		| "Issuing SSL certificate"
		| "Active — HTTPS ready"
		| "Configuration Error";
	stageStep: 1 | 2 | 3 | 4;
	hostnameStatus: string | null;
	sslStatus: string | null;
	lastSyncAt: Date | null;
	lastError: string | null;
	isHttpsReady: boolean;
	records: CloudflareDnsRecordInstruction[];
	customerActionRequired: string;
}

// ---------------------------------------------------------------------------
// Predicates & Configuration Helpers
// ---------------------------------------------------------------------------

export const isCloudflareSaasActive = async (): Promise<boolean> => {
	const settings = await getCloudflareSaasSettings();
	return (
		settings.enabled &&
		settings.hasApiToken &&
		Boolean(settings.zoneId && settings.zoneId.trim().length > 0)
	);
};

export const resolveCloudflareCnameTarget = async (
	options?: {
		applicationId?: string | null;
		composeId?: string | null;
	},
): Promise<string> => {
	// 1. Specific Cloudflare SaaS customer CNAME target
	const cfTarget = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_CNAME_TARGET,
	);
	if (cfTarget && cfTarget.trim().length > 0) {
		return cfTarget.trim().toLowerCase();
	}

	// 2. Cloudflare Fallback Origin
	const fallbackOrigin = await getPlatformSettingValue(
		PLATFORM_SETTING_KEYS.CLOUDFLARE_SAAS_FALLBACK_ORIGIN,
	);
	if (fallbackOrigin && fallbackOrigin.trim().length > 0) {
		return fallbackOrigin.trim().toLowerCase();
	}

	// 3. Fallback to platform routing target
	return await resolveCnameTargetForService(options || {});
};

// ---------------------------------------------------------------------------
// Provisioning Operation
// ---------------------------------------------------------------------------

export const provisionCustomHostname = async (
	domainId: string,
	options?: {
		tx?: any;
		fetchImpl?: typeof fetch;
	},
): Promise<DomainRow> => {
	const tx = options?.tx || db;

	const domainRows = await tx
		.select()
		.from(domains)
		.where(eq(domains.domainId, domainId))
		.limit(1);

	const domain = domainRows[0];
	if (!domain) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Domain not found",
		});
	}

	// Never register platform internal subdomains or localhost with Cloudflare
	if (await isPlatformOrTestDomain(domain.host)) {
		return domain;
	}

	// If already registered with Cloudflare, synchronize status instead of recreating
	if (domain.cfHostnameId) {
		return await syncCustomHostnameStatus(domainId, options);
	}

	const saasActive = await isCloudflareSaasActive();
	if (!saasActive) {
		return domain;
	}

	const settings = await getCloudflareSaasSettings();
	const zoneId = settings.zoneId;
	if (!zoneId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Cloudflare Zone ID is not configured.",
		});
	}

	const client = await getCloudflareClient(undefined, options?.fetchImpl);
	if (!client) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Cloudflare API token is not configured.",
		});
	}

	const cleanHost = domain.host.trim().toLowerCase();

	try {
		let cfHostname: CloudflareCustomHostname;
		try {
			cfHostname = await client.createCustomHostname(zoneId, {
				hostname: cleanHost,
				ssl: {
					method: settings.defaultSslMethod || "http",
					type: "dv",
					settings: {
						http2: "on",
						tls_1_3: "on",
						min_tls_version: "1.2",
					},
				},
			});
		} catch (createErr: any) {
			// Idempotency: Cloudflare error code 1406: "Custom hostname already exists."
			if (createErr instanceof CloudflareClientError && createErr.isDuplicate) {
				const existingList = await client.listCustomHostnames(zoneId, {
					hostname: cleanHost,
				});
				const existing = existingList.hostnames.find(
					(h) => h.hostname.toLowerCase() === cleanHost,
				);
				if (existing) {
					cfHostname = existing;
				} else {
					throw createErr;
				}
			} else {
				throw createErr;
			}
		}

		// Persist returned Cloudflare details
		const updated = await tx
			.update(domains)
			.set({
				cfHostnameId: cfHostname.id,
				cfStatus: cfHostname.status || "pending",
				cfSslStatus: cfHostname.ssl?.status || "initializing",
				cfVerificationErrors: cfHostname.verification_errors || [],
				cfOwnershipVerification: cfHostname.ownership_verification || null,
				cfSslValidationRecords: cfHostname.ssl?.validation_records || null,
				cfSslCertificates: cfHostname.ssl?.certificates || null,
				cfLastSyncAt: new Date(),
				cfLastError: null,
			})
			.where(eq(domains.domainId, domainId))
			.returning();

		return updated[0];
	} catch (err: any) {
		const errorMessage =
			err instanceof CloudflareClientError
				? err.message
				: err instanceof Error
				? err.message
				: "Cloudflare custom hostname registration failed";

		// Record error on domain record so user and admin see what happened
		const updated = await tx
			.update(domains)
			.set({
				cfStatus: "error",
				cfLastError: errorMessage,
				cfLastSyncAt: new Date(),
			})
			.where(eq(domains.domainId, domainId))
			.returning();

		return updated[0] || domain;
	}
};

// ---------------------------------------------------------------------------
// Synchronization Operation
// ---------------------------------------------------------------------------

export const syncCustomHostnameStatus = async (
	domainId: string,
	options?: {
		tx?: any;
		fetchImpl?: typeof fetch;
	},
): Promise<DomainRow> => {
	const tx = options?.tx || db;

	const domainRows = await tx
		.select()
		.from(domains)
		.where(eq(domains.domainId, domainId))
		.limit(1);

	const domain = domainRows[0];
	if (!domain) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Domain not found",
		});
	}

	// If domain has no Cloudflare hostname ID, attempt initial provisioning
	if (!domain.cfHostnameId) {
		const saasActive = await isCloudflareSaasActive();
		if (saasActive && !(await isPlatformOrTestDomain(domain.host))) {
			return await provisionCustomHostname(domainId, options);
		}
		return domain;
	}

	const settings = await getCloudflareSaasSettings();
	const zoneId = settings.zoneId;
	if (!zoneId) {
		return domain;
	}

	const client = await getCloudflareClient(undefined, options?.fetchImpl);
	if (!client) {
		return domain;
	}

	try {
		const cfHostname = await client.getCustomHostname(
			zoneId,
			domain.cfHostnameId,
		);

		const isHostnameActive = cfHostname.status === "active";
		const isSslActive = cfHostname.ssl?.status === "active";
		const isFullyActive = isHostnameActive && isSslActive;

		const updatePayload: Partial<DomainRow> = {
			cfStatus: cfHostname.status,
			cfSslStatus: cfHostname.ssl?.status || null,
			cfVerificationErrors: cfHostname.verification_errors || [],
			cfOwnershipVerification: cfHostname.ownership_verification || null,
			cfSslValidationRecords: cfHostname.ssl?.validation_records || null,
			cfSslCertificates: cfHostname.ssl?.certificates || null,
			cfLastSyncAt: new Date(),
			cfLastError: null,
		};

		// If Cloudflare hostname and SSL are active, activate HTTPS on the domain!
		if (isFullyActive && !domain.https) {
			updatePayload.https = true;
		}

		const updated = await tx
			.update(domains)
			.set(updatePayload)
			.where(eq(domains.domainId, domainId))
			.returning();

		const resultDomain = updated[0];

		// If HTTPS was just activated, ensure Traefik router is reconfigured
		if (isFullyActive && !domain.https && resultDomain?.applicationId) {
			try {
				const app = await findApplicationById(resultDomain.applicationId);
				if (app) {
					await manageDomain(app, resultDomain as any);
				}
			} catch (traefikErr) {
				console.error(
					`[Cloudflare SaaS] Traefik router sync error for ${domain.host}:`,
					traefikErr,
				);
			}
		}

		return resultDomain;
	} catch (err: any) {
		// If 404: Hostname was deleted directly on Cloudflare
		if (err instanceof CloudflareClientError && err.isNotFound) {
			const updated = await tx
				.update(domains)
				.set({
					cfHostnameId: null,
					cfStatus: null,
					cfSslStatus: null,
					cfLastError: "Custom hostname not found on Cloudflare (deleted externally).",
					cfLastSyncAt: new Date(),
				})
				.where(eq(domains.domainId, domainId))
				.returning();
			return updated[0];
		}

		const errorMessage =
			err instanceof CloudflareClientError
				? err.message
				: err instanceof Error
				? err.message
				: "Status sync failed";

		const updated = await tx
			.update(domains)
			.set({
				cfLastError: errorMessage,
				cfLastSyncAt: new Date(),
			})
			.where(eq(domains.domainId, domainId))
			.returning();

		return updated[0] || domain;
	}
};

// ---------------------------------------------------------------------------
// Removal Operation
// ---------------------------------------------------------------------------

export const deleteCustomHostname = async (
	domainId: string,
	options?: {
		tx?: any;
		fetchImpl?: typeof fetch;
	},
): Promise<void> => {
	const tx = options?.tx || db;

	const domainRows = await tx
		.select()
		.from(domains)
		.where(eq(domains.domainId, domainId))
		.limit(1);

	const domain = domainRows[0];
	if (!domain || !domain.cfHostnameId) {
		return;
	}

	const settings = await getCloudflareSaasSettings();
	const zoneId = settings.zoneId;
	if (!zoneId) {
		return;
	}

	const client = await getCloudflareClient(undefined, options?.fetchImpl);
	if (!client) {
		return;
	}

	try {
		await client.deleteCustomHostname(zoneId, domain.cfHostnameId);
	} catch (err: any) {
		// If 404, it was already deleted on Cloudflare
		if (err instanceof CloudflareClientError && err.isNotFound) {
			return;
		}
		console.error(
			`[Cloudflare SaaS] Failed to delete custom hostname ${domain.cfHostnameId} for ${domain.host}:`,
			err,
		);
		// Do not throw: allow database deletion to proceed safely
	}
};

// ---------------------------------------------------------------------------
// Status Mapping & DNS Instructions Builder
// ---------------------------------------------------------------------------

export const mapDomainCloudflareStatus = (
	domain: DomainRow,
	cnameTarget: string,
): CloudflareDomainLifecycleStatus => {
	const isCloudflareSaas = Boolean(domain.cfHostnameId || domain.cfStatus);

	if (!isCloudflareSaas) {
		return {
			isCloudflareSaas: false,
			hostnameId: null,
			status: domain.https ? "active" : "pending",
			stageName: domain.https ? "Active — HTTPS ready" : "Awaiting DNS configuration",
			stageStep: domain.https ? 4 : 1,
			hostnameStatus: null,
			sslStatus: null,
			lastSyncAt: domain.cfLastSyncAt ? new Date(domain.cfLastSyncAt) : null,
			lastError: null,
			isHttpsReady: domain.https,
			records: [],
			customerActionRequired: "Configure standard DNS records.",
		};
	}

	const hostnameStatus = domain.cfStatus || "pending";
	const sslStatus = domain.cfSslStatus || "initializing";
	const lastError = domain.cfLastError || null;

	const isHostnameActive = hostnameStatus === "active";
	const isSslActive = sslStatus === "active";
	const hasErrors =
		hostnameStatus === "error" ||
		hostnameStatus === "blocked" ||
		sslStatus === "error" ||
		sslStatus === "timed_out" ||
		sslStatus === "failed" ||
		(Array.isArray(domain.cfVerificationErrors) && domain.cfVerificationErrors.length > 0);

	let status: "pending" | "pending_verification" | "pending_certificate" | "active" | "error" =
		"pending";
	let stageName: CloudflareDomainLifecycleStatus["stageName"] =
		"Awaiting DNS configuration";
	let stageStep: 1 | 2 | 3 | 4 = 1;
	let customerActionRequired =
		`Add a CNAME record pointing to ${cnameTarget}.`;

	if (hasErrors) {
		status = "error";
		stageName = "Configuration Error";
		stageStep = 1;
		customerActionRequired =
			lastError ||
			(Array.isArray(domain.cfVerificationErrors) && domain.cfVerificationErrors.length > 0
				? domain.cfVerificationErrors.join("; ")
				: "Please verify domain DNS records and click Re-check.");
	} else if (isHostnameActive && isSslActive) {
		status = "active";
		stageName = "Active — HTTPS ready";
		stageStep = 4;
		customerActionRequired = "No action required. Your domain is active and serving traffic securely.";
	} else if (isHostnameActive && !isSslActive) {
		status = "pending_certificate";
		stageName = "Issuing SSL certificate";
		stageStep = 3;
		customerActionRequired =
			"Domain ownership verified. SSL certificate issuance is in progress with the Certificate Authority.";
	} else if (!isHostnameActive) {
		const ownership = domain.cfOwnershipVerification as
			| { type?: string; name?: string; value?: string }
			| null
			| undefined;

		if (ownership?.name && ownership?.value) {
			status = "pending_verification";
			stageName = "Verifying domain ownership";
			stageStep = 2;
			customerActionRequired =
				`Add the TXT verification record "${ownership.name}" at your DNS provider.`;
		} else {
			status = "pending";
			stageName = "Awaiting DNS configuration";
			stageStep = 1;
			customerActionRequired =
				`Add a CNAME record with Name "${domain.host}" pointing to Target "${cnameTarget}".`;
		}
	}

	// Build structured DNS instructions
	const records: CloudflareDnsRecordInstruction[] = [];

	// 1. Primary CNAME routing record
	const cleanHost = domain.host.trim().toLowerCase();
	const parts = cleanHost.split(".");
	const recordName = parts.length > 2 ? parts.slice(0, parts.length - 2).join(".") : "@";

	records.push({
		type: "CNAME",
		name: recordName,
		value: cnameTarget,
		purpose: "Traffic Routing",
		status: isHostnameActive ? "active" : "required",
		description: `Directs customer traffic for ${cleanHost} to the HatDot edge ingress.`,
	});

	// 2. Ownership verification TXT record (if required by Cloudflare)
	const ownership = domain.cfOwnershipVerification as
		| { type?: string; name?: string; value?: string }
		| null
		| undefined;

	if (ownership?.name && ownership?.value) {
		records.push({
			type: "TXT",
			name: ownership.name,
			value: ownership.value,
			purpose: "Domain Ownership Verification",
			status: isHostnameActive ? "verified" : "required",
			description:
				"Cloudflare security check confirming authorization to route this domain.",
		});
	}

	// 3. SSL validation records (if DCV records are issued by Cloudflare)
	const sslRecords = domain.cfSslValidationRecords as
		| CloudflareSslValidationRecord[]
		| null
		| undefined;

	if (Array.isArray(sslRecords)) {
		for (const rec of sslRecords) {
			if (rec.txt_name && rec.txt_value) {
				records.push({
					type: "TXT",
					name: rec.txt_name,
					value: rec.txt_value,
					purpose: "SSL Certificate Validation (DCV)",
					status: isSslActive ? "verified" : "required",
					description:
						"Certificate Authority validation token for automatic TLS certificate issuance.",
				});
			} else if (rec.cname && rec.cname_target) {
				records.push({
					type: "CNAME",
					name: rec.cname,
					value: rec.cname_target,
					purpose: "SSL Certificate Validation (DCV)",
					status: isSslActive ? "verified" : "required",
					description:
						"Certificate Authority validation CNAME for automatic TLS certificate issuance.",
				});
			}
		}
	}

	return {
		isCloudflareSaas,
		hostnameId: domain.cfHostnameId,
		status,
		stageName,
		stageStep,
		hostnameStatus,
		sslStatus,
		lastSyncAt: domain.cfLastSyncAt ? new Date(domain.cfLastSyncAt) : null,
		lastError,
		isHttpsReady: domain.https,
		records,
		customerActionRequired,
	};
};

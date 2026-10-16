import dns from "node:dns";
import { isIP } from "node:net";
import os from "node:os";
import { promisify } from "node:util";
import { BRAND } from "@paas/branding";
import { db } from "@dokploy/server/db";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { generateRandomDomain } from "@dokploy/server/templates";
import { execAsyncRemote } from "@dokploy/server/utils/process/execAsync";
import { manageDomain } from "@dokploy/server/utils/traefik/domain";
import { getPublicIpWithFallback } from "@dokploy/server/wss/utils";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
	type apiCreateDomain,
	domains,
	applications,
	compose,
	environments,
	projects,
	previewDeployments,
} from "../db/schema";
import { findApplicationById } from "./application";
import { detectCDNProvider } from "./cdn";
import { findComposeById } from "./compose";
import { findServerById } from "./server";

export type Domain = typeof domains.$inferSelect;

export const getServiceOrganizationId = async (
	options: {
		applicationId?: string | null;
		composeId?: string | null;
		previewDeploymentId?: string | null;
	},
	tx: any = db,
): Promise<string | null> => {
	if (options.applicationId) {
		const app = await tx
			.select({ organizationId: projects.organizationId })
			.from(applications)
			.innerJoin(
				environments,
				eq(applications.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(applications.applicationId, options.applicationId))
			.limit(1);
		return app[0]?.organizationId || null;
	}

	if (options.composeId) {
		const comp = await tx
			.select({ organizationId: projects.organizationId })
			.from(compose)
			.innerJoin(
				environments,
				eq(compose.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(compose.composeId, options.composeId))
			.limit(1);
		return comp[0]?.organizationId || null;
	}

	if (options.previewDeploymentId) {
		const prev = await tx
			.select({ organizationId: projects.organizationId })
			.from(previewDeployments)
			.innerJoin(
				applications,
				eq(previewDeployments.applicationId, applications.applicationId),
			)
			.innerJoin(
				environments,
				eq(applications.environmentId, environments.environmentId),
			)
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(
				eq(
					previewDeployments.previewDeploymentId,
					options.previewDeploymentId,
				),
			)
			.limit(1);
		return prev[0]?.organizationId || null;
	}

	return null;
};

export const checkDomainTenantConflict = async (
	host: string,
	targetOrgId: string | null,
	currentDomainId?: string,
	tx: any = db,
) => {
	if (!host || !targetOrgId) return;
	const cleanHost = host.trim().toLowerCase();

	// Check application domains
	const appConflicts = await tx
		.select({
			domainId: domains.domainId,
			host: domains.host,
			organizationId: projects.organizationId,
		})
		.from(domains)
		.innerJoin(
			applications,
			eq(domains.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				sql`lower(trim(${domains.host})) = ${cleanHost}`,
				currentDomainId ? ne(domains.domainId, currentDomainId) : undefined,
			),
		)
		.limit(1);

	if (
		appConflicts.length > 0 &&
		appConflicts[0].organizationId &&
		appConflicts[0].organizationId !== targetOrgId
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `The domain "${host}" is already registered to another organization. To use it here, remove it from the other organization first or verify DNS ownership.`,
		});
	}

	// Check compose domains
	const composeConflicts = await tx
		.select({
			domainId: domains.domainId,
			host: domains.host,
			organizationId: projects.organizationId,
		})
		.from(domains)
		.innerJoin(compose, eq(domains.composeId, compose.composeId))
		.innerJoin(
			environments,
			eq(compose.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				sql`lower(trim(${domains.host})) = ${cleanHost}`,
				currentDomainId ? ne(domains.domainId, currentDomainId) : undefined,
			),
		)
		.limit(1);

	if (
		composeConflicts.length > 0 &&
		composeConflicts[0].organizationId &&
		composeConflicts[0].organizationId !== targetOrgId
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `The domain "${host}" is already registered to another organization. To use it here, remove it from the other organization first or verify DNS ownership.`,
		});
	}

	// Check preview deployment domains
	const previewConflicts = await tx
		.select({
			domainId: domains.domainId,
			host: domains.host,
			organizationId: projects.organizationId,
		})
		.from(domains)
		.innerJoin(
			previewDeployments,
			eq(domains.previewDeploymentId, previewDeployments.previewDeploymentId),
		)
		.innerJoin(
			applications,
			eq(previewDeployments.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(
			and(
				sql`lower(trim(${domains.host})) = ${cleanHost}`,
				currentDomainId ? ne(domains.domainId, currentDomainId) : undefined,
			),
		)
		.limit(1);

	if (
		previewConflicts.length > 0 &&
		previewConflicts[0].organizationId &&
		previewConflicts[0].organizationId !== targetOrgId
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `The domain "${host}" is already registered to another organization. To use it here, remove it from the other organization first or verify DNS ownership.`,
		});
	}
};

export const isPrivateOrLocalAddress = (ipOrHost: string): boolean => {
	const cleaned = ipOrHost
		.replace(/^https?:\/\//, "")
		.split(/[/:]/)[0]
		?.trim()
		.toLowerCase() || "";
	if (!cleaned) return true;

	if (
		cleaned === "localhost" ||
		cleaned === "0.0.0.0" ||
		cleaned === "::1" ||
		cleaned === "host.docker.internal" ||
		cleaned.endsWith(".localhost") ||
		cleaned.endsWith(".local") ||
		cleaned.endsWith(".internal")
	) {
		return true;
	}

	const ipType = isIP(cleaned);
	if (ipType === 4) {
		const rawParts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
		if (rawParts.length !== 4 || rawParts.some(Number.isNaN)) return true;
		const p0 = rawParts[0] ?? -1;
		const p1 = rawParts[1] ?? -1;

		// 127.0.0.0/8 (Loopback)
		if (p0 === 127) return true;
		// 0.0.0.0/8
		if (p0 === 0) return true;
		// 10.0.0.0/8 (Private RFC1918)
		if (p0 === 10) return true;
		// 172.16.0.0/12 (Private RFC1918: 172.16.0.0 - 172.31.255.255)
		if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
		// 192.168.0.0/16 (Private RFC1918)
		if (p0 === 192 && p1 === 168) return true;
		// 169.254.0.0/16 (Link-local)
		if (p0 === 169 && p1 === 254) return true;
	} else if (ipType === 6) {
		if (cleaned === "::1" || cleaned === "::") return true;
		if (
			cleaned.startsWith("fe80:") ||
			cleaned.startsWith("fc") ||
			cleaned.startsWith("fd")
		) {
			return true;
		}
	}

	// Sslip / nip pattern matching private IP
	const sslipMatch = cleaned.match(
		/(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})\.(?:sslip|nip)\.io$/i,
	);
	if (sslipMatch && sslipMatch[1] && sslipMatch[2]) {
		const p1 = Number.parseInt(sslipMatch[1], 10);
		const p2 = Number.parseInt(sslipMatch[2], 10);
		if (
			p1 === 127 ||
			p1 === 0 ||
			p1 === 10 ||
			(p1 === 172 && p2 >= 16 && p2 <= 31) ||
			(p1 === 192 && p2 === 168) ||
			(p1 === 169 && p2 === 254)
		) {
			return true;
		}
	}

	return false;
};

export const validatePlatformSubdomainDepth = (
	host: string,
	platformDomain?: string | null,
): {
	isValid: boolean;
	isMultiLevelSubdomain: boolean;
	error?: string;
	canonicalHost?: string;
} => {
	if (!host || !platformDomain) {
		return { isValid: true, isMultiLevelSubdomain: false };
	}

	const cleanHost = host
		.replace(/^https?:\/\//, "")
		.split(/[/:]/)[0]!
		.trim()
		.toLowerCase();

	const cleanPlatform = platformDomain
		.replace(/^https?:\/\//, "")
		.split(/[/:]/)[0]!
		.trim()
		.toLowerCase();

	if (cleanHost === cleanPlatform) {
		return {
			isValid: true,
			isMultiLevelSubdomain: false,
			canonicalHost: cleanHost,
		};
	}

	if (cleanHost.endsWith(`.${cleanPlatform}`)) {
		const prefix = cleanHost.slice(0, -(cleanPlatform.length + 1));
		const labels = prefix.split(".").filter(Boolean);
		if (labels.length > 1) {
			const singleLabel = labels[labels.length - 1];
			const canonicalHost = `${singleLabel}.${cleanPlatform}`;
			return {
				isValid: false,
				isMultiLevelSubdomain: true,
				canonicalHost,
				error: `Multi-level platform subdomain '${cleanHost}' is not covered by the wildcard certificate (*.${cleanPlatform}). Wildcard certificates cover single-level subdomains only. Browsers will report NET::ERR_CERT_AUTHORITY_INVALID. Use the canonical URL 'https://${canonicalHost}' instead.`,
			};
		}
		return {
			isValid: true,
			isMultiLevelSubdomain: false,
			canonicalHost: cleanHost,
		};
	}

	return {
		isValid: true,
		isMultiLevelSubdomain: false,
		canonicalHost: cleanHost,
	};
};

export const createDomain = async (
	input: z.infer<typeof apiCreateDomain>,
	tx: any = db,
) => {
	const host = input.host?.trim();
	if (host) {
		const targetOrgId = await getServiceOrganizationId(
			{
				applicationId: input.applicationId,
				composeId: input.composeId,
				previewDeploymentId: input.previewDeploymentId,
			},
			tx,
		);
		await checkDomainTenantConflict(host, targetOrgId, undefined, tx);

		const platformDomain = await getConfiguredPlatformDomain();
		if (platformDomain) {
			const depthCheck = validatePlatformSubdomainDepth(host, platformDomain);
			if (!depthCheck.isValid) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: depthCheck.error,
				});
			}
		}
	}

	let portToUse = input.port;
	if (input.applicationId) {
		try {
			const app = await findApplicationById(input.applicationId);
			if (app) {
				if (!portToUse || portToUse === 3000) {
					if (app.buildType === "static") {
						portToUse = 80;
					} else if (
						app.ports &&
						app.ports.length > 0 &&
						app.ports[0]?.targetPort
					) {
						portToUse = app.ports[0].targetPort;
					}
				}
			}
		} catch {}
	}

	const certTypeToUse =
		input.certificateType && input.certificateType !== "none"
			? input.certificateType
			: input.https
				? "letsencrypt"
				: (input.certificateType ?? "none");

	const domain = await tx
		.insert(domains)
		.values({
			...input,
			certificateType: certTypeToUse,
			port: portToUse !== undefined ? portToUse : (input.port ?? null),
			host: host,
		} as typeof domains.$inferInsert)
		.returning()
		.then((response: any) => response[0]);

	if (!domain) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error creating domain",
		});
	}

	if (domain.applicationId) {
		const application = await findApplicationById(domain.applicationId);
		await manageDomain(application, domain);
	}

	return domain;
};

export const getPublicServerIp = async (serverId?: string): Promise<string> => {
	if (serverId) {
		try {
			const server = await findServerById(serverId);
			if (
				server.ipAddress &&
				isIP(server.ipAddress) &&
				!isPrivateOrLocalAddress(server.ipAddress)
			) {
				return server.ipAddress;
			}
		} catch {}
	}

	const settings = await getWebServerSettings();
	if (
		settings?.serverIp &&
		isIP(settings.serverIp) &&
		!isPrivateOrLocalAddress(settings.serverIp)
	) {
		return settings.serverIp;
	}

	try {
		const publicIp = await getPublicIpWithFallback();
		if (publicIp && isIP(publicIp) && !isPrivateOrLocalAddress(publicIp)) {
			return publicIp;
		}
	} catch {}

	const candidates = await getServerIpCandidates(serverId);
	const publicCandidate = candidates.find(
		(ip) => isIP(ip) && !isPrivateOrLocalAddress(ip),
	);
	if (publicCandidate) {
		return publicCandidate;
	}

	return settings?.serverIp || "127.0.0.1";
};

export const getConfiguredPlatformDomain = async (): Promise<string | null> => {
	// 1. Explicit environment variable overrides
	const envDomain =
		process.env.PLATFORM_DOMAIN || process.env.BRAND_PLATFORM_SUBDOMAIN_BASE;
	if (envDomain && !isPrivateOrLocalAddress(envDomain) && !isIP(envDomain)) {
		const clean = envDomain
			.replace(/^https?:\/\//, "")
			.split(/[/:]/)[0]!
			.trim()
			.toLowerCase();
		if (clean && clean !== "localhost") return clean;
	}

	// 2. Web server settings host domain (e.g. panel2021.hatdot.cloud -> hatdot.cloud)
	const settings = await getWebServerSettings();
	if (
		settings?.host &&
		!isIP(settings.host) &&
		!isPrivateOrLocalAddress(settings.host)
	) {
		const cleanHost = settings.host
			.replace(/^https?:\/\//, "")
			.split(/[/:]/)[0]!
			.trim()
			.toLowerCase();
		if (cleanHost && cleanHost !== "localhost") {
			const baseDomain = cleanHost.replace(
				/^(panel2021|app|panel|admin|dashboard)\./,
				"",
			);
			if (baseDomain.includes(".")) {
				return baseDomain;
			}
		}
	}

	// 3. BRAND_DOMAIN from env
	if (
		process.env.BRAND_DOMAIN &&
		!isPrivateOrLocalAddress(process.env.BRAND_DOMAIN) &&
		!isIP(process.env.BRAND_DOMAIN)
	) {
		const clean = process.env.BRAND_DOMAIN
			.replace(/^https?:\/\//, "")
			.split(/[/:]/)[0]!
			.trim()
			.toLowerCase();
		if (clean && clean !== "localhost") return clean;
	}

	// 4. Platform branding config (defaults to hatdot.cloud in production branding)
	if (
		BRAND.PLATFORM_SUBDOMAIN_BASE &&
		BRAND.PLATFORM_SUBDOMAIN_BASE !== "localhost" &&
		!isIP(BRAND.PLATFORM_SUBDOMAIN_BASE) &&
		!isPrivateOrLocalAddress(BRAND.PLATFORM_SUBDOMAIN_BASE)
	) {
		const clean = BRAND.PLATFORM_SUBDOMAIN_BASE
			.replace(/^https?:\/\//, "")
			.split(/[/:]/)[0]!
			.trim()
			.toLowerCase();
		if (clean && clean !== "localhost") return clean;
	}

	return null;
};

export const checkWildcardDnsSupport = async (
	platformDomain: string,
): Promise<boolean> => {
	try {
		const testHost = `test-wildcard-${Math.random().toString(36).substring(2, 8)}.${platformDomain}`;
		const ips = await withTimeout(dns.promises.resolve4(testHost), 2500);
		if (ips && Array.isArray(ips) && ips.length > 0) {
			const hasPublic = ips.some(
				(ip) => isIP(ip) === 4 && !isPrivateOrLocalAddress(ip),
			);
			return hasPublic;
		}
		return false;
	} catch {
		return false;
	}
};

export const isPlatformOrTestDomain = async (
	host: string,
): Promise<boolean> => {
	const clean = host
		.replace(/^https?:\/\//, "")
		.split(/[/:]/)[0]!
		.trim()
		.toLowerCase();
	if (
		clean.includes(".sslip.io") ||
		clean.includes(".traefik.me") ||
		clean.includes(".nip.io") ||
		clean === "localhost" ||
		clean.endsWith(".localhost") ||
		isPrivateOrLocalAddress(clean)
	) {
		return true;
	}

	const platformDomain = await getConfiguredPlatformDomain();
	if (
		platformDomain &&
		(clean === platformDomain || clean.endsWith(`.${platformDomain}`))
	) {
		return true;
	}

	return false;
};

export const resolveGeneratedApplicationDomain = async (
	appName: string,
	serverId?: string,
): Promise<{
	host: string;
	isPlatformDomain: boolean;
	supportsHttps: boolean;
	platformDomain: string | null;
}> => {
	const platformDomain = await getConfiguredPlatformDomain();
	const serverIp = await getPublicServerIp(serverId);
	const settings = await getWebServerSettings();

	if (platformDomain) {
		const wildcardSupported = await checkWildcardDnsSupport(platformDomain);
		if (wildcardSupported || process.env.ENABLE_PLATFORM_WILDCARD === "true") {
			const supportsHttps =
				settings?.certificateType === "letsencrypt" ||
				Boolean(settings?.https);
			return {
				host: `${appName}.${platformDomain}`,
				isPlatformDomain: true,
				supportsHttps,
				platformDomain,
			};
		}
	}

	const sslipHost = generateRandomDomain({
		serverIp,
		projectName: appName,
	});

	return {
		host: sslipHost,
		isPlatformDomain: false,
		supportsHttps: false,
		platformDomain: null,
	};
};

export const generateTraefikMeDomain = async (
	appName: string,
	_userId?: string,
	serverId?: string,
) => {
	const { host } = await resolveGeneratedApplicationDomain(appName, serverId);
	return host;
};

export const generateWildcardDomain = (
	appName: string,
	serverDomain: string,
) => {
	return `${appName}-${serverDomain}`;
};

export const findDomainById = async (domainId: string) => {
	const domainRows = await db
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

	let app: { applicationId: string; appName: string; name: string } | null = null;
	if (domain.applicationId) {
		try {
			const fullApp = await findApplicationById(domain.applicationId);
			app = {
				applicationId: fullApp.applicationId,
				appName: fullApp.appName,
				name: fullApp.name,
			};
		} catch {}
	}

	let comp: { composeId: string; appName: string; name: string } | null = null;
	if (domain.composeId) {
		try {
			const fullComp = await findComposeById(domain.composeId);
			comp = {
				composeId: fullComp.composeId,
				appName: fullComp.appName,
				name: fullComp.name,
			};
		} catch {}
	}

	return {
		...domain,
		application: app,
		compose: comp,
	};
};

export const findDomainsByApplicationId = async (applicationId: string) => {
	const rows = await db
		.select()
		.from(domains)
		.where(eq(domains.applicationId, applicationId));

	let app: { applicationId: string; appName: string; name: string } | null = null;
	try {
		const fullApp = await findApplicationById(applicationId);
		app = {
			applicationId: fullApp.applicationId,
			appName: fullApp.appName,
			name: fullApp.name,
		};
	} catch {}

	return rows.map((domain) => ({
		...domain,
		application: app,
	}));
};

export const findDomainsByComposeId = async (composeId: string) => {
	const rows = await db
		.select()
		.from(domains)
		.where(eq(domains.composeId, composeId));

	let comp: { composeId: string; appName: string; name: string } | null = null;
	try {
		const fullComp = await findComposeById(composeId);
		comp = {
			composeId: fullComp.composeId,
			appName: fullComp.appName,
			name: fullComp.name,
		};
	} catch {}

	return rows.map((domain) => ({
		...domain,
		compose: comp,
	}));
};

export const findDomainsByOrganizationId = async (organizationId: string) => {
	const appDomains = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			https: domains.https,
			port: domains.port,
			path: domains.path,
			enabled: domains.enabled,
			certificateType: domains.certificateType,
			createdAt: domains.createdAt,
			applicationId: domains.applicationId,
			composeId: domains.composeId,
			serviceName: applications.name,
			appName: applications.appName,
			projectId: projects.projectId,
			environmentId: environments.environmentId,
			domainType: domains.domainType,
		})
		.from(domains)
		.innerJoin(
			applications,
			eq(domains.applicationId, applications.applicationId),
		)
		.innerJoin(
			environments,
			eq(applications.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(eq(projects.organizationId, organizationId));

	const composeDomains = await db
		.select({
			domainId: domains.domainId,
			host: domains.host,
			https: domains.https,
			port: domains.port,
			path: domains.path,
			enabled: domains.enabled,
			certificateType: domains.certificateType,
			createdAt: domains.createdAt,
			applicationId: domains.applicationId,
			composeId: domains.composeId,
			serviceName: compose.name,
			appName: compose.appName,
			projectId: projects.projectId,
			environmentId: environments.environmentId,
			domainType: domains.domainType,
		})
		.from(domains)
		.innerJoin(compose, eq(domains.composeId, compose.composeId))
		.innerJoin(
			environments,
			eq(compose.environmentId, environments.environmentId),
		)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(eq(projects.organizationId, organizationId));

	const all = [...appDomains, ...composeDomains];
	all.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
	return all;
};

export const updateDomainById = async (
	domainId: string,
	domainData: Partial<Domain>,
) => {
	if (domainData.host) {
		const current = await findDomainById(domainId);
		if (
			current &&
			domainData.host.trim().toLowerCase() !== current.host.toLowerCase()
		) {
			const targetOrgId = await getServiceOrganizationId({
				applicationId: current.applicationId,
				composeId: current.composeId,
				previewDeploymentId: current.previewDeploymentId,
			});
			await checkDomainTenantConflict(
				domainData.host.trim(),
				targetOrgId,
				domainId,
			);
			const platformDomain = await getConfiguredPlatformDomain();
			if (platformDomain) {
				const depthCheck = validatePlatformSubdomainDepth(
					domainData.host.trim(),
					platformDomain,
				);
				if (!depthCheck.isValid) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: depthCheck.error,
					});
				}
			}
		}
	}

	const domain = await db
		.update(domains)
		.set({
			...domainData,
			...(domainData.host && { host: domainData.host.trim() }),
		})
		.where(eq(domains.domainId, domainId))
		.returning();

	return domain[0];
};

export const removeDomainById = async (domainId: string) => {
	await findDomainById(domainId);
	const result = await db
		.delete(domains)
		.where(eq(domains.domainId, domainId))
		.returning();

	return result[0];
};

export const getDomainHost = (domain: Domain) => {
	return `${domain.https ? "https" : "http"}://${domain.host}`;
};

const resolveDns4 = promisify(dns.resolve4);
const resolveDns6 = promisify(dns.resolve6);

const resolveDns = async (domain: string): Promise<string[]> => {
	const results = await Promise.allSettled([
		resolveDns4(domain),
		resolveDns6(domain),
	]);
	const ips = results.flatMap((result) =>
		result.status === "fulfilled" ? result.value : [],
	);

	if (ips.length > 0) {
		return ips;
	}

	const failure = results.find((result) => result.status === "rejected");
	throw failure?.reason instanceof Error
		? failure.reason
		: new Error("Failed to resolve domain");
};

export const validateDomain = async (
	domain: string,
	expectedIps?: string[],
): Promise<{
	isValid: boolean;
	resolvedIp?: string;
	error?: string;
	isCloudflare?: boolean;
	cdnProvider?: string;
}> => {
	try {
		// Remove protocol and path if present
		const cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];

		// Check platform subdomain depth
		const platformDomain = await getConfiguredPlatformDomain();
		if (platformDomain && cleanDomain) {
			const depthCheck = validatePlatformSubdomainDepth(
				cleanDomain,
				platformDomain,
			);
			if (!depthCheck.isValid) {
				return {
					isValid: false,
					error: depthCheck.error,
				};
			}
		}

		// Resolve the domain to get its IP
		const ips = await resolveDns(cleanDomain || "");

		const resolvedIps = ips.map((ip) => ip.toString());

		// Check if any IP belongs to a CDN provider
		const cdnProvider = ips
			.map((ip) => detectCDNProvider(ip))
			.find((provider) => provider !== null);

		// If behind a CDN, we consider it valid but inform the user
		if (cdnProvider) {
			return {
				isValid: true,
				resolvedIp: resolvedIps.join(", "),
				cdnProvider: cdnProvider.displayName,
				error: cdnProvider.warningMessage,
			};
		}

		if (expectedIps && expectedIps.length > 0) {
			const isValid = resolvedIps.some((ip) => expectedIps.includes(ip));
			return {
				isValid,
				resolvedIp: resolvedIps.join(", "),
				error: !isValid
					? `Domain resolves to ${resolvedIps.join(", ")} but should point to ${expectedIps.join(" or ")}`
					: undefined,
			};
		}

		// If no expected IP, just return the resolved IP
		return {
			isValid: true,
			resolvedIp: resolvedIps.join(", "),
		};
	} catch (error) {
		return {
			isValid: false,
			error:
				error instanceof Error ? error.message : "Failed to resolve domain",
		};
	}
};

export const getServerIpCandidates = async (
	serverId?: string | null,
): Promise<string[]> => {
	const candidates = new Set<string>();

	if (serverId) {
		const server = await findServerById(serverId);
		if (server.ipAddress) {
			candidates.add(server.ipAddress);
		}

		const [interfaceIps, publicIp] = await Promise.all([
			withTimeout(
				execAsyncRemote(
					serverId,
					"ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1",
				),
				7000,
			),
			withTimeout(
				execAsyncRemote(
					serverId,
					"curl -fsS -m 5 https://ifconfig.me || curl -fsS -m 5 https://icanhazip.com",
				),
				7000,
			),
		]);
		for (const output of [interfaceIps?.stdout, publicIp?.stdout]) {
			for (const detectedIp of parseIpCandidates(output)) {
				candidates.add(detectedIp);
			}
		}
	} else {
		const settings = await getWebServerSettings();
		if (settings?.serverIp) {
			candidates.add(settings.serverIp);
		}
		for (const addresses of Object.values(os.networkInterfaces())) {
			for (const address of addresses ?? []) {
				if (!address.internal && isIP(address.address)) {
					candidates.add(address.address);
				}
			}
		}

		const publicIp = await withTimeout(getPublicIpWithFallback(), 7000);
		if (publicIp && isIP(publicIp)) {
			candidates.add(publicIp);
		}
	}

	return Array.from(candidates);
};

const parseIpCandidates = (output?: string): string[] =>
	(output ?? "")
		.split(/\s+/)
		.map((candidate) => candidate.trim())
		.filter((candidate) => isIP(candidate) !== 0);

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
	return Promise.race([
		promise,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
	]).catch(() => null);
};

export interface DnsInstructions {
	host: string;
	recordType: "A" | "CNAME";
	recordName: string;
	recordValue: string;
	serverIp: string;
	isSubdomain: boolean;
	verified: boolean;
	currentIps: string[];
	message: string;
	cdnProvider?: string;
}

export const getDnsInstructionsForDomain = async (
	host: string,
	serverId?: string | null,
): Promise<DnsInstructions> => {
	const cleanHost = host.replace(/^https?:\/\//, "").split("/")[0]?.trim().toLowerCase() || "";
	const serverCandidates = await getServerIpCandidates(serverId);
	const settings = await getWebServerSettings();
	const expectedIp = serverCandidates?.[0] || settings?.serverIp || "127.0.0.1";

	const parts = cleanHost.split(".");
	const isSubdomain = parts.length > 2;
	const recordName = isSubdomain ? parts.slice(0, parts.length - 2).join(".") : "@";

	const validation = await validateDomain(cleanHost, [expectedIp]);

	let message = "Domain is verified and pointing to this server.";
	if (!validation.isValid) {
		if (validation.resolvedIp) {
			message = `Domain currently resolves to ${validation.resolvedIp}, but expected ${expectedIp}. Update your DNS A record.`;
		} else {
			message = `DNS record not found yet. Add an A record with Name "${recordName}" and Value "${expectedIp}" at your DNS provider.`;
		}
	} else if (validation.cdnProvider) {
		message = `Domain is routed through ${validation.cdnProvider}. SSL and traffic will proxy through the CDN.`;
	}

	return {
		host: cleanHost,
		recordType: "A",
		recordName,
		recordValue: expectedIp,
		serverIp: expectedIp,
		isSubdomain,
		verified: validation.isValid,
		currentIps: validation.resolvedIp ? validation.resolvedIp.split(", ") : [],
		message,
		cdnProvider: validation.cdnProvider,
	};
};

export interface LiveReachabilityResult {
	isLive: boolean;
	testUrl: string;
	checks: {
		deploymentHealthy: boolean;
		dnsResolves: boolean;
		httpsActive: boolean;
		appResponding: boolean;
	};
	statusCode?: number;
	responseTimeMs?: number;
	message: string;
	details?: string;
}

export const verifyApplicationLiveUrl = async (
	applicationId: string,
	options: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<LiveReachabilityResult> => {
	const maxRetries = options.maxRetries ?? 3;
	const retryDelayMs = options.retryDelayMs ?? 1500;

	const application = await findApplicationById(applicationId);
	const appDomains = await findDomainsByApplicationId(applicationId);

	const activeDomain = appDomains.find((d) => d.enabled) || appDomains[0];
	let testUrl = "";
	let host = "";
	let isHttps = true;

	if (activeDomain?.host) {
		host = activeDomain.host.trim();
		isHttps = activeDomain.https;
		testUrl = `${isHttps ? "https" : "http"}://${host}${activeDomain.path || "/"}`;
	} else {
		const randomTraefikMe = await generateTraefikMeDomain(
			application.appName,
			application.environment.project.organizationId,
			application.serverId || undefined,
		);
		host = randomTraefikMe;
		isHttps = false;
		testUrl = `http://${host}/`;
	}

	const isHealthyDeployment =
		application.applicationStatus === "done" ||
		application.applicationStatus === "running";

	const isPrivateHost = isPrivateOrLocalAddress(host);
	if (isPrivateHost) {
		return {
			isLive: false,
			testUrl,
			checks: {
				deploymentHealthy: isHealthyDeployment,
				dnsResolves: false,
				httpsActive: false,
				appResponding: false,
			},
			message: "Live URL cannot be a private, local, or loopback address.",
			details: `The host "${host}" resolves to a local or private network address which is not externally routable in production.`,
		};
	}

	// Check DNS resolution
	let resolvedIps: string[] = [];
	let dnsResolves = false;
	try {
		const cleanDnsHost = (host.split("/")[0] || host).trim();
		resolvedIps = await resolveDns(cleanDnsHost);
		const hasPublicIp = resolvedIps.some(
			(ip) => !isPrivateOrLocalAddress(ip),
		);
		dnsResolves = resolvedIps.length > 0 && hasPublicIp;
		if (resolvedIps.length > 0 && !hasPublicIp) {
			return {
				isLive: false,
				testUrl,
				checks: {
					deploymentHealthy: isHealthyDeployment,
					dnsResolves: false,
					httpsActive: false,
					appResponding: false,
				},
				message: "Domain resolves to private IP addresses.",
				details: `DNS lookup for "${host}" returned private/local IP (${resolvedIps.join(", ")}). Production live URLs must point to a public server IP.`,
			};
		}
	} catch {
		dnsResolves = false;
	}

	// Attempt HTTP(s) reachability with bounded retry
	let lastStatusCode: number | undefined;
	let lastError: string | undefined;
	let responseTimeMs = 0;
	let appResponding = false;
	let httpsActive = false;
	let sslError: string | undefined;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const startTime = Date.now();
		let timeoutId: NodeJS.Timeout | undefined;
		try {
			const controller = new AbortController();
			timeoutId = setTimeout(() => controller.abort(), 6000);

			const response = await fetch(testUrl, {
				method: "GET",
				signal: controller.signal,
				headers: {
					"User-Agent": "HatDot-HealthCheck/1.0",
					Accept: "*/*",
				},
				redirect: "follow",
			});

			responseTimeMs = Date.now() - startTime;
			lastStatusCode = response.status;
			if (testUrl.startsWith("https://")) {
				httpsActive = response.url.startsWith("https://");
			}

			// Check for Vite Host Rejection
			let bodyText = "";
			try {
				if (typeof (response as any).clone === "function") {
					bodyText = await (response as any).clone().text();
				} else if (typeof response.text === "function") {
					bodyText = await response.text();
				}
			} catch {}

			if (
				bodyText.includes("Blocked request. This host") ||
				(bodyText.includes("is not allowed") &&
					(bodyText.includes("allowedHosts") ||
						bodyText.includes("Host (")))
			) {
				return {
					isLive: false,
					testUrl,
					checks: {
						deploymentHealthy: isHealthyDeployment,
						dnsResolves,
						httpsActive: false,
						appResponding: false,
					},
					statusCode: 403,
					message: `Vite rejected host header: ${host} is not in preview.allowedHosts.`,
					details: `Vite host validation blocked the request for "${host}". Ensure "${host}" is configured in preview.allowedHosts or __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.`,
				};
			}

			// Accept any 2xx or 3xx redirect or 401/403 (auth protected app is live)
			if (
				(response.status >= 200 && response.status < 400) ||
				response.status === 401 ||
				response.status === 403
			) {
				appResponding = true;
				break;
			} else if (response.status >= 500 && attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			}
		} catch (err: any) {
			const cause = err?.cause;
			const causeCode = cause?.code || "";
			const causeMsg = cause?.message || "";
			const rawErr = err instanceof Error ? err.message : String(err);
			const fullErr = `${rawErr} ${causeCode} ${causeMsg}`;

			if (
				causeCode === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
				causeCode === "ERR_TLS_CERT_ALTNAME_INVALID" ||
				causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
				causeCode === "CERT_HAS_EXPIRED" ||
				fullErr.includes("DEPTH_ZERO_SELF_SIGNED_CERT") ||
				fullErr.includes("SELF_SIGNED") ||
				fullErr.includes("certificate") ||
				fullErr.includes("SSL") ||
				fullErr.includes("TLS")
			) {
				sslError = causeMsg || causeCode || "TLS certificate validation pending";
			}

			if (causeCode === "ECONNREFUSED" || fullErr.includes("ECONNREFUSED")) {
				lastError = `Connection refused (ECONNREFUSED) on ${testUrl}. Routing layer or host port is not accepting connections.`;
			} else if (causeCode === "ENOTFOUND" || fullErr.includes("ENOTFOUND")) {
				lastError = `DNS lookup failed (ENOTFOUND) for ${host}. Ensure domain DNS records point to this server.`;
			} else if (
				causeCode === "ETIMEDOUT" ||
				err?.name === "AbortError" ||
				causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
				fullErr.includes("timeout") ||
				fullErr.includes("ETIMEDOUT")
			) {
				lastError = `Connection timed out connecting to ${testUrl}. Network or firewall may be dropping traffic or DNS is slow to propagate.`;
			} else if (sslError) {
				lastError = `SSL/TLS handshake failed: ${sslError}. HTTPS certificate provisioning may still be in progress.`;
			} else {
				lastError = causeMsg
					? `${rawErr}: ${causeMsg} (${causeCode || "NETWORK_ERROR"})`
					: rawErr;
			}

			// If HTTPS failed due to SSL certificate error, attempt HTTP fallback check
			// to see if Traefik routing and upstream application are alive
			if (testUrl.startsWith("https://") && sslError && !appResponding) {
				try {
					const httpFallbackUrl = `http://${host}${activeDomain?.path || "/"}`;
					const httpRes = await fetch(httpFallbackUrl, {
						method: "GET",
						headers: { "User-Agent": "HatDot-HealthCheck/1.0", Accept: "*/*" },
						redirect: "follow",
						signal: AbortSignal.timeout(4000),
					});
					if (
						(httpRes.status >= 200 && httpRes.status < 400) ||
						httpRes.status === 401 ||
						httpRes.status === 403
					) {
						let httpBody = "";
						try {
							if (typeof (httpRes as any).clone === "function") {
								httpBody = await (httpRes as any).clone().text();
							} else if (typeof httpRes.text === "function") {
								httpBody = await httpRes.text();
							}
						} catch {}

						if (
							httpBody.includes("Blocked request. This host") ||
							(httpBody.includes("is not allowed") &&
								(httpBody.includes("allowedHosts") ||
									httpBody.includes("Host (")))
						) {
							return {
								isLive: false,
								testUrl,
								checks: {
									deploymentHealthy: isHealthyDeployment,
									dnsResolves,
									httpsActive: false,
									appResponding: false,
								},
								statusCode: 403,
								message: `Vite rejected host header: ${host} is not in preview.allowedHosts.`,
								details: `Vite host validation blocked the request for "${host}". Ensure "${host}" is configured in preview.allowedHosts or __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.`,
							};
						}

						appResponding = true;
						lastStatusCode = httpRes.status;
						break;
					}
				} catch {
					// Fallback check also failed
				}
			}

			if (attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			}
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	}

	const isLive =
		isHealthyDeployment &&
		dnsResolves &&
		(appResponding ||
			(lastStatusCode !== undefined &&
				lastStatusCode < 500 &&
				lastStatusCode !== 404));

	let message = "";
	if (isLive) {
		if (isHttps && !httpsActive) {
			message =
				"Application is live. HTTPS certificate provisioning is in progress.";
		} else {
			message = "Your application is live and responding.";
		}
	} else {
		message =
			"Your application was deployed, but the test URL is not responding yet.";
	}

	let details = "";
	if (!isLive) {
		if (!isHealthyDeployment) {
			details = `Application deployment status is currently ${application.applicationStatus}.`;
		} else if (!dnsResolves) {
			details = `DNS lookup for "${host}" could not be resolved or resolved to private IPs. Ensure public DNS records or sslip.io/wildcard routing is available.`;
		} else if (lastStatusCode === 502 || lastStatusCode === 504) {
			details = `Traefik returned HTTP ${lastStatusCode} (Bad Gateway / Upstream Unreachable). The container is running, but Traefik cannot reach the internal port. Verify application upstream port.`;
		} else if (sslError) {
			details = `HTTPS certificate verification pending: ${sslError}. Let's Encrypt SSL issuance is in progress.`;
		} else if (lastError) {
			details = `Connection error: ${lastError}`;
		} else if (lastStatusCode) {
			details = `Application returned HTTP status ${lastStatusCode}.`;
		}
	} else if (isHttps && !httpsActive && sslError) {
		details = `HTTPS certificate is pending: ${sslError}`;
	}

	return {
		isLive,
		testUrl,
		checks: {
			deploymentHealthy: isHealthyDeployment,
			dnsResolves,
			httpsActive,
			appResponding,
		},
		statusCode: lastStatusCode,
		responseTimeMs: responseTimeMs > 0 ? responseTimeMs : undefined,
		message,
		details: details || undefined,
	};
};


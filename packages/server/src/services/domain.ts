import dns from "node:dns";
import { isIP } from "node:net";
import os from "node:os";
import { promisify } from "node:util";
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
	}

	const domain = await tx
		.insert(domains)
		.values({
			...input,
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

export const generateTraefikMeDomain = async (
	appName: string,
	_userId: string,
	serverId?: string,
) => {
	if (serverId) {
		const server = await findServerById(serverId);
		return generateRandomDomain({
			serverIp: server.ipAddress,
			projectName: appName,
		});
	}

	if (process.env.NODE_ENV === "development") {
		return generateRandomDomain({
			serverIp: "",
			projectName: appName,
		});
	}
	const settings = await getWebServerSettings();
	return generateRandomDomain({
		serverIp: settings?.serverIp || "",
		projectName: appName,
	});
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

export const updateDomainById = async (
	domainId: string,
	domainData: Partial<Domain>,
) => {
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

	// Check DNS resolution
	let dnsResolves = false;
	try {
		const cleanDnsHost = (host.split("/")[0] || host).trim();
		const resolved = await resolveDns(cleanDnsHost);
		dnsResolves = resolved.length > 0;
	} catch {
		dnsResolves = false;
	}

	// Attempt HTTP(s) reachability with bounded retry
	let lastStatusCode: number | undefined;
	let lastError: string | undefined;
	let responseTimeMs = 0;
	let appResponding = false;
	let httpsActive = false;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const startTime = Date.now();
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 6000);

			const response = await fetch(testUrl, {
				method: "GET",
				signal: controller.signal,
				headers: {
					"User-Agent": "HatDot-HealthCheck/1.0",
					Accept: "*/*",
				},
				redirect: "follow",
			});
			clearTimeout(timeoutId);

			responseTimeMs = Date.now() - startTime;
			lastStatusCode = response.status;
			httpsActive =
				testUrl.startsWith("https://") ||
				response.url.startsWith("https://");

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
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			if (attempt < maxRetries) {
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
			}
		}
	}

	const isLive =
		isHealthyDeployment &&
		(appResponding || (dnsResolves && lastStatusCode !== undefined));

	const message = isLive
		? "Your application is live and responding."
		: "Your application was deployed, but the test URL is not responding yet.";

	let details = "";
	if (!isLive) {
		if (!isHealthyDeployment) {
			details = `Application deployment status is currently ${application.applicationStatus}`;
		} else if (!dnsResolves) {
			details = `DNS lookup for "${host}" could not be resolved. Ensure DNS records or sslip.io/wildcard routing is available.`;
		} else if (lastError) {
			details = `Connection error: ${lastError}`;
		} else if (lastStatusCode) {
			details = `Application returned HTTP status ${lastStatusCode}.`;
		}
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


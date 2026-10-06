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
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { type apiCreateDomain, domains, applications, compose } from "../db/schema";
import { findApplicationById } from "./application";
import { detectCDNProvider } from "./cdn";
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
		const app = await tx.query.applications.findFirst({
			where: eq(applications.applicationId, options.applicationId),
			with: {
				environment: {
					with: {
						project: true,
					},
				},
			},
		});
		return app?.environment?.project?.organizationId || null;
	}

	if (options.composeId) {
		const comp = await tx.query.compose.findFirst({
			where: eq(compose.composeId, options.composeId),
			with: {
				environment: {
					with: {
						project: true,
					},
				},
			},
		});
		return comp?.environment?.project?.organizationId || null;
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

	const existingDomains = await tx.query.domains.findMany({
		with: {
			application: {
				with: {
					environment: {
						with: {
							project: true,
						},
					},
				},
			},
			compose: {
				with: {
					environment: {
						with: {
							project: true,
						},
					},
				},
			},
		},
	});

	for (const d of existingDomains) {
		if (currentDomainId && d.domainId === currentDomainId) continue;
		if (d.host?.trim().toLowerCase() === cleanHost) {
			const ownerOrgId =
				d.application?.environment?.project?.organizationId ||
				d.compose?.environment?.project?.organizationId ||
				null;

			if (ownerOrgId && ownerOrgId !== targetOrgId) {
				throw new TRPCError({
					code: "CONFLICT",
					message: `The domain "${host}" is already registered to another organization. To use it here, remove it from the other organization first or verify DNS ownership.`,
				});
			}
		}
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
	const domain = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: {
				columns: { applicationId: true, appName: true, name: true },
			},
		},
	});
	if (!domain) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Domain not found",
		});
	}
	return domain;
};

export const findDomainsByApplicationId = async (applicationId: string) => {
	const domainsArray = await db.query.domains.findMany({
		where: eq(domains.applicationId, applicationId),
		with: {
			application: {
				columns: { applicationId: true, appName: true, name: true },
			},
		},
	});

	return domainsArray;
};

export const findDomainsByComposeId = async (composeId: string) => {
	const domainsArray = await db.query.domains.findMany({
		where: eq(domains.composeId, composeId),
		with: {
			compose: {
				columns: { composeId: true, appName: true, name: true },
			},
		},
	});

	return domainsArray;
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


import type { ApplicationNested } from ".";
import { getConfiguredPlatformDomain } from "../../services/domain";

/**
 * Framework-aware Host-header (trusted host) configuration.
 *
 * Design rules:
 *  - Customer source files are NEVER modified. Hosts are delivered through the
 *    framework's documented runtime mechanism (environment variables) only.
 *  - Only hosts that belong to THIS application are ever authorized
 *    (enabled domain rows whose applicationId matches, or the assigned platform host).
 *  - Wildcards, IPs, localhost and malformed values are rejected, and no
 *    "allow everything" setting (e.g. `allowedHosts: true`) is ever emitted.
 *  - The mechanism is only emitted for frameworks that actually need it.
 */

export type ApplicationWithDomains = {
	appName?: string | null;
	applicationId?: string | null;
	domains?: Array<{
		host?: string | null;
		enabled?: boolean | null;
		applicationId?: string | null;
	}> | null;
	[key: string]: any;
};

const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normalizes and validates a hostname. Returns null for anything that must
 * never be trusted (wildcards, IPs, localhost, whitespace/commas, ports, paths).
 */
export const normalizeHostname = (
	raw: string | null | undefined,
): string | null => {
	if (!raw || typeof raw !== "string") return null;
	let value = raw.trim().toLowerCase();
	value = value.replace(/^https?:\/\//, "");
	value = value.replace(/\/+$/, "");
	// Reject anything that still carries a path, query, port, userinfo or list separators.
	if (/[\s,;/?#@:*\\]/.test(value)) return null;
	if (value.endsWith(".")) value = value.slice(0, -1);
	if (!value || value.length > 253) return null;
	if (value.startsWith(".")) return null;
	if (value === "localhost" || value.endsWith(".localhost")) return null;
	if (/^\d+(\.\d+){3}$/.test(value)) return null; // IPv4
	const labels = value.split(".");
	if (labels.length < 2) return null;
	if (!labels.every((l) => HOSTNAME_LABEL.test(l))) return null;
	return value;
};

/**
 * Authoritative list of hostnames for ONE application.
 * Domain rows pointing at a different application are ignored (tenant isolation).
 */
export const getAuthorizedHostsSync = (
	application: ApplicationNested | ApplicationWithDomains,
	platformDomain?: string | null,
): string[] => {
	const app = application as ApplicationWithDomains;
	const hosts = new Set<string>();

	const rows = Array.isArray(app.domains) ? app.domains : [];
	for (const d of rows) {
		if (!d || d.enabled === false) continue;
		if (d.applicationId && app.applicationId && d.applicationId !== app.applicationId) {
			continue;
		}
		const clean = normalizeHostname(d.host);
		if (clean) hosts.add(clean);
	}

	if (app.appName) {
		const base =
			platformDomain ||
			process.env.PLATFORM_DOMAIN ||
			process.env.BRAND_PLATFORM_SUBDOMAIN_BASE ||
			"hatdot.cloud";
		const assigned = normalizeHostname(`${app.appName}.${base}`);
		if (assigned) hosts.add(assigned);
	}

	return Array.from(hosts);
};

export const getAuthorizedHostsForApplication = async (
	application: ApplicationNested | ApplicationWithDomains,
): Promise<string[]> => {
	const platformDomain = await getConfiguredPlatformDomain();
	return getAuthorizedHostsSync(application, platformDomain);
};

export type HostValidationMechanism =
	| "env"
	| "diagnostic-only"
	| "none";

export interface HostValidationPlan {
	mechanism: HostValidationMechanism;
	/** Environment entries (KEY=value) to inject into the production runtime. */
	env: string[];
	hosts: string[];
	reason: string;
	/** Concrete remediation for the customer when HatDot cannot configure it safely. */
	remediation?: string;
}

export interface HostValidationInput {
	framework?: string | null;
	language?: string | null;
	dependencies?: Record<string, string>;
	/** True when the effective production start command runs a Vite server (preview/dev). */
	runsViteServer?: boolean;
	hosts: string[];
	/** KEY=VALUE strings already provided by the customer (never overridden). */
	userEnv?: string[];
}

export const VITE_ALLOWED_HOSTS_ENV = "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS";

/**
 * Decides, per framework, how (and whether) the assigned hostnames reach the runtime.
 */
export const resolveHostValidation = (
	input: HostValidationInput,
): HostValidationPlan => {
	const hosts = Array.from(
		new Set(input.hosts.map((h) => normalizeHostname(h)).filter(Boolean)),
	) as string[];
	const userEnv = input.userEnv ?? [];
	const hasUserEnv = (key: string) => userEnv.some((e) => e.startsWith(`${key}=`));
	const deps = input.dependencies ?? {};
	const framework = (input.framework ?? "").toLowerCase();
	const language = (input.language ?? "").toLowerCase();

	if (hosts.length === 0) {
		return {
			mechanism: "none",
			env: [],
			hosts,
			reason: "No valid authorized hostnames for this application.",
		};
	}

	if (input.runsViteServer) {
		if (hasUserEnv(VITE_ALLOWED_HOSTS_ENV)) {
			return {
				mechanism: "none",
				env: [],
				hosts,
				reason: `Customer already defines ${VITE_ALLOWED_HOSTS_ENV}; left untouched.`,
			};
		}
		return {
			mechanism: "env",
			env: [`${VITE_ALLOWED_HOSTS_ENV}=${hosts.join(",")}`],
			hosts,
			reason:
				"Vite server enforces Host validation; hosts delivered via Vite's documented runtime environment variable (no source changes).",
		};
	}

	if (framework.includes("django") || (language === "python" && deps.django)) {
		if (hasUserEnv("DJANGO_ALLOWED_HOSTS")) {
			return { mechanism: "none", env: [], hosts, reason: "Customer defines DJANGO_ALLOWED_HOSTS." };
		}
		return {
			mechanism: "diagnostic-only",
			env: [],
			hosts,
			reason:
				"Django validates Host via settings.ALLOWED_HOSTS, which HatDot cannot edit safely.",
			remediation: `Read ALLOWED_HOSTS from the environment in settings.py and set DJANGO_ALLOWED_HOSTS=${hosts.join(",")} in Application Environment.`,
		};
	}

	if (framework.includes("rails") || framework.includes("ruby")) {
		return {
			mechanism: "diagnostic-only",
			env: [],
			hosts,
			reason: "Rails host authorization is configured in config.hosts.",
			remediation: `Add config.hosts << "${hosts[0]}" in config/environments/production.rb (or use RAILS_DEVELOPMENT_HOSTS only for development).`,
		};
	}

	if (framework.includes("laravel")) {
		return {
			mechanism: "diagnostic-only",
			env: [],
			hosts,
			reason: "Laravel trusted hosts are configured by TrustHosts middleware.",
			remediation: `If you use TrustHosts, include ${hosts.join(", ")} in the allowed patterns.`,
		};
	}

	return {
		mechanism: "none",
		env: [],
		hosts,
		reason: "Framework does not enforce Host validation in production mode.",
	};
};

export interface HostRejection {
	framework: "vite" | "django" | "rails" | "webpack-dev-server" | "generic";
	message: string;
	remediation: string;
}

/**
 * Recognizes framework-level host-validation rejections from an HTTP response.
 */
export const detectHostRejection = (response: {
	status: number;
	body?: string | null;
}): HostRejection | null => {
	const body = response.body ?? "";
	if (response.status === 403 && /Blocked request\. This host/i.test(body)) {
		return {
			framework: "vite",
			message: "Vite rejected the Host header (preview/server.allowedHosts).",
			remediation:
				"HatDot injects __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS only for Vite servers. Ensure the start command runs `vite preview`/`vite` directly, or add the host to preview.allowedHosts in vite.config.",
		};
	}
	if (response.status === 400 && /DisallowedHost|Invalid HTTP_HOST header/i.test(body)) {
		return {
			framework: "django",
			message: "Django rejected the Host header (ALLOWED_HOSTS).",
			remediation:
				"Add the application hostname to ALLOWED_HOSTS (e.g. read it from DJANGO_ALLOWED_HOSTS).",
		};
	}
	if (response.status === 403 && /Blocked hosts?|Blocked host\(s\)/i.test(body)) {
		return {
			framework: "rails",
			message: "Rails rejected the Host header (config.hosts).",
			remediation: "Add the hostname to config.hosts in production.rb.",
		};
	}
	if (/Invalid Host header/i.test(body)) {
		return {
			framework: "webpack-dev-server",
			message: "A dev server rejected the Host header.",
			remediation:
				"This looks like a development server running in production. Use a production start command (build + preview/static serving).",
		};
	}
	return null;
};

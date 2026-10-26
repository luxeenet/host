/**
 * Integration policy — pure logic (no database, no network).
 *
 * Single source of truth for:
 *  - which integrations exist and what configuration each one needs,
 *  - validation/normalization of administrator input,
 *  - the shared availability state used by customer screens, API procedures,
 *    OAuth handlers and deployment operations,
 *  - secret redaction for anything that can reach a response, log or audit row.
 */

export const INTEGRATION_IDS = [
	"github",
	"gitlab",
	"bitbucket",
	"gitea",
	"docker",
	"git",
	"drop",
] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const isIntegrationId = (value: unknown): value is IntegrationId =>
	typeof value === "string" &&
	(INTEGRATION_IDS as readonly string[]).includes(value);

export type IntegrationFieldType =
	| "text"
	| "url"
	| "secret"
	| "textarea-secret"
	| "select"
	| "multiselect"
	| "boolean";

export interface IntegrationFieldDef {
	key: string;
	label: string;
	type: IntegrationFieldType;
	required?: boolean;
	help?: string;
	placeholder?: string;
	default?: string | boolean | string[];
	options?: { value: string; label: string }[];
}

export type IntegrationKind = "source-control" | "registry" | "source";

export interface IntegrationDefinition {
	id: IntegrationId;
	label: string;
	kind: IntegrationKind;
	description: string;
	/**
	 * Self-contained integrations have no external account to connect (plain
	 * Git URLs, file upload). Once enabled and configured they are ready.
	 */
	selfContained: boolean;
	fields: IntegrationFieldDef[];
	/** Paths (relative to the panel origin) shown to administrators. */
	callbackPaths?: { label: string; path: string }[];
	/** Minimum provider permissions, shown as documentation. */
	requiredPermissions?: string[];
}

const instanceUrlField = (def: string): IntegrationFieldDef => ({
	key: "instanceUrl",
	label: "Instance URL",
	type: "url",
	required: true,
	default: def,
	placeholder: def,
	help: "Base URL of the server, without a trailing path.",
});

export const INTEGRATION_DEFINITIONS: Record<
	IntegrationId,
	IntegrationDefinition
> = {
	github: {
		id: "github",
		label: "GitHub",
		kind: "source-control",
		description:
			"Let customers connect GitHub accounts or organizations and deploy from their repositories.",
		selfContained: false,
		fields: [
			{
				key: "baseUrl",
				label: "GitHub URL",
				type: "url",
				default: "https://github.com",
				placeholder: "https://github.com",
				help: "Change only for GitHub Enterprise Server.",
			},
			{
				key: "organization",
				label: "Organization (optional)",
				type: "text",
				help: "Informational: the GitHub organization that owns the platform app.",
			},
			{ key: "appId", label: "GitHub App ID", type: "text" },
			{ key: "clientId", label: "Client ID", type: "text" },
			{ key: "clientSecret", label: "Client secret", type: "secret" },
			{ key: "webhookSecret", label: "Webhook secret", type: "secret" },
			{
				key: "privateKey",
				label: "App private key (PEM)",
				type: "textarea-secret",
			},
		],
		callbackPaths: [
			{ label: "Setup / callback URL", path: "/api/providers/github/setup" },
			{ label: "Webhook URL", path: "/api/providers/github/webhook" },
		],
		requiredPermissions: [
			"Repository contents: Read-only",
			"Metadata: Read-only",
			"Pull requests: Read & write (only for preview deployments)",
		],
	},
	gitlab: {
		id: "gitlab",
		label: "GitLab",
		kind: "source-control",
		description:
			"Let customers connect GitLab.com or a self-hosted GitLab and deploy from their projects.",
		selfContained: false,
		fields: [
			instanceUrlField("https://gitlab.com"),
			{
				key: "restrictToInstance",
				label: "Only allow this instance",
				type: "boolean",
				default: false,
				help: "When on, customers can only register GitLab providers on this instance.",
			},
			{ key: "applicationId", label: "OAuth application ID", type: "text" },
			{ key: "secret", label: "OAuth application secret", type: "secret" },
			{
				key: "accessToken",
				label: "Access token (for connection test)",
				type: "secret",
				help: "A read-only token used only to verify the instance. Never shared with customers.",
			},
		],
		callbackPaths: [
			{ label: "Redirect URI", path: "/api/providers/gitlab/callback" },
		],
		requiredPermissions: ["read_user", "read_repository", "api (listing projects)"],
	},
	bitbucket: {
		id: "bitbucket",
		label: "Bitbucket",
		kind: "source-control",
		description:
			"Let customers connect Bitbucket Cloud workspaces and deploy from their repositories.",
		selfContained: false,
		fields: [
			{
				key: "workspace",
				label: "Workspace (optional)",
				type: "text",
				help: "Workspace slug used for the connection test.",
			},
			{ key: "email", label: "Atlassian account email", type: "text" },
			{ key: "apiToken", label: "API token", type: "secret" },
			{ key: "clientId", label: "OAuth consumer key", type: "text" },
			{ key: "clientSecret", label: "OAuth consumer secret", type: "secret" },
		],
		requiredPermissions: ["Repositories: Read", "Account: Read"],
	},
	gitea: {
		id: "gitea",
		label: "Gitea",
		kind: "source-control",
		description:
			"Let customers connect a Gitea or Forgejo instance and deploy from their repositories.",
		selfContained: false,
		fields: [
			instanceUrlField("https://gitea.com"),
			{
				key: "restrictToInstance",
				label: "Only allow this instance",
				type: "boolean",
				default: false,
				help: "When on, customers can only register Gitea providers on this instance.",
			},
			{ key: "clientId", label: "OAuth client ID", type: "text" },
			{ key: "clientSecret", label: "OAuth client secret", type: "secret" },
			{
				key: "accessToken",
				label: "Access token (for connection test)",
				type: "secret",
				help: "A read-only token used only to verify the instance. Never shared with customers.",
			},
		],
		callbackPaths: [
			{ label: "Redirect URI", path: "/api/providers/gitea/callback" },
		],
		requiredPermissions: ["read:user", "read:repository"],
	},
	docker: {
		id: "docker",
		label: "Docker",
		kind: "registry",
		description:
			"Let customers deploy container images from a registry (Docker Hub or a custom registry).",
		selfContained: false,
		fields: [
			{
				key: "registryType",
				label: "Registry type",
				type: "select",
				required: true,
				default: "dockerhub",
				options: [
					{ value: "dockerhub", label: "Docker Hub" },
					{ value: "ghcr", label: "GitHub Container Registry" },
					{ value: "custom", label: "Custom registry" },
				],
			},
			{
				key: "registryEndpoint",
				label: "Registry endpoint",
				type: "url",
				required: true,
				default: "https://registry-1.docker.io",
				placeholder: "https://registry-1.docker.io",
			},
			{ key: "namespace", label: "Namespace (optional)", type: "text" },
			{ key: "username", label: "Username", type: "text" },
			{ key: "password", label: "Password or access token", type: "secret" },
		],
		requiredPermissions: ["Pull access to the images customers deploy"],
	},
	git: {
		id: "git",
		label: "Git",
		kind: "source-control",
		description:
			"Let customers deploy from any Git URL, using a public clone or an SSH key.",
		selfContained: true,
		fields: [
			{
				key: "allowedAuthMethods",
				label: "Allowed access methods",
				type: "multiselect",
				required: true,
				default: ["public", "ssh"],
				options: [
					{ value: "public", label: "Public HTTPS clone" },
					{ value: "ssh", label: "SSH key (private repositories)" },
				],
				help: "Private repositories use the SSH keys customers add to their account.",
			},
			{
				key: "testRepositoryUrl",
				label: "Test repository URL (optional)",
				type: "url",
				help: "If set, “Test” runs a read-only `git ls-remote` against it.",
			},
		],
	},
	drop: {
		id: "drop",
		label: "Drop",
		kind: "source",
		description:
			"Let customers deploy by uploading a ZIP of their project (the “Drop” tab). This is an upload source, not an external provider.",
		selfContained: true,
		fields: [],
	},
};

export const INTEGRATION_LIST: IntegrationDefinition[] = INTEGRATION_IDS.map(
	(id) => INTEGRATION_DEFINITIONS[id],
);

export const getIntegrationDefinition = (id: IntegrationId) =>
	INTEGRATION_DEFINITIONS[id];

// ---------------------------------------------------------------------------
// Secrets & redaction
// ---------------------------------------------------------------------------

export const secretFieldKeys = (id: IntegrationId): string[] =>
	INTEGRATION_DEFINITIONS[id].fields
		.filter((f) => f.type === "secret" || f.type === "textarea-secret")
		.map((f) => f.key);

export const REDACTED = "[redacted]";

const GENERIC_SECRET_REPLACERS: Array<[RegExp, string]> = [
	[
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		REDACTED,
	],
	[/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g, REDACTED],
	[/\bglpat-[A-Za-z0-9_-]{10,}\b/g, REDACTED],
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
	[
		/\b(access_token|refresh_token|client_secret|password|token)=[^&\s"']+/gi,
		`$1=${REDACTED}`,
	],
	[/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
];

/**
 * Removes known secret values and common credential shapes from free text so
 * it can be shown to administrators or written to logs/audit entries.
 */
export const redactSecrets = (
	input: unknown,
	knownSecrets: Array<string | null | undefined> = [],
): string => {
	let text =
		typeof input === "string"
			? input
			: input instanceof Error
				? input.message
				: JSON.stringify(input ?? "");
	for (const secret of knownSecrets) {
		if (secret && secret.length >= 4) {
			text = text.split(secret).join(REDACTED);
		}
	}
	for (const [pattern, replacement] of GENERIC_SECRET_REPLACERS) {
		text = text.replace(pattern, replacement);
	}
	return text;
};

// ---------------------------------------------------------------------------
// Validation & normalization
// ---------------------------------------------------------------------------

export type IntegrationConfig = Record<string, string | boolean | string[]>;

export class IntegrationValidationError extends Error {
	constructor(
		message: string,
		public readonly fieldErrors: Record<string, string>,
	) {
		super(message);
		this.name = "IntegrationValidationError";
	}
}

const isMetadataAddress = (hostname: string) =>
	/^169\.254\.\d+\.\d+$/.test(hostname) ||
	hostname === "metadata.google.internal" ||
	hostname === "[fd00:ec2::254]";

/** Normalizes and validates an http(s) URL. Returns the cleaned URL. */
export const normalizeHttpUrl = (raw: string): string => {
	const value = raw.trim();
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Enter a valid URL, for example https://example.com");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Only http:// and https:// URLs are supported.");
	}
	if (url.username || url.password) {
		throw new Error(
			"Do not put credentials in the URL. Use the credential fields instead.",
		);
	}
	if (isMetadataAddress(url.hostname.toLowerCase())) {
		throw new Error("This address is not allowed.");
	}
	url.hash = "";
	url.search = "";
	return url.toString().replace(/\/+$/, "");
};

/** Git remote URL: https/ssh/git only, no option injection, no credentials. */
export const normalizeGitRemoteUrl = (raw: string): string => {
	const value = raw.trim();
	if (!value || value.startsWith("-") || /\s/.test(value)) {
		throw new Error("Enter a valid repository URL.");
	}
	if (/^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(value)) {
		return value; // scp-like: git@host:org/repo.git
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Enter a valid repository URL.");
	}
	if (!["https:", "ssh:", "git:"].includes(url.protocol)) {
		throw new Error("Only https, ssh and git repository URLs are supported.");
	}
	if (url.password || (url.protocol !== "ssh:" && url.username)) {
		throw new Error("Do not put credentials in the repository URL.");
	}
	if (isMetadataAddress(url.hostname.toLowerCase())) {
		throw new Error("This address is not allowed.");
	}
	return value;
};

/**
 * Validates non-secret configuration against the provider definition and
 * returns a clean config containing only known keys.
 */
export const validateIntegrationConfig = (
	id: IntegrationId,
	input: Record<string, unknown>,
): IntegrationConfig => {
	const def = INTEGRATION_DEFINITIONS[id];
	const errors: Record<string, string> = {};
	const clean: IntegrationConfig = {};

	for (const field of def.fields) {
		if (field.type === "secret" || field.type === "textarea-secret") continue;
		const raw = input[field.key];

		switch (field.type) {
			case "boolean": {
				if (raw === undefined) break;
				clean[field.key] = raw === true || raw === "true";
				break;
			}
			case "multiselect": {
				if (raw === undefined) break;
				const arr = Array.isArray(raw) ? raw.map(String) : [];
				const allowed = new Set((field.options ?? []).map((o) => o.value));
				const filtered = arr.filter((v) => allowed.has(v));
				if (filtered.length !== arr.length) {
					errors[field.key] = "Contains an unsupported option.";
				} else {
					clean[field.key] = Array.from(new Set(filtered));
				}
				break;
			}
			case "select": {
				if (raw === undefined || raw === "") break;
				const allowed = new Set((field.options ?? []).map((o) => o.value));
				if (typeof raw !== "string" || !allowed.has(raw)) {
					errors[field.key] = "Choose one of the available options.";
				} else {
					clean[field.key] = raw;
				}
				break;
			}
			case "url": {
				if (typeof raw !== "string" || raw.trim() === "") break;
				try {
					clean[field.key] =
						id === "git" && field.key === "testRepositoryUrl"
							? normalizeGitRemoteUrl(raw)
							: normalizeHttpUrl(raw);
				} catch (e) {
					errors[field.key] = (e as Error).message;
				}
				break;
			}
			default: {
				if (typeof raw !== "string" || raw.trim() === "") break;
				const value = raw.trim();
				if (value.length > 200) {
					errors[field.key] = "Must be 200 characters or fewer.";
				} else if (/[\r\n]/.test(value)) {
					errors[field.key] = "Must be a single line.";
				} else {
					clean[field.key] = value;
				}
			}
		}
	}

	if (Object.keys(errors).length > 0) {
		throw new IntegrationValidationError(
			"Some settings need attention.",
			errors,
		);
	}
	return clean;
};

/** Validates a secret value supplied by an administrator. */
export const validateSecretValue = (
	id: IntegrationId,
	key: string,
	value: string,
): string => {
	if (!secretFieldKeys(id).includes(key)) {
		throw new IntegrationValidationError("Unknown credential field.", {
			[key]: "Unknown credential field.",
		});
	}
	const field = INTEGRATION_DEFINITIONS[id].fields.find((f) => f.key === key);
	const trimmed = value.trim();
	if (!trimmed) {
		throw new IntegrationValidationError("Credential cannot be empty.", {
			[key]: "Credential cannot be empty.",
		});
	}
	const max = field?.type === "textarea-secret" ? 8192 : 1024;
	if (trimmed.length > max) {
		throw new IntegrationValidationError("Credential is too long.", {
			[key]: "Credential is too long.",
		});
	}
	if (field?.type === "secret" && /[\r\n]/.test(trimmed)) {
		throw new IntegrationValidationError("Must be a single line.", {
			[key]: "Must be a single line.",
		});
	}
	return trimmed;
};

/** Applies the provider defaults for any key that has no stored value. */
export const withDefaults = (
	id: IntegrationId,
	config: IntegrationConfig,
): IntegrationConfig => {
	const out: IntegrationConfig = { ...config };
	for (const field of INTEGRATION_DEFINITIONS[id].fields) {
		if (out[field.key] === undefined && field.default !== undefined) {
			out[field.key] = field.default;
		}
	}
	return out;
};

/** Labels of required fields that are empty. Secrets are tracked separately. */
export const missingRequiredFields = (
	id: IntegrationId,
	config: IntegrationConfig,
	secretsConfigured: Record<string, boolean> = {},
): string[] => {
	const merged = withDefaults(id, config);
	const missing: string[] = [];
	for (const field of INTEGRATION_DEFINITIONS[id].fields) {
		if (!field.required) continue;
		if (field.type === "secret" || field.type === "textarea-secret") {
			if (!secretsConfigured[field.key]) missing.push(field.label);
			continue;
		}
		const v = merged[field.key];
		const empty =
			v === undefined ||
			v === "" ||
			(Array.isArray(v) && v.length === 0);
		if (empty) missing.push(field.label);
	}
	return missing;
};

// ---------------------------------------------------------------------------
// Shared availability state
// ---------------------------------------------------------------------------

export type IntegrationState =
	| "disabled"
	| "not_configured"
	| "configured"
	| "ready"
	| "failing";

export type TestStatus = "verified" | "failed" | "unverified";
export type VerificationLevel = "credentials" | "reachability" | "configuration";

export interface IntegrationRowLike {
	enabled: boolean;
	config: IntegrationConfig | null;
	secretsConfigured: Record<string, boolean>;
	lastTestStatus: TestStatus | null;
	lastTestedAt: Date | string | null;
	/** Fingerprint of config+secrets when the last test ran. */
	testedFingerprint: string | null;
	/** Fingerprint of the current config+secrets. */
	currentFingerprint: string;
}

/**
 * Computes the platform-level state of an integration.
 *
 *  disabled        – administrator turned it off
 *  not_configured  – enabled but required settings are missing
 *  configured      – settings complete, but not verified with the current settings
 *  ready           – verified (or self-contained): customers may authorize/connect
 *  failing         – the latest test with the current settings failed
 *
 * A missing row means "never touched by an administrator": the integration
 * keeps its pre-existing behavior (enabled, customer-supplied credentials) so
 * upgrades do not break existing customers.
 */
export const computeIntegrationState = (
	id: IntegrationId,
	row: IntegrationRowLike | null,
): IntegrationState => {
	const def = INTEGRATION_DEFINITIONS[id];
	const enabled = row ? row.enabled : true;
	if (!enabled) return "disabled";

	const missing = missingRequiredFields(
		id,
		row?.config ?? {},
		row?.secretsConfigured ?? {},
	);
	if (missing.length > 0) return "not_configured";
	if (def.selfContained) return "ready";
	if (!row || !row.lastTestedAt || !row.lastTestStatus) return "configured";
	if (row.testedFingerprint !== row.currentFingerprint) return "configured";
	if (row.lastTestStatus === "failed") return "failing";
	if (row.lastTestStatus === "verified") return "ready";
	return "configured";
};

/** Customers may start NEW connections/operations in these states. */
export const isCustomerAvailable = (state: IntegrationState): boolean =>
	state === "configured" || state === "ready" || state === "failing";

export const unavailableMessage = (
	id: IntegrationId,
	state: IntegrationState,
): string => {
	const label = INTEGRATION_DEFINITIONS[id].label;
	if (state === "disabled") {
		return `${label} is currently unavailable. Please contact your administrator or choose another source.`;
	}
	if (state === "not_configured") {
		return `${label} is not set up yet. Please contact your administrator.`;
	}
	return `${label} is currently unavailable.`;
};

export interface CustomerIntegrationView {
	id: IntegrationId;
	label: string;
	available: boolean;
	/** True when the integration is available but may be having problems. */
	degraded: boolean;
	message: string | null;
}

/** Customer-safe projection: no configuration, no credentials, no test detail. */
export const toCustomerView = (
	id: IntegrationId,
	state: IntegrationState,
): CustomerIntegrationView => ({
	id,
	label: INTEGRATION_DEFINITIONS[id].label,
	available: isCustomerAvailable(state),
	degraded: state === "failing",
	message: isCustomerAvailable(state)
		? state === "failing"
			? `${INTEGRATION_DEFINITIONS[id].label} may be experiencing issues.`
			: null
		: unavailableMessage(id, state),
});

/** Maps a customer-chosen source/provider type to its integration id. */
export const integrationForSourceType = (
	sourceType: string | null | undefined,
): IntegrationId | null => {
	switch (sourceType) {
		case "github":
		case "gitlab":
		case "bitbucket":
		case "gitea":
		case "docker":
		case "git":
		case "drop":
			return sourceType;
		default:
			return null;
	}
};

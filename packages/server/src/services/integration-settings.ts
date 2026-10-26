import { createHmac } from "node:crypto";
import { db } from "@dokploy/server/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
	type IntegrationSettingRow,
	integrationSettings,
} from "../db/schema/integration-setting";
import { decryptValue, encryptValue } from "../lib/encryption";
import { encryptionSecret } from "../lib/encryption-secret";
import { betterAuthSecret } from "../lib/auth-secret";
import {
	type ConnectivityDeps,
	type ConnectivityResult,
	testIntegrationConnection,
} from "./integration-connectivity";
import {
	type CustomerIntegrationView,
	INTEGRATION_DEFINITIONS,
	INTEGRATION_IDS,
	type IntegrationConfig,
	type IntegrationId,
	type IntegrationRowLike,
	type IntegrationState,
	IntegrationValidationError,
	type TestStatus,
	type VerificationLevel,
	computeIntegrationState,
	integrationForSourceType,
	isCustomerAvailable,
	missingRequiredFields,
	normalizeHttpUrl,
	redactSecrets,
	secretFieldKeys,
	toCustomerView,
	unavailableMessage,
	validateIntegrationConfig,
	validateSecretValue,
	withDefaults,
} from "./integration-policy";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const fingerprintKey = () =>
	createHmac("sha256", encryptionSecret ?? betterAuthSecret)
		.update("hatdot:integration-fingerprint:v1")
		.digest();

const stableStringify = (value: unknown): string =>
	JSON.stringify(value, (_k, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
						a.localeCompare(b),
					),
				)
			: v,
	);

export const computeFingerprint = (
	config: IntegrationConfig,
	secrets: Record<string, string>,
) =>
	createHmac("sha256", fingerprintKey())
		.update(stableStringify({ config, secrets }))
		.digest("hex");

const readSecrets = (row: IntegrationSettingRow | null | undefined) => {
	if (!row?.secrets) return { secrets: {} as Record<string, string>, ok: true };
	try {
		const parsed = JSON.parse(decryptValue(row.secrets));
		const secrets: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed ?? {})) {
			if (typeof v === "string") secrets[k] = v;
		}
		return { secrets, ok: true };
	} catch {
		return { secrets: {} as Record<string, string>, ok: false };
	}
};

const loadRow = async (id: IntegrationId) => {
	const rows = await db
		.select()
		.from(integrationSettings)
		.where(eq(integrationSettings.provider, id))
		.limit(1);
	return rows[0] ?? null;
};

const configOf = (row: IntegrationSettingRow | null): IntegrationConfig =>
	((row?.config as IntegrationConfig | undefined) ?? {}) as IntegrationConfig;

const toRowLike = (
	row: IntegrationSettingRow | null,
	secrets: Record<string, string>,
): IntegrationRowLike | null => {
	if (!row) return null;
	const config = configOf(row);
	const configured: Record<string, boolean> = {};
	for (const key of row.secretKeys ?? []) configured[key] = true;
	return {
		enabled: row.enabled,
		config,
		secretsConfigured: configured,
		lastTestStatus: (row.lastTestStatus as TestStatus | null) ?? null,
		lastTestedAt: row.lastTestedAt,
		testedFingerprint: row.testedFingerprint,
		currentFingerprint: computeFingerprint(config, secrets),
	};
};

// ---------------------------------------------------------------------------
// Shared availability (used by customer screens, API procedures, OAuth
// handlers, repository listing and deployment operations)
// ---------------------------------------------------------------------------

export const getIntegrationState = async (
	id: IntegrationId,
): Promise<IntegrationState> => {
	const row = await loadRow(id);
	const { secrets } = readSecrets(row);
	return computeIntegrationState(id, toRowLike(row, secrets));
};

export const getCustomerIntegrations = async (): Promise<
	CustomerIntegrationView[]
> => {
	const rows = await db.select().from(integrationSettings);
	const byId = new Map(rows.map((r) => [r.provider, r]));
	return INTEGRATION_IDS.map((id) => {
		const row = byId.get(id) ?? null;
		const { secrets } = readSecrets(row);
		return toCustomerView(id, computeIntegrationState(id, toRowLike(row, secrets)));
	});
};

/**
 * Throws FORBIDDEN when customers may not start NEW usage of the integration
 * (new connections, OAuth, repository selection, new source configuration).
 * Existing connections and already-deployed applications are intentionally
 * not routed through this check so they keep working.
 */
export const assertIntegrationAvailable = async (id: IntegrationId) => {
	const state = await getIntegrationState(id);
	if (!isCustomerAvailable(state)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: unavailableMessage(id, state),
		});
	}
};

/** Gate for a customer-selected source type; no-op for unknown/legacy types. */
export const assertSourceTypeAvailable = async (
	sourceType: string | null | undefined,
) => {
	const id = integrationForSourceType(sourceType);
	if (id) await assertIntegrationAvailable(id);
};

/**
 * For GitLab/Gitea: when the administrator restricted customers to one
 * instance, reject providers registered against any other host.
 */
export const assertInstanceAllowed = async (
	id: "gitlab" | "gitea",
	customerUrl: string,
) => {
	const row = await loadRow(id);
	const config = withDefaults(id, configOf(row));
	if (config.restrictToInstance !== true) return;
	try {
		const allowed = new URL(normalizeHttpUrl(String(config.instanceUrl))).host;
		const given = new URL(normalizeHttpUrl(customerUrl)).host;
		if (allowed.toLowerCase() === given.toLowerCase()) return;
	} catch {
		// fall through to the rejection below
	}
	throw new TRPCError({
		code: "FORBIDDEN",
		message: `${INTEGRATION_DEFINITIONS[id].label} connections are limited to the instance configured by your administrator.`,
	});
};

// ---------------------------------------------------------------------------
// Administrator views & mutations
// ---------------------------------------------------------------------------

export interface AdminIntegrationView {
	id: IntegrationId;
	label: string;
	kind: string;
	description: string;
	selfContained: boolean;
	fields: (typeof INTEGRATION_DEFINITIONS)[IntegrationId]["fields"];
	callbackPaths: { label: string; path: string }[];
	requiredPermissions: string[];
	enabled: boolean;
	state: IntegrationState;
	/** Non-secret configuration with defaults applied. */
	config: IntegrationConfig;
	/** Presence only — secret values are never returned. */
	secretsConfigured: Record<string, boolean>;
	missingRequired: string[];
	secretsUnreadable: boolean;
	lastTestStatus: TestStatus | null;
	lastVerification: VerificationLevel | null;
	lastTestMessage: string | null;
	lastTestedAt: string | null;
	lastSuccessfulTestAt: string | null;
	/** True when settings changed after the last test. */
	testStale: boolean;
	/** True when an administrator has saved settings for this integration. */
	persisted: boolean;
	updatedAt: string | null;
}

const toAdminView = (
	id: IntegrationId,
	row: IntegrationSettingRow | null,
): AdminIntegrationView => {
	const def = INTEGRATION_DEFINITIONS[id];
	const { secrets, ok } = readSecrets(row);
	const like = toRowLike(row, secrets);
	const configured: Record<string, boolean> = {};
	for (const key of secretFieldKeys(id)) {
		configured[key] = Boolean(row?.secretKeys?.includes(key));
	}
	const config = withDefaults(id, configOf(row));
	return {
		id,
		label: def.label,
		kind: def.kind,
		description: def.description,
		selfContained: def.selfContained,
		fields: def.fields,
		callbackPaths: def.callbackPaths ?? [],
		requiredPermissions: def.requiredPermissions ?? [],
		enabled: row ? row.enabled : true,
		state: computeIntegrationState(id, like),
		config,
		secretsConfigured: configured,
		missingRequired: missingRequiredFields(id, configOf(row), configured),
		secretsUnreadable: !ok,
		lastTestStatus: (row?.lastTestStatus as TestStatus | null) ?? null,
		lastVerification: (row?.lastVerification as VerificationLevel | null) ?? null,
		lastTestMessage: row?.lastTestMessage ?? null,
		lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
		lastSuccessfulTestAt: row?.lastSuccessfulTestAt?.toISOString() ?? null,
		testStale: Boolean(
			like && like.lastTestedAt && like.testedFingerprint !== like.currentFingerprint,
		),
		persisted: Boolean(row),
		updatedAt: row?.updatedAt?.toISOString() ?? null,
	};
};

export const listAdminIntegrations = async (): Promise<
	AdminIntegrationView[]
> => {
	const rows = await db.select().from(integrationSettings);
	const byId = new Map(rows.map((r) => [r.provider, r]));
	return INTEGRATION_IDS.map((id) => toAdminView(id, byId.get(id) ?? null));
};

export interface SaveIntegrationInput {
	config?: Record<string, unknown>;
	/** Values to set. Omitted/empty keys keep their stored value. */
	secrets?: Record<string, string | undefined>;
	/** Credential keys to remove. */
	clearSecrets?: string[];
}

export interface IntegrationChange {
	view: AdminIntegrationView;
	/** Keys whose values changed — never contains values. */
	changedConfigKeys: string[];
	changedSecretKeys: string[];
	clearedSecretKeys: string[];
}

export const saveIntegrationSettings = async (
	id: IntegrationId,
	input: SaveIntegrationInput,
	userId: string,
): Promise<IntegrationChange> => {
	const existing = await loadRow(id);
	const current = readSecrets(existing);
	const ciphertextUnreadable = !current.ok && Boolean(existing?.secrets);

	const previousConfig = configOf(existing);
	const nextConfig =
		input.config !== undefined
			? validateIntegrationConfig(id, { ...previousConfig, ...input.config })
			: previousConfig;

	const nextSecrets: Record<string, string> = { ...current.secrets };
	const changedSecretKeys: string[] = [];
	const clearedSecretKeys: string[] = [];
	const errors: Record<string, string> = {};

	for (const [key, raw] of Object.entries(input.secrets ?? {})) {
		if (raw === undefined || raw.trim() === "") continue; // keep stored value
		try {
			nextSecrets[key] = validateSecretValue(id, key, raw);
			changedSecretKeys.push(key);
		} catch (e) {
			errors[key] =
				e instanceof IntegrationValidationError
					? (e.fieldErrors[key] ?? e.message)
					: "Invalid credential.";
		}
	}
	for (const key of input.clearSecrets ?? []) {
		if (!secretFieldKeys(id).includes(key)) {
			errors[key] = "Unknown credential field.";
			continue;
		}
		if (key in nextSecrets) {
			delete nextSecrets[key];
			clearedSecretKeys.push(key);
		}
	}
	if (Object.keys(errors).length > 0) {
		throw new IntegrationValidationError("Some settings need attention.", errors);
	}

	const secretsTouched =
		changedSecretKeys.length > 0 || clearedSecretKeys.length > 0;
	// Unreadable ciphertext (encryption key changed) is carried over untouched on
	// non-secret edits so we never destroy data we could not read.
	const preserveCiphertext = ciphertextUnreadable && !secretsTouched;

	const changedConfigKeys = Object.keys(nextConfig).filter(
		(k) => JSON.stringify(nextConfig[k]) !== JSON.stringify(previousConfig[k]),
	);

	const secretKeys = preserveCiphertext
		? (existing?.secretKeys ?? [])
		: Object.keys(nextSecrets);
	const missing = missingRequiredFields(
		id,
		nextConfig,
		Object.fromEntries(secretKeys.map((k) => [k, true])),
	);
	const enabledNow = existing ? existing.enabled : true;
	// An enabled integration must stay complete; otherwise it would silently
	// become "not configured" for customers.
	if (enabledNow && missing.length > 0 && existing) {
		throw new IntegrationValidationError(
			`Required: ${missing.join(", ")}.`,
			Object.fromEntries(missing.map((m) => [m, "Required."])),
		);
	}

	const values = {
		config: nextConfig as Record<string, unknown>,
		secrets: preserveCiphertext
			? (existing?.secrets ?? null)
			: secretKeys.length
				? encryptValue(JSON.stringify(nextSecrets))
				: null,
		secretKeys,
		updatedBy: userId,
		updatedAt: new Date(),
	};

	await db
		.insert(integrationSettings)
		.values({ provider: id, enabled: enabledNow, ...values })
		.onConflictDoUpdate({ target: integrationSettings.provider, set: values });

	return {
		view: toAdminView(id, await loadRow(id)),
		changedConfigKeys,
		changedSecretKeys,
		clearedSecretKeys,
	};
};

export const setIntegrationEnabled = async (
	id: IntegrationId,
	enabled: boolean,
	userId: string,
): Promise<{ view: AdminIntegrationView; previous: boolean }> => {
	const existing = await loadRow(id);
	const previous = existing ? existing.enabled : true;

	if (enabled) {
		const configured: Record<string, boolean> = {};
		for (const key of existing?.secretKeys ?? []) configured[key] = true;
		const missing = missingRequiredFields(id, configOf(existing), configured);
		if (missing.length > 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Complete the required settings before enabling ${INTEGRATION_DEFINITIONS[id].label}: ${missing.join(", ")}.`,
			});
		}
	}

	await db
		.insert(integrationSettings)
		.values({
			provider: id,
			enabled,
			config: configOf(existing) as Record<string, unknown>,
			updatedBy: userId,
		})
		.onConflictDoUpdate({
			target: integrationSettings.provider,
			set: { enabled, updatedBy: userId, updatedAt: new Date() },
		});

	return { view: toAdminView(id, await loadRow(id)), previous };
};

export const runIntegrationTest = async (
	id: IntegrationId,
	deps: ConnectivityDeps = {},
): Promise<{ result: ConnectivityResult; view: AdminIntegrationView }> => {
	const row = await loadRow(id);
	const { secrets, ok } = readSecrets(row);
	if (!ok) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Stored credentials could not be read (the encryption key changed). Clear them and enter them again.",
		});
	}
	const config = configOf(row);

	const missing = missingRequiredFields(
		id,
		config,
		Object.fromEntries(Object.keys(secrets).map((k) => [k, true])),
	);
	if (missing.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Complete the required settings first: ${missing.join(", ")}.`,
		});
	}

	let result: ConnectivityResult;
	try {
		result = await testIntegrationConnection(id, config, secrets, deps);
	} catch (err) {
		result = {
			status: "failed",
			verification: "reachability",
			message: redactSecrets(
				`The test could not be completed: ${err instanceof Error ? err.message : "unknown error"}`,
				Object.values(secrets),
			),
		};
	}

	const now = new Date();
	const values = {
		lastTestStatus: result.status,
		lastVerification: result.verification,
		lastTestMessage: result.message,
		lastTestedAt: now,
		testedFingerprint: computeFingerprint(config, secrets),
		updatedAt: now,
		...(result.status === "verified" ? { lastSuccessfulTestAt: now } : {}),
	};
	await db
		.insert(integrationSettings)
		.values({
			provider: id,
			enabled: row ? row.enabled : true,
			config: config as Record<string, unknown>,
			secrets: row?.secrets ?? null,
			secretKeys: row?.secretKeys ?? [],
			...values,
		})
		.onConflictDoUpdate({ target: integrationSettings.provider, set: values });

	return { result, view: toAdminView(id, await loadRow(id)) };
};

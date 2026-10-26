import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { betterAuthSecret } from "./auth-secret";
import { encryptionSecret } from "./encryption-secret";

/**
 * Signed, short-lived OAuth `state` values.
 *
 * The state binds an OAuth round-trip to:
 *  - the provider type and the provider record being authorized,
 *  - the signed-in user and organization that started the flow, and
 *  - a one-time nonce that is also stored in an HttpOnly cookie (login-CSRF).
 *
 * Callbacks must verify all of these before exchanging the authorization code.
 */

export type OAuthProviderType = "github" | "gitlab" | "bitbucket" | "gitea";

export interface OAuthStatePayload {
	/** Provider type this state was issued for. */
	p: OAuthProviderType;
	/** Provider record id (e.g. giteaId / gitlabId). */
	i: string;
	/** User that initiated the flow. */
	u: string;
	/** Organization active when the flow started. */
	o: string;
	/** Random nonce, mirrored in the nonce cookie. */
	n: string;
	/** Expiry (epoch ms). */
	e: number;
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_NONCE_COOKIE = "hd_oauth_nonce";

const deriveSigningKey = (secret: string) =>
	createHmac("sha256", secret).update("hatdot:oauth-state:v1").digest();

const defaultKey = () => deriveSigningKey(encryptionSecret ?? betterAuthSecret);

const b64 = (buf: Buffer) => buf.toString("base64url");

const sign = (payloadPart: string, key: Buffer) =>
	b64(createHmac("sha256", key).update(payloadPart).digest());

export class OAuthStateError extends Error {
	constructor(
		message: string,
		public readonly reason:
			| "malformed"
			| "bad_signature"
			| "expired"
			| "mismatch",
	) {
		super(message);
		this.name = "OAuthStateError";
	}
}

export interface CreatedOAuthState {
	state: string;
	nonce: string;
	expiresAt: number;
}

export const createOAuthState = (
	input: {
		provider: OAuthProviderType;
		providerId: string;
		userId: string;
		organizationId: string;
	},
	options: { ttlMs?: number; now?: number; secret?: string } = {},
): CreatedOAuthState => {
	const now = options.now ?? Date.now();
	const key = options.secret ? deriveSigningKey(options.secret) : defaultKey();
	const nonce = randomBytes(16).toString("hex");
	const payload: OAuthStatePayload = {
		p: input.provider,
		i: input.providerId,
		u: input.userId,
		o: input.organizationId,
		n: nonce,
		e: now + (options.ttlMs ?? OAUTH_STATE_TTL_MS),
	};
	const payloadPart = b64(Buffer.from(JSON.stringify(payload), "utf8"));
	return {
		state: `${payloadPart}.${sign(payloadPart, key)}`,
		nonce,
		expiresAt: payload.e,
	};
};

export interface VerifyExpectations {
	provider: OAuthProviderType;
	userId: string;
	organizationId: string;
	/** Nonce read from the HttpOnly cookie set when the flow started. */
	nonce?: string | null;
	/** Optional provider record id the callback targets. */
	providerId?: string;
}

/**
 * Verifies signature, expiry and binding. Throws {@link OAuthStateError}; the
 * message is safe to show to users and never contains the state contents.
 */
export const verifyOAuthState = (
	state: unknown,
	expected: VerifyExpectations,
	options: { now?: number; secret?: string } = {},
): OAuthStatePayload => {
	if (typeof state !== "string" || state.length > 2048) {
		throw new OAuthStateError("Invalid authorization state.", "malformed");
	}
	const parts = state.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new OAuthStateError("Invalid authorization state.", "malformed");
	}
	const [payloadPart, signature] = parts as [string, string];
	const key = options.secret ? deriveSigningKey(options.secret) : defaultKey();
	const expectedSig = Buffer.from(sign(payloadPart, key));
	const givenSig = Buffer.from(signature);
	if (
		expectedSig.length !== givenSig.length ||
		!timingSafeEqual(expectedSig, givenSig)
	) {
		throw new OAuthStateError("Invalid authorization state.", "bad_signature");
	}

	let payload: OAuthStatePayload;
	try {
		payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
	} catch {
		throw new OAuthStateError("Invalid authorization state.", "malformed");
	}

	if (typeof payload.e !== "number" || payload.e < (options.now ?? Date.now())) {
		throw new OAuthStateError(
			"The authorization request expired. Please start again.",
			"expired",
		);
	}
	if (
		payload.p !== expected.provider ||
		payload.u !== expected.userId ||
		payload.o !== expected.organizationId ||
		(expected.providerId !== undefined && payload.i !== expected.providerId)
	) {
		throw new OAuthStateError(
			"This authorization request does not belong to your session.",
			"mismatch",
		);
	}
	if (expected.nonce !== undefined) {
		const cookieNonce = Buffer.from(expected.nonce ?? "");
		const stateNonce = Buffer.from(payload.n);
		if (
			cookieNonce.length === 0 ||
			cookieNonce.length !== stateNonce.length ||
			!timingSafeEqual(cookieNonce, stateNonce)
		) {
			throw new OAuthStateError(
				"This authorization request does not belong to your session.",
				"mismatch",
			);
		}
	}
	return payload;
};

/** Builds the Set-Cookie value that binds the nonce to the browser session. */
export const buildNonceCookie = (
	nonce: string,
	options: { secure?: boolean; maxAgeSeconds?: number } = {},
) =>
	[
		`${OAUTH_NONCE_COOKIE}=${nonce}`,
		"Path=/api/providers",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${options.maxAgeSeconds ?? Math.floor(OAUTH_STATE_TTL_MS / 1000)}`,
		options.secure ? "Secure" : "",
	]
		.filter(Boolean)
		.join("; ");

export const buildClearNonceCookie = (options: { secure?: boolean } = {}) =>
	[
		`${OAUTH_NONCE_COOKIE}=`,
		"Path=/api/providers",
		"HttpOnly",
		"SameSite=Lax",
		"Max-Age=0",
		options.secure ? "Secure" : "",
	]
		.filter(Boolean)
		.join("; ");

export const readNonceCookie = (cookieHeader: string | undefined | null) => {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === OAUTH_NONCE_COOKIE) return rest.join("=") || null;
	}
	return null;
};

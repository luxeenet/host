/**
 * Integration connectivity tests.
 *
 * Production code talks to the real provider APIs. `fetch` and `execFile` are
 * injectable only so automated tests can run without network access — tests
 * that use mocks verify our handling of provider responses, NOT live access.
 *
 * Messages returned here are safe to show to administrators: they never contain
 * credentials, response bodies, or stack traces.
 */
import { createSign } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import {
	type IntegrationConfig,
	type IntegrationId,
	type TestStatus,
	type VerificationLevel,
	redactSecrets,
	withDefaults,
} from "./integration-policy";

export interface ConnectivityResult {
	status: TestStatus;
	verification: VerificationLevel;
	/** Short, human-readable, credential-free message. */
	message: string;
}

export interface ConnectivityDeps {
	fetch?: typeof fetch;
	execFile?: (
		file: string,
		args: string[],
		options: { timeout: number; env: NodeJS.ProcessEnv },
	) => Promise<{ stdout: string; stderr: string }>;
	now?: () => number;
}

const TIMEOUT_MS = 8000;

const defaultExecFile: NonNullable<ConnectivityDeps["execFile"]> = (
	file,
	args,
	options,
) =>
	new Promise((resolve, reject) => {
		nodeExecFile(file, args, options, (err, stdout, stderr) => {
			if (err) reject(Object.assign(err, { stdout, stderr }));
			else resolve({ stdout: String(stdout), stderr: String(stderr) });
		});
	});

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const describeNetworkError = (err: unknown, host: string): string => {
	const e = err as { name?: string; cause?: { code?: string }; code?: string };
	const code = e?.cause?.code || e?.code || "";
	if (e?.name === "TimeoutError" || e?.name === "AbortError" || code === "ETIMEDOUT") {
		return `Timed out connecting to ${host}.`;
	}
	if (code === "ENOTFOUND") return `Could not resolve ${host}. Check the address.`;
	if (code === "ECONNREFUSED") return `Connection to ${host} was refused.`;
	if (typeof code === "string" && code.includes("CERT")) {
		return `The TLS certificate presented by ${host} could not be verified.`;
	}
	return `Could not connect to ${host}.`;
};

const hostOf = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return "the server";
	}
};

const fail = (
	verification: VerificationLevel,
	message: string,
	secrets: string[],
): ConnectivityResult => ({
	status: "failed",
	verification,
	message: redactSecrets(message, secrets),
});

const ok = (
	verification: VerificationLevel,
	message: string,
	secrets: string[],
): ConnectivityResult => ({
	status: "verified",
	verification,
	message: redactSecrets(message, secrets),
});

const base64url = (input: Buffer | string) =>
	Buffer.from(input).toString("base64url");

/** RS256 JWT for authenticating as a GitHub App. */
export const createGithubAppJwt = (
	appId: string,
	privateKeyPem: string,
	nowMs: number,
): string => {
	const iat = Math.floor(nowMs / 1000) - 60;
	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64url(
		JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }),
	);
	const signer = createSign("RSA-SHA256");
	signer.update(`${header}.${payload}`);
	const signature = signer.sign(privateKeyPem).toString("base64url");
	return `${header}.${payload}.${signature}`;
};

const githubApiBase = (baseUrl: string) => {
	const url = new URL(baseUrl);
	return url.hostname === "github.com"
		? "https://api.github.com"
		: `${baseUrl.replace(/\/+$/, "")}/api/v3`;
};

type Probe = (
	url: string,
	init?: RequestInit,
) => Promise<{ status: number; headers: Headers; json: () => Promise<any> }>;

const makeProbe = (f: typeof fetch): Probe => async (url, init = {}) => {
	const res = await f(url, {
		...init,
		redirect: "manual",
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { "User-Agent": "HatDot-Integration-Test/1.0", ...(init.headers ?? {}) },
	});
	return {
		status: res.status,
		headers: res.headers,
		json: async () => {
			try {
				return await res.json();
			} catch {
				return {};
			}
		},
	};
};

const testGithub = async (
	config: IntegrationConfig,
	secrets: Record<string, string>,
	probe: Probe,
	now: number,
): Promise<ConnectivityResult> => {
	const baseUrl = str(config.baseUrl) || "https://github.com";
	const api = githubApiBase(baseUrl);
	const secretList = Object.values(secrets);
	const appId = str(config.appId);
	const privateKey = secrets.privateKey;

	if (appId && privateKey) {
		let jwt: string;
		try {
			jwt = createGithubAppJwt(appId, privateKey, now);
		} catch {
			return fail(
				"credentials",
				"The private key is not a valid PEM-encoded RSA key.",
				secretList,
			);
		}
		try {
			const res = await probe(`${api}/app`, {
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (res.status === 200) {
				const body = await res.json();
				const name = str(body?.name).slice(0, 80);
				return ok(
					"credentials",
					name
						? `Authenticated as GitHub App “${name}”.`
						: "Authenticated as a GitHub App.",
					secretList,
				);
			}
			if (res.status === 401) {
				return fail(
					"credentials",
					"GitHub rejected the App ID or private key.",
					secretList,
				);
			}
			return fail(
				"credentials",
				`GitHub returned an unexpected response (HTTP ${res.status}).`,
				secretList,
			);
		} catch (err) {
			return fail("credentials", describeNetworkError(err, hostOf(api)), secretList);
		}
	}

	try {
		const res = await probe(`${api}/zen`);
		if (res.status === 200) {
			const needs = [
				!appId || !privateKey ? "App ID and private key" : null,
			].filter(Boolean);
			return ok(
				"reachability",
				`GitHub is reachable. Credentials were not verified${needs.length ? ` — add the ${needs.join(" and ")} to verify them` : ""}.`,
				secretList,
			);
		}
		return fail(
			"reachability",
			`GitHub returned an unexpected response (HTTP ${res.status}).`,
			secretList,
		);
	} catch (err) {
		return fail("reachability", describeNetworkError(err, hostOf(api)), secretList);
	}
};

const testGitlab = async (
	config: IntegrationConfig,
	secrets: Record<string, string>,
	probe: Probe,
): Promise<ConnectivityResult> => {
	const base = str(config.instanceUrl);
	const secretList = Object.values(secrets);
	const token = secrets.accessToken;
	try {
		if (token) {
			const res = await probe(`${base}/api/v4/user`, {
				headers: { "PRIVATE-TOKEN": token },
			});
			if (res.status === 200) {
				const body = await res.json();
				const user = str(body?.username).slice(0, 80);
				return ok(
					"credentials",
					user ? `Authenticated as @${user}.` : "Access token verified.",
					secretList,
				);
			}
			if (res.status === 401 || res.status === 403) {
				return fail(
					"credentials",
					"GitLab rejected the access token (invalid, expired, or missing the read_api scope).",
					secretList,
				);
			}
			return fail(
				"credentials",
				`This does not look like a GitLab API (HTTP ${res.status}). Check the instance URL.`,
				secretList,
			);
		}
		const res = await probe(`${base}/api/v4/version`);
		// 200 (open instance) or 401 (auth required) both prove a GitLab API answered.
		if (res.status === 200 || res.status === 401) {
			return ok(
				"reachability",
				"GitLab is reachable. Add an access token to verify credentials.",
				secretList,
			);
		}
		return fail(
			"reachability",
			`This does not look like a GitLab instance (HTTP ${res.status}). Check the instance URL.`,
			secretList,
		);
	} catch (err) {
		return fail(
			token ? "credentials" : "reachability",
			describeNetworkError(err, hostOf(base)),
			secretList,
		);
	}
};

const testGitea = async (
	config: IntegrationConfig,
	secrets: Record<string, string>,
	probe: Probe,
): Promise<ConnectivityResult> => {
	const base = str(config.instanceUrl);
	const secretList = Object.values(secrets);
	const token = secrets.accessToken;
	try {
		const version = await probe(`${base}/api/v1/version`);
		if (version.status !== 200) {
			return fail(
				token ? "credentials" : "reachability",
				`This does not look like a Gitea/Forgejo instance (HTTP ${version.status}). Check the instance URL.`,
				secretList,
			);
		}
		if (!token) {
			return ok(
				"reachability",
				"Gitea is reachable. Add an access token to verify credentials.",
				secretList,
			);
		}
		const res = await probe(`${base}/api/v1/user`, {
			headers: { Authorization: `token ${token}` },
		});
		if (res.status === 200) {
			const body = await res.json();
			const login = str(body?.login).slice(0, 80);
			return ok(
				"credentials",
				login ? `Authenticated as ${login}.` : "Access token verified.",
				secretList,
			);
		}
		if (res.status === 401 || res.status === 403) {
			return fail("credentials", "Gitea rejected the access token.", secretList);
		}
		return fail(
			"credentials",
			`Gitea returned an unexpected response (HTTP ${res.status}).`,
			secretList,
		);
	} catch (err) {
		return fail(
			token ? "credentials" : "reachability",
			describeNetworkError(err, hostOf(base)),
			secretList,
		);
	}
};

const BB_API = "https://api.bitbucket.org/2.0";

const testBitbucket = async (
	config: IntegrationConfig,
	secrets: Record<string, string>,
	probe: Probe,
): Promise<ConnectivityResult> => {
	const secretList = Object.values(secrets);
	const email = str(config.email);
	const token = secrets.apiToken;
	const workspace = str(config.workspace);
	try {
		if (email && token) {
			const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
			const res = await probe(`${BB_API}/user`, {
				headers: { Authorization: auth },
			});
			if (res.status === 401 || res.status === 403) {
				return fail(
					"credentials",
					"Bitbucket rejected the email or API token.",
					[...secretList, auth],
				);
			}
			if (res.status !== 200) {
				return fail(
					"credentials",
					`Bitbucket returned an unexpected response (HTTP ${res.status}).`,
					[...secretList, auth],
				);
			}
			if (workspace) {
				const ws = await probe(
					`${BB_API}/workspaces/${encodeURIComponent(workspace)}`,
					{ headers: { Authorization: auth } },
				);
				if (ws.status === 404 || ws.status === 403) {
					return fail(
						"credentials",
						`Authenticated, but workspace “${workspace}” was not found or is not accessible with this token.`,
						[...secretList, auth],
					);
				}
				if (ws.status !== 200) {
					return fail(
						"credentials",
						`Could not check the workspace (HTTP ${ws.status}).`,
						[...secretList, auth],
					);
				}
				return ok(
					"credentials",
					`Authenticated and workspace “${workspace}” is accessible.`,
					[...secretList, auth],
				);
			}
			return ok("credentials", "Bitbucket credentials verified.", [
				...secretList,
				auth,
			]);
		}
		const res = await probe(`${BB_API}/repositories?pagelen=1`);
		if (res.status === 200) {
			return ok(
				"reachability",
				"Bitbucket is reachable. Add the email and API token to verify credentials.",
				secretList,
			);
		}
		return fail(
			"reachability",
			`Bitbucket returned an unexpected response (HTTP ${res.status}).`,
			secretList,
		);
	} catch (err) {
		return fail(
			email && token ? "credentials" : "reachability",
			describeNetworkError(err, "api.bitbucket.org"),
			secretList,
		);
	}
};

const parseChallenge = (header: string | null) => {
	if (!header) return null;
	const scheme = header.split(/\s+/)[0]?.toLowerCase();
	const params: Record<string, string> = {};
	for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) {
		if (m[1] && m[2] !== undefined) params[m[1].toLowerCase()] = m[2];
	}
	return { scheme, params };
};

const testDocker = async (
	config: IntegrationConfig,
	secrets: Record<string, string>,
	probe: Probe,
): Promise<ConnectivityResult> => {
	const endpoint = str(config.registryEndpoint);
	const username = str(config.username);
	const password = secrets.password;
	const hasCreds = Boolean(username && password);
	const basic = hasCreds
		? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
		: null;
	const secretList = [...Object.values(secrets), ...(basic ? [basic] : [])];
	const level: VerificationLevel = hasCreds ? "credentials" : "reachability";

	try {
		const ping = await probe(`${endpoint}/v2/`);
		if (ping.status === 200) {
			if (!hasCreds) {
				return ok("reachability", "Registry is reachable (anonymous access allowed).", secretList);
			}
		} else if (ping.status !== 401) {
			return fail(
				level,
				`This does not look like a Docker registry (HTTP ${ping.status}). Check the endpoint.`,
				secretList,
			);
		}

		const challenge = parseChallenge(ping.headers.get("www-authenticate"));
		if (ping.status === 401 && !challenge) {
			return fail(level, "The registry requires authentication but did not describe how.", secretList);
		}

		if (!hasCreds) {
			return ok(
				"reachability",
				"Registry is reachable. Add credentials to verify private image access.",
				secretList,
			);
		}

		if (ping.status === 200 || challenge?.scheme === "basic") {
			const res = await probe(`${endpoint}/v2/`, {
				headers: { Authorization: basic as string },
			});
			if (res.status === 200) {
				return ok("credentials", "Registry credentials verified.", secretList);
			}
			if (res.status === 401 || res.status === 403) {
				return fail("credentials", "The registry rejected the username or password.", secretList);
			}
			return fail("credentials", `Registry returned an unexpected response (HTTP ${res.status}).`, secretList);
		}

		if (challenge?.scheme === "bearer" && challenge.params.realm) {
			const realm = new URL(challenge.params.realm);
			if (challenge.params.service) {
				realm.searchParams.set("service", challenge.params.service);
			}
			const res = await probe(realm.toString(), {
				headers: { Authorization: basic as string },
			});
			if (res.status === 200) {
				return ok("credentials", "Registry credentials verified.", secretList);
			}
			if (res.status === 401 || res.status === 403) {
				return fail("credentials", "The registry rejected the username or password.", secretList);
			}
			return fail("credentials", `The registry token service returned HTTP ${res.status}.`, secretList);
		}

		return fail("credentials", "Unsupported registry authentication scheme.", secretList);
	} catch (err) {
		return fail(level, describeNetworkError(err, hostOf(endpoint)), secretList);
	}
};

const testGit = async (
	config: IntegrationConfig,
	deps: Required<Pick<ConnectivityDeps, "execFile">>,
): Promise<ConnectivityResult> => {
	const url = str(config.testRepositoryUrl);
	const methods = Array.isArray(config.allowedAuthMethods)
		? config.allowedAuthMethods
		: [];
	if (methods.length === 0) {
		return fail("configuration", "Select at least one allowed access method.", []);
	}
	if (!url) {
		return {
			status: "unverified",
			verification: "configuration",
			message:
				"Configuration is valid. Add a test repository URL to verify Git access.",
		};
	}
	try {
		await deps.execFile("git", ["ls-remote", "--heads", "--", url], {
			timeout: 15000,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GIT_ASKPASS: "echo",
				GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10",
			},
		});
		return ok("reachability", "The test repository is reachable with git.", []);
	} catch (err) {
		const e = err as { killed?: boolean; code?: string | number };
		if (e?.code === "ENOENT") {
			return fail("reachability", "Git is not installed on the server.", []);
		}
		if (e?.killed) {
			return fail("reachability", "Timed out reaching the test repository.", []);
		}
		return fail(
			"reachability",
			"Git could not read the test repository. It may be private, missing, or unreachable.",
			[],
		);
	}
};

/**
 * Runs a live connectivity test for one integration.
 * `secrets` holds decrypted values keyed by field key.
 */
export const testIntegrationConnection = async (
	id: IntegrationId,
	rawConfig: IntegrationConfig,
	secrets: Record<string, string>,
	deps: ConnectivityDeps = {},
): Promise<ConnectivityResult> => {
	const config = withDefaults(id, rawConfig);
	const probe = makeProbe(deps.fetch ?? fetch);
	const now = (deps.now ?? Date.now)();
	switch (id) {
		case "github":
			return testGithub(config, secrets, probe, now);
		case "gitlab":
			return testGitlab(config, secrets, probe);
		case "gitea":
			return testGitea(config, secrets, probe);
		case "bitbucket":
			return testBitbucket(config, secrets, probe);
		case "docker":
			return testDocker(config, secrets, probe);
		case "git":
			return testGit(config, { execFile: deps.execFile ?? defaultExecFile });
		case "drop":
			return {
				status: "unverified",
				verification: "configuration",
				message:
					"Drop uploads need no external connection. Nothing to test.",
			};
	}
};

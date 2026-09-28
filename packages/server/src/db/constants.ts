import fs from "node:fs";

export const {
	DATABASE_URL,
	POSTGRES_PASSWORD_FILE,
	POSTGRES_USER = "dokploy",
	POSTGRES_DB = "dokploy",
	POSTGRES_HOST = "dokploy-postgres",
	POSTGRES_PORT = "5432",
} = process.env;

export function readSecret(path: string): string {
	try {
		return fs.readFileSync(path, "utf8").trim();
	} catch {
		throw new Error(`Cannot read secret at ${path}`);
	}
}
const IS_BUILD_TIME =
	process.env.DOKPLOY_BUILD_TIME === "true" ||
	process.env.NEXT_PHASE === "phase-production-build";

export let dbUrl: string;
if (DATABASE_URL) {
	// Compatibilidad legacy / overrides
	dbUrl = DATABASE_URL;
} else if (POSTGRES_PASSWORD_FILE) {
	const password = readSecret(POSTGRES_PASSWORD_FILE);
	dbUrl = `postgres://${POSTGRES_USER}:${encodeURIComponent(
		password,
	)}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
} else if (IS_BUILD_TIME) {
	// Next.js page-data workers may evaluate server modules without
	// preserving NEXT_PHASE. This is strictly an image-build placeholder.
	// It must never be used by the production runtime.
	dbUrl = "postgres://build:build@127.0.0.1:5432/dokploy";
} else {
	if (process.env.NODE_ENV !== "test") {
		console.warn(`
		⚠️  [DEPRECATED DATABASE CONFIG]
		You are using the legacy hardcoded database credentials.
		This mode WILL BE REMOVED in a future release.
		
		Please migrate to Docker Secrets using POSTGRES_PASSWORD_FILE.
		Please execute this command in your server: curl -sSL https://dokploy.com/security/0.26.6.sh | bash
		`);
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"[DB CONFIG] Neither DATABASE_URL nor POSTGRES_PASSWORD_FILE is set. " +
				"In production you must provide one of these environment variables. " +
				"Set POSTGRES_PASSWORD_FILE to the path of a Docker secret containing the password, " +
				"or set DATABASE_URL to the full connection string.",
		);
	} else {
		dbUrl = "postgres://dokploy:dokploy@localhost:5432/dokploy";
	}
}

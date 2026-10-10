import { TRPCError } from "@trpc/server";

export type SupportedDatabaseType =
	| "postgres"
	| "postgresql"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "mongodb"
	| "redis"
	| "libsql";

export const DEFAULT_DATABASE_IMAGES: Record<string, string> = {
	postgres: "postgres:18",
	postgresql: "postgres:18",
	mysql: "mysql:8",
	mariadb: "mariadb:11",
	mongo: "mongo:8",
	mongodb: "mongo:8",
	redis: "redis:7",
	libsql: "ghcr.io/tursodatabase/libsql-server:latest",
};

/**
 * Known legacy invalid default images created by older schema defaults or frontend templates
 * that fail on Docker Hub / registries. Maps them safely to the canonical supported version.
 */
export const LEGACY_INVALID_IMAGE_REPLACEMENTS: Record<string, string> = {
	"mariadb:6": "mariadb:11",
	"mariadb:4": "mariadb:11",
	"mongo:15": "mongo:8",
};

/**
 * Standard default ports per database engine
 */
export const DEFAULT_DATABASE_PORTS: Record<string, number> = {
	postgres: 5432,
	postgresql: 5432,
	mysql: 3306,
	mariadb: 3306,
	mongo: 27017,
	mongodb: 27017,
	redis: 6379,
	libsql: 8080,
};

/**
 * Regex validating Docker image reference format:
 * [registry/][namespace/]repository[:tag][@digest]
 * e.g. "postgres:18", "ghcr.io/tursodatabase/libsql-server:latest", "localhost:5000/my-db:1.0"
 */
const DOCKER_IMAGE_REGEX =
	/^(?:(?=[^:/]{1,253})(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*(?::[0-9]{1,5})?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127})?(?:@[a-zA-Z0-9]+:[a-fA-F0-9]{32,})?$/i;

/**
 * Validates whether a given string is a valid Docker image reference.
 */
export function isValidDockerImage(image: string): boolean {
	if (!image || typeof image !== "string") return false;
	const trimmed = image.trim();
	if (trimmed.length === 0 || trimmed.length > 255) return false;
	// Disallow whitespace, quotes, and dangerous injection chars
	if (/[\s"'`$;|&><]/.test(trimmed)) return false;
	return DOCKER_IMAGE_REGEX.test(trimmed);
}

/**
 * Validates a database image string and throws a descriptive TRPCError if invalid.
 */
export function validateDatabaseImage(image: string): void {
	if (!isValidDockerImage(image)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid Docker image reference "${image}". Expected format: "[registry/][namespace/]repository[:tag]" without spaces or special characters.`,
		});
	}
}

/**
 * Centralized resolution contract for database Docker images across all 6 engines.
 *
 * Rules:
 * 1. If requestedImage is missing, null, undefined, or empty/whitespace, returns the canonical engine default.
 * 2. If requestedImage matches known non-existent legacy defaults (mariadb:6, mariadb:4, mongo:15),
 *    maps safely to the supported default to repair existing database deployments.
 * 3. If requestedImage is just the bare engine name (e.g. "postgres"), returns the canonical engine default.
 * 4. If requestedImage is a pure numeric tag/version (e.g. "16"), resolves to "${engine}:${tag}".
 * 5. Rejects arbitrary resource/service identifiers that lack tags, namespaces, or registries.
 * 6. Preserves explicit tags, custom namespaces, and private registries (e.g., ghcr.io, bitnami/...).
 * 7. Validates format against Docker image reference rules and rejects dangerous/malformed strings.
 */
export function resolveDatabaseImage(
	engineType: string,
	requestedImage?: string | null,
): string {
	const normalizedEngine = (engineType || "").toLowerCase().trim();
	const defaultImage = DEFAULT_DATABASE_IMAGES[normalizedEngine];

	if (!defaultImage) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported database engine type "${engineType}". Supported engines: postgres, mysql, mariadb, mongo, redis, libsql.`,
		});
	}

	if (!requestedImage || typeof requestedImage !== "string") {
		return defaultImage;
	}

	const trimmed = requestedImage.trim();
	if (trimmed === "") {
		return defaultImage;
	}

	// Safe backwards-compatible migration for known invalid legacy defaults in existing customer records
	if (LEGACY_INVALID_IMAGE_REPLACEMENTS[trimmed]) {
		return LEGACY_INVALID_IMAGE_REPLACEMENTS[trimmed];
	}

	// If the bare engine name is supplied without tag (e.g. "postgres" or "mariadb")
	if (
		trimmed.toLowerCase() === normalizedEngine ||
		(normalizedEngine === "postgres" &&
			trimmed.toLowerCase() === "postgresql") ||
		(normalizedEngine === "mongo" && trimmed.toLowerCase() === "mongodb")
	) {
		return defaultImage;
	}

	// Reject dangerous characters, whitespace, or injection attempts immediately
	if (/[\s"'`$;|&><]/.test(trimmed)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid Docker image reference "${trimmed}". Docker image reference cannot contain spaces or special characters.`,
		});
	}

	// If the user provided a pure version/tag (e.g. "16" or ":16") for standard engine
	if (/^:?\d+(\.\d+)*$/.test(trimmed)) {
		const tag = trimmed.startsWith(":") ? trimmed.slice(1) : trimmed;
		const baseRepo =
			normalizedEngine === "postgresql"
				? "postgres"
				: normalizedEngine === "mongodb"
					? "mongo"
					: normalizedEngine;
		if (baseRepo !== "libsql") {
			const resolved = `${baseRepo}:${tag}`;
			validateDatabaseImage(resolved);
			return resolved;
		}
	}

	// If requestedImage is an arbitrary resource identifier or database name without tags (:),
	// namespaces/registries (/), or digests (@), it cannot be pulled from a registry as a database image.
	// In production, customer databases may have legacy database names or app identifiers stored
	// in this column (e.g. "butaxdb", "my-customer-db").
	// To safely protect and self-heal existing customer databases across restarts, updates,
	// and redeployments, map arbitrary untagged resource identifiers to the canonical engine default.
	if (
		!trimmed.includes(":") &&
		!trimmed.includes("/") &&
		!trimmed.includes("@")
	) {
		return defaultImage;
	}

	validateDatabaseImage(trimmed);
	return trimmed;
}

/**
 * Resolves the persistent volume data mount path for any supported database engine and version.
 */
export function getDatabaseMountPath(
	engineType: string,
	dockerImage?: string | null,
): string {
	const normalizedEngine = (engineType || "").toLowerCase().trim();
	const image = resolveDatabaseImage(normalizedEngine, dockerImage);

	switch (normalizedEngine) {
		case "postgres":
		case "postgresql": {
			const versionMatch =
				image.match(/postgres(?:ql)?:(\d+)/) || image.match(/:(\d+)/);
			if (versionMatch?.[1]) {
				const version = Number.parseInt(versionMatch[1], 10);
				if (version >= 18) {
					return `/var/lib/postgresql/${version}/docker`;
				}
			}
			return "/var/lib/postgresql/data";
		}
		case "mysql":
		case "mariadb":
			return "/var/lib/mysql";
		case "mongo":
		case "mongodb":
			return "/data/db";
		case "redis":
			return "/data";
		case "libsql":
			return "/var/lib/sqld";
		default:
			return "/data";
	}
}

import { TRPCError } from "@trpc/server";

export const PUBLIC_DATABASE_ACCESS_DISABLED_MESSAGE =
	"External / public database connectivity is currently being prepared for general release and is temporarily unavailable for customer self-service. Applications deployed inside HatDot can continue using supported internal database connectivity.";

export const DATABASE_MANAGEMENT_DISABLED_MESSAGE =
	"Database management is currently undergoing scheduled platform upgrades and is temporarily unavailable for customer self-service. Managed database self-service is coming soon.";

/**
 * Checks whether external/public database connectivity is enabled for the user.
 * Restricted to platform administrators by default while the feature is in preparation.
 */
export function isPublicDatabaseAccessEnabled(user?: {
	isPlatformAdmin?: boolean;
	role?: string;
} | null): boolean {
	if (
		process.env.ENABLE_PUBLIC_DATABASE_ACCESS === "true" ||
		process.env.ENABLE_PUBLIC_DATABASE_CONNECTIVITY === "true"
	) {
		return true;
	}
	return user?.isPlatformAdmin === true;
}

/**
 * Enforces server-side denial for external / public database connectivity.
 */
export function assertPublicDatabaseAccess(user?: {
	isPlatformAdmin?: boolean;
	role?: string;
} | null): void {
	if (!isPublicDatabaseAccessEnabled(user)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: PUBLIC_DATABASE_ACCESS_DISABLED_MESSAGE,
		});
	}
}

/**
 * Checks whether customer database management is enabled.
 * Internal database browsing, querying, and import operations are enabled for customers.
 */
export function isDatabaseManagementEnabledForUser(user?: {
	isPlatformAdmin?: boolean;
	role?: string;
} | null): boolean {
	if (process.env.DISABLE_DATABASE_MANAGEMENT === "true") {
		return user?.isPlatformAdmin === true;
	}
	return true;
}

export function assertDatabaseManagementAccess(user?: {
	isPlatformAdmin?: boolean;
	role?: string;
} | null): void {
	if (!isDatabaseManagementEnabledForUser(user)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: DATABASE_MANAGEMENT_DISABLED_MESSAGE,
		});
	}
}

/**
 * Sanitizes database connection details for customer responses when public database access is disabled.
 * Hides external hostnames, DNS names, external ports, public credentials, and external connection strings.
 */
export function sanitizeConnectionDetailsForCustomer(
	details: any,
	user?: { isPlatformAdmin?: boolean; role?: string } | null,
): any {
	if (isPublicDatabaseAccessEnabled(user)) {
		return details;
	}
	return {
		...details,
		external: {
			...details?.external,
			host: null,
			port: null,
			user: null,
			password: null,
			url: null,
			command: null,
			isEnabled: false,
			hasPublicHost: false,
			isDomain: false,
			platformDomain: null,
			serverIp: null,
			isComingSoon: true,
		},
		endpointStatus: {
			isConfigured: false,
			isValidPublicEndpoint: false,
			publicHost: null,
			publicPort: null,
			guidance:
				"External / public database connectivity is coming soon. Applications inside HatDot can continue using internal database connectivity.",
		},
	};
}

/**
 * Sanitizes a single database record for customer responses when public database access is disabled.
 * Nulls out publicHost, publicHostInfo, and externalPort.
 */
export function sanitizeDatabaseRecordForCustomer<
	T extends { externalPort?: number | null; publicHost?: string | null; publicHostInfo?: any },
>(
	record: T,
	user?: { isPlatformAdmin?: boolean; role?: string } | null,
): T {
	if (isPublicDatabaseAccessEnabled(user)) {
		return record;
	}
	return {
		...record,
		externalPort: null,
		publicHost: null,
		publicHostInfo: null,
	};
}


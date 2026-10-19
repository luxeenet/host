import { TRPCError } from "@trpc/server";

export const DATABASE_MANAGEMENT_DISABLED_MESSAGE =
	"Database management is currently undergoing scheduled platform upgrades and is temporarily unavailable for customer self-service. Managed database self-service is coming soon.";

export function isDatabaseManagementEnabledForUser(user?: {
	isPlatformAdmin?: boolean;
	role?: string;
} | null): boolean {
	// If explicitly enabled via environment variable for all customers
	if (process.env.ENABLE_PUBLIC_DATABASE_MANAGEMENT === "true") {
		return true;
	}
	// Platform administrators retain administrative operations access
	if (user?.isPlatformAdmin === true) {
		return true;
	}
	return false;
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

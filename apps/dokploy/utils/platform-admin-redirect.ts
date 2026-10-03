/**
 * Pure decision helper (no heavy imports; unit-testable): maps an
 * authenticated user to a redirect for platform-only pages, or null if allowed.
 * Org owner/admin roles never grant access — only isPlatformAdmin === true.
 */
export function resolvePlatformAdminRedirect(
	user: { isPlatformAdmin?: boolean | null } | null | undefined,
): { permanent: false; destination: string } | null {
	if (!user) {
		return { permanent: false, destination: "/" };
	}
	if (user.isPlatformAdmin !== true) {
		return { permanent: false, destination: "/dashboard/home" };
	}
	return null;
}

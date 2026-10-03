import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { resolvePlatformAdminRedirect } from "./platform-admin-redirect";

export { resolvePlatformAdminRedirect };

/**
 * Server-side guard helper for Next.js getServerSideProps.
 * Redirects unauthenticated users to `/` and non-platform-admin users to `/dashboard/home`.
 * Returns null if the caller is authorized as a platform administrator.
 */
export async function requirePlatformAdminPage(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	const redirect = resolvePlatformAdminRedirect(user as any);
	return redirect ? { redirect } : null;
}

/**
 * Same guard, but returns the validated `{ user, session }` on success so the
 * page can build tRPC server-side helpers. On failure returns `{ redirect }`.
 */
export async function requirePlatformAdminSession(
	ctx: GetServerSidePropsContext,
) {
	const { user, session } = await validateRequest(ctx.req);
	const redirect = resolvePlatformAdminRedirect(user as any);
	if (redirect || !user || !session) {
		return {
			redirect: redirect ?? { permanent: false as const, destination: "/" },
		};
	}
	return { user, session };
}

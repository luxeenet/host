import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { IS_CLOUD } from "@dokploy/server/constants";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
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

/**
 * Guard for AI features page. Allows platform admins or cloud users whose plan
 * includes AI (or self-hosted authenticated users).
 */
export async function requireAiFeatureSession(
	ctx: GetServerSidePropsContext,
) {
	const { user, session } = await validateRequest(ctx.req);
	if (!user || !session) {
		return {
			redirect: { permanent: false as const, destination: "/" },
		};
	}
	if ((user as any)?.isPlatformAdmin) {
		return { user, session };
	}
	if (IS_CLOUD) {
		const orgId = session.activeOrganizationId;
		if (!orgId) {
			return {
				redirect: { permanent: false as const, destination: "/dashboard/home" },
			};
		}
		const aiCheck = await PlanEntitlementService.checkCanUseAi(orgId);
		if (!aiCheck.allowed) {
			return {
				redirect: { permanent: false as const, destination: "/dashboard/home" },
			};
		}
	}
	return { user, session };
}

/**
 * Server-side guard helper for standard authenticated customer pages.
 * Redirects unauthenticated users to `/`.
 * Returns `{ user, session }` for authenticated users.
 */
export async function requireAuthSession(ctx: GetServerSidePropsContext) {
	const { user, session } = await validateRequest(ctx.req);
	if (!user || !session) {
		return {
			redirect: { permanent: false as const, destination: "/" },
		};
	}
	return { user, session };
}

/**
 * Server-side guard helper for standard authenticated pages (without server-side session prefetch).
 * Redirects unauthenticated users to `/`.
 * Returns null if the caller is authenticated.
 */
export async function requireAuthPage(ctx: GetServerSidePropsContext) {
	const { user, session } = await validateRequest(ctx.req);
	if (!user || !session) {
		return {
			redirect: { permanent: false as const, destination: "/" },
		};
	}
	return null;
}

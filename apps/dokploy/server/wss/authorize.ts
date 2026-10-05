import { getAccessibleServerIds, IS_CLOUD } from "@dokploy/server";
import {
	checkServiceAccess,
	findMemberByUserId,
	hasPermission,
} from "@dokploy/server/services/permission";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";

type WssUser =
	| { id: string; isPlatformAdmin?: boolean | null }
	| null
	| undefined;
type WssSession = { activeOrganizationId?: string | null } | null | undefined;

const buildCtx = (user: { id: string }, activeOrganizationId: string) => ({
	user: { id: user.id },
	session: { activeOrganizationId },
});

// Authorizes docker/container operations opened over a WebSocket (container
// terminal, container logs, container stats).
export const canAccessDockerOverWss = async (
	user: WssUser,
	session: WssSession,
	serverId?: string | null,
	serviceId?: string | null,
): Promise<boolean> => {
	if (!user || !session?.activeOrganizationId) return false;

	const ctx = buildCtx(user, session.activeOrganizationId);

	// Case 1: Customer application/database/compose container (scoped by serviceId)
	if (serviceId) {
		try {
			// Verify service belongs to active organization and caller has read access
			await checkServiceAccess(ctx, serviceId, "read");

			// In cloud, verify organization plan entitles container terminal / docker access
			if (IS_CLOUD && !user.isPlatformAdmin) {
				const termCheck = await PlanEntitlementService.checkCanUseTerminal(
					session.activeOrganizationId,
				);
				if (!termCheck.allowed) {
					return false;
				}
			}

			if (serverId && serverId !== "local") {
				const accessible = await getAccessibleServerIds({
					userId: user.id,
					activeOrganizationId: session.activeOrganizationId,
				});
				if (!accessible.has(serverId)) return false;
			}

			return true;
		} catch {
			return false;
		}
	}

	// Case 2: Generic Docker overview (no service context)
	// In cloud, generic host Docker daemon inspection is platform-admin only.
	if (IS_CLOUD && (!serverId || serverId === "local") && !user.isPlatformAdmin) {
		return false;
	}

	if (!(await hasPermission(ctx, { docker: ["read"] }))) return false;

	if (serverId && serverId !== "local") {
		const accessible = await getAccessibleServerIds({
			userId: user.id,
			activeOrganizationId: session.activeOrganizationId,
		});
		if (!accessible.has(serverId)) return false;
	}

	return true;
};

// Authorizes the host/server SSH terminal opened over a WebSocket (/terminal).
// The local host terminal (serverId === "local" or null) is a root shell on the control-plane host,
// so in Cloud it is strictly restricted to isPlatformAdmin === true.
// In self-hosted, it requires owner/admin (or isPlatformAdmin).
// A remote server terminal (serverId !== "local") needs server access + server: ["terminal"] permission,
// and in cloud requires plan terminal entitlement.
export const canAccessTerminalOverWss = async (
	user: WssUser,
	session: WssSession,
	serverId?: string | null,
): Promise<boolean> => {
	if (!user || !session?.activeOrganizationId) return false;

	if (serverId && serverId !== "local") {
		const accessible = await getAccessibleServerIds({
			userId: user.id,
			activeOrganizationId: session.activeOrganizationId,
		});
		if (!accessible.has(serverId)) return false;

		if (IS_CLOUD && !user.isPlatformAdmin) {
			const termCheck = await PlanEntitlementService.checkCanUseTerminal(
				session.activeOrganizationId,
			);
			if (!termCheck.allowed) return false;
		}

		return await hasPermission(buildCtx(user, session.activeOrganizationId), {
			server: ["terminal"],
		});
	}

	if (IS_CLOUD) {
		return !!user.isPlatformAdmin;
	}

	try {
		const member = await findMemberByUserId(
			user.id,
			session.activeOrganizationId,
		);
		return member?.role === "owner" || member?.role === "admin" || !!user.isPlatformAdmin;
	} catch {
		return false;
	}
};

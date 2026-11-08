import type { AuditAction, AuditResourceType } from "@dokploy/server/db/schema";
import { createAuditLog } from "@dokploy/server/services/proprietary/audit-log";

export interface AuditCtx {
	user: { id: string; email: string; role?: string | null };
	session?: { activeOrganizationId?: string | null } | null;
}

export interface AuditEvent {
	action: AuditAction;
	resourceType: AuditResourceType;
	resourceId?: string;
	resourceName?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Creates an audit log entry from a tRPC context.
 * Extracts userId, userEmail, userRole and organizationId automatically.
 *
 * Usage:
 *   await audit(ctx, { action: "create", resourceType: "project", resourceName: "my-app" });
 */
export const audit = (ctx: AuditCtx, event: AuditEvent) => {
	const organizationId = ctx?.session?.activeOrganizationId;
	if (!organizationId) {
		return Promise.resolve();
	}

	return createAuditLog({
		organizationId,
		userId: ctx.user.id,
		userEmail: ctx.user.email,
		userRole: ctx.user.role || "member",
		...event,
	});
};

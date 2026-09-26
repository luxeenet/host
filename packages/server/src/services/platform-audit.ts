/**
 * Platform Audit Log Service — Apache 2.0
 *
 * Our own independent implementation of audit logging.
 * Writes to paas_audit_log table.
 *
 * This intentionally does NOT import or derive from /proprietary/audit-log.
 */
import { nanoid } from "nanoid";
import { db } from "../db";
import { platformAuditLogs } from "../db/schema/platform-audit";
import type { CreateAuditLogInput } from "../db/schema/platform-audit";

export { type CreateAuditLogInput };

/**
 * Write a platform audit log entry.
 * Never throws — audit logging failures must not break the main request.
 */
export async function createPlatformAuditLog(
	input: CreateAuditLogInput,
): Promise<void> {
	try {
		await db.insert(platformAuditLogs).values({
			id: nanoid(),
			organizationId: input.organizationId ?? null,
			userId: input.userId ?? null,
			userEmail: input.userEmail ?? null,
			action: input.action,
			resourceType: input.resourceType,
			resourceId: input.resourceId ?? null,
			summary: input.summary ?? null,
			metadata: input.metadata ?? null,
			ipAddress: input.ipAddress ?? null,
			userAgent: input.userAgent ?? null,
		});
	} catch (err) {
		// Audit failures must never crash the caller
		console.error("[platform-audit] Failed to write audit log:", err);
	}
}

/**
 * Convenience alias — same signature as the proprietary createAuditLog
 * so existing callers can drop in this replacement.
 */
export const createAuditLog = createPlatformAuditLog;

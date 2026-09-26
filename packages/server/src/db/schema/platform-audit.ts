/**
 * Platform audit log schema — our own Apache 2.0 implementation.
 *
 * NOTE: This is NOT derived from or dependent on the /proprietary audit-log.
 * This is an independent implementation.
 */
import { relations } from "drizzle-orm";
import {
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { user } from "./user";

export const platformAuditLogs = pgTable("paas_audit_log", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id").references(() => organization.id, {
		onDelete: "set null",
	}),
	userId: text("user_id").references(() => user.id, {
		onDelete: "set null",
	}),
	userEmail: text("user_email"),
	/** Action verb: "created", "deleted", "deployed", "subscribed", "cancelled", etc. */
	action: text("action").notNull(),
	/** Resource type: "application", "subscription", "payment", "ticket", etc. */
	resourceType: text("resource_type").notNull(),
	/** Resource ID */
	resourceId: text("resource_id"),
	/** Human-readable summary of what happened */
	summary: text("summary"),
	/** Structured context data (diff, before/after) */
	metadata: jsonb("metadata"),
	/** IP address of the request */
	ipAddress: text("ip_address"),
	/** User agent of the request */
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const platformAuditLogsRelations = relations(
	platformAuditLogs,
	({ one }) => ({
		organization: one(organization, {
			fields: [platformAuditLogs.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [platformAuditLogs.userId],
			references: [user.id],
		}),
	}),
);

export const apiListAuditLogs = z.object({
	organizationId: z.string().optional(),
	resourceType: z.string().optional(),
	action: z.string().optional(),
	limit: z.number().int().min(1).max(200).default(50),
	offset: z.number().int().min(0).default(0),
});

export interface CreateAuditLogInput {
	organizationId?: string | null;
	userId?: string | null;
	userEmail?: string | null;
	action: string;
	resourceType: string;
	resourceId?: string | null;
	summary?: string | null;
	metadata?: Record<string, unknown> | null;
	ipAddress?: string | null;
	userAgent?: string | null;
}

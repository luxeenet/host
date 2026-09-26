/**
 * Support ticket schema.
 */
import { relations } from "drizzle-orm";
import {
	boolean,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { user } from "./user";

export const ticketStatus = pgEnum("ticketStatus", [
	"open",
	"pending_customer",
	"pending_staff",
	"resolved",
	"closed",
]);

export const ticketPriority = pgEnum("ticketPriority", [
	"low",
	"normal",
	"high",
	"urgent",
]);

export const ticketCategory = pgEnum("ticketCategory", [
	"billing",
	"deployment",
	"domain",
	"database",
	"performance",
	"security",
	"account",
	"other",
]);

export const supportTickets = pgTable("paas_support_ticket", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	createdByUserId: text("created_by_user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	subject: text("subject").notNull(),
	category: ticketCategory("category").notNull().default("other"),
	priority: ticketPriority("priority").notNull().default("normal"),
	status: ticketStatus("status").notNull().default("open"),
	/** Reference to an application or project (optional) */
	resourceRef: text("resource_ref"),
	resolvedAt: timestamp("resolved_at"),
	closedAt: timestamp("closed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const supportMessages = pgTable("paas_support_message", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	ticketId: text("ticket_id")
		.notNull()
		.references(() => supportTickets.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	/** true = staff reply, false = customer reply */
	isStaff: boolean("is_staff").notNull().default(false),
	body: text("body").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportTicketsRelations = relations(
	supportTickets,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [supportTickets.organizationId],
			references: [organization.id],
		}),
		createdBy: one(user, {
			fields: [supportTickets.createdByUserId],
			references: [user.id],
		}),
		messages: many(supportMessages),
	}),
);

export const supportMessagesRelations = relations(
	supportMessages,
	({ one }) => ({
		ticket: one(supportTickets, {
			fields: [supportMessages.ticketId],
			references: [supportTickets.id],
		}),
		author: one(user, {
			fields: [supportMessages.userId],
			references: [user.id],
		}),
	}),
);

export const apiCreateTicket = z.object({
	subject: z.string().min(1).max(200),
	category: z.enum(["billing", "deployment", "domain", "database", "performance", "security", "account", "other"]),
	priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
	body: z.string().min(10).max(10000),
	resourceRef: z.string().optional(),
});

export const apiAddTicketMessage = z.object({
	ticketId: z.string().min(1),
	body: z.string().min(1).max(10000),
});

export const apiUpdateTicketStatus = z.object({
	ticketId: z.string().min(1),
	status: z.enum(["open", "pending_customer", "pending_staff", "resolved", "closed"]),
});

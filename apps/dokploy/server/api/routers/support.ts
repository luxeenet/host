/**
 * Support tickets router — customer + staff ticket management.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../../db";
import * as schema from "@dokploy/server/db/schema";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "../trpc";

export const supportRouter = createTRPCRouter({
	// ─── Customer ─────────────────────────────────────────────

	/** List tickets for the authenticated org */
	list: protectedProcedure
		.input(
			z.object({
				status: z.string().optional(),
				limit: z.number().int().min(1).max(50).default(20),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			return db.query.supportTickets.findMany({
				where: and(
					eq(schema.supportTickets.organizationId, orgId),
					input.status
						? eq(schema.supportTickets.status, input.status as any)
						: undefined,
				),
				with: { messages: true },
				orderBy: [desc(schema.supportTickets.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});
		}),

	/** Get a single ticket (must belong to org) */
	get: protectedProcedure
		.input(z.object({ ticketId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			const ticket = await db.query.supportTickets.findFirst({
				where: and(
					eq(schema.supportTickets.id, input.ticketId),
					eq(schema.supportTickets.organizationId, orgId),
				),
				with: { messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] } },
			});
			if (!ticket) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Ticket not found.",
				});
			}
			return ticket;
		}),

	/** Create a new support ticket */
	create: protectedProcedure
		.input(schema.apiCreateTicket)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			const userId = ctx.user.id;

			return db.transaction(async (tx) => {
				const ticketId = nanoid();
				const [ticket] = await tx
					.insert(schema.supportTickets)
					.values({
						id: ticketId,
						organizationId: orgId,
						createdByUserId: userId,
						subject: input.subject,
						category: input.category,
						priority: input.priority ?? "normal",
						resourceRef: input.resourceRef ?? null,
					})
					.returning();

				await tx.insert(schema.supportMessages).values({
					id: nanoid(),
					ticketId,
					userId,
					isStaff: false,
					body: input.body,
				});

				return ticket;
			});
		}),

	/** Add a reply to a ticket */
	addMessage: protectedProcedure
		.input(schema.apiAddTicketMessage)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			const ticket = await db.query.supportTickets.findFirst({
				where: and(
					eq(schema.supportTickets.id, input.ticketId),
					eq(schema.supportTickets.organizationId, orgId),
				),
			});
			if (!ticket) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found." });
			}
			if (ticket.status === "closed") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cannot reply to a closed ticket.",
				});
			}

			const [msg] = await db
				.insert(schema.supportMessages)
				.values({
					id: nanoid(),
					ticketId: input.ticketId,
					userId: ctx.user.id,
					isStaff: false,
					body: input.body,
				})
				.returning();

			// Reopen ticket if customer replies to pending_staff
			if (ticket.status === "pending_customer" || ticket.status === "resolved") {
				await db
					.update(schema.supportTickets)
					.set({ status: "open", updatedAt: new Date() })
					.where(eq(schema.supportTickets.id, input.ticketId));
			}

			return msg;
		}),

	// ─── Admin ────────────────────────────────────────────────

	/** Admin: list all tickets */
	adminList: adminProcedure
		.input(
			z.object({
				status: z.string().optional(),
				priority: z.string().optional(),
				limit: z.number().int().min(1).max(100).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ input }) => {
			return db.query.supportTickets.findMany({
				where: and(
					input.status
						? eq(schema.supportTickets.status, input.status as any)
						: undefined,
					input.priority
						? eq(schema.supportTickets.priority, input.priority as any)
						: undefined,
				),
				with: {
					organization: true,
					createdBy: true,
					messages: {
						orderBy: (m, { desc }) => [desc(m.createdAt)],
						limit: 1,
					},
				},
				orderBy: [desc(schema.supportTickets.updatedAt)],
				limit: input.limit,
				offset: input.offset,
			});
		}),

	/** Admin: get a single ticket */
	adminGet: adminProcedure
		.input(z.object({ ticketId: z.string().min(1) }))
		.query(async ({ input }) => {
			const ticket = await db.query.supportTickets.findFirst({
				where: eq(schema.supportTickets.id, input.ticketId),
				with: {
					organization: true,
					createdBy: true,
					messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] },
				},
			});
			if (!ticket) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found." });
			}
			return ticket;
		}),

	/** Admin: reply to a ticket as staff */
	adminReply: adminProcedure
		.input(schema.apiAddTicketMessage)
		.mutation(async ({ ctx, input }) => {
			const ticket = await db.query.supportTickets.findFirst({
				where: eq(schema.supportTickets.id, input.ticketId),
			});
			if (!ticket) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found." });
			}

			const [msg] = await db
				.insert(schema.supportMessages)
				.values({
					id: nanoid(),
					ticketId: input.ticketId,
					userId: ctx.user.id,
					isStaff: true,
					body: input.body,
				})
				.returning();

			await db
				.update(schema.supportTickets)
				.set({ status: "pending_customer", updatedAt: new Date() })
				.where(eq(schema.supportTickets.id, input.ticketId));

			return msg;
		}),

	/** Admin: update ticket status */
	adminUpdateStatus: adminProcedure
		.input(schema.apiUpdateTicketStatus)
		.mutation(async ({ input }) => {
			const [updated] = await db
				.update(schema.supportTickets)
				.set({
					status: input.status,
					resolvedAt:
						input.status === "resolved" ? new Date() : undefined,
					closedAt:
						input.status === "closed" ? new Date() : undefined,
					updatedAt: new Date(),
				})
				.where(eq(schema.supportTickets.id, input.ticketId))
				.returning();

			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found." });
			}
			return updated;
		}),
});

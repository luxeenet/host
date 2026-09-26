/**
 * Subscriptions router — customer subscription management.
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
import { seedPlans } from "@dokploy/server/services/plan-seed";

// Helper: generate invoice number
const generateInvoiceNumber = async (): Promise<string> => {
	const year = new Date().getFullYear();
	const count = await db.$count(schema.invoices);
	const seq = String(count + 1).padStart(5, "0");
	return `INV-${year}-${seq}`;
};

// Helper: compute next period end from a plan's billing cycle
const getNextPeriodEnd = (billingCycle: "monthly" | "yearly"): Date => {
	const d = new Date();
	if (billingCycle === "yearly") {
		d.setFullYear(d.getFullYear() + 1);
	} else {
		d.setMonth(d.getMonth() + 1);
	}
	return d;
};

export const subscriptionRouter = createTRPCRouter({
	// ─── Customer ─────────────────────────────────────────────

	/** Get the current subscription for the authenticated org */
	getCurrent: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		return db.query.subscriptions.findFirst({
			where: eq(schema.subscriptions.organizationId, orgId),
			with: {
				plan: {
					with: {
						resources: true,
						features: true,
						applicationTypes: true,
					},
				},
			},
			orderBy: [desc(schema.subscriptions.createdAt)],
		});
	}),

	/** Subscribe to a plan (creates subscription + first invoice) */
	create: protectedProcedure
		.input(z.object({ planId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;

			// Check if already subscribed
			const existing = await db.query.subscriptions.findFirst({
				where: and(
					eq(schema.subscriptions.organizationId, orgId),
					eq(schema.subscriptions.status, "active"),
				),
			});
			if (existing) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Organization already has an active subscription.",
				});
			}

			const plan = await db.query.plans.findFirst({
				where: eq(schema.plans.id, input.planId),
			});
			if (!plan || plan.status !== "active") {
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
			}

			const now = new Date();
			const trialEndsAt =
				plan.trialDays > 0
					? new Date(now.getTime() + plan.trialDays * 86400000)
					: null;
			const periodEnd = trialEndsAt ?? getNextPeriodEnd(plan.billingCycle);

			return db.transaction(async (tx) => {
				const subId = nanoid();
				const [sub] = await tx
					.insert(schema.subscriptions)
					.values({
						id: subId,
						organizationId: orgId,
						planId: plan.id,
						status: trialEndsAt ? "trial" : "pending_payment",
						currentPeriodStart: now,
						currentPeriodEnd: periodEnd,
						trialEndsAt,
					})
					.returning();

				// Create first invoice (only if not free trial)
				if (Number(plan.price) > 0) {
					const invoiceNumber = await generateInvoiceNumber();
					await tx.insert(schema.invoices).values({
						id: nanoid(),
						subscriptionId: subId,
						organizationId: orgId,
						invoiceNumber,
						amount: plan.price,
						currency: plan.currency,
						status: trialEndsAt ? "draft" : "open",
						dueDate: trialEndsAt ?? new Date(now.getTime() + 7 * 86400000),
						periodStart: now,
						periodEnd: periodEnd,
					});
				}

				return sub;
			});
		}),

	/** Cancel subscription at period end */
	cancel: protectedProcedure.mutation(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		const sub = await db.query.subscriptions.findFirst({
			where: and(
				eq(schema.subscriptions.organizationId, orgId),
				eq(schema.subscriptions.status, "active"),
			),
		});
		if (!sub) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "No active subscription found.",
			});
		}

		const [updated] = await db
			.update(schema.subscriptions)
			.set({ cancelledAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.subscriptions.id, sub.id))
			.returning();

		return updated;
	}),

	/** Upgrade plan */
	upgrade: protectedProcedure
		.input(z.object({ planId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;

			const plan = await db.query.plans.findFirst({
				where: eq(schema.plans.id, input.planId),
			});
			if (!plan || plan.status !== "active") {
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
			}

			const sub = await db.query.subscriptions.findFirst({
				where: eq(schema.subscriptions.organizationId, orgId),
				orderBy: [desc(schema.subscriptions.createdAt)],
			});

			if (!sub) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No subscription to upgrade.",
				});
			}

			const [updated] = await db
				.update(schema.subscriptions)
				.set({ planId: input.planId, updatedAt: new Date() })
				.where(eq(schema.subscriptions.id, sub.id))
				.returning();

			return updated;
		}),

	// ─── Admin ────────────────────────────────────────────────

	/** Admin: list all subscriptions */
	adminList: adminProcedure
		.input(
			z.object({
				limit: z.number().int().min(1).max(100).default(50),
				offset: z.number().int().min(0).default(0),
				status: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			return db.query.subscriptions.findMany({
				where: input.status
					? eq(schema.subscriptions.status, input.status as any)
					: undefined,
				with: {
					plan: true,
					organization: true,
				},
				orderBy: [desc(schema.subscriptions.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});
		}),

	/** Admin: manually override subscription status */
	adminOverride: adminProcedure
		.input(
			z.object({
				subscriptionId: z.string().min(1),
				status: z.enum([
					"trial",
					"active",
					"past_due",
					"grace_period",
					"suspended",
					"cancelled",
					"expired",
				]),
				reason: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const [updated] = await db
				.update(schema.subscriptions)
				.set({ status: input.status, updatedAt: new Date() })
				.where(eq(schema.subscriptions.id, input.subscriptionId))
				.returning();

			if (!updated) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Subscription not found.",
				});
			}

			return updated;
		}),

	/** Admin: seed default plans (idempotent) */
	seedPlans: adminProcedure.mutation(async () => {
		await seedPlans();
		return { success: true };
	}),
});

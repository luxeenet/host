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
import { SonicPesaService } from "@dokploy/server/services/sonicpesa";

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

	/** Get all available active plans */
	getPlans: protectedProcedure.query(async () => {
		return db.query.plans.findMany({
			where: eq(schema.plans.status, "active"),
			with: {
				resources: true,
				features: true,
				applicationTypes: true,
			},
			orderBy: [schema.plans.sortOrder],
		});
	}),

	/** Get invoices and payment history for the organization */
	getInvoices: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		return db.query.invoices.findMany({
			where: eq(schema.invoices.organizationId, orgId),
			with: {
				payments: true,
				subscription: {
					with: { plan: true },
				},
			},
			orderBy: [desc(schema.invoices.createdAt)],
		});
	}),

	/** Initiate a live SonicPesa Push USSD payment */
	initiateSonicPesaPayment: protectedProcedure
		.input(
			z.object({
				planId: z.string().min(1),
				phone: z.string().min(8),
				buyerName: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;

			const plan = await db.query.plans.findFirst({
				where: eq(schema.plans.id, input.planId),
			});
			if (!plan || plan.status !== "active") {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Plan not found or inactive.",
				});
			}

			const amountNum = Number(plan.price);
			if (amountNum <= 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"This plan is free. You can subscribe directly without payment.",
				});
			}

			// Get or create subscription
			let sub = await db.query.subscriptions.findFirst({
				where: eq(schema.subscriptions.organizationId, orgId),
				orderBy: [desc(schema.subscriptions.createdAt)],
			});

			const now = new Date();
			const periodEnd = getNextPeriodEnd(plan.billingCycle);

			if (!sub) {
				const [newSub] = await db
					.insert(schema.subscriptions)
					.values({
						id: nanoid(),
						organizationId: orgId,
						planId: plan.id,
						status: "pending_payment",
						currentPeriodStart: now,
						currentPeriodEnd: periodEnd,
					})
					.returning();
				sub = newSub;
			} else {
				// Update plan on current sub
				await db
					.update(schema.subscriptions)
					.set({ planId: plan.id, updatedAt: now })
					.where(eq(schema.subscriptions.id, sub.id));
			}

			if (!sub) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to initialize subscription record.",
				});
			}

			// Create or find open invoice
			const invoiceNumber = await generateInvoiceNumber();
			const [invoice] = await db
				.insert(schema.invoices)
				.values({
					id: nanoid(),
					subscriptionId: sub.id,
					organizationId: orgId,
					invoiceNumber,
					amount: plan.price,
					currency: plan.currency || "TZS",
					status: "open",
					dueDate: new Date(now.getTime() + 7 * 86400000),
					periodStart: now,
					periodEnd,
				})
				.returning();

			if (!invoice) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create invoice for payment.",
				});
			}

			// Call SonicPesa Push USSD Direct
			const buyerName = input.buyerName || ctx.user.name || "Hatdot Customer";
			const buyerEmail = ctx.user.email || "support@hatdot.cloud";

			const orderRes = await SonicPesaService.createOrder({
				buyerEmail,
				buyerName,
				buyerPhone: input.phone,
				amount: amountNum,
				currency: plan.currency || "TZS",
			});

			if (orderRes.status !== "success" || !orderRes.orderId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						orderRes.message ||
						"Failed to trigger USSD payment prompt with SonicPesa.",
				});
			}

			// Save payment record
			await db.insert(schema.payments).values({
				id: nanoid(),
				invoiceId: invoice.id,
				organizationId: orgId,
				amount: plan.price,
				currency: plan.currency || "TZS",
				provider: "sonicpesa",
				providerReference: orderRes.orderId,
				status: "pending",
				payerIdentifier: input.phone,
				providerMetadata: orderRes.raw,
			});

			return {
				orderId: orderRes.orderId,
				reference: orderRes.reference,
				amount: orderRes.amount,
				currency: orderRes.currency,
				message: orderRes.message,
				invoiceId: invoice.id,
			};
		}),

	/** Check SonicPesa payment status and auto-activate if confirmed */
	checkSonicPesaStatus: protectedProcedure
		.input(z.object({ orderId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const status = await SonicPesaService.checkOrderStatus(input.orderId);

			if (status.paymentStatus === "SUCCESS") {
				await SonicPesaService.fulfillPayment({
					orderId: input.orderId,
					transId: status.transid,
					channel: status.channel,
					reference: status.reference,
					rawMetadata: status.raw,
				});
			}

			return {
				status: status.paymentStatus,
				isPaid: status.paymentStatus === "SUCCESS",
				transid: status.transid,
				channel: status.channel,
				phone: status.phone,
				message: status.message,
			};
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

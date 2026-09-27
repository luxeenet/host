/**
 * Payment tRPC Router
 *
 * Handles: initiate payment, verify payment, list payment history.
 * Supports all Tanzania mobile money providers via the PaymentProvider abstraction.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../../db";
import * as schema from "@dokploy/server/db/schema";
import { createTRPCRouter, platformAdminProcedure, protectedProcedure } from "../trpc";
import {
	getPaymentProvider,
	type SupportedProvider,
} from "@dokploy/server/services/payment-provider";
import { activateSubscriptionOnPayment } from "@dokploy/server/services/billing-cycle";
import { apiInitiatePayment, apiVerifyPayment } from "@dokploy/server/db/schema";

export const paymentRouter = createTRPCRouter({
	// ─── Customer: Initiate Payment ────────────────────────────

	/**
	 * Initiate payment for an open invoice.
	 * Sends STK push (M-Pesa) or creates a manual payment record.
	 */
	initiate: protectedProcedure
		.input(apiInitiatePayment)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;

			// Verify invoice belongs to this org
			const invoice = await db.query.invoices.findFirst({
				where: and(
					eq(schema.invoices.id, input.invoiceId),
					eq(schema.invoices.organizationId, orgId),
				),
			});

			if (!invoice) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
			}

			if (invoice.status === "paid") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "This invoice has already been paid.",
				});
			}

			if (invoice.status === "void" || invoice.status === "uncollectible") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This invoice cannot be paid.",
				});
			}

			const provider = getPaymentProvider(input.provider as SupportedProvider);

			const result = await provider.initiate({
				amount: Number(invoice.amount),
				currency: invoice.currency,
				payerIdentifier: input.payerIdentifier ?? "",
				invoiceId: invoice.id,
				description: `Payment for invoice ${invoice.invoiceNumber}`,
			});

			// Persist payment record
			const [payment] = await db
				.insert(schema.payments)
				.values({
					id: nanoid(),
					invoiceId: invoice.id,
					organizationId: orgId,
					amount: invoice.amount,
					currency: invoice.currency,
					provider: input.provider as any,
					providerReference: result.providerReference,
					status: result.status as any,
					payerIdentifier: input.payerIdentifier,
					providerMetadata: result.rawResponse as any,
				})
				.returning();

			if (!payment) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create payment record.",
				});
			}

			return {
				paymentId: payment.id,
				providerReference: result.providerReference,
				status: result.status,
				message: result.message,
			};
		}),

	// ─── Customer: Verify Payment ──────────────────────────────

	/**
	 * Poll/verify payment status with the provider.
	 * On success, marks invoice paid + activates subscription.
	 */
	verify: protectedProcedure
		.input(apiVerifyPayment)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;

			const payment = await db.query.payments.findFirst({
				where: and(
					eq(schema.payments.id, input.paymentId),
					eq(schema.payments.organizationId, orgId),
				),
				with: { invoice: { with: { subscription: true } } },
			});

			if (!payment) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
			}

			if (payment.status === "succeeded") {
				return { status: "succeeded", message: "Payment already confirmed." };
			}

			const provider = getPaymentProvider(payment.provider as SupportedProvider);
			const reference =
				input.providerReference ?? payment.providerReference ?? "";

			const result = await provider.verify(reference);

			// Update payment record
			await db
				.update(schema.payments)
				.set({
					status: result.status as any,
					providerTransactionId: result.providerTransactionId,
					providerMetadata: result.rawResponse as any,
					paidAt: result.status === "succeeded" ? new Date() : undefined,
					updatedAt: new Date(),
				})
				.where(eq(schema.payments.id, payment.id));

			if (result.status === "succeeded") {
				// Mark invoice as paid
				await db
					.update(schema.invoices)
					.set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
					.where(eq(schema.invoices.id, payment.invoiceId));

				// Activate subscription
				const subId = payment.invoice.subscriptionId;
				await activateSubscriptionOnPayment(subId);

				return { status: "succeeded", message: "Payment confirmed. Subscription activated." };
			}

			if (result.status === "failed") {
				// Increment failed payment count
				const sub = payment.invoice.subscription;
				const currentFailed = Number.parseInt(sub.failedPaymentCount ?? "0", 10);
				await db
					.update(schema.subscriptions)
					.set({
						failedPaymentCount: String(currentFailed + 1),
						updatedAt: new Date(),
					})
					.where(eq(schema.subscriptions.id, sub.id));

				return { status: "failed", message: result.message ?? "Payment failed." };
			}

			return { status: result.status, message: result.message ?? "Payment pending." };
		}),

	// ─── Customer: List Payments ───────────────────────────────

	list: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		return db.query.payments.findMany({
			where: eq(schema.payments.organizationId, orgId),
			orderBy: [desc(schema.payments.createdAt)],
			limit: 50,
		});
	}),

	// ─── Customer: List Invoices ───────────────────────────────

	listInvoices: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		return db.query.invoices.findMany({
			where: eq(schema.invoices.organizationId, orgId),
			orderBy: [desc(schema.invoices.createdAt)],
			limit: 50,
		});
	}),

	// ─── Admin: Manual Confirmation ───────────────────────────

	/**
	 * Admin manually confirms a payment (for bank transfers, manual payments).
	 */
	adminConfirm: platformAdminProcedure
		.input(
			z.object({
				paymentId: z.string().min(1),
				providerTransactionId: z.string().optional(),
				notes: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const payment = await db.query.payments.findFirst({
				where: eq(schema.payments.id, input.paymentId),
				with: { invoice: { with: { subscription: true } } },
			});

			if (!payment) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found." });
			}

			await db
				.update(schema.payments)
				.set({
					status: "succeeded",
					providerTransactionId: input.providerTransactionId,
					paidAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(schema.payments.id, payment.id));

			await db
				.update(schema.invoices)
				.set({ status: "paid", paidAt: new Date(), updatedAt: new Date(), notes: input.notes })
				.where(eq(schema.invoices.id, payment.invoiceId));

			await activateSubscriptionOnPayment(payment.invoice.subscriptionId);

			return { success: true };
		}),

	// ─── Admin: List all payments ──────────────────────────────

	adminList: platformAdminProcedure
		.input(
			z.object({
				limit: z.number().int().min(1).max(100).default(50),
				offset: z.number().int().min(0).default(0),
				status: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			return db.query.payments.findMany({
				where: input.status
					? eq(schema.payments.status, input.status as any)
					: undefined,
				with: { invoice: true, organization: true },
				orderBy: [desc(schema.payments.createdAt)],
				limit: input.limit,
				offset: input.offset,
			});
		}),
});

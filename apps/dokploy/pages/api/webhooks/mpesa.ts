/**
 * M-Pesa STK Push Callback Webhook
 *
 * Vodacom / Safaricom call this endpoint after the customer completes
 * or cancels the STK push prompt on their phone.
 *
 * Route: POST /api/webhooks/mpesa
 *
 * Security: M-Pesa sends no HMAC signature on callbacks; we verify
 * the CheckoutRequestID exists in our database before processing.
 */
import { eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@dokploy/server/db";
import * as schema from "@dokploy/server/db/schema";
import { activateSubscriptionOnPayment } from "@dokploy/server/services/billing-cycle";

interface MpesaCallbackBody {
	Body: {
		stkCallback: {
			MerchantRequestID: string;
			CheckoutRequestID: string;
			ResultCode: number;
			ResultDesc: string;
			CallbackMetadata?: {
				Item: Array<{ Name: string; Value?: string | number }>;
			};
		};
	};
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	// M-Pesa only sends POST
	if (req.method !== "POST") {
		return res.status(405).json({ message: "Method not allowed" });
	}

	try {
		const body = req.body as MpesaCallbackBody;
		const callback = body?.Body?.stkCallback;

		if (!callback) {
			return res.status(400).json({ message: "Invalid callback body" });
		}

		const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } =
			callback;

		// Find the payment by providerReference (= CheckoutRequestID)
		const payment = await db.query.payments.findFirst({
			where: eq(schema.payments.providerReference, CheckoutRequestID),
			with: {
				invoice: {
					with: { subscription: true },
				},
			},
		});

		if (!payment) {
			// Not our payment — acknowledge and ignore
			return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
		}

		if (ResultCode === 0) {
			// Success — extract M-Pesa transaction code
			const receiptItem = CallbackMetadata?.Item?.find(
				(i) => i.Name === "MpesaReceiptNumber",
			);
			const mpesaReceipt = String(receiptItem?.Value ?? "");

			await db
				.update(schema.payments)
				.set({
					status: "succeeded",
					providerTransactionId: mpesaReceipt,
					paidAt: new Date(),
					updatedAt: new Date(),
					providerMetadata: body as any,
				})
				.where(eq(schema.payments.id, payment.id));

			await db
				.update(schema.invoices)
				.set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
				.where(eq(schema.invoices.id, payment.invoiceId));

			await activateSubscriptionOnPayment(payment.invoice.subscriptionId);

			console.log(
				`[mpesa-webhook] Payment ${payment.id} succeeded. Receipt: ${mpesaReceipt}`,
			);
		} else {
			// Payment failed / cancelled
			await db
				.update(schema.payments)
				.set({
					status: "failed",
					failureReason: ResultDesc,
					updatedAt: new Date(),
					providerMetadata: body as any,
				})
				.where(eq(schema.payments.id, payment.id));

			// Increment failed payment counter on subscription
			const sub = payment.invoice.subscription;
			const currentFailed = Number.parseInt(sub.failedPaymentCount ?? "0", 10);
			await db
				.update(schema.subscriptions)
				.set({
					failedPaymentCount: String(currentFailed + 1),
					updatedAt: new Date(),
				})
				.where(eq(schema.subscriptions.id, sub.id));

			console.warn(
				`[mpesa-webhook] Payment ${payment.id} failed. Code: ${ResultCode}, Reason: ${ResultDesc}`,
			);
		}

		// Always ACK to M-Pesa
		return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
	} catch (err) {
		console.error("[mpesa-webhook] Error:", err);
		// Return 200 to prevent M-Pesa from retrying indefinitely
		return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
	}
}

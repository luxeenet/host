/**
 * SonicPesa Payment & Payout Webhook Handler
 *
 * SonicPesa calls this endpoint when a payment order is completed,
 * cancelled, or when a payout status changes.
 *
 * Route: POST /api/webhooks/sonicpesa
 *
 * Security: Verifies X-SonicPesa-Signature HMAC SHA256 header
 * according to official SonicPesa Developer Documentation.
 */
import crypto from "node:crypto";
import { buffer } from "node:stream/consumers";
import { eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@dokploy/server/db";
import * as schema from "@dokploy/server/db/schema";
import { activateSubscriptionOnPayment } from "@dokploy/server/services/billing-cycle";
import { getSonicPesaResolvedCredentials } from "@dokploy/server";

export const config = {
	api: {
		bodyParser: false,
	},
};

interface SonicPesaWebhookEvent {
	event?: string;
	order_id?: string;
	amount?: number | string;
	currency?: string;
	status?: string;
	transid?: string;
	channel?: string;
	reference?: string;
	msisdn?: string;
	payment_status?: string;
	timestamp?: string;
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: "Method not allowed" });
	}

	try {
		const rawBuffer = await buffer(req);
		const rawBody = rawBuffer.toString("utf-8");

		const signatureHeader = req.headers["x-sonicpesa-signature"];
		const creds = await getSonicPesaResolvedCredentials();
		const apiSecret = creds.apiSecret;

		// Verify signature if API Secret is configured
		if (apiSecret && signatureHeader) {
			const expectedSignature = crypto
				.createHmac("sha256", apiSecret)
				.update(rawBody)
				.digest("hex");

			const sigStr = (Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader) || "";
			let isValid = false;
			try {
				isValid =
					sigStr.length === expectedSignature.length &&
					crypto.timingSafeEqual(Buffer.from(sigStr, "utf-8"), Buffer.from(expectedSignature, "utf-8"));
			} catch {
				isValid = false;
			}

			if (!isValid) {
				console.warn("[sonicpesa-webhook] Invalid signature header received");
				return res.status(401).json({ message: "Invalid signature" });
			}
		}

		let body: SonicPesaWebhookEvent = {};
		try {
			body = JSON.parse(rawBody) as SonicPesaWebhookEvent;
		} catch (parseErr) {
			console.error("[sonicpesa-webhook] JSON parse error:", parseErr);
			return res.status(400).json({ message: "Invalid JSON payload" });
		}

		const orderId = body.order_id;
		const eventType = body.event || "";
		const paymentStatus = (body.payment_status || body.status || "").toUpperCase();

		if (!orderId) {
			return res.status(200).json({ status: "success", message: "Ignored — no order_id" });
		}

		// Find matching payment by providerReference
		const payment = await db.query.payments.findFirst({
			where: eq(schema.payments.providerReference, orderId),
			with: {
				invoice: {
					with: { subscription: true },
				},
			},
		});

		if (!payment) {
			console.log(`[sonicpesa-webhook] No payment record found for order ${orderId}`);
			return res.status(200).json({ status: "success", message: "Accepted" });
		}

		if (
			eventType === "payment.success" ||
			paymentStatus === "SUCCESS" ||
			paymentStatus === "COMPLETED"
		) {
			await db
				.update(schema.payments)
				.set({
					status: "succeeded",
					providerTransactionId: body.transid ?? body.reference ?? undefined,
					paidAt: new Date(),
					updatedAt: new Date(),
					providerMetadata: body as unknown as Record<string, unknown>,
				})
				.where(eq(schema.payments.id, payment.id));

			await db
				.update(schema.invoices)
				.set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
				.where(eq(schema.invoices.id, payment.invoiceId));

			await activateSubscriptionOnPayment(payment.invoice.subscriptionId);

			console.log(
				`[sonicpesa-webhook] Payment ${payment.id} succeeded. TransId: ${body.transid || "N/A"}`,
			);
		} else if (
			paymentStatus === "CANCELLED" ||
			paymentStatus === "USERCANCELLED" ||
			paymentStatus === "REJECTED" ||
			paymentStatus === "FAILED"
		) {
			await db
				.update(schema.payments)
				.set({
					status: "failed",
					failureReason: `SonicPesa status: ${paymentStatus}`,
					updatedAt: new Date(),
					providerMetadata: body as unknown as Record<string, unknown>,
				})
				.where(eq(schema.payments.id, payment.id));

			const sub = payment.invoice.subscription;
			if (sub) {
				const currentFailed = Number.parseInt(sub.failedPaymentCount ?? "0", 10);
				await db
					.update(schema.subscriptions)
					.set({
						failedPaymentCount: String(currentFailed + 1),
						updatedAt: new Date(),
					})
					.where(eq(schema.subscriptions.id, sub.id));
			}

			console.warn(
				`[sonicpesa-webhook] Payment ${payment.id} marked failed (${paymentStatus})`,
			);
		}

		return res.status(200).json({ status: "success", message: "Accepted" });
	} catch (err) {
		console.error("[sonicpesa-webhook] Error processing webhook:", err);
		return res.status(200).json({ status: "success", message: "Accepted" });
	}
}

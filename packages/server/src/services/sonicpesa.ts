/**
 * SonicPesa Payment Gateway Service — Hatdot PaaS
 *
 * Implements high-performance mobile money USSD Push and card payments:
 * - M-Pesa, Tigo Pesa, Airtel Money, Halopesa
 * - API Version 1.0 Production Cluster (https://api.sonicpesa.com/api/v1)
 * - Push USSD Direct (`/payment/create_order`)
 * - Status Polling (`/payment/order_status`)
 * - Webhooks (`payment.success`)
 * - Auto-fulfillment & subscription activation
 */

import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import * as schema from "../db/schema";

export const SONICPESA_BASE_URL =
	process.env.SONICPESA_BASE_URL || "https://api.sonicpesa.com/api/v1";

export const SONICPESA_API_KEY =
	process.env.SONICPESA_API_KEY || "";

export const SONICPESA_API_SECRET =
	process.env.SONICPESA_API_SECRET || "";

export interface CreateOrderParams {
	buyerEmail: string;
	buyerName: string;
	buyerPhone: string;
	amount: number;
	currency?: string;
	metadata?: Record<string, any>;
}

export interface SonicPesaOrderResponse {
	status: "success" | "error";
	message?: string;
	orderId?: string;
	reference?: string;
	amount?: number;
	currency?: string;
	paymentStatus?: string;
	raw?: any;
}

export interface SonicPesaStatusResponse {
	status: "success" | "error";
	message?: string;
	paymentStatus: "SUCCESS" | "PENDING" | "CANCELLED" | "USERCANCELLED" | "REJECTED" | "INPROGRESS" | "FAILED" | "UNKNOWN";
	amount?: number;
	currency?: string;
	phone?: string;
	transid?: string | null;
	reference?: string | null;
	channel?: string | null;
	raw?: any;
}

/**
 * Normalizes Tanzanian phone numbers into international format: 255XXXXXXXXX
 */
export function normalizeTanzanianPhone(phone: string): string {
	const cleaned = phone.replace(/\D/g, "");
	if (cleaned.startsWith("0")) {
		return `255${cleaned.substring(1)}`;
	}
	if (cleaned.startsWith("255")) {
		return cleaned;
	}
	if (cleaned.length === 9 && (cleaned.startsWith("7") || cleaned.startsWith("6"))) {
		return `255${cleaned}`;
	}
	return cleaned;
}

export class SonicPesaService {
	/**
	 * Initiate a Push USSD Payment Order.
	 * Sends a live USSD prompt directly to the customer's phone.
	 */
	static async createOrder(params: CreateOrderParams): Promise<SonicPesaOrderResponse> {
		const formattedPhone = normalizeTanzanianPhone(params.buyerPhone);

		const payload = {
			buyer_email: params.buyerEmail,
			buyer_name: params.buyerName,
			buyer_phone: formattedPhone,
			amount: Math.round(params.amount),
			currency: params.currency || "TZS",
		};

		try {
			const res = await fetch(`${SONICPESA_BASE_URL}/payment/create_order`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-KEY": SONICPESA_API_KEY,
				},
				body: JSON.stringify(payload),
			});

			const json = (await res.json()) as any;

			if (!res.ok || json.status === "error") {
				return {
					status: "error",
					message: json.message || "Failed to create SonicPesa payment order",
					raw: json,
				};
			}

			const data = json.data || {};
			return {
				status: "success",
				message: json.message || "Payment order created successfully! Push USSD sent.",
				orderId: data.order_id,
				reference: data.reference,
				amount: data.amount ? Number(data.amount) : params.amount,
				currency: data.currency || "TZS",
				paymentStatus: data.payment_status || data.status || "PENDING",
				raw: json,
			};
		} catch (error: any) {
			console.error("[SonicPesaService.createOrder] Request failed:", error);
			return {
				status: "error",
				message: error.message || "Network error connecting to SonicPesa",
			};
		}
	}

	/**
	 * Check real-time payment status of an existing order.
	 */
	static async checkOrderStatus(orderId: string): Promise<SonicPesaStatusResponse> {
		try {
			const res = await fetch(`${SONICPESA_BASE_URL}/payment/order_status`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-KEY": SONICPESA_API_KEY,
				},
				body: JSON.stringify({ order_id: orderId }),
			});

			const json = (await res.json()) as any;

			if (!res.ok || json.status === "error") {
				return {
					status: "error",
					message: json.message || "Error retrieving order status",
					paymentStatus: "UNKNOWN",
					raw: json,
				};
			}

			const data = json.data || {};
			const rawStatus = (data.payment_status || json.transaction?.status || "UNKNOWN").toUpperCase();

			let paymentStatus: SonicPesaStatusResponse["paymentStatus"] = "UNKNOWN";
			if (["SUCCESS", "COMPLETED"].includes(rawStatus)) {
				paymentStatus = "SUCCESS";
			} else if (["PENDING", "PROCESSING", "INPROGRESS"].includes(rawStatus)) {
				paymentStatus = "PENDING";
			} else if (rawStatus === "CANCELLED") {
				paymentStatus = "CANCELLED";
			} else if (rawStatus === "USERCANCELLED") {
				paymentStatus = "USERCANCELLED";
			} else if (["REJECTED", "FAILED"].includes(rawStatus)) {
				paymentStatus = "REJECTED";
			}

			return {
				status: "success",
				paymentStatus,
				amount: data.amount ? Number(data.amount) : undefined,
				currency: data.currency || "TZS",
				phone: data.phone || data.msisdn,
				transid: data.transid,
				reference: data.reference,
				channel: data.channel,
				raw: json,
			};
		} catch (error: any) {
			console.error("[SonicPesaService.checkOrderStatus] Request failed:", error);
			return {
				status: "error",
				message: error.message || "Network error checking SonicPesa status",
				paymentStatus: "UNKNOWN",
			};
		}
	}

	/**
	 * Verify HMAC signature of inbound webhooks from SonicPesa.
	 */
	static verifyWebhookSignature(payloadRaw: string, signature: string): boolean {
		if (!SONICPESA_API_SECRET) {
			// If secret not configured yet, allow for dev/sandbox mode or basic verification
			return true;
		}
		try {
			const expectedSignature = crypto
				.createHmac("sha256", SONICPESA_API_SECRET)
				.update(payloadRaw)
				.digest("hex");
			return crypto.timingSafeEqual(
				Buffer.from(signature),
				Buffer.from(expectedSignature),
			);
		} catch (e) {
			return false;
		}
	}

	/**
	 * Fulfills a successful payment:
	 * 1. Updates paas_payment to "succeeded"
	 * 2. Updates paas_invoice to "paid"
	 * 3. Updates/activates paas_subscription to "active" and calculates next billing period
	 */
	static async fulfillPayment(params: {
		orderId: string;
		transId?: string | null;
		channel?: string | null;
		reference?: string | null;
		rawMetadata?: any;
	}): Promise<{ success: boolean; message: string; subscriptionId?: string }> {
		const { orderId, transId, channel, reference, rawMetadata } = params;

		// 1. Find the payment by providerReference (orderId)
		const payment = await db.query.payments.findFirst({
			where: eq(schema.payments.providerReference, orderId),
		});

		if (!payment) {
			console.warn(`[SonicPesaService.fulfillPayment] Payment with orderId ${orderId} not found in DB`);
			return { success: false, message: `Payment order ${orderId} not found.` };
		}

		if (payment.status === "succeeded") {
			return {
				success: true,
				message: "Payment already marked as succeeded.",
			};
		}

		const now = new Date();

		return await db.transaction(async (tx) => {
			// 1. Update payment record
			await tx
				.update(schema.payments)
				.set({
					status: "succeeded",
					providerTransactionId: transId || reference || null,
					providerMetadata: rawMetadata || null,
					paidAt: now,
					updatedAt: now,
				})
				.where(eq(schema.payments.id, payment.id));

			// 2. Update invoice record
			const invoice = await tx.query.invoices.findFirst({
				where: eq(schema.invoices.id, payment.invoiceId),
			});

			if (invoice) {
				await tx
					.update(schema.invoices)
					.set({
						status: "paid",
						paidAt: now,
						updatedAt: now,
					})
					.where(eq(schema.invoices.id, invoice.id));

				// 3. Update subscription record
				const sub = await tx.query.subscriptions.findFirst({
					where: eq(schema.subscriptions.id, invoice.subscriptionId),
				});

				if (sub) {
					const plan = await tx.query.plans.findFirst({
						where: eq(schema.plans.id, sub.planId),
					});

					const billingCycle = plan?.billingCycle || "monthly";
					const nextPeriodEnd = new Date(now);
					if (billingCycle === "yearly") {
						nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + 1);
					} else {
						nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
					}

					await tx
						.update(schema.subscriptions)
						.set({
							status: "active",
							currentPeriodStart: now,
							currentPeriodEnd: nextPeriodEnd,
							failedPaymentCount: "0",
							updatedAt: now,
						})
						.where(eq(schema.subscriptions.id, sub.id));

					return {
						success: true,
						message: "Payment succeeded and subscription activated successfully!",
						subscriptionId: sub.id,
					};
				}
			}

			return {
				success: true,
				message: "Payment record updated to succeeded.",
			};
		});
	}
}

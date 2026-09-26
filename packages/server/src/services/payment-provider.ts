/**
 * Payment Provider Abstraction
 *
 * Pluggable payment gateway layer.
 * Each Tanzania mobile money provider implements PaymentProvider.
 *
 * Currently implemented:
 *  - M-Pesa (Vodacom Tanzania) — primary
 *  - Manual / Bank Transfer — fallback
 *
 * To add a new provider:
 *  1. Implement the PaymentProvider interface below
 *  2. Register it in getPaymentProvider()
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PaymentInitiateRequest {
	/** Invoice amount in TZS */
	amount: number;
	currency: string;
	/** Phone number or account identifier (e.g. 255712345678) */
	payerIdentifier: string;
	/** Our invoice ID — used as reference */
	invoiceId: string;
	/** Optional description shown to payer */
	description?: string;
}

export interface PaymentInitiateResult {
	/** Provider-assigned request/checkout ID */
	providerReference: string;
	/** Current status after initiating */
	status: "pending" | "processing" | "succeeded" | "failed";
	/** Human-readable message */
	message?: string;
	/** Raw provider response for audit */
	rawResponse?: Record<string, unknown>;
}

export interface PaymentVerifyResult {
	status: "pending" | "processing" | "succeeded" | "failed" | "refunded";
	/** Provider transaction ID (e.g. MPESA transaction code) */
	providerTransactionId?: string;
	message?: string;
	rawResponse?: Record<string, unknown>;
}

export interface PaymentProvider {
	name: string;
	initiate(req: PaymentInitiateRequest): Promise<PaymentInitiateResult>;
	verify(providerReference: string): Promise<PaymentVerifyResult>;
}

// ─────────────────────────────────────────────────────────────
// M-Pesa Tanzania (Vodacom Daraja API)
// ─────────────────────────────────────────────────────────────

class MpesaTanzaniaProvider implements PaymentProvider {
	name = "mpesa";

	private get businessShortCode(): string {
		return process.env.MPESA_BUSINESS_SHORT_CODE ?? "";
	}
	private get consumerKey(): string {
		return process.env.MPESA_CONSUMER_KEY ?? "";
	}
	private get consumerSecret(): string {
		return process.env.MPESA_CONSUMER_SECRET ?? "";
	}
	private get passkey(): string {
		return process.env.MPESA_PASSKEY ?? "";
	}
	private get baseUrl(): string {
		return process.env.MPESA_ENV === "production"
			? "https://openapi.m-pesa.com"
			: "https://sandbox.safaricom.co.ke";
	}
	private get callbackUrl(): string {
		return process.env.MPESA_CALLBACK_URL ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/mpesa`;
	}

	private async getAccessToken(): Promise<string> {
		const credentials = Buffer.from(
			`${this.consumerKey}:${this.consumerSecret}`,
		).toString("base64");

		const res = await fetch(
			`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
			{
				headers: { Authorization: `Basic ${credentials}` },
			},
		);

		if (!res.ok) {
			throw new Error(`M-Pesa auth failed: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as { access_token: string };
		return data.access_token;
	}

	async initiate(req: PaymentInitiateRequest): Promise<PaymentInitiateResult> {
		try {
			const token = await this.getAccessToken();
			const timestamp = new Date()
				.toISOString()
				.replace(/[-T:.Z]/g, "")
				.slice(0, 14);
			const password = Buffer.from(
				`${this.businessShortCode}${this.passkey}${timestamp}`,
			).toString("base64");

			const body = {
				BusinessShortCode: this.businessShortCode,
				Password: password,
				Timestamp: timestamp,
				TransactionType: "CustomerPayBillOnline",
				Amount: Math.ceil(req.amount),
				PartyA: req.payerIdentifier.replace(/^\+/, ""),
				PartyB: this.businessShortCode,
				PhoneNumber: req.payerIdentifier.replace(/^\+/, ""),
				CallBackURL: this.callbackUrl,
				AccountReference: req.invoiceId,
				TransactionDesc: req.description ?? `Payment for ${req.invoiceId}`,
			};

			const res = await fetch(
				`${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(body),
				},
			);

			const data = (await res.json()) as Record<string, unknown>;

			if (!res.ok || data["ResponseCode"] !== "0") {
				return {
					providerReference: (data["CheckoutRequestID"] as string) ?? "",
					status: "failed",
					message:
						(data["CustomerMessage"] as string) ??
						(data["errorMessage"] as string) ??
						"Payment initiation failed",
					rawResponse: data,
				};
			}

			return {
				providerReference: data["CheckoutRequestID"] as string,
				status: "pending",
				message: (data["CustomerMessage"] as string) ?? "STK push sent",
				rawResponse: data,
			};
		} catch (err) {
			throw new Error(
				`M-Pesa initiate error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	async verify(providerReference: string): Promise<PaymentVerifyResult> {
		try {
			const token = await this.getAccessToken();
			const timestamp = new Date()
				.toISOString()
				.replace(/[-T:.Z]/g, "")
				.slice(0, 14);
			const password = Buffer.from(
				`${this.businessShortCode}${this.passkey}${timestamp}`,
			).toString("base64");

			const body = {
				BusinessShortCode: this.businessShortCode,
				Password: password,
				Timestamp: timestamp,
				CheckoutRequestID: providerReference,
			};

			const res = await fetch(`${this.baseUrl}/mpesa/stkpushquery/v1/query`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			});

			const data = (await res.json()) as Record<string, unknown>;
			const resultCode = String(data["ResultCode"] ?? data["ResponseCode"]);

			if (resultCode === "0") {
				return {
					status: "succeeded",
					providerTransactionId: (data["MpesaReceiptNumber"] as string) ?? undefined,
					message: "Payment confirmed",
					rawResponse: data,
				};
			}

			if (resultCode === "1032" || resultCode === "1037") {
				return { status: "failed", message: "Payment cancelled by user", rawResponse: data };
			}

			// Still processing
			return { status: "pending", message: "Awaiting payment", rawResponse: data };
		} catch (err) {
			throw new Error(
				`M-Pesa verify error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

// ─────────────────────────────────────────────────────────────
// SonicPesa Gateway Provider (Tanzania Mobile Money & USSD Push)
// ─────────────────────────────────────────────────────────────

class SonicPesaProvider implements PaymentProvider {
	name = "sonicpesa";

	private get apiKey(): string {
		return process.env.SONICPESA_API_KEY ?? "";
	}
	private get apiSecret(): string {
		return process.env.SONICPESA_API_SECRET ?? "";
	}
	private get baseUrl(): string {
		return (
			process.env.SONICPESA_BASE_URL ?? "https://api.sonicpesa.com/api/v1"
		);
	}

	async initiate(req: PaymentInitiateRequest): Promise<PaymentInitiateResult> {
		try {
			if (!this.apiKey) {
				throw new Error("SONICPESA_API_KEY environment variable is missing.");
			}

			// Format phone number to 255XXXXXXXXX format
			let phone = req.payerIdentifier.replace(/\D/g, "");
			if (phone.startsWith("0")) {
				phone = `255${phone.slice(1)}`;
			} else if (!phone.startsWith("255") && phone.length === 9) {
				phone = `255${phone}`;
			}

			const payload = {
				buyer_email: process.env.BRAND_SUPPORT_EMAIL ?? "customer@localhost",
				buyer_name: req.description ?? `Invoice ${req.invoiceId}`,
				buyer_phone: phone,
				amount: req.amount,
				currency: req.currency || "TZS",
			};

			const res = await fetch(`${this.baseUrl}/payment/create_order`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-KEY": this.apiKey,
				},
				body: JSON.stringify(payload),
			});

			const data = (await res.json()) as {
				status: string;
				message?: string;
				data?: {
					order_id: string;
					reference?: string;
					payment_status?: string;
				};
			};

			if (!res.ok || data.status !== "success" || !data.data?.order_id) {
				throw new Error(
					data.message ||
						`SonicPesa payment creation failed with status ${res.status}`,
				);
			}

			return {
				providerReference: data.data.order_id,
				status: "pending",
				message: data.message || "Push USSD sent to customer phone",
				rawResponse: data as unknown as Record<string, unknown>,
			};
		} catch (err) {
			throw new Error(
				`SonicPesa initiate error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	async verify(providerReference: string): Promise<PaymentVerifyResult> {
		try {
			if (!this.apiKey) {
				throw new Error("SONICPESA_API_KEY environment variable is missing.");
			}

			const res = await fetch(`${this.baseUrl}/payment/order_status`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-KEY": this.apiKey,
				},
				body: JSON.stringify({ order_id: providerReference }),
			});

			const data = (await res.json()) as {
				status: string;
				message?: string;
				data?: {
					order_id: string;
					payment_status: string;
					transid?: string;
					amount?: number;
					channel?: string;
				};
			};

			if (!res.ok || data.status !== "success") {
				return {
					status: "pending",
					message: data.message || "Could not retrieve order status",
					rawResponse: data as unknown as Record<string, unknown>,
				};
			}

			const paymentStatus = data.data?.payment_status?.toUpperCase();

			if (paymentStatus === "SUCCESS" || paymentStatus === "COMPLETED") {
				return {
					status: "succeeded",
					providerTransactionId: data.data?.transid ?? undefined,
					message: "Payment successful",
					rawResponse: data as unknown as Record<string, unknown>,
				};
			}

			if (
				paymentStatus === "CANCELLED" ||
				paymentStatus === "USERCANCELLED" ||
				paymentStatus === "REJECTED"
			) {
				return {
					status: "failed",
					message: `Payment ${paymentStatus.toLowerCase()}`,
					rawResponse: data as unknown as Record<string, unknown>,
				};
			}

			return {
				status: "pending",
				message: `Payment status is ${paymentStatus}`,
				rawResponse: data as unknown as Record<string, unknown>,
			};
		} catch (err) {
			throw new Error(
				`SonicPesa verify error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

// ─────────────────────────────────────────────────────────────
// Manual / Bank Transfer Provider
// ─────────────────────────────────────────────────────────────

class ManualProvider implements PaymentProvider {
	name = "manual";

	async initiate(req: PaymentInitiateRequest): Promise<PaymentInitiateResult> {
		// Manual payments are confirmed by admin
		return {
			providerReference: `MANUAL-${req.invoiceId}-${Date.now()}`,
			status: "pending",
			message: "Awaiting manual confirmation from admin",
		};
	}

	async verify(_providerReference: string): Promise<PaymentVerifyResult> {
		// Admin must manually confirm via adminProcedure
		return { status: "pending", message: "Manual confirmation required" };
	}
}

// ─────────────────────────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────────────────────────

export type SupportedProvider =
	| "mpesa"
	| "sonicpesa"
	| "tigopesa"
	| "airtelmoney"
	| "halopesa"
	| "azampesa"
	| "bank_transfer"
	| "card"
	| "manual";

export function getPaymentProvider(provider: SupportedProvider): PaymentProvider {
	switch (provider) {
		case "mpesa":
			return new MpesaTanzaniaProvider();
		case "sonicpesa":
			return new SonicPesaProvider();
		case "tigopesa":
		case "airtelmoney":
		case "halopesa":
		case "azampesa":
		case "bank_transfer":
		case "card":
		case "manual":
		default:
			// All other providers fall back to manual confirmation for now
			return new ManualProvider();
	}
}

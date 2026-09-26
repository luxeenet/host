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

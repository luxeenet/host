/**
 * SMTP Configuration & Email Transport Service — Hatdot PaaS
 *
 * Secure centralized management of SMTP email configuration.
 * Reads credentials dynamically from PostgreSQL (`paas_platform_setting`)
 * with fallback to system environment variables.
 */
import nodemailer from "nodemailer";
import { brand } from "@paas/branding";
import { PLATFORM_SETTING_KEYS } from "../db/schema/platform-settings";
import { getPlatformSettingValue, setPlatformSettingValue } from "./cname-routing";

export interface SmtpSettings {
	host: string;
	port: number;
	user: string;
	from: string;
	fromName: string;
	secure: boolean;
	hasPassword: boolean;
	maskedPassword: string;
	configured: boolean;
}

export interface ResolvedSmtpCredentials {
	host: string;
	port: number;
	user: string;
	pass: string;
	from: string;
	fromName: string;
	secure: boolean;
	configured: boolean;
}

export interface UpdateSmtpInput {
	host?: string | null;
	port?: number | null;
	user?: string | null;
	pass?: string | null;
	from?: string | null;
	fromName?: string | null;
	secure?: boolean | null;
}

export interface SendMailOptions {
	to: string | string[];
	subject: string;
	html?: string;
	text?: string;
	attachments?: { filename: string; content: Buffer }[];
}

export interface TestSmtpResult {
	success: boolean;
	message: string;
	latencyMs: number;
}

const maskString = (val?: string | null): string => {
	if (!val) return "";
	const trimmed = val.trim();
	if (trimmed.length <= 4) return "••••••••";
	return `••••••••${trimmed.slice(-3)}`;
};

/**
 * Formats a clean, standard RFC 5322 From: header safely handling brackets and quotes.
 */
export function formatFromHeader(from: string, fromName?: string): string {
	const trimmed = (from || "").trim();
	if (!trimmed) {
		const defaultName = (fromName || brand.APP_NAME).replace(/"/g, "").trim();
		return `"${defaultName}" <${brand.EMAIL_FROM || "notifications@hatdot.cloud"}>`;
	}

	const match = trimmed.match(/^(?:["']?([^"']+)["']?\s*)?<([^>]+)>$/);
	if (match) {
		const rawExtracted = match[1];
		const extractedName = (fromName || rawExtracted || brand.APP_NAME).replace(/"/g, "").trim();
		const extractedEmail = (match[2] || "").trim();
		return `"${extractedName}" <${extractedEmail}>`;
	}

	const cleanEmail = trimmed.replace(/[<>"]/g, "").trim();
	const displayName = (fromName || brand.APP_NAME).replace(/"/g, "").trim();
	return `"${displayName}" <${cleanEmail}>`;
}

/**
 * Resolves live SMTP credentials with DB platformSettings precedence over process.env.
 */
export async function getSmtpResolvedCredentials(): Promise<ResolvedSmtpCredentials> {
	const dbHost = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_HOST, null);
	const dbPort = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_PORT, null);
	const dbUser = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_USER, null);
	const dbPass = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_PASS, null);
	const dbFrom = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_FROM, null);
	const dbFromName = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_FROM_NAME, null);
	const dbSecure = await getPlatformSettingValue(PLATFORM_SETTING_KEYS.SMTP_SECURE, null);

	const host = dbHost?.trim() || process.env.SMTP_SERVER?.trim() || process.env.SMTP_HOST?.trim() || "";
	const rawPort = dbPort?.trim() || process.env.SMTP_PORT?.trim() || "587";
	const port = Number.parseInt(rawPort, 10) || 587;
	const user = dbUser?.trim() || process.env.SMTP_USERNAME?.trim() || process.env.SMTP_USER?.trim() || "";
	const pass = dbPass?.trim() || process.env.SMTP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim() || "";
	const from = dbFrom?.trim() || process.env.SMTP_FROM_ADDRESS?.trim() || process.env.SMTP_FROM?.trim() || brand.EMAIL_FROM;
	const fromName = dbFromName?.trim() || process.env.SMTP_FROM_NAME?.trim() || brand.APP_NAME;
	const secure = dbSecure !== null ? dbSecure === "true" : port === 465;

	const configured = Boolean(host && from);

	return {
		host,
		port,
		user,
		pass,
		from,
		fromName,
		secure,
		configured,
	};
}

/**
 * Returns sanitized SMTP settings for the Admin Dashboard UI.
 */
export async function getSmtpSanitizedSettings(): Promise<SmtpSettings> {
	const creds = await getSmtpResolvedCredentials();

	return {
		host: creds.host,
		port: creds.port,
		user: creds.user,
		from: creds.from,
		fromName: creds.fromName,
		secure: creds.secure,
		hasPassword: Boolean(creds.pass),
		maskedPassword: maskString(creds.pass),
		configured: creds.configured,
	};
}

/**
 * Updates SMTP settings in the database.
 */
export async function updateSmtpSettings(input: UpdateSmtpInput): Promise<SmtpSettings> {
	if (input.host !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_HOST,
			input.host?.trim() || null,
			"SMTP mail server hostname",
		);
	}

	if (input.port !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_PORT,
			input.port ? String(input.port) : "587",
			"SMTP mail server port",
		);
	}

	if (input.user !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_USER,
			input.user?.trim() || null,
			"SMTP mail server authentication username",
		);
	}

	if (input.pass !== undefined && input.pass !== null) {
		const trimmedPass = input.pass.trim();
		if (trimmedPass && !trimmedPass.includes("••")) {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SMTP_PASS,
				trimmedPass,
				"SMTP mail server password",
			);
		} else if (trimmedPass === "") {
			await setPlatformSettingValue(
				PLATFORM_SETTING_KEYS.SMTP_PASS,
				null,
				"SMTP mail server password",
			);
		}
	}

	if (input.from !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_FROM,
			input.from?.trim() || null,
			"Default From email address for outgoing system emails",
		);
	}

	if (input.fromName !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_FROM_NAME,
			input.fromName?.trim() || null,
			"Sender display name for outgoing system emails",
		);
	}

	if (input.secure !== undefined) {
		await setPlatformSettingValue(
			PLATFORM_SETTING_KEYS.SMTP_SECURE,
			input.secure ? "true" : "false",
			"Whether to use SSL directly (port 465) or STARTTLS",
		);
	}

	return await getSmtpSanitizedSettings();
}

/**
 * Creates a configured Nodemailer transporter using resolved credentials.
 */
export async function createMailTransporter() {
	const creds = await getSmtpResolvedCredentials();
	if (!creds.configured) {
		return null;
	}

	return nodemailer.createTransport({
		host: creds.host,
		port: creds.port,
		secure: creds.secure,
		auth: creds.user ? { user: creds.user, pass: creds.pass } : undefined,
		tls: {
			rejectUnauthorized: false, // Prevents self-signed cert failures in custom corporate relays
		},
	});
}

/**
 * Sends a transactional or notification email.
 */
export async function sendPlatformMail(options: SendMailOptions): Promise<boolean> {
	const creds = await getSmtpResolvedCredentials();
	const transporter = await createMailTransporter();

	if (!transporter || !creds.configured) {
		console.warn(`[email] SMTP not configured. Skipped sending '${options.subject}' to ${Array.isArray(options.to) ? options.to.join(", ") : options.to}`);
		return false;
	}

	const to = Array.isArray(options.to) ? options.to.join(", ") : options.to;
	const fromFormatted = formatFromHeader(creds.from, creds.fromName);

	try {
		await transporter.sendMail({
			from: fromFormatted,
			to,
			subject: options.subject,
			html: options.html,
			text: options.text || (options.html ? options.html.replace(/<[^>]+>/g, " ").trim() : ""),
			attachments: options.attachments,
		});

		console.log(`[email] Successfully sent '${options.subject}' to ${to}`);
		return true;
	} catch (error: any) {
		console.error(`[email] Failed to send email to ${to}:`, error?.message || error);
		throw error;
	}
}

/**
 * Tests the SMTP connection and sends a sample test email.
 */
export async function testSmtpConnection(targetEmail?: string): Promise<TestSmtpResult> {
	const creds = await getSmtpResolvedCredentials();
	if (!creds.configured) {
		return {
			success: false,
			message: "SMTP host or From address is not configured. Please fill in SMTP details first.",
			latencyMs: 0,
		};
	}

	const startTime = Date.now();
	try {
		const transporter = await createMailTransporter();
		if (!transporter) {
			throw new Error("Failed to initialize mail transport");
		}

		// 1. Verify connection handshake & auth
		await transporter.verify();
		const handshakeLatency = Date.now() - startTime;

		// 2. If target email provided, send a live test message
		if (targetEmail && targetEmail.includes("@")) {
			const testHtml = `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
					<div style="text-align: center; margin-bottom: 24px;">
						<h1 style="color: #0284c7; margin: 0; font-size: 24px; font-weight: 800;">${brand.APP_NAME}</h1>
						<p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Platform Notification Engine</p>
					</div>
					<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 24px;">
						<span style="font-size: 28px;">✅</span>
						<h2 style="color: #166534; font-size: 18px; margin: 8px 0 4px 0; font-weight: 700;">SMTP Transport Verified!</h2>
						<p style="color: #15803d; font-size: 13px; margin: 0;">This email confirms that your SMTP server configuration is working perfectly.</p>
					</div>
					<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
						<tr>
							<td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">SMTP Host:</td>
							<td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">${creds.host}</td>
						</tr>
						<tr>
							<td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">Port & Encryption:</td>
							<td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">${creds.port} (${creds.secure ? "SSL" : "TLS/STARTTLS"})</td>
						</tr>
						<tr>
							<td style="padding: 8px 0; color: #64748b; border-bottom: 1px solid #f1f5f9;">From Address:</td>
							<td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right; border-bottom: 1px solid #f1f5f9;">${creds.from}</td>
						</tr>
						<tr>
							<td style="padding: 8px 0; color: #64748b;">Verification Latency:</td>
							<td style="padding: 8px 0; color: #16a34a; font-weight: 700; text-align: right;">${handshakeLatency} ms</td>
						</tr>
					</table>
					<div style="border-top: 1px solid #e2e8f0; padding-top: 18px; text-align: center; color: #94a3b8; font-size: 12px;">
						${brand.COPYRIGHT}
					</div>
				</div>
			`;

			await transporter.sendMail({
				from: `"${creds.fromName}" <${creds.from}>`,
				to: targetEmail,
				subject: `[${brand.APP_NAME}] SMTP Transport Verification Test ✅`,
				html: testHtml,
			});

			const totalLatency = Date.now() - startTime;
			return {
				success: true,
				message: `SMTP handshake verified and live test email successfully delivered to ${targetEmail} (${totalLatency}ms total).`,
				latencyMs: totalLatency,
			};
		}

		return {
			success: true,
			message: `SMTP server handshake and credentials verified successfully (${handshakeLatency}ms). Ready to send notifications.`,
			latencyMs: handshakeLatency,
		};
	} catch (err: any) {
		const latencyMs = Date.now() - startTime;
		return {
			success: false,
			message: `SMTP connection failed: ${err?.message || "Unknown error"}`,
			latencyMs,
		};
	}
}

/**
 * Platform Admin: Sends a live sample email for any notification template in the platform catalog.
 */
export async function sendSampleEmailNotification(
	templateId: string,
	targetEmail: string,
): Promise<{ success: boolean; message: string; template: string }> {
	if (!targetEmail || !targetEmail.includes("@")) {
		throw new Error("Invalid recipient email address.");
	}

	const creds = await getSmtpResolvedCredentials();
	if (!creds.configured) {
		throw new Error("SMTP is not configured yet. Please configure SMTP host and credentials first.");
	}

	const appBaseUrl = `https://${creds.host || brand.PLATFORM_SUBDOMAIN_BASE || "panel.hatdot.cloud"}`;

	switch (templateId) {
		case "verify-email": {
			const { sendVerificationEmail } = await import("../verification/send-verification-email");
			await sendVerificationEmail({
				userName: "Administrator",
				email: targetEmail,
				verificationUrl: `${appBaseUrl}/verify-email?token=sample_diagnostic_token`,
			});
			return {
				success: true,
				message: `Account Email Verification sample sent to ${targetEmail}`,
				template: "verify-email.tsx",
			};
		}

		case "invitation": {
			const { sendInvitationEmail } = await import("../verification/send-verification-email");
			await sendInvitationEmail({
				email: targetEmail,
				inviteLink: `${appBaseUrl}/invitation/sample_token_invitation`,
				organizationName: "Production Engineering Team",
			});
			return {
				success: true,
				message: `Team Invitation sample sent to ${targetEmail}`,
				template: "invitation.tsx",
			};
		}

		case "password-reset": {
			const resetHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 520px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7;">
    <div style="background-color: #09090b; padding: 32px 40px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0;">${brand.APP_NAME}</h1>
      <p style="color: #a1a1aa; font-size: 11px; font-weight: 600; text-transform: uppercase; margin: 4px 0 0 0;">Security Service</p>
    </div>
    <div style="padding: 40px 40px 32px;">
      <h2 style="color: #09090b; font-size: 22px; font-weight: 600; margin: 0 0 12px;">Reset Your Password</h2>
      <p style="color: #71717a; font-size: 14px; line-height: 24px; margin: 0 0 28px;">
        Hello Administrator, this is a sample password reset notification to verify your email template delivery.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${appBaseUrl}/reset-password?token=sample_token" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Reset Password</a>
      </div>
      <p style="color: #d97706; font-size: 12px; text-align: center; font-weight: 500;">
        ⏱️ For security, password reset links expire in 1 hour.
      </p>
    </div>
    <div style="background-color: #fafafa; padding: 20px 40px; text-align: center; border-top: 1px solid #e4e4e7;">
      <p style="color: #a1a1aa; font-size: 12px; margin: 0;">${brand.COPYRIGHT}</p>
    </div>
  </div>
</body>
</html>`;
			await sendPlatformMail({
				to: targetEmail,
				subject: `Reset your ${brand.APP_NAME} password (Sample)`,
				html: resetHtml,
				text: `Reset your password at: ${appBaseUrl}/reset-password?token=sample_token`,
			});
			return {
				success: true,
				message: `Password Reset sample sent to ${targetEmail}`,
				template: "auth.ts (Security)",
			};
		}

		case "invoice-notification": {
			const { render } = await import("@react-email/components");
			const InvoiceNotificationEmail = (await import("../emails/emails/invoice-notification")).default;
			const html = await render(
				InvoiceNotificationEmail({
					userName: "Administrator",
					invoiceNumber: "INV-2026-0842",
					amountPaid: "$49.00",
					currency: "USD",
					date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
					hostedInvoiceUrl: `${appBaseUrl}/dashboard/settings/billing`,
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Invoice & Receipt #INV-2026-0842 — ${brand.APP_NAME}`,
				html,
			});
			return {
				success: true,
				message: `Invoice & Receipt sample sent to ${targetEmail}`,
				template: "invoice-notification.tsx",
			};
		}

		case "payment-failed": {
			const { render } = await import("@react-email/components");
			const PaymentFailedEmail = (await import("../emails/emails/payment-failed")).default;
			const html = await render(
				PaymentFailedEmail({
					userName: "Administrator",
					invoiceNumber: "INV-2026-0842",
					amountDue: "$49.00",
					currency: "USD",
					date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
					hostedInvoiceUrl: `${appBaseUrl}/dashboard/settings/billing`,
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Payment failed for invoice #INV-2026-0842 — Action required`,
				html,
			});
			return {
				success: true,
				message: `Payment Failure Alert sample sent to ${targetEmail}`,
				template: "payment-failed.tsx",
			};
		}

		case "trial-expiring": {
			const { render } = await import("@react-email/components");
			const TrialExpiringEmail = (await import("../emails/emails/trial-expiring")).default;
			const html = await render(
				TrialExpiringEmail({
					userName: "Administrator",
					planName: "Pro Tier",
					daysRemaining: 3,
					endsOn: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
					billingUrl: `${appBaseUrl}/dashboard/settings/billing`,
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Your ${brand.APP_NAME} trial ends in 3 days`,
				html,
			});
			return {
				success: true,
				message: `Trial Expiration Warning sample sent to ${targetEmail}`,
				template: "trial-expiring.tsx",
			};
		}

		case "build-failed": {
			const { render } = await import("@react-email/components");
			const BuildFailedEmail = (await import("../emails/emails/build-failed")).default;
			const html = await render(
				BuildFailedEmail({
					projectName: "production-core",
					applicationName: "api-gateway",
					applicationType: "application",
					errorMessage: "Process exited with code 1: Memory quota exceeded during bundle compilation.",
					buildLink: `${appBaseUrl}/dashboard`,
					date: new Date().toLocaleString(),
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Build failed for api-gateway on ${brand.APP_NAME}`,
				html,
			});
			return {
				success: true,
				message: `Build Failure Notification sample sent to ${targetEmail}`,
				template: "build-failed.tsx",
			};
		}

		case "build-success": {
			const { render } = await import("@react-email/components");
			const BuildSuccessEmail = (await import("../emails/emails/build-success")).default;
			const html = await render(
				BuildSuccessEmail({
					projectName: "production-core",
					applicationName: "web-frontend",
					applicationType: "application",
					environmentName: "production",
					buildLink: `${appBaseUrl}/dashboard`,
					date: new Date().toLocaleString(),
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Build successful for web-frontend on ${brand.APP_NAME}`,
				html,
			});
			return {
				success: true,
				message: `Build Success Notification sample sent to ${targetEmail}`,
				template: "build-success.tsx",
			};
		}

		case "database-backup": {
			const { render } = await import("@react-email/components");
			const DatabaseBackupEmail = (await import("../emails/emails/database-backup")).default;
			const html = await render(
				DatabaseBackupEmail({
					applicationName: "postgres-primary",
					databaseType: "postgres",
					projectName: "production-core",
					type: "success",
					date: new Date().toLocaleString(),
				}),
			);
			await sendPlatformMail({
				to: targetEmail,
				subject: `Database backup completed for postgres-primary`,
				html,
			});
			return {
				success: true,
				message: `Database Backup sample sent to ${targetEmail}`,
				template: "database-backup.tsx",
			};
		}

		default:
			throw new Error(`Unknown notification template: '${templateId}'`);
	}
}


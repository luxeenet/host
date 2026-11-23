/**
 * Billing Cycle Service
 *
 * Manages the full subscription lifecycle:
 *   trial → pending_payment / active → past_due → grace_period → suspended → expired
 *
 * Enforces customer resource suspension on overdue payment and automated
 * data cleanup after retention expiry, while delivering multi-stage email notifications.
 *
 * Called by the billing cron job on a schedule.
 */
import { and, eq, lt, or } from "drizzle-orm";
import { brand } from "@paas/branding";
import { db } from "../db";
import * as schema from "../db/schema";
import { nanoid } from "nanoid";
import { getDokployUrl } from "./admin";
import { sendEmail } from "../verification/send-verification-email";
import {
	stopService,
	stopServiceRemote,
	startService,
	startServiceRemote,
	removeService,
} from "../utils/docker/utils";
import { stopCompose, startCompose, removeCompose } from "./compose";
import { deleteProject } from "./project";
import { removeTraefikConfig } from "../utils/traefik/application";
import { removeDirectoryCode } from "../utils/filesystem/directory";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const now = () => new Date();

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

async function getIntSetting(key: string, fallback: number): Promise<number> {
	const row = await db.query.platformSettings.findFirst({
		where: eq(schema.platformSettings.key, key),
	});
	const val = Number.parseInt(row?.value ?? "", 10);
	return Number.isNaN(val) ? fallback : val;
}

// ─────────────────────────────────────────────────────────────
// 1. Expire trials
// ─────────────────────────────────────────────────────────────

/**
 * Move subscriptions from "trial" → "pending_payment" when trial_ends_at has passed.
 */
export async function expireTrials(): Promise<number> {
	const expired = await db.query.subscriptions.findMany({
		where: and(
			eq(schema.subscriptions.status, "trial"),
			lt(schema.subscriptions.trialEndsAt, now()),
		),
	});

	if (expired.length === 0) return 0;

	for (const sub of expired) {
		await db
			.update(schema.subscriptions)
			.set({ status: "pending_payment", updatedAt: now() })
			.where(eq(schema.subscriptions.id, sub.id));

		// Generate invoice for the new billing period
		await generateRenewalInvoice(sub.id, sub.organizationId, sub.planId);
	}

	console.log(`[billing] Expired ${expired.length} trials → pending_payment`);
	return expired.length;
}

// ─────────────────────────────────────────────────────────────
// 2. Renew active subscriptions
// ─────────────────────────────────────────────────────────────

/**
 * For "active" subscriptions whose current_period_end has passed,
 * generate a new invoice and advance the billing period.
 */
export async function renewActiveSubscriptions(): Promise<number> {
	const due = await db.query.subscriptions.findMany({
		where: and(
			eq(schema.subscriptions.status, "active"),
			lt(schema.subscriptions.currentPeriodEnd, now()),
		),
		with: { plan: true },
	});

	if (due.length === 0) return 0;

	for (const sub of due) {
		const nextStart = sub.currentPeriodEnd;
		const nextEnd =
			sub.plan.billingCycle === "yearly"
				? addDays(nextStart, 365)
				: addDays(nextStart, 30);

		await db
			.update(schema.subscriptions)
			.set({
				status: "past_due",
				currentPeriodStart: nextStart,
				currentPeriodEnd: nextEnd,
				updatedAt: now(),
			})
			.where(eq(schema.subscriptions.id, sub.id));

		await generateRenewalInvoice(sub.id, sub.organizationId, sub.planId);
	}

	console.log(`[billing] Renewed ${due.length} subscriptions → past_due`);
	return due.length;
}

// ─────────────────────────────────────────────────────────────
// 3. Apply grace period
// ─────────────────────────────────────────────────────────────

/**
 * Move "past_due" → "grace_period" after configured grace period days.
 * Also send suspension warning email to organization owner.
 */
export async function applyGracePeriod(): Promise<number> {
	const graceDays = await getIntSetting("grace_period_days", 3);

	// Find past_due subs with open invoices older than graceDays
	const pastDue = await db.query.subscriptions.findMany({
		where: eq(schema.subscriptions.status, "past_due"),
	});

	let count = 0;
	for (const sub of pastDue) {
		// Find the oldest open invoice for this sub
		const invoice = await db.query.invoices.findFirst({
			where: and(
				eq(schema.invoices.subscriptionId, sub.id),
				eq(schema.invoices.status, "open"),
			),
		});

		if (!invoice) continue;

		const daysOverdue =
			(now().getTime() - invoice.dueDate.getTime()) / 86400000;

		if (daysOverdue >= graceDays) {
			const graceEndsAt = addDays(now(), graceDays);
			await db
				.update(schema.subscriptions)
				.set({
					status: "grace_period",
					gracePeriodEndsAt: graceEndsAt,
					updatedAt: now(),
				})
				.where(eq(schema.subscriptions.id, sub.id));

			console.log(
				`[billing] Sub ${sub.id} → grace_period until ${graceEndsAt.toISOString()}`,
			);

			// Send customer warning email
			await sendBillingNotification(sub.organizationId, "grace_period", {
				graceDays,
				graceEndsAt,
				amount: invoice.amount,
				currency: invoice.currency,
			});

			count++;
		}
	}

	return count;
}

// ─────────────────────────────────────────────────────────────
// 4. Suspend after grace period & stop running services
// ─────────────────────────────────────────────────────────────

/**
 * Move "grace_period" → "suspended" when grace period expires.
 * STOPS all customer running containers (applications, databases, compose)
 * to prevent unpaid resource usage while preserving data.
 */
export async function suspendExpiredGracePeriods(): Promise<number> {
	const toSuspend = await db.query.subscriptions.findMany({
		where: and(
			eq(schema.subscriptions.status, "grace_period"),
			lt(schema.subscriptions.gracePeriodEndsAt, now()),
		),
	});

	if (toSuspend.length === 0) return 0;

	for (const sub of toSuspend) {
		await db
			.update(schema.subscriptions)
			.set({ status: "suspended", suspendedAt: now(), updatedAt: now() })
			.where(eq(schema.subscriptions.id, sub.id));

		// Stop all running containers and services for this tenant
		await stopOrganizationServices(sub.organizationId);

		// Send urgent suspension notification
		await sendBillingNotification(sub.organizationId, "suspended");

		console.log(`[billing] Sub ${sub.id} SUSPENDED — services stopped, data preserved`);
	}

	return toSuspend.length;
}

// ─────────────────────────────────────────────────────────────
// 4b. Deprovision expired organizations after retention period
// ─────────────────────────────────────────────────────────────

/**
 * Handle organizations that have remained suspended beyond data_retention_days_after_expiry.
 * - Warns 3 days before final permanent deletion.
 * - Permanently deprovisions services and marks status as "expired".
 */
export async function deprovisionExpiredOrganizations(): Promise<number> {
	const retentionDays = await getIntSetting("data_retention_days_after_expiry", 14);
	const retentionCutoff = addDays(now(), -retentionDays);
	const warningCutoff = addDays(retentionCutoff, 3); // 3 days before final deletion

	const suspendedSubs = await db.query.subscriptions.findMany({
		where: eq(schema.subscriptions.status, "suspended"),
	});

	let deprovisionedCount = 0;
	for (const sub of suspendedSubs) {
		if (!sub.suspendedAt) continue;

		// 1. Retention period exceeded: permanently deprovision
		if (sub.suspendedAt <= retentionCutoff) {
			console.log(`[billing] Sub ${sub.id} (org ${sub.organizationId}) exceeded ${retentionDays}d retention. Deprovisioning...`);
			await deprovisionOrganizationResources(sub.organizationId);

			await db
				.update(schema.subscriptions)
				.set({
					status: "expired",
					expiredAt: now(),
					updatedAt: now(),
				})
				.where(eq(schema.subscriptions.id, sub.id));

			await sendBillingNotification(sub.organizationId, "expired", {
				retentionDays,
			});

			deprovisionedCount++;
		}
		// 2. Final warning: 3 days before cutoff
		else if (sub.suspendedAt <= warningCutoff) {
			const meta = ((sub.metadata as any) || {}) as Record<string, any>;
			if (!meta.finalDeletionWarningSent) {
				const msRemaining = (sub.suspendedAt.getTime() + retentionDays * 86400000) - now().getTime();
				const daysRemaining = Math.max(1, Math.ceil(msRemaining / 86400000));

				await sendBillingNotification(sub.organizationId, "final_warning", {
					daysRemaining,
				});

				await db
					.update(schema.subscriptions)
					.set({
						metadata: { ...meta, finalDeletionWarningSent: true },
						updatedAt: now(),
					})
					.where(eq(schema.subscriptions.id, sub.id));

				console.log(`[billing] Sent final deletion warning for sub ${sub.id} (${daysRemaining}d remaining)`);
			}
		}
	}

	return deprovisionedCount;
}

// ─────────────────────────────────────────────────────────────
// 4c. Resource Lifecycle: Stop, Start, and Deprovision
// ─────────────────────────────────────────────────────────────

/**
 * Scale down / stop all running services for an organization.
 * Preserves code, databases, storage volumes, and configuration.
 */
export async function stopOrganizationServices(
	organizationId: string,
): Promise<{ stopped: number }> {
	let count = 0;
	try {
		const orgProjects = await db.query.projects.findMany({
			where: eq(schema.projects.organizationId, organizationId),
			with: {
				environments: {
					with: {
						applications: true,
						postgres: true,
						mariadb: true,
						mysql: true,
						mongo: true,
						redis: true,
						libsql: true,
						compose: true,
					},
				},
			},
		});

		for (const project of orgProjects) {
			for (const env of project.environments) {
				// Standalone applications
				for (const app of env.applications) {
					try {
						if (app.serverId) {
							await stopServiceRemote(app.serverId, app.appName);
						} else {
							await stopService(app.appName);
						}
						count++;
					} catch (err) {
						console.error(`[billing] Error stopping application ${app.appName}:`, err);
					}
				}

				// Databases
				const dbs = [
					...env.postgres,
					...env.mariadb,
					...env.mysql,
					...env.mongo,
					...env.redis,
					...env.libsql,
				];
				for (const d of dbs) {
					try {
						if (d.serverId) {
							await stopServiceRemote(d.serverId, d.appName);
						} else {
							await stopService(d.appName);
						}
						count++;
					} catch (err) {
						console.error(`[billing] Error stopping database ${d.appName}:`, err);
					}
				}

				// Compose services
				for (const comp of env.compose) {
					try {
						await stopCompose(comp.composeId);
						count++;
					} catch (err) {
						console.error(`[billing] Error stopping compose ${comp.appName}:`, err);
					}
				}
			}
		}
	} catch (err) {
		console.error(`[billing] Error fetching services for org ${organizationId}:`, err);
	}

	console.log(`[billing] Stopped ${count} services for org ${organizationId}`);
	return { stopped: count };
}

/**
 * Restart all stopped services for an organization upon payment confirmation.
 */
export async function startOrganizationServices(
	organizationId: string,
): Promise<{ started: number }> {
	let count = 0;
	try {
		const orgProjects = await db.query.projects.findMany({
			where: eq(schema.projects.organizationId, organizationId),
			with: {
				environments: {
					with: {
						applications: true,
						postgres: true,
						mariadb: true,
						mysql: true,
						mongo: true,
						redis: true,
						libsql: true,
						compose: true,
					},
				},
			},
		});

		for (const project of orgProjects) {
			for (const env of project.environments) {
				// Standalone applications
				for (const app of env.applications) {
					try {
						if (app.serverId) {
							await startServiceRemote(app.serverId, app.appName);
						} else {
							await startService(app.appName);
						}
						count++;
					} catch (err) {
						console.error(`[billing] Error starting application ${app.appName}:`, err);
					}
				}

				// Databases
				const dbs = [
					...env.postgres,
					...env.mariadb,
					...env.mysql,
					...env.mongo,
					...env.redis,
					...env.libsql,
				];
				for (const d of dbs) {
					try {
						if (d.serverId) {
							await startServiceRemote(d.serverId, d.appName);
						} else {
							await startService(d.appName);
						}
						count++;
					} catch (err) {
						console.error(`[billing] Error starting database ${d.appName}:`, err);
					}
				}

				// Compose services
				for (const comp of env.compose) {
					try {
						await startCompose(comp.composeId);
						count++;
					} catch (err) {
						console.error(`[billing] Error starting compose ${comp.appName}:`, err);
					}
				}
			}
		}
	} catch (err) {
		console.error(`[billing] Error fetching services to restart for org ${organizationId}:`, err);
	}

	console.log(`[billing] Restarted ${count} services for org ${organizationId}`);
	return { started: count };
}

/**
 * Permanently purge all applications, databases, volumes, and projects for an expired organization.
 */
export async function deprovisionOrganizationResources(
	organizationId: string,
): Promise<void> {
	try {
		const orgProjects = await db.query.projects.findMany({
			where: eq(schema.projects.organizationId, organizationId),
			with: {
				environments: {
					with: {
						applications: true,
						postgres: true,
						mariadb: true,
						mysql: true,
						mongo: true,
						redis: true,
						libsql: true,
						compose: true,
					},
				},
			},
		});

		for (const project of orgProjects) {
			for (const env of project.environments) {
				for (const app of env.applications) {
					try {
						await removeTraefikConfig(app.appName, app.serverId);
					} catch (_) {}
					try {
						await removeService(app.appName, app.serverId);
					} catch (_) {}
					try {
						await removeDirectoryCode(app.appName, app.serverId);
					} catch (_) {}
				}

				for (const comp of env.compose) {
					try {
						await removeCompose(comp, true);
					} catch (_) {}
				}

				const dbs = [
					...env.postgres,
					...env.mariadb,
					...env.mysql,
					...env.mongo,
					...env.redis,
					...env.libsql,
				];
				for (const d of dbs) {
					try {
						await removeService(d.appName, d.serverId);
					} catch (_) {}
				}
			}

			try {
				await deleteProject(project.projectId);
			} catch (err) {
				console.error(`[billing] Error deleting project ${project.projectId}:`, err);
			}
		}
	} catch (err) {
		console.error(`[billing] Error deprovisioning org ${organizationId}:`, err);
	}
}

// ─────────────────────────────────────────────────────────────
// 5. Generate renewal invoice
// ─────────────────────────────────────────────────────────────

async function generateRenewalInvoice(
	subscriptionId: string,
	organizationId: string,
	planId: string,
): Promise<void> {
	const plan = await db.query.plans.findFirst({
		where: eq(schema.plans.id, planId),
	});

	if (!plan || Number(plan.price) === 0) return;

	const count = await db.$count(schema.invoices);
	const year = new Date().getFullYear();
	const invoiceNumber = `INV-${year}-${String(count + 1).padStart(5, "0")}`;

	const periodStart = now();
	const periodEnd =
		plan.billingCycle === "yearly"
			? addDays(periodStart, 365)
			: addDays(periodStart, 30);

	const dueDate = addDays(now(), 7); // 7 day payment window

	await db.insert(schema.invoices).values({
		id: nanoid(),
		subscriptionId,
		organizationId,
		invoiceNumber,
		amount: plan.price,
		currency: plan.currency,
		status: "open",
		dueDate,
		periodStart,
		periodEnd,
		metadata: {
			renewalGeneratedAt: new Date().toISOString(),
			lastReminderSentAt: new Date().toISOString(),
			reminderCount: 0,
		},
	});

	// Dispatch renewal invoice notification immediately to organization owner
	await sendBillingNotification(organizationId, "invoice_generated", {
		amount: plan.price,
		currency: plan.currency,
		invoiceNumber,
		dueDate,
	});
}

// ─────────────────────────────────────────────────────────────
// 6. Activate paid subscriptions & auto-restart services
// ─────────────────────────────────────────────────────────────

/**
 * When a payment is confirmed, activate the subscription.
 * If services were previously suspended, automatically restart them.
 * Called from the payment router on successful verification.
 */
export async function activateSubscriptionOnPayment(
	subscriptionId: string,
): Promise<void> {
	const sub = await db.query.subscriptions.findFirst({
		where: eq(schema.subscriptions.id, subscriptionId),
		with: { plan: true },
	});

	if (!sub) return;

	const wasSuspended = sub.status === "suspended" || Boolean(sub.suspendedAt);

	const nextEnd =
		sub.plan.billingCycle === "yearly"
			? addDays(now(), 365)
			: addDays(now(), 30);

	await db
		.update(schema.subscriptions)
		.set({
			status: "active",
			currentPeriodStart: now(),
			currentPeriodEnd: nextEnd,
			gracePeriodEndsAt: null,
			suspendedAt: null,
			failedPaymentCount: "0",
			updatedAt: now(),
		})
		.where(eq(schema.subscriptions.id, subscriptionId));

	// Automatically restart all stopped services if previously suspended
	if (wasSuspended) {
		await startOrganizationServices(sub.organizationId);
	}

	// Send customer payment confirmation & reactivation notification
	await sendBillingNotification(sub.organizationId, "reactivated");
}

// ─────────────────────────────────────────────────────────────
// 7. Multi-stage Customer Email Notifications
// ─────────────────────────────────────────────────────────────

/**
 * Delivers professional, branded HTML notification emails to the customer/owner
 * across every stage of the billing lifecycle (grace period, suspension, final warning, etc.)
 */
export type BillingNotificationType =
	| "invoice_generated"
	| "invoice_reminder"
	| "payment_overdue"
	| "grace_period"
	| "grace_period_urgent"
	| "suspended"
	| "final_warning"
	| "expired"
	| "reactivated"
	| "trial_expiring";

export interface BillingNotificationDetails {
	invoiceNumber?: string;
	amount?: string;
	currency?: string;
	dueDate?: Date | string;
	graceDays?: number;
	graceEndsAt?: Date | string;
	hoursRemaining?: number;
	daysRemaining?: number;
	planName?: string;
	trialEndsAt?: Date | string;
	retentionDays?: number;
}

/**
 * Builds a responsive, professional HTML billing email matching HatDot platform design.
 */
function buildBillingEmailHtml({
	title,
	badgeText,
	badgeColor,
	userName,
	paragraphs,
	tableRows,
	ctaText,
	ctaUrl,
	secondaryText,
}: {
	title: string;
	badgeText: string;
	badgeColor: { bg: string; border: string; text: string };
	userName: string;
	paragraphs: string[];
	tableRows?: { label: string; value: string }[];
	ctaText: string;
	ctaUrl: string;
	secondaryText?: string;
}): string {
	const tableHtml = tableRows && tableRows.length > 0
		? `
			<table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #fafafa; border-radius: 8px; overflow: hidden; border: 1px solid #e4e4e7;">
				${tableRows
					.map(
						(row, idx) => `
					<tr style="${idx < tableRows.length - 1 ? "border-bottom: 1px solid #e4e4e7;" : ""}">
						<td style="padding: 12px 16px; color: #71717a; font-size: 13px; font-weight: 500;">${row.label}</td>
						<td style="padding: 12px 16px; color: #09090b; font-size: 13px; font-weight: 600; text-align: right;">${row.value}</td>
					</tr>
				`,
					)
					.join("")}
			</table>
		`
		: "";

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 560px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <!-- Platform Header -->
    <div style="background-color: #09090b; padding: 28px 36px; text-align: center;">
      <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">${brand.APP_NAME}</h1>
      <p style="color: #a1a1aa; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0 0 0;">Cloud Platform & Billing</p>
    </div>

    <!-- Content -->
    <div style="padding: 36px 36px 28px;">
      <div style="display: inline-block; background-color: ${badgeColor.bg}; border: 1px solid ${badgeColor.border}; color: ${badgeColor.text}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 6px; margin-bottom: 16px;">
        ${badgeText}
      </div>
      <h2 style="color: #09090b; font-size: 20px; font-weight: 700; margin: 0 0 16px;">${title}</h2>
      <p style="color: #3f3f46; font-size: 14px; line-height: 22px; margin: 0 0 14px;">
        Hello ${userName},
      </p>
      ${paragraphs.map((p) => `<p style="color: #52525b; font-size: 14px; line-height: 22px; margin: 0 0 14px;">${p}</p>`).join("")}

      ${tableHtml}

      <div style="text-align: center; margin: 28px 0 20px;">
        <a href="${ctaUrl}" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">${ctaText}</a>
      </div>

      ${
				secondaryText
					? `<p style="color: #71717a; font-size: 12px; line-height: 18px; margin: 20px 0 0; text-align: center; border-top: 1px solid #f4f4f5; padding-top: 16px;">${secondaryText}</p>`
					: ""
			}
    </div>

    <!-- Platform Footer -->
    <div style="background-color: #fafafa; padding: 20px 36px; text-align: center; border-top: 1px solid #e4e4e7;">
      <p style="color: #a1a1aa; font-size: 12px; line-height: 18px; margin: 0;">
        Sent securely from <a href="${brand.MARKETING_URL}" style="color: #71717a; text-decoration: underline;">${brand.APP_NAME} Cloud</a>. Questions? Contact <a href="mailto:${brand.SUPPORT_EMAIL}" style="color: #71717a; text-decoration: underline;">${brand.SUPPORT_EMAIL}</a>.
      </p>
      <p style="color: #a1a1aa; font-size: 11px; line-height: 16px; margin: 8px 0 0 0;">
        ${brand.COPYRIGHT}
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Delivers professional, branded HTML notification emails to the customer/owner
 * across every stage of the billing lifecycle (grace period, suspension, final warning, etc.)
 */
export async function sendBillingNotification(
	organizationId: string,
	type: BillingNotificationType,
	details?: BillingNotificationDetails,
): Promise<boolean> {
	try {
		const ownerMember = await db.query.member.findFirst({
			where: and(
				eq(schema.member.organizationId, organizationId),
				eq(schema.member.role, "owner"),
			),
			with: {
				user: true,
				organization: true,
			},
		});

		const recipientEmail = ownerMember?.user?.email;
		if (!recipientEmail) {
			console.warn(`[billing] No owner email found for org ${organizationId}`);
			return false;
		}

		const orgName = ownerMember?.organization?.name || "Your Workspace";
		const userName =
			`${ownerMember?.user?.firstName || ""} ${ownerMember?.user?.lastName || ""}`.trim() ||
			"Customer";
		const baseUrl =
			(await getDokployUrl()) || brand.APP_URL || "https://hatdot.cloud";
		const billingUrl = `${baseUrl}/dashboard/settings/billing`;

		let subject = "";
		let htmlContent = "";

		const formatCurrency = (amt?: string, curr?: string) => {
			if (!amt) return "N/A";
			return `${(curr || brand.DEFAULT_CURRENCY).toUpperCase()} ${Number(amt).toLocaleString()}`;
		};

		const formatDate = (d?: Date | string) => {
			if (!d) return "N/A";
			const dateObj = typeof d === "string" ? new Date(d) : d;
			return dateObj.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		};

		switch (type) {
			case "invoice_generated": {
				subject = `New Invoice #${details?.invoiceNumber || "INV"} for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "New Subscription Invoice Ready",
					badgeText: "Invoice Generated",
					badgeColor: { bg: "#e0f2fe", border: "#7dd3fc", text: "#0369a1" },
					userName,
					paragraphs: [
						`A new renewal invoice has been generated for your workspace <strong>${orgName}</strong>.`,
						"You can review your breakdown, download a receipt, and settle your balance online using M-Pesa, Card, or Bank Transfer.",
					],
					tableRows: [
						{ label: "Invoice Number", value: details?.invoiceNumber || "N/A" },
						{ label: "Amount Due", value: formatCurrency(details?.amount, details?.currency) },
						{ label: "Due Date", value: formatDate(details?.dueDate) },
						{ label: "Workspace", value: orgName },
					],
					ctaText: "View & Pay Invoice",
					ctaUrl: billingUrl,
					secondaryText: "Automatic recurring renewal ensures uninterrupted cloud service availability.",
				});
				break;
			}

			case "invoice_reminder": {
				subject = `Payment Reminder: Invoice #${details?.invoiceNumber || "INV"} for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Friendly Payment Reminder",
					badgeText: "Payment Reminder",
					badgeColor: { bg: "#fef3c7", border: "#fde047", text: "#854d0e" },
					userName,
					paragraphs: [
						`This is a friendly reminder that invoice <strong>#${details?.invoiceNumber || "INV"}</strong> for <strong>${orgName}</strong> is pending payment.`,
						`Please complete payment by <strong>${formatDate(details?.dueDate)}</strong> to avoid any interruption to your applications and database services.`,
					],
					tableRows: [
						{ label: "Invoice Number", value: details?.invoiceNumber || "N/A" },
						{ label: "Amount Due", value: formatCurrency(details?.amount, details?.currency) },
						{ label: "Due Date", value: formatDate(details?.dueDate) },
						{ label: "Status", value: "Pending Payment" },
					],
					ctaText: "Pay Invoice Now",
					ctaUrl: billingUrl,
					secondaryText: "Supported payment options: M-Pesa, Visa, Mastercard, and Mobile Wallets.",
				});
				break;
			}

			case "payment_overdue": {
				subject = `Action Required: Invoice #${details?.invoiceNumber || "INV"} Overdue for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Invoice Past Due — Immediate Action Required",
					badgeText: "Payment Overdue",
					badgeColor: { bg: "#fee2e2", border: "#fca5a5", text: "#991b1b" },
					userName,
					paragraphs: [
						`Invoice <strong>#${details?.invoiceNumber || "INV"}</strong> for <strong>${orgName}</strong> has passed its due date (${formatDate(details?.dueDate)}) without received payment.`,
						"To prevent automated suspension of your running containers and public endpoints, please settle the outstanding balance immediately.",
					],
					tableRows: [
						{ label: "Invoice Number", value: details?.invoiceNumber || "N/A" },
						{ label: "Amount Overdue", value: formatCurrency(details?.amount, details?.currency) },
						{ label: "Original Due Date", value: formatDate(details?.dueDate) },
						{ label: "Status", value: "Overdue" },
					],
					ctaText: "Settle Overdue Balance",
					ctaUrl: billingUrl,
					secondaryText: "Need assistance or payment arrangement? Reply directly to this email or reach support.",
				});
				break;
			}

			case "grace_period": {
				subject = `Action Required: Payment Past Due for ${orgName} — Grace Period Active`;
				htmlContent = buildBillingEmailHtml({
					title: "Payment Past Due — Grace Period Active",
					badgeText: "Grace Period Active",
					badgeColor: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
					userName,
					paragraphs: [
						`We were unable to process the subscription renewal for <strong>${orgName}</strong>.`,
						`Your applications, databases, and network services are currently <strong>still running</strong> under a <strong>${details?.graceDays || 3}-day grace period</strong>.`,
						`Please settle your balance before <strong>${formatDate(details?.graceEndsAt)}</strong> to avoid automated service suspension.`,
					],
					tableRows: [
						{ label: "Workspace", value: orgName },
						{ label: "Grace Period Ends", value: formatDate(details?.graceEndsAt) },
						{ label: "Amount Due", value: formatCurrency(details?.amount, details?.currency) },
					],
					ctaText: "Pay Invoice & Maintain Services",
					ctaUrl: billingUrl,
					secondaryText: "All container configurations and data remain secure during the grace period.",
				});
				break;
			}

			case "grace_period_urgent": {
				const timeText =
					details?.hoursRemaining && details.hoursRemaining < 24
						? `${details.hoursRemaining} hours`
						: `${details?.daysRemaining || 1} day(s)`;
				subject = `URGENT: ${timeText} Remaining in Grace Period for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Urgent: Service Suspension Imminent",
					badgeText: "Critical Warning",
					badgeColor: { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
					userName,
					paragraphs: [
						`Your subscription grace period for <strong>${orgName}</strong> will expire in approximately <strong>${timeText}</strong>.`,
						"Once expired, all active container workloads and database servers will be automatically paused to prevent unpaid compute usage.",
						"Settle your open invoice right away to keep your services active without downtime.",
					],
					tableRows: [
						{ label: "Time Remaining", value: timeText },
						{ label: "Scheduled Suspension", value: formatDate(details?.graceEndsAt) },
						{ label: "Workspace", value: orgName },
					],
					ctaText: "Renew Now to Prevent Suspension",
					ctaUrl: billingUrl,
					secondaryText: "Payment via M-Pesa or Card restores good standing instantly.",
				});
				break;
			}

			case "suspended": {
				subject = `URGENT: Services Suspended for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Services Paused due to Overdue Payment",
					badgeText: "Workloads Suspended",
					badgeColor: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b" },
					userName,
					paragraphs: [
						`The grace period for your subscription for <strong>${orgName}</strong> has ended without received payment.`,
						"Your running web applications, background workers, and databases have been <strong>temporarily stopped</strong> to prevent further charges.",
						"<strong>Your code, persistent volumes, and databases are completely safe.</strong> Nothing has been deleted. Settle your open invoice to automatically restart all services immediately.",
					],
					tableRows: [
						{ label: "Workspace", value: orgName },
						{ label: "Service Status", value: "Paused (Data Preserved)" },
						{ label: "Action", value: "Pay Invoice to Restart Services" },
					],
					ctaText: "Reactivate All Services Online",
					ctaUrl: billingUrl,
					secondaryText: "Services restart automatically within moments of payment confirmation.",
				});
				break;
			}

			case "final_warning": {
				subject = `FINAL NOTICE: Scheduled Data Decommissioning for ${orgName} in ${details?.daysRemaining || 3} Days`;
				htmlContent = buildBillingEmailHtml({
					title: "Final Warning: Data Deletion Scheduled",
					badgeText: "Permanent Erasure Warning",
					badgeColor: { bg: "#450a0a", border: "#dc2626", text: "#fecaca" },
					userName,
					paragraphs: [
						`Your subscription for <strong>${orgName}</strong> has remained suspended beyond the standard grace period.`,
						`In approximately <strong>${details?.daysRemaining || 3} days</strong>, all associated resources—including persistent database volumes, stored code, and server configurations—will be <strong>permanently deleted</strong> in accordance with our data retention policy.`,
						"To prevent irreversible data loss, please settle your overdue account balance immediately.",
					],
					tableRows: [
						{ label: "Workspace", value: orgName },
						{ label: "Days Remaining", value: `${details?.daysRemaining || 3} days` },
						{ label: "Policy", value: "Permanent Resource Decommissioning" },
					],
					ctaText: "Pay Invoice & Retain Data",
					ctaUrl: billingUrl,
					secondaryText: "Once decommissioned, volumes and databases cannot be recovered.",
				});
				break;
			}

			case "expired": {
				subject = `Notice: Account Services Decommissioned for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Notice: Workspace Resources Decommissioned",
					badgeText: "Account Expired",
					badgeColor: { bg: "#f4f4f5", border: "#d4d4d8", text: "#52525b" },
					userName,
					paragraphs: [
						`Because the data retention period of ${details?.retentionDays || 14} days has expired without payment, the container workloads and volumes for <strong>${orgName}</strong> have been decommissioned.`,
						"Your account remains accessible. You may create a fresh project or subscribe to a new plan at any time through your dashboard.",
					],
					ctaText: "Open Dashboard",
					ctaUrl: `${baseUrl}/dashboard/home`,
					secondaryText: `Thank you for having chosen ${brand.APP_NAME}. We hope to welcome you back soon.`,
				});
				break;
			}

			case "reactivated": {
				subject = `Payment Confirmed: Services Reactivated for ${orgName} — ${brand.APP_NAME}`;
				htmlContent = buildBillingEmailHtml({
					title: "Payment Confirmed — Services Online",
					badgeText: "Services Reactivated",
					badgeColor: { bg: "#dcfce7", border: "#86efac", text: "#166534" },
					userName,
					paragraphs: [
						`Thank you! Your payment for <strong>${orgName}</strong> has been received and confirmed.`,
						"All suspended applications, databases, and cloud services have been automatically restarted and are back online.",
					],
					tableRows: [
						{ label: "Workspace", value: orgName },
						{ label: "Status", value: "Active & Healthy" },
						{ label: "Payment Status", value: "Confirmed" },
					],
					ctaText: "Open Control Panel",
					ctaUrl: `${baseUrl}/dashboard/home`,
					secondaryText: "Thank you for trusting us with your cloud infrastructure.",
				});
				break;
			}

			case "trial_expiring": {
				const dayLabel = details?.daysRemaining === 1 ? "day" : "days";
				subject = `Your ${brand.APP_NAME} trial ends in ${details?.daysRemaining} ${dayLabel}`;
				htmlContent = buildBillingEmailHtml({
					title: "Your Free Trial Is Ending Soon",
					badgeText: "Trial Expiration",
					badgeColor: { bg: "#fef3c7", border: "#fde047", text: "#854d0e" },
					userName,
					paragraphs: [
						`Your trial period for <strong>${orgName}</strong> on the <strong>${details?.planName || "Cloud"}</strong> tier will end in <strong>${details?.daysRemaining} ${dayLabel}</strong> (${formatDate(details?.trialEndsAt)}).`,
						"Select a plan now to ensure your deployments, domains, and custom databases remain active without interruption.",
					],
					tableRows: [
						{ label: "Current Plan", value: details?.planName || "Trial" },
						{ label: "Trial Ends On", value: formatDate(details?.trialEndsAt) },
						{ label: "Time Left", value: `${details?.daysRemaining} ${dayLabel}` },
					],
					ctaText: "Choose a Plan to Stay Live",
					ctaUrl: billingUrl,
					secondaryText: "Need more time to evaluate? Contact our support team for an extension.",
				});
				break;
			}
		}

		try {
			await sendEmail({
				email: recipientEmail,
				subject,
				html: htmlContent,
				text: subject,
			});
		} catch (emailErr) {
			console.warn(`[billing] Email delivery skipped for ${recipientEmail}:`, (emailErr as any)?.message);
		}

		return true;
	} catch (err) {
		console.error(`[billing] Error sending billing notification to org ${organizationId}:`, err);
		return false;
	}
}

// ─────────────────────────────────────────────────────────────
// 8. Multi-Daily Billing Reminders & Notifications
// ─────────────────────────────────────────────────────────────

/**
 * Sends professional billing reminders more than once a day (every 8–12 hours)
 * for:
 *   - Open / overdue invoices pending payment (every 8h if overdue, 12h if pending)
 *   - Subscriptions actively in grace_period (every 8h for urgent countdown)
 *   - Subscriptions in trial nearing expiry (<= 3 days remaining, every 12h)
 *
 * Employs timestamps in metadata (`lastReminderSentAt`, `reminderCount`)
 * to ensure reliable, multi-daily frequency without duplicating within an 8-hour window.
 */
export async function sendBillingReminders(): Promise<{
	invoicesReminded: number;
	graceReminded: number;
	trialsReminded: number;
}> {
	let invoicesReminded = 0;
	let graceReminded = 0;
	let trialsReminded = 0;
	const nowMs = Date.now();

	// 1. Open invoices reminder (every 8 hours if overdue, every 12 hours if pending)
	try {
		const openInvoices = await db.query.invoices.findMany({
			where: eq(schema.invoices.status, "open"),
		});

		for (const inv of openInvoices) {
			const meta = ((inv.metadata as any) || {}) as Record<string, any>;
			const lastSent = meta.lastReminderSentAt
				? new Date(meta.lastReminderSentAt).getTime()
				: 0;
			const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : 0;
			const isOverdue = dueMs > 0 && dueMs < nowMs;
			// Overdue invoices reminded every 8h (3x per day); pending invoices every 12h (2x per day)
			const minIntervalMs = isOverdue
				? 8 * 60 * 60 * 1000
				: 12 * 60 * 60 * 1000;

			if (nowMs - lastSent >= minIntervalMs) {
				await sendBillingNotification(
					inv.organizationId,
					isOverdue ? "payment_overdue" : "invoice_reminder",
					{
						invoiceNumber: inv.invoiceNumber,
						amount: inv.amount,
						currency: inv.currency,
						dueDate: inv.dueDate,
					},
				);

				await db
					.update(schema.invoices)
					.set({
						metadata: {
							...meta,
							lastReminderSentAt: new Date().toISOString(),
							reminderCount: ((meta.reminderCount as number) || 0) + 1,
						},
						updatedAt: now(),
					})
					.where(eq(schema.invoices.id, inv.id));

				invoicesReminded++;
			}
		}
	} catch (invErr) {
		console.error("[billing] Error processing invoice reminders:", invErr);
	}

	// 2. Active grace period reminders (every 8 hours = up to 3x per day for critical urgency)
	try {
		const graceSubs = await db.query.subscriptions.findMany({
			where: eq(schema.subscriptions.status, "grace_period"),
		});

		const GRACE_INTERVAL_MS = 8 * 60 * 60 * 1000;

		for (const sub of graceSubs) {
			const meta = ((sub.metadata as any) || {}) as Record<string, any>;
			const lastSent = meta.lastGraceReminderSentAt
				? new Date(meta.lastGraceReminderSentAt).getTime()
				: 0;

			if (nowMs - lastSent >= GRACE_INTERVAL_MS) {
				const graceEndMs = sub.gracePeriodEndsAt
					? new Date(sub.gracePeriodEndsAt).getTime()
					: 0;
				const msRemaining = graceEndMs - nowMs;
				const hoursRemaining = Math.max(1, Math.round(msRemaining / (60 * 60 * 1000)));
				const daysRemaining = Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

				await sendBillingNotification(sub.organizationId, "grace_period_urgent", {
					graceEndsAt: sub.gracePeriodEndsAt || undefined,
					hoursRemaining,
					daysRemaining,
				});

				await db
					.update(schema.subscriptions)
					.set({
						metadata: {
							...meta,
							lastGraceReminderSentAt: new Date().toISOString(),
							graceReminderCount: ((meta.graceReminderCount as number) || 0) + 1,
						},
						updatedAt: now(),
					})
					.where(eq(schema.subscriptions.id, sub.id));

				graceReminded++;
			}
		}
	} catch (graceErr) {
		console.error("[billing] Error processing grace period reminders:", graceErr);
	}

	// 3. Subscriptions in trial ending within 3 days (every 12 hours = 2x per day)
	try {
		const trialSubs = await db.query.subscriptions.findMany({
			where: eq(schema.subscriptions.status, "trial"),
			with: { plan: true },
		});

		const TRIAL_INTERVAL_MS = 12 * 60 * 60 * 1000;

		for (const sub of trialSubs) {
			if (!sub.trialEndsAt) continue;
			const trialEndMs = new Date(sub.trialEndsAt).getTime();
			const msUntilEnd = trialEndMs - nowMs;
			// Remind if within 3 days (and not already expired)
			if (msUntilEnd > 0 && msUntilEnd <= 3 * 24 * 60 * 60 * 1000) {
				const meta = ((sub.metadata as any) || {}) as Record<string, any>;
				const lastSent = meta.lastTrialReminderSentAt
					? new Date(meta.lastTrialReminderSentAt).getTime()
					: 0;

				if (nowMs - lastSent >= TRIAL_INTERVAL_MS) {
					const daysRemaining = Math.max(1, Math.ceil(msUntilEnd / (24 * 60 * 60 * 1000)));

					await sendBillingNotification(sub.organizationId, "trial_expiring", {
						daysRemaining,
						planName: sub.plan?.name || "Trial",
						trialEndsAt: sub.trialEndsAt,
					});

					await db
						.update(schema.subscriptions)
						.set({
							metadata: {
								...meta,
								lastTrialReminderSentAt: new Date().toISOString(),
								trialReminderCount: ((meta.trialReminderCount as number) || 0) + 1,
							},
							updatedAt: now(),
						})
						.where(eq(schema.subscriptions.id, sub.id));

					trialsReminded++;
				}
			}
		}
	} catch (trialErr) {
		console.error("[billing] Error processing trial reminders:", trialErr);
	}

	return { invoicesReminded, graceReminded, trialsReminded };
}

// ─────────────────────────────────────────────────────────────
// 9. Main billing tick — runs all jobs in sequence
// ─────────────────────────────────────────────────────────────

export async function runBillingCycle(): Promise<void> {
	console.log("[billing] Running billing cycle tick...");
	try {
		const [t, r, g, s, d, reminders] = await Promise.all([
			expireTrials(),
			renewActiveSubscriptions(),
			applyGracePeriod(),
			suspendExpiredGracePeriods(),
			deprovisionExpiredOrganizations(),
			sendBillingReminders(),
		]);
		console.log(
			`[billing] Tick done — trials_expired=${t} renewals=${r} grace=${g} suspended=${s} deprovisioned=${d} reminders=${JSON.stringify(reminders)}`,
		);
	} catch (err) {
		console.error("[billing] Billing cycle error:", err);
	}
}

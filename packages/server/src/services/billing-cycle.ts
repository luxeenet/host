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
import { db } from "../db";
import * as schema from "../db/schema";
import { nanoid } from "nanoid";
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

	await db.insert(schema.invoices).values({
		id: nanoid(),
		subscriptionId,
		organizationId,
		invoiceNumber,
		amount: plan.price,
		currency: plan.currency,
		status: "open",
		dueDate: addDays(now(), 7), // 7 day payment window
		periodStart,
		periodEnd,
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
export async function sendBillingNotification(
	organizationId: string,
	type: "grace_period" | "suspended" | "final_warning" | "expired" | "reactivated",
	details?: {
		graceDays?: number;
		graceEndsAt?: Date;
		amount?: string;
		currency?: string;
		retentionDays?: number;
		daysRemaining?: number;
	},
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

		const orgName = ownerMember?.organization?.name || "Your Organization";
		const userName =
			`${ownerMember?.user?.firstName || ""} ${ownerMember?.user?.lastName || ""}`.trim() ||
			"Customer";
		const appUrl = process.env.BETTER_AUTH_URL || "";

		let subject = "";
		let htmlContent = "";

		switch (type) {
			case "grace_period": {
				subject = `[HatDot] Action Required: Payment Past Due for ${orgName}`;
				htmlContent = `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
						<h2 style="color: #f59e0b; margin-top: 0;">⚠️ Payment Past Due — Grace Period Active</h2>
						<p>Hi ${userName},</p>
						<p>We were unable to process the subscription renewal for <strong>${orgName}</strong>.</p>
						<p>Your applications, databases, and services are currently <strong>still running</strong> under a <strong>${details?.graceDays || 3}-day grace period</strong>.</p>
						<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px; margin: 18px 0; border-radius: 4px;">
							<p style="margin: 0; font-weight: 600; color: #92400e;">
								Please settle your open invoice before ${details?.graceEndsAt ? new Date(details.graceEndsAt).toLocaleDateString() : "the grace period ends"} to avoid service interruption and workload suspension.
							</p>
						</div>
						<p style="margin: 24px 0;">
							<a href="${appUrl}/dashboard/billing" style="display: inline-block; background: #6366f1; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pay Invoice & Renew Plan</a>
						</p>
						<p style="color: #64748b; font-size: 13px; border-top: 1px solid #f1f5f9; padding-top: 14px; margin-top: 24px;">If you need assistance with payment methods (M-Pesa, Card), please contact our support team.</p>
					</div>
				`;
				break;
			}
			case "suspended": {
				subject = `[HatDot] URGENT: Services Suspended for ${orgName}`;
				htmlContent = `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
						<h2 style="color: #ef4444; margin-top: 0;">🛑 Services Paused due to Overdue Payment</h2>
						<p>Hi ${userName},</p>
						<p>The grace period for your subscription for <strong>${orgName}</strong> has ended without payment.</p>
						<p>Your running applications and database services have been <strong>temporarily paused</strong> to prevent further charges.</p>
						<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 18px 0;">
							<p style="margin: 0; font-weight: bold; color: #334155;">🔒 Your Data and Code Are Safe:</p>
							<p style="margin: 8px 0 0 0; color: #64748b; font-size: 14px; line-height: 1.5;">
								All your persistent storage volumes, database files, code repositories, and environment variables are preserved intact.
								Settle your open invoice now to immediately restore all your services back online.
							</p>
						</div>
						<p style="margin: 24px 0;">
							<a href="${appUrl}/dashboard/billing" style="display: inline-block; background: #ef4444; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Reactivate Services Now</a>
						</p>
					</div>
				`;
				break;
			}
			case "final_warning": {
				subject = `[HatDot] FINAL NOTICE: Scheduled Data Decommissioning for ${orgName}`;
				htmlContent = `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
						<h2 style="color: #dc2626; margin-top: 0;">🚨 FINAL WARNING: Data Deletion Scheduled</h2>
						<p>Hi ${userName},</p>
						<p>Your subscription for <strong>${orgName}</strong> has remained suspended without payment.</p>
						<div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 14px; margin: 18px 0; border-radius: 4px;">
							<p style="margin: 0; font-weight: bold; color: #991b1b; line-height: 1.5;">
								In approximately ${details?.daysRemaining || 3} days, your applications, databases, code, and persistent storage volumes will be permanently decommissioned and erased.
							</p>
						</div>
						<p>To avoid permanent data loss, please pay your overdue balance immediately:</p>
						<p style="margin: 24px 0;">
							<a href="${appUrl}/dashboard/billing" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pay Invoice to Retain Data</a>
						</p>
					</div>
				`;
				break;
			}
			case "expired": {
				subject = `[HatDot] Notice: Account Services Decommissioned for ${orgName}`;
				htmlContent = `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
						<h2 style="color: #64748b; margin-top: 0;">Notice: Resources Decommissioned</h2>
						<p>Hi ${userName},</p>
						<p>Because the retention period of ${details?.retentionDays || 14} days expired without payment, the resources associated with <strong>${orgName}</strong> have been decommissioned.</p>
						<p>You can create a new project or subscribe to a new plan at any time through your HatDot dashboard.</p>
					</div>
				`;
				break;
			}
			case "reactivated": {
				subject = `[HatDot] Payment Confirmed: Services Reactivated for ${orgName}`;
				htmlContent = `
					<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
						<h2 style="color: #10b981; margin-top: 0;">✅ Services Successfully Reactivated</h2>
						<p>Hi ${userName},</p>
						<p>Thank you! Your payment for <strong>${orgName}</strong> has been confirmed.</p>
						<p>All your suspended applications, databases, and services have been automatically restarted and are now back online.</p>
						<p style="margin: 24px 0;">
							<a href="${appUrl}/dashboard/home" style="display: inline-block; background: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Open Dashboard</a>
						</p>
					</div>
				`;
				break;
			}
		}

		try {
			const { sendEmail } = await import("../verification/send-verification-email");
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
// 8. Main billing tick — runs all jobs in sequence
// ─────────────────────────────────────────────────────────────

export async function runBillingCycle(): Promise<void> {
	console.log("[billing] Running billing cycle tick...");
	try {
		const [t, r, g, s, d] = await Promise.all([
			expireTrials(),
			renewActiveSubscriptions(),
			applyGracePeriod(),
			suspendExpiredGracePeriods(),
			deprovisionExpiredOrganizations(),
		]);
		console.log(
			`[billing] Tick done — trials_expired=${t} renewals=${r} grace=${g} suspended=${s} deprovisioned=${d}`,
		);
	} catch (err) {
		console.error("[billing] Billing cycle error:", err);
	}
}

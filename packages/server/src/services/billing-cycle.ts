/**
 * Billing Cycle Service
 *
 * Manages the full subscription lifecycle:
 *   trial → pending_payment / active → past_due → grace_period → suspended → expired
 *
 * Called by the billing cron job on a schedule.
 */
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { nanoid } from "nanoid";

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
 * Also send suspension warning (implemented as a log for now).
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
			count++;
		}
	}

	return count;
}

// ─────────────────────────────────────────────────────────────
// 4. Suspend after grace period
// ─────────────────────────────────────────────────────────────

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

		// Mark open invoices as uncollectible (optional — keep as open for retry)
		console.log(`[billing] Sub ${sub.id} SUSPENDED (grace period expired)`);
	}

	return toSuspend.length;
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
// 6. Activate paid subscriptions
// ─────────────────────────────────────────────────────────────

/**
 * When a payment is confirmed, activate the subscription.
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
}

// ─────────────────────────────────────────────────────────────
// 7. Main billing tick — runs all jobs in sequence
// ─────────────────────────────────────────────────────────────

export async function runBillingCycle(): Promise<void> {
	console.log("[billing] Running billing cycle tick...");
	try {
		const [t, r, g, s] = await Promise.all([
			expireTrials(),
			renewActiveSubscriptions(),
			applyGracePeriod(),
			suspendExpiredGracePeriods(),
		]);
		console.log(
			`[billing] Tick done — trials_expired=${t} renewals=${r} grace=${g} suspended=${s}`,
		);
	} catch (err) {
		console.error("[billing] Billing cycle error:", err);
	}
}

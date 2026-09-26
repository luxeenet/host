/**
 * Subscription schema — customer subscription lifecycle.
 *
 * Maps organization → plan subscription with full lifecycle states.
 */
import { relations } from "drizzle-orm";
import { jsonb, numeric, pgEnum, pgTable, text, timestamp, } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { plans } from "./plan";
// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────
export const subscriptionStatus = pgEnum("subscriptionStatus", [
    "trial",
    "pending_payment",
    "active",
    "past_due",
    "grace_period",
    "suspended",
    "cancelled",
    "expired",
]);
export const invoiceStatus = pgEnum("invoiceStatus", [
    "draft",
    "open",
    "paid",
    "void",
    "uncollectible",
]);
export const paymentStatus = pgEnum("paymentStatus", [
    "pending",
    "processing",
    "succeeded",
    "failed",
    "refunded",
    "cancelled",
]);
export const paymentProviderEnum = pgEnum("paymentProviderEnum", [
    "mpesa",
    "tigopesa",
    "airtelmoney",
    "halopesa",
    "azampesa",
    "bank_transfer",
    "card",
    "manual",
]);
// ─────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────
export const subscriptions = pgTable("paas_subscription", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
    planId: text("plan_id")
        .notNull()
        .references(() => plans.id, { onDelete: "restrict" }),
    status: subscriptionStatus("status").notNull().default("trial"),
    /** Start of the current billing period */
    currentPeriodStart: timestamp("current_period_start").notNull().defaultNow(),
    /** End of the current billing period */
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    /** Trial expiry (null if no trial) */
    trialEndsAt: timestamp("trial_ends_at"),
    /** Grace period before suspension (48–72h after payment failure) */
    gracePeriodEndsAt: timestamp("grace_period_ends_at"),
    /** Suspension timestamp */
    suspendedAt: timestamp("suspended_at"),
    /** Cancellation timestamp */
    cancelledAt: timestamp("cancelled_at"),
    /** Expiry timestamp */
    expiredAt: timestamp("expired_at"),
    /** Number of consecutive payment failures */
    failedPaymentCount: text("failed_payment_count").notNull().default("0"),
    /** External reference (e.g. Stripe subscription ID if added later) */
    externalRef: text("external_ref"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Invoices
// ─────────────────────────────────────────────────────────────
export const invoices = pgTable("paas_invoice", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    subscriptionId: text("subscription_id")
        .notNull()
        .references(() => subscriptions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
    /** Invoice number (human-readable, e.g. INV-2026-0001) */
    invoiceNumber: text("invoice_number").notNull().unique(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("TZS"),
    status: invoiceStatus("status").notNull().default("open"),
    /** When payment is due */
    dueDate: timestamp("due_date").notNull(),
    paidAt: timestamp("paid_at"),
    /** Billing period this invoice covers */
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────
export const payments = pgTable("paas_payment", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    invoiceId: text("invoice_id")
        .notNull()
        .references(() => invoices.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("TZS"),
    provider: paymentProviderEnum("provider").notNull(),
    /** Provider-specific transaction reference */
    providerReference: text("provider_reference"),
    /** Provider-specific transaction ID */
    providerTransactionId: text("provider_transaction_id"),
    status: paymentStatus("status").notNull().default("pending"),
    /** Payer's phone number or card last4 */
    payerIdentifier: text("payer_identifier"),
    /** Raw provider callback data */
    providerMetadata: jsonb("provider_metadata"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Credits
// ─────────────────────────────────────────────────────────────
export const credits = pgTable("paas_credit", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("TZS"),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Coupons
// ─────────────────────────────────────────────────────────────
export const coupons = pgTable("paas_coupon", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    code: text("code").notNull().unique(),
    description: text("description"),
    /** percent or fixed */
    discountType: text("discount_type").notNull().default("percent"),
    discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("TZS"),
    maxUses: text("max_uses"),
    uses: text("uses").notNull().default("0"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────
export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
    organization: one(organization, {
        fields: [subscriptions.organizationId],
        references: [organization.id],
    }),
    plan: one(plans, {
        fields: [subscriptions.planId],
        references: [plans.id],
    }),
    invoices: many(invoices),
}));
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
    subscription: one(subscriptions, {
        fields: [invoices.subscriptionId],
        references: [subscriptions.id],
    }),
    organization: one(organization, {
        fields: [invoices.organizationId],
        references: [organization.id],
    }),
    payments: many(payments),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
    invoice: one(invoices, {
        fields: [payments.invoiceId],
        references: [invoices.id],
    }),
    organization: one(organization, {
        fields: [payments.organizationId],
        references: [organization.id],
    }),
}));
export const creditsRelations = relations(credits, ({ one }) => ({
    organization: one(organization, {
        fields: [credits.organizationId],
        references: [organization.id],
    }),
}));
// ─────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────
export const apiCreateSubscription = z.object({
    organizationId: z.string().min(1),
    planId: z.string().min(1),
});
export const apiInitiatePayment = z.object({
    invoiceId: z.string().min(1),
    provider: z.enum(["mpesa", "tigopesa", "airtelmoney", "halopesa", "azampesa", "bank_transfer", "card", "manual"]),
    payerIdentifier: z.string().min(1).optional(),
});
export const apiVerifyPayment = z.object({
    paymentId: z.string().min(1),
    providerReference: z.string().min(1).optional(),
});
export const apiAddCredit = z.object({
    organizationId: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(1),
});

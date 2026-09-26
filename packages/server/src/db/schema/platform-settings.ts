/**
 * Platform settings schema.
 * Key-value store for centralized platform configuration.
 * Admin-manageable via the admin panel.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";

export const platformSettings = pgTable("paas_platform_setting", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	key: text("key").notNull().unique(),
	value: text("value"),
	description: text("description"),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiUpsertPlatformSetting = z.object({
	key: z.string().min(1).max(100),
	value: z.string().nullable(),
});

/**
 * Well-known platform setting keys.
 * Use these constants instead of magic strings.
 */
export const PLATFORM_SETTING_KEYS = {
	MAINTENANCE_MODE: "maintenance_mode",
	REGISTRATION_OPEN: "registration_open",
	DEFAULT_PLAN_ID: "default_plan_id",
	FREE_TRIAL_ENABLED: "free_trial_enabled",
	FREE_TRIAL_DAYS: "free_trial_days",
	MAX_CUSTOMERS: "max_customers",
	SMTP_HOST: "smtp_host",
	SMTP_PORT: "smtp_port",
	SMTP_USER: "smtp_user",
	SMTP_PASS: "smtp_pass",
	SMTP_FROM: "smtp_from",
	DEPLOYMENT_NOTIFICATIONS_ENABLED: "deployment_notifications_enabled",
	BILLING_NOTIFICATIONS_ENABLED: "billing_notifications_enabled",
	GRACE_PERIOD_DAYS: "grace_period_days",
	SUSPENSION_AFTER_GRACE_DAYS: "suspension_after_grace_days",
	DATA_RETENTION_DAYS_AFTER_EXPIRY: "data_retention_days_after_expiry",
} as const;

export type PlatformSettingKey =
	(typeof PLATFORM_SETTING_KEYS)[keyof typeof PLATFORM_SETTING_KEYS];

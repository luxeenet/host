/**
 * Administrator-controlled integration settings (platform-wide).
 *
 * One row per integration id. Non-secret configuration lives in `config`;
 * credentials are stored AES-256-GCM encrypted in `secrets` (same mechanism as
 * the rest of the platform) and are never returned to any client.
 */
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const integrationSettings = pgTable("paas_integration_setting", {
	/** Integration id: github | gitlab | bitbucket | gitea | docker | git | drop */
	provider: text("provider").primaryKey().notNull(),
	enabled: boolean("enabled").notNull().default(true),
	/** Non-secret configuration (validated against the provider definition). */
	config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
	/** Encrypted JSON object of credential values keyed by field key. */
	secrets: text("secrets"),
	/** Which credential keys are set — lets us list status without decrypting. */
	secretKeys: jsonb("secret_keys").$type<string[]>().notNull().default([]),
	lastTestStatus: text("last_test_status"),
	lastTestedAt: timestamp("last_tested_at"),
	lastSuccessfulTestAt: timestamp("last_successful_test_at"),
	lastTestMessage: text("last_test_message"),
	lastVerification: text("last_verification"),
	/** HMAC of config+secrets when the last test ran (detects stale results). */
	testedFingerprint: text("tested_fingerprint"),
	updatedBy: text("updated_by"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type IntegrationSettingRow = typeof integrationSettings.$inferSelect;

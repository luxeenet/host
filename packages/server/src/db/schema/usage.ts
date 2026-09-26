/**
 * Usage metering schema.
 * Records CPU, RAM, storage, bandwidth, build minutes per organization/application.
 * Designed to support future usage-based billing without schema redesign.
 */
import { relations } from "drizzle-orm";
import {
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";

export const usageRecordType = pgEnum("usageRecordType", [
	"cpu_seconds",
	"ram_mb_hours",
	"storage_gb_hours",
	"bandwidth_gb",
	"build_minutes",
	"deployment_count",
	"database_storage_gb_hours",
	"backup_storage_gb_hours",
]);

export const usageRecords = pgTable("paas_usage_record", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	/** The specific application or database this usage belongs to (optional) */
	resourceId: text("resource_id"),
	/** Type of resource this record measures */
	recordType: usageRecordType("record_type").notNull(),
	/** Measured value (e.g. 120.5 GB) */
	value: numeric("value", { precision: 16, scale: 4 }).notNull(),
	/** Unit description (informational) */
	unit: text("unit"),
	/** ISO timestamp the measurement was taken */
	recordedAt: timestamp("recorded_at").notNull().defaultNow(),
	/** Billing period this usage belongs to (YYYY-MM) */
	billingPeriod: text("billing_period").notNull(),
});

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
	organization: one(organization, {
		fields: [usageRecords.organizationId],
		references: [organization.id],
	}),
}));

export const apiGetUsage = z.object({
	organizationId: z.string().min(1),
	billingPeriod: z.string().regex(/^\d{4}-\d{2}$/, "Format: YYYY-MM").optional(),
});

import { relations } from "drizzle-orm";
import {
	bigint,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { organization } from "./account";
import { destinations } from "./destination";

export const backupStorageStatus = pgEnum("backupStorageStatus", [
	"reserved",
	"committed",
	"deleted",
]);

export const backupStorageRecords = pgTable("paas_backup_storage_record", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	destinationId: text("destination_id")
		.notNull()
		.references(() => destinations.destinationId, { onDelete: "cascade" }),
	backupId: text("backup_id"),
	/** Relative path inside the bucket/namespace, e.g. "appName/prefix/backup-file.sql.gz" */
	objectKey: text("object_key").notNull(),
	/** Exact size in bytes */
	bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
	status: backupStorageStatus("status").notNull().default("reserved"),
	/** When an in-flight reservation expires if not committed */
	expiresAt: timestamp("expires_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const backupStorageRecordsRelations = relations(
	backupStorageRecords,
	({ one }) => ({
		organization: one(organization, {
			fields: [backupStorageRecords.organizationId],
			references: [organization.id],
		}),
		destination: one(destinations, {
			fields: [backupStorageRecords.destinationId],
			references: [destinations.destinationId],
		}),
	}),
);

DO $$ BEGIN
  CREATE TYPE "backupStorageStatus" AS ENUM ('reserved', 'committed', 'deleted');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "paas_backup_storage_record" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "destination_id" text NOT NULL REFERENCES "destination"("destinationId") ON DELETE CASCADE,
  "backup_id" text,
  "object_key" text NOT NULL,
  "bytes" bigint DEFAULT 0 NOT NULL,
  "status" "backupStorageStatus" DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_paas_backup_storage_org_status" ON "paas_backup_storage_record" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "idx_paas_backup_storage_dest_key" ON "paas_backup_storage_record" ("destination_id", "object_key");

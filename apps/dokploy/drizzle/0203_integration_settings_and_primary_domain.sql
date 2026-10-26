CREATE TABLE IF NOT EXISTS "paas_integration_setting" (
  "provider" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secrets" text,
  "secret_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_test_status" text,
  "last_tested_at" timestamp,
  "last_successful_test_at" timestamp,
  "last_test_message" text,
  "last_verification" text,
  "tested_fingerprint" text,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "isPrimary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_primary_per_application" ON "domain" ("applicationId") WHERE "isPrimary" = true AND "applicationId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_primary_per_compose" ON "domain" ("composeId") WHERE "isPrimary" = true AND "composeId" IS NOT NULL;

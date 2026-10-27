ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfHostnameId" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfStatus" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfSslStatus" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfVerificationErrors" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfOwnershipVerification" jsonb;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfSslValidationRecords" jsonb;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfSslCertificates" jsonb;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfLastSyncAt" timestamp;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfLastError" text;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "cfCustomOrigin" text;

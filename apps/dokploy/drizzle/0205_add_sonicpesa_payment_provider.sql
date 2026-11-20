DO $$ BEGIN
    ALTER TYPE "public"."paymentProviderEnum" ADD VALUE IF NOT EXISTS 'sonicpesa';
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TYPE "paymentProviderEnum" ADD VALUE IF NOT EXISTS 'sonicpesa';
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "paas_payment" ALTER COLUMN "provider" TYPE text USING "provider"::text;
EXCEPTION
    WHEN undefined_table THEN null;
    WHEN undefined_column THEN null;
END $$;


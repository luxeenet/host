-- ================================================================
-- Migration: 0197_platform_business_layer.sql
-- Description: Adds all platform business tables:
--   paas_plan, paas_plan_resource, paas_plan_feature,
--   paas_plan_app_type, paas_subscription, paas_invoice,
--   paas_payment, paas_credit, paas_coupon,
--   paas_usage_record, paas_support_ticket, paas_support_message,
--   paas_server_capacity, paas_platform_setting, paas_audit_log
-- ================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE "planStatus" AS ENUM ('active', 'inactive', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "billingCycle" AS ENUM ('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "applicationTypeEnum" AS ENUM ('static', 'node', 'php', 'python', 'docker', 'compose');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscriptionStatus" AS ENUM ('trial', 'pending_payment', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "invoiceStatus" AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "paymentStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "paymentProviderEnum" AS ENUM ('mpesa', 'tigopesa', 'airtelmoney', 'halopesa', 'azampesa', 'bank_transfer', 'card', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "usageRecordType" AS ENUM ('cpu_seconds', 'ram_mb_hours', 'storage_gb_hours', 'bandwidth_gb', 'build_minutes', 'deployment_count', 'database_storage_gb_hours', 'backup_storage_gb_hours');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ticketStatus" AS ENUM ('open', 'pending_customer', 'pending_staff', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ticketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ticketCategory" AS ENUM ('billing', 'deployment', 'domain', 'database', 'performance', 'security', 'account', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ──────────────────────────────────────────────────────────────
-- Plans
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_plan" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" text,
  "price" numeric(12, 2) NOT NULL DEFAULT '0',
  "currency" text NOT NULL DEFAULT 'TZS',
  "billing_cycle" "billingCycle" NOT NULL DEFAULT 'monthly',
  "status" "planStatus" NOT NULL DEFAULT 'active',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_public" boolean NOT NULL DEFAULT true,
  "is_featured" boolean NOT NULL DEFAULT false,
  "trial_days" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "paas_plan_resource" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL REFERENCES "paas_plan"("id") ON DELETE CASCADE,
  "resource_key" text NOT NULL,
  "value" integer NOT NULL DEFAULT -1,
  "unit" text
);

CREATE TABLE IF NOT EXISTS "paas_plan_feature" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL REFERENCES "paas_plan"("id") ON DELETE CASCADE,
  "feature_key" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "metadata" jsonb
);

CREATE TABLE IF NOT EXISTS "paas_plan_app_type" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL REFERENCES "paas_plan"("id") ON DELETE CASCADE,
  "application_type" "applicationTypeEnum" NOT NULL
);

-- ──────────────────────────────────────────────────────────────
-- Subscriptions
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_subscription" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "plan_id" text NOT NULL REFERENCES "paas_plan"("id") ON DELETE RESTRICT,
  "status" "subscriptionStatus" NOT NULL DEFAULT 'trial',
  "current_period_start" timestamp NOT NULL DEFAULT now(),
  "current_period_end" timestamp NOT NULL,
  "trial_ends_at" timestamp,
  "grace_period_ends_at" timestamp,
  "suspended_at" timestamp,
  "cancelled_at" timestamp,
  "expired_at" timestamp,
  "failed_payment_count" text NOT NULL DEFAULT '0',
  "external_ref" text,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sub_org_idx" ON "paas_subscription"("organization_id");
CREATE INDEX IF NOT EXISTS "sub_status_idx" ON "paas_subscription"("status");

-- ──────────────────────────────────────────────────────────────
-- Invoices
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_invoice" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL REFERENCES "paas_subscription"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "invoice_number" text NOT NULL UNIQUE,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'TZS',
  "status" "invoiceStatus" NOT NULL DEFAULT 'open',
  "due_date" timestamp NOT NULL,
  "paid_at" timestamp,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "notes" text,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "inv_org_idx" ON "paas_invoice"("organization_id");
CREATE INDEX IF NOT EXISTS "inv_status_idx" ON "paas_invoice"("status");

-- ──────────────────────────────────────────────────────────────
-- Payments
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_payment" (
  "id" text PRIMARY KEY NOT NULL,
  "invoice_id" text NOT NULL REFERENCES "paas_invoice"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'TZS',
  "provider" "paymentProviderEnum" NOT NULL,
  "provider_reference" text,
  "provider_transaction_id" text,
  "status" "paymentStatus" NOT NULL DEFAULT 'pending',
  "payer_identifier" text,
  "provider_metadata" jsonb,
  "failure_reason" text,
  "paid_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pay_org_idx" ON "paas_payment"("organization_id");
CREATE INDEX IF NOT EXISTS "pay_status_idx" ON "paas_payment"("status");

-- ──────────────────────────────────────────────────────────────
-- Credits & Coupons
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_credit" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'TZS',
  "reason" text NOT NULL,
  "expires_at" timestamp,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "paas_coupon" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "description" text,
  "discount_type" text NOT NULL DEFAULT 'percent',
  "discount_value" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'TZS',
  "max_uses" text,
  "uses" text NOT NULL DEFAULT '0',
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- Usage Records
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_usage_record" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "resource_id" text,
  "record_type" "usageRecordType" NOT NULL,
  "value" numeric(16, 4) NOT NULL,
  "unit" text,
  "recorded_at" timestamp NOT NULL DEFAULT now(),
  "billing_period" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "usage_org_period_idx" ON "paas_usage_record"("organization_id", "billing_period");

-- ──────────────────────────────────────────────────────────────
-- Support
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_support_ticket" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "subject" text NOT NULL,
  "category" "ticketCategory" NOT NULL DEFAULT 'other',
  "priority" "ticketPriority" NOT NULL DEFAULT 'normal',
  "status" "ticketStatus" NOT NULL DEFAULT 'open',
  "resource_ref" text,
  "resolved_at" timestamp,
  "closed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ticket_org_idx" ON "paas_support_ticket"("organization_id");
CREATE INDEX IF NOT EXISTS "ticket_status_idx" ON "paas_support_ticket"("status");

CREATE TABLE IF NOT EXISTS "paas_support_message" (
  "id" text PRIMARY KEY NOT NULL,
  "ticket_id" text NOT NULL REFERENCES "paas_support_ticket"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "is_staff" boolean NOT NULL DEFAULT false,
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "msg_ticket_idx" ON "paas_support_message"("ticket_id");

-- ──────────────────────────────────────────────────────────────
-- Server Capacity
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_server_capacity" (
  "id" text PRIMARY KEY NOT NULL,
  "server_id" text NOT NULL UNIQUE REFERENCES "server"("serverId") ON DELETE CASCADE,
  "cpu_cores" integer NOT NULL DEFAULT 0,
  "ram_mb" integer NOT NULL DEFAULT 0,
  "disk_gb" integer NOT NULL DEFAULT 0,
  "reserved_ram_mb" integer NOT NULL DEFAULT 0,
  "reserved_cpu_millicores" integer NOT NULL DEFAULT 0,
  "reserved_disk_gb" integer NOT NULL DEFAULT 0,
  "safety_reserve_percent" integer NOT NULL DEFAULT 20,
  "current_metrics" jsonb,
  "last_heartbeat_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- Platform Settings
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_platform_setting" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "value" text,
  "description" text,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Seed default platform settings
INSERT INTO "paas_platform_setting" ("id", "key", "value", "description", "updated_at")
VALUES
  (gen_random_uuid()::text, 'registration_open', 'true', 'Allow new customer registrations', now()),
  (gen_random_uuid()::text, 'maintenance_mode', 'false', 'Put platform in maintenance mode', now()),
  (gen_random_uuid()::text, 'free_trial_enabled', 'true', 'Enable free trial for new customers', now()),
  (gen_random_uuid()::text, 'free_trial_days', '14', 'Number of free trial days', now()),
  (gen_random_uuid()::text, 'grace_period_days', '3', 'Grace period days after failed payment', now()),
  (gen_random_uuid()::text, 'suspension_after_grace_days', '1', 'Days after grace period before suspension', now()),
  (gen_random_uuid()::text, 'data_retention_days_after_expiry', '30', 'Days to retain customer data after subscription expiry', now())
ON CONFLICT ("key") DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- Platform Audit Logs
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "paas_audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text REFERENCES "organization"("id") ON DELETE SET NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "user_email" text,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "summary" text,
  "metadata" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_org_idx" ON "paas_audit_log"("organization_id");
CREATE INDEX IF NOT EXISTS "audit_user_idx" ON "paas_audit_log"("user_id");
CREATE INDEX IF NOT EXISTS "audit_resource_idx" ON "paas_audit_log"("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "paas_audit_log"("created_at");

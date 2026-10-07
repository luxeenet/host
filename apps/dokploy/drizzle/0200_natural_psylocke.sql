CREATE TYPE "public"."applicationTypeEnum" AS ENUM('static', 'node', 'php', 'python', 'docker', 'compose');--> statement-breakpoint
CREATE TYPE "public"."billingCycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."planStatus" AS ENUM('active', 'inactive', 'archived');--> statement-breakpoint
CREATE TYPE "public"."invoiceStatus" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."paymentProviderEnum" AS ENUM('mpesa', 'tigopesa', 'airtelmoney', 'halopesa', 'azampesa', 'bank_transfer', 'card', 'manual');--> statement-breakpoint
CREATE TYPE "public"."paymentStatus" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscriptionStatus" AS ENUM('trial', 'pending_payment', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."usageRecordType" AS ENUM('cpu_seconds', 'ram_mb_hours', 'storage_gb_hours', 'bandwidth_gb', 'build_minutes', 'deployment_count', 'database_storage_gb_hours', 'backup_storage_gb_hours');--> statement-breakpoint
CREATE TYPE "public"."ticketCategory" AS ENUM('billing', 'deployment', 'domain', 'database', 'performance', 'security', 'account', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticketPriority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticketStatus" AS ENUM('open', 'pending_customer', 'pending_staff', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "paas_plan_app_type" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"application_type" "applicationTypeEnum" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_plan_feature" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "paas_plan_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"resource_key" text NOT NULL,
	"value" integer DEFAULT -1 NOT NULL,
	"unit" text
);
--> statement-breakpoint
CREATE TABLE "paas_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TZS' NOT NULL,
	"billing_cycle" "billingCycle" DEFAULT 'monthly' NOT NULL,
	"status" "planStatus" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paas_plan_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "paas_coupon" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'TZS',
	"max_uses" text,
	"uses" text DEFAULT '0' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paas_coupon_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "paas_credit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'TZS' NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'TZS' NOT NULL,
	"status" "invoiceStatus" DEFAULT 'open' NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paas_invoice_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "paas_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'TZS' NOT NULL,
	"provider" "paymentProviderEnum" NOT NULL,
	"provider_reference" text,
	"provider_transaction_id" text,
	"status" "paymentStatus" DEFAULT 'pending' NOT NULL,
	"payer_identifier" text,
	"provider_metadata" jsonb,
	"failure_reason" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscriptionStatus" DEFAULT 'trial' NOT NULL,
	"current_period_start" timestamp DEFAULT now() NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"trial_ends_at" timestamp,
	"grace_period_ends_at" timestamp,
	"suspended_at" timestamp,
	"cancelled_at" timestamp,
	"expired_at" timestamp,
	"failed_payment_count" text DEFAULT '0' NOT NULL,
	"external_ref" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text,
	"record_type" "usageRecordType" NOT NULL,
	"value" numeric(16, 4) NOT NULL,
	"unit" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"billing_period" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_support_message" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_support_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"subject" text NOT NULL,
	"category" "ticketCategory" DEFAULT 'other' NOT NULL,
	"priority" "ticketPriority" DEFAULT 'normal' NOT NULL,
	"status" "ticketStatus" DEFAULT 'open' NOT NULL,
	"resource_ref" text,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_server_capacity" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"cpu_cores" integer DEFAULT 0 NOT NULL,
	"ram_mb" integer DEFAULT 0 NOT NULL,
	"disk_gb" integer DEFAULT 0 NOT NULL,
	"reserved_ram_mb" integer DEFAULT 0 NOT NULL,
	"reserved_cpu_millicores" integer DEFAULT 0 NOT NULL,
	"reserved_disk_gb" integer DEFAULT 0 NOT NULL,
	"safety_reserve_percent" integer DEFAULT 20 NOT NULL,
	"current_metrics" jsonb,
	"last_heartbeat_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paas_server_capacity_server_id_unique" UNIQUE("server_id")
);
--> statement-breakpoint
CREATE TABLE "paas_platform_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paas_platform_setting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "paas_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"user_email" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"summary" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"user_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_plan_app_type" ADD CONSTRAINT "paas_plan_app_type_plan_id_paas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_plan_feature" ADD CONSTRAINT "paas_plan_feature_plan_id_paas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_plan_resource" ADD CONSTRAINT "paas_plan_resource_plan_id_paas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_credit" ADD CONSTRAINT "paas_credit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_invoice" ADD CONSTRAINT "paas_invoice_subscription_id_paas_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."paas_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_invoice" ADD CONSTRAINT "paas_invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_payment" ADD CONSTRAINT "paas_payment_invoice_id_paas_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."paas_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_payment" ADD CONSTRAINT "paas_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_subscription" ADD CONSTRAINT "paas_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_subscription" ADD CONSTRAINT "paas_subscription_plan_id_paas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_usage_record" ADD CONSTRAINT "paas_usage_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_support_message" ADD CONSTRAINT "paas_support_message_ticket_id_paas_support_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."paas_support_ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_support_message" ADD CONSTRAINT "paas_support_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_support_ticket" ADD CONSTRAINT "paas_support_ticket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_support_ticket" ADD CONSTRAINT "paas_support_ticket_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_server_capacity" ADD CONSTRAINT "paas_server_capacity_server_id_server_serverId_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("serverId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_audit_log" ADD CONSTRAINT "paas_audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_audit_log" ADD CONSTRAINT "paas_audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
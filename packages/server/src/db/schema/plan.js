/**
 * Plans schema — database-driven hosting plan definitions.
 *
 * All pricing, limits, and feature entitlements are stored here.
 * NEVER hardcode plan limits in feature controllers.
 */
import { relations } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────
export const planStatus = pgEnum("planStatus", [
    "active",
    "inactive",
    "archived",
]);
export const billingCycle = pgEnum("billingCycle", ["monthly", "yearly"]);
export const applicationTypeEnum = pgEnum("applicationTypeEnum", [
    "static",
    "node",
    "php",
    "python",
    "docker",
    "compose",
]);
// ─────────────────────────────────────────────────────────────
// Plans
// ─────────────────────────────────────────────────────────────
export const plans = pgTable("paas_plan", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("TZS"),
    billingCycle: billingCycle("billing_cycle").notNull().default("monthly"),
    status: planStatus("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    trialDays: integer("trial_days").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// ─────────────────────────────────────────────────────────────
// Plan Resources (quotas)
// ─────────────────────────────────────────────────────────────
export const planResources = pgTable("paas_plan_resource", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    planId: text("plan_id")
        .notNull()
        .references(() => plans.id, { onDelete: "cascade" }),
    /**
     * Resource key. Known keys:
     *   max_projects, max_applications, max_databases,
     *   max_domains, max_storage_gb, max_bandwidth_gb,
     *   max_ram_mb, max_cpu_millicores, max_deployments_per_day,
     *   build_minutes_per_month, backup_storage_gb,
     *   max_team_members, max_environments
     */
    resourceKey: text("resource_key").notNull(),
    /** -1 = unlimited */
    value: integer("value").notNull().default(-1),
    unit: text("unit"),
});
// ─────────────────────────────────────────────────────────────
// Plan Features (boolean feature flags)
// ─────────────────────────────────────────────────────────────
export const planFeatures = pgTable("paas_plan_feature", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    planId: text("plan_id")
        .notNull()
        .references(() => plans.id, { onDelete: "cascade" }),
    /**
     * Feature key. Known keys:
     *   custom_domains, ssl, automatic_deployments, backups,
     *   databases, preview_deployments, team_members, api_access,
     *   priority_support, docker_access, compose_access,
     *   volume_mounts, scheduled_tasks, rollbacks
     */
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    metadata: jsonb("metadata"),
});
// ─────────────────────────────────────────────────────────────
// Plan Application Types
// ─────────────────────────────────────────────────────────────
export const planApplicationTypes = pgTable("paas_plan_app_type", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    planId: text("plan_id")
        .notNull()
        .references(() => plans.id, { onDelete: "cascade" }),
    applicationType: applicationTypeEnum("application_type").notNull(),
});
// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────
export const plansRelations = relations(plans, ({ many }) => ({
    resources: many(planResources),
    features: many(planFeatures),
    applicationTypes: many(planApplicationTypes),
}));
export const planResourcesRelations = relations(planResources, ({ one }) => ({
    plan: one(plans, {
        fields: [planResources.planId],
        references: [plans.id],
    }),
}));
export const planFeaturesRelations = relations(planFeatures, ({ one }) => ({
    plan: one(plans, {
        fields: [planFeatures.planId],
        references: [plans.id],
    }),
}));
export const planApplicationTypesRelations = relations(planApplicationTypes, ({ one }) => ({
    plan: one(plans, {
        fields: [planApplicationTypes.planId],
        references: [plans.id],
    }),
}));
// ─────────────────────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────────────────────
export const apiCreatePlan = z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
    description: z.string().optional(),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price"),
    currency: z.string().length(3).default("TZS"),
    billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
    status: z.enum(["active", "inactive", "archived"]).default("active"),
    sortOrder: z.number().int().default(0),
    isPublic: z.boolean().default(true),
    trialDays: z.number().int().min(0).max(365).default(0),
});
export const apiUpdatePlan = apiCreatePlan.partial().extend({
    id: z.string().min(1),
});
export const apiSetPlanResource = z.object({
    planId: z.string().min(1),
    resourceKey: z.string().min(1),
    value: z.number().int().min(-1),
    unit: z.string().optional(),
});
export const apiSetPlanFeature = z.object({
    planId: z.string().min(1),
    featureKey: z.string().min(1),
    enabled: z.boolean(),
});
export const apiSetPlanApplicationType = z.object({
    planId: z.string().min(1),
    applicationType: z.enum(["static", "node", "php", "python", "docker", "compose"]),
});

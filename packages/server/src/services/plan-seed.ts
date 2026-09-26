/**
 * Plan seed data — initial hosting plans.
 *
 * Plans are database-driven. This seed creates the initial set.
 * Admin can modify plans at /admin/plans without code changes.
 *
 * Resource keys:
 *   max_projects, max_applications, max_databases, max_domains,
 *   max_storage_gb, max_bandwidth_gb, max_ram_mb,
 *   max_cpu_millicores, max_deployments_per_day,
 *   build_minutes_per_month, backup_storage_gb,
 *   max_team_members, max_environments
 *
 * Feature keys:
 *   custom_domains, ssl, automatic_deployments, backups,
 *   databases, preview_deployments, team_members, api_access,
 *   priority_support, docker_access, compose_access,
 *   volume_mounts, scheduled_tasks, rollbacks
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import * as schema from "../db/schema";

interface PlanSeedDef {
	name: string;
	slug: string;
	description: string;
	price: string;
	currency: string;
	billingCycle: "monthly" | "yearly";
	isPublic: boolean;
	isFeatured: boolean;
	trialDays: number;
	sortOrder: number;
	resources: Array<{ key: string; value: number; unit?: string }>;
	features: Array<{ key: string; enabled: boolean }>;
	appTypes: Array<"static" | "node" | "php" | "python" | "docker" | "compose">;
}

const PLANS: PlanSeedDef[] = [
	// ──────────────────────────────────────
	// FREE / STATIC HOSTING
	// ──────────────────────────────────────
	{
		name: "Starter",
		slug: "starter",
		description: "Perfect for static websites, portfolios, and landing pages.",
		price: "0",
		currency: "TZS",
		billingCycle: "monthly",
		isPublic: true,
		isFeatured: false,
		trialDays: 0,
		sortOrder: 10,
		resources: [
			{ key: "max_projects", value: 1 },
			{ key: "max_applications", value: 1 },
			{ key: "max_databases", value: 0 },
			{ key: "max_domains", value: 1 },
			{ key: "max_storage_gb", value: 1 },
			{ key: "max_bandwidth_gb", value: 5 },
			{ key: "max_ram_mb", value: 256 },
			{ key: "build_minutes_per_month", value: 60 },
			{ key: "max_team_members", value: 1 },
			{ key: "max_environments", value: 1 },
		],
		features: [
			{ key: "ssl", enabled: true },
			{ key: "custom_domains", enabled: false },
			{ key: "automatic_deployments", enabled: false },
			{ key: "backups", enabled: false },
			{ key: "databases", enabled: false },
			{ key: "preview_deployments", enabled: false },
			{ key: "team_members", enabled: false },
			{ key: "api_access", enabled: false },
			{ key: "priority_support", enabled: false },
			{ key: "docker_access", enabled: false },
			{ key: "compose_access", enabled: false },
			{ key: "volume_mounts", enabled: false },
			{ key: "scheduled_tasks", enabled: false },
			{ key: "rollbacks", enabled: false },
		],
		appTypes: ["static"],
	},

	// ──────────────────────────────────────
	// PHP / BASIC
	// ──────────────────────────────────────
	{
		name: "Basic",
		slug: "basic",
		description: "WordPress, Laravel, and basic PHP hosting.",
		price: "9900",
		currency: "TZS",
		billingCycle: "monthly",
		isPublic: true,
		isFeatured: false,
		trialDays: 14,
		sortOrder: 20,
		resources: [
			{ key: "max_projects", value: 3 },
			{ key: "max_applications", value: 3 },
			{ key: "max_databases", value: 2 },
			{ key: "max_domains", value: 3 },
			{ key: "max_storage_gb", value: 5 },
			{ key: "max_bandwidth_gb", value: 20 },
			{ key: "max_ram_mb", value: 512 },
			{ key: "build_minutes_per_month", value: 200 },
			{ key: "max_team_members", value: 1 },
			{ key: "max_environments", value: 2 },
		],
		features: [
			{ key: "ssl", enabled: true },
			{ key: "custom_domains", enabled: true },
			{ key: "automatic_deployments", enabled: true },
			{ key: "backups", enabled: true },
			{ key: "databases", enabled: true },
			{ key: "preview_deployments", enabled: false },
			{ key: "team_members", enabled: false },
			{ key: "api_access", enabled: false },
			{ key: "priority_support", enabled: false },
			{ key: "docker_access", enabled: false },
			{ key: "compose_access", enabled: false },
			{ key: "volume_mounts", enabled: true },
			{ key: "scheduled_tasks", enabled: false },
			{ key: "rollbacks", enabled: true },
		],
		appTypes: ["static", "php"],
	},

	// ──────────────────────────────────────
	// NODE / PYTHON DEVELOPER
	// ──────────────────────────────────────
	{
		name: "Developer",
		slug: "developer",
		description: "Node.js, Python, APIs, and full-stack applications.",
		price: "24900",
		currency: "TZS",
		billingCycle: "monthly",
		isPublic: true,
		isFeatured: true,
		trialDays: 14,
		sortOrder: 30,
		resources: [
			{ key: "max_projects", value: 5 },
			{ key: "max_applications", value: 10 },
			{ key: "max_databases", value: 5 },
			{ key: "max_domains", value: 10 },
			{ key: "max_storage_gb", value: 20 },
			{ key: "max_bandwidth_gb", value: 100 },
			{ key: "max_ram_mb", value: 2048 },
			{ key: "build_minutes_per_month", value: 1000 },
			{ key: "max_team_members", value: 3 },
			{ key: "max_environments", value: 3 },
			{ key: "backup_storage_gb", value: 10 },
		],
		features: [
			{ key: "ssl", enabled: true },
			{ key: "custom_domains", enabled: true },
			{ key: "automatic_deployments", enabled: true },
			{ key: "backups", enabled: true },
			{ key: "databases", enabled: true },
			{ key: "preview_deployments", enabled: true },
			{ key: "team_members", enabled: true },
			{ key: "api_access", enabled: true },
			{ key: "priority_support", enabled: false },
			{ key: "docker_access", enabled: false },
			{ key: "compose_access", enabled: false },
			{ key: "volume_mounts", enabled: true },
			{ key: "scheduled_tasks", enabled: true },
			{ key: "rollbacks", enabled: true },
		],
		appTypes: ["static", "node", "php", "python"],
	},

	// ──────────────────────────────────────
	// BUSINESS
	// ──────────────────────────────────────
	{
		name: "Business",
		slug: "business",
		description: "Full Docker and Compose support. Team collaboration.",
		price: "59900",
		currency: "TZS",
		billingCycle: "monthly",
		isPublic: true,
		isFeatured: false,
		trialDays: 14,
		sortOrder: 40,
		resources: [
			{ key: "max_projects", value: 20 },
			{ key: "max_applications", value: 50 },
			{ key: "max_databases", value: 20 },
			{ key: "max_domains", value: -1 }, // unlimited
			{ key: "max_storage_gb", value: 100 },
			{ key: "max_bandwidth_gb", value: 500 },
			{ key: "max_ram_mb", value: 8192 },
			{ key: "build_minutes_per_month", value: 5000 },
			{ key: "max_team_members", value: 10 },
			{ key: "max_environments", value: 5 },
			{ key: "backup_storage_gb", value: 50 },
		],
		features: [
			{ key: "ssl", enabled: true },
			{ key: "custom_domains", enabled: true },
			{ key: "automatic_deployments", enabled: true },
			{ key: "backups", enabled: true },
			{ key: "databases", enabled: true },
			{ key: "preview_deployments", enabled: true },
			{ key: "team_members", enabled: true },
			{ key: "api_access", enabled: true },
			{ key: "priority_support", enabled: true },
			{ key: "docker_access", enabled: true },
			{ key: "compose_access", enabled: true },
			{ key: "volume_mounts", enabled: true },
			{ key: "scheduled_tasks", enabled: true },
			{ key: "rollbacks", enabled: true },
		],
		appTypes: ["static", "node", "php", "python", "docker", "compose"],
	},

	// ──────────────────────────────────────
	// ENTERPRISE / UNLIMITED
	// ──────────────────────────────────────
	{
		name: "Enterprise",
		slug: "enterprise",
		description: "Unlimited resources. Dedicated support. SLA included.",
		price: "199900",
		currency: "TZS",
		billingCycle: "monthly",
		isPublic: false, // Sales-only
		isFeatured: false,
		trialDays: 30,
		sortOrder: 50,
		resources: [
			{ key: "max_projects", value: -1 },
			{ key: "max_applications", value: -1 },
			{ key: "max_databases", value: -1 },
			{ key: "max_domains", value: -1 },
			{ key: "max_storage_gb", value: -1 },
			{ key: "max_bandwidth_gb", value: -1 },
			{ key: "max_ram_mb", value: -1 },
			{ key: "build_minutes_per_month", value: -1 },
			{ key: "max_team_members", value: -1 },
			{ key: "max_environments", value: -1 },
			{ key: "backup_storage_gb", value: -1 },
		],
		features: [
			{ key: "ssl", enabled: true },
			{ key: "custom_domains", enabled: true },
			{ key: "automatic_deployments", enabled: true },
			{ key: "backups", enabled: true },
			{ key: "databases", enabled: true },
			{ key: "preview_deployments", enabled: true },
			{ key: "team_members", enabled: true },
			{ key: "api_access", enabled: true },
			{ key: "priority_support", enabled: true },
			{ key: "docker_access", enabled: true },
			{ key: "compose_access", enabled: true },
			{ key: "volume_mounts", enabled: true },
			{ key: "scheduled_tasks", enabled: true },
			{ key: "rollbacks", enabled: true },
		],
		appTypes: ["static", "node", "php", "python", "docker", "compose"],
	},
];

/**
 * Seed initial plans into the database.
 * Idempotent: skips plans that already exist by slug.
 */
export async function seedPlans(): Promise<void> {
	console.log("[PlanSeed] Seeding platform plans...");

	for (const planDef of PLANS) {
		const existing = await db.query.plans.findFirst({
			where: eq(schema.plans.slug, planDef.slug),
		});

		if (existing) {
			console.log(`[PlanSeed] Skipping "${planDef.slug}" — already exists.`);
			continue;
		}

		const planId = nanoid();

		await db.transaction(async (tx) => {
			await tx.insert(schema.plans).values({
				id: planId,
				name: planDef.name,
				slug: planDef.slug,
				description: planDef.description,
				price: planDef.price,
				currency: planDef.currency,
				billingCycle: planDef.billingCycle,
				isPublic: planDef.isPublic,
				isFeatured: planDef.isFeatured,
				trialDays: planDef.trialDays,
				sortOrder: planDef.sortOrder,
				status: "active",
			});

			for (const r of planDef.resources) {
				await tx.insert(schema.planResources).values({
					id: nanoid(),
					planId,
					resourceKey: r.key,
					value: r.value,
					unit: r.unit ?? null,
				});
			}

			for (const f of planDef.features) {
				await tx.insert(schema.planFeatures).values({
					id: nanoid(),
					planId,
					featureKey: f.key,
					enabled: f.enabled,
				});
			}

			for (const appType of planDef.appTypes) {
				await tx.insert(schema.planApplicationTypes).values({
					id: nanoid(),
					planId,
					applicationType: appType,
				});
			}
		});

		console.log(`[PlanSeed] Created plan "${planDef.name}" (${planDef.slug})`);
	}

	console.log("[PlanSeed] Done.");
}

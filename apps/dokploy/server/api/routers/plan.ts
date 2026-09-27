/**
 * Plans router — public plan listing + admin plan management.
 */
import { TRPCError } from "@trpc/server";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../../db";
import * as schema from "@dokploy/server/db/schema";
import {
	createTRPCRouter,
	platformAdminProcedure,
	protectedProcedure,
	publicProcedure,
} from "../trpc";

export const planRouter = createTRPCRouter({
	// ─── Public ───────────────────────────────────────────────

	/** List all public active plans */
	list: publicProcedure.query(async () => {
		return db.query.plans.findMany({
			where: (p, { and, eq }) =>
				and(eq(p.status, "active"), eq(p.isPublic, true)),
			with: {
				resources: true,
				features: true,
				applicationTypes: true,
			},
			orderBy: (p) => [asc(p.sortOrder)],
		});
	}),

	/** Get a single plan by ID or slug */
	get: publicProcedure
		.input(z.object({ id: z.string().optional(), slug: z.string().optional() }))
		.query(async ({ input }) => {
			const plan = await db.query.plans.findFirst({
				where: (p, { or, eq }) =>
					or(
						input.id ? eq(p.id, input.id) : undefined,
						input.slug ? eq(p.slug, input.slug) : undefined,
					),
				with: {
					resources: true,
					features: true,
					applicationTypes: true,
				},
			});

			if (!plan) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
			}

			return plan;
		}),

	// ─── Admin ────────────────────────────────────────────────

	/** Admin: list all plans including inactive */
	adminList: platformAdminProcedure.query(async () => {
		return db.query.plans.findMany({
			with: {
				resources: true,
				features: true,
				applicationTypes: true,
			},
			orderBy: (p) => [asc(p.sortOrder)],
		});
	}),

	/** Admin: create a new plan */
	create: platformAdminProcedure
		.input(schema.apiCreatePlan)
		.mutation(async ({ input }) => {
			const id = nanoid();
			const [plan] = await db
				.insert(schema.plans)
				.values({ ...input, id })
				.returning();
			return plan;
		}),

	/** Admin: update a plan */
	update: platformAdminProcedure
		.input(schema.apiUpdatePlan)
		.mutation(async ({ input }) => {
			const { id, ...data } = input;
			const [updated] = await db
				.update(schema.plans)
				.set({ ...data, updatedAt: new Date() })
				.where(eq(schema.plans.id, id))
				.returning();
			if (!updated)
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
			return updated;
		}),

	/** Admin: delete a plan (only if no active subscriptions) */
	delete: platformAdminProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const activeSubs = await db.query.subscriptions.findFirst({
				where: (s, { and, eq, not }) =>
					and(
						eq(s.planId, input.id),
						not(eq(s.status, "cancelled")),
						not(eq(s.status, "expired")),
					),
			});
			if (activeSubs) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Cannot delete a plan with active subscriptions. Archive it instead.",
				});
			}
			await db.delete(schema.plans).where(eq(schema.plans.id, input.id));
			return { success: true };
		}),

	/** Admin: set plan resource */
	setResource: platformAdminProcedure
		.input(schema.apiSetPlanResource)
		.mutation(async ({ input }) => {
			const existing = await db.query.planResources.findFirst({
				where: (r, { and, eq }) =>
					and(eq(r.planId, input.planId), eq(r.resourceKey, input.resourceKey)),
			});

			if (existing) {
				const [updated] = await db
					.update(schema.planResources)
					.set({ value: input.value, unit: input.unit })
					.where(eq(schema.planResources.id, existing.id))
					.returning();
				return updated;
			}

			const [created] = await db
				.insert(schema.planResources)
				.values({ id: nanoid(), ...input })
				.returning();
			return created;
		}),

	/** Admin: set plan feature */
	setFeature: platformAdminProcedure
		.input(schema.apiSetPlanFeature)
		.mutation(async ({ input }) => {
			const existing = await db.query.planFeatures.findFirst({
				where: (f, { and, eq }) =>
					and(eq(f.planId, input.planId), eq(f.featureKey, input.featureKey)),
			});

			if (existing) {
				const [updated] = await db
					.update(schema.planFeatures)
					.set({ enabled: input.enabled })
					.where(eq(schema.planFeatures.id, existing.id))
					.returning();
				return updated;
			}

			const [created] = await db
				.insert(schema.planFeatures)
				.values({ id: nanoid(), ...input })
				.returning();
			return created;
		}),
});

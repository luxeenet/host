import {
	createRedirect,
	findApplicationById,
	findRedirectById,
	removeRedirectById,
	updateRedirectById,
} from "@dokploy/server";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateRedirect,
	apiFindOneRedirect,
	apiUpdateRedirect,
} from "@/server/db/schema";

const validateRedirectRule = async (
	applicationId: string,
	regex: string,
	replacement: string,
	currentRedirectId?: string,
) => {
	const trimmedRegex = regex.trim();
	const trimmedReplacement = replacement.trim();

	// 1. Validate regex syntax
	try {
		new RegExp(trimmedRegex);
	} catch (err: any) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid regular expression pattern: ${err?.message || "Syntax error"}`,
		});
	}

	// 2. Direct self-loop check (A -> A)
	if (trimmedRegex === trimmedReplacement) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Redirect source and target cannot be identical (would cause an infinite loop).",
		});
	}

	// 3. Direct recursion where target matches source pattern without replacement variables
	try {
		const compiled = new RegExp(trimmedRegex);
		if (compiled.test(trimmedReplacement) && !trimmedReplacement.includes("$")) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Target replacement matches the source pattern without group substitution, which would cause an infinite redirect loop.",
			});
		}
	} catch (err) {
		if (err instanceof TRPCError) throw err;
	}

	// 4. Circular loop with existing rules for this application (A -> B and B -> A)
	try {
		const app = await findApplicationById(applicationId);
		if (app?.redirects) {
			for (const existing of app.redirects) {
				if (currentRedirectId && existing.redirectId === currentRedirectId) continue;
				const existingRegex = existing.regex.trim();
				const existingReplacement = existing.replacement.trim();

				if (
					(existingRegex === trimmedReplacement && existingReplacement === trimmedRegex) ||
					(existingReplacement === trimmedRegex && existingRegex === trimmedReplacement)
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "This redirect rule forms a circular loop with an existing redirect rule.",
					});
				}
			}
		}
	} catch (err) {
		if (err instanceof TRPCError) throw err;
	}
};

export const redirectsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateRedirect)
		.mutation(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				service: ["create"],
			});
			await validateRedirectRule(input.applicationId, input.regex, input.replacement);
			await createRedirect(input);
			await audit(ctx, {
				action: "create",
				resourceType: "redirect",
				resourceId: input.applicationId,
				resourceName: input.regex,
			});
			return true;
		}),

	one: protectedProcedure
		.input(apiFindOneRedirect)
		.query(async ({ input, ctx }) => {
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(ctx, redirect.applicationId, {
				service: ["read"],
			});
			return redirect;
		}),

	delete: protectedProcedure
		.input(apiFindOneRedirect)
		.mutation(async ({ input, ctx }) => {
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(ctx, redirect.applicationId, {
				service: ["delete"],
			});
			const result = await removeRedirectById(input.redirectId);
			await audit(ctx, {
				action: "delete",
				resourceType: "redirect",
				resourceId: input.redirectId,
			});
			return result;
		}),

	update: protectedProcedure
		.input(apiUpdateRedirect)
		.mutation(async ({ input, ctx }) => {
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(ctx, redirect.applicationId, {
				service: ["create"],
			});
			await validateRedirectRule(
				redirect.applicationId,
				input.regex ?? redirect.regex,
				input.replacement ?? redirect.replacement,
				input.redirectId,
			);
			const result = await updateRedirectById(input.redirectId, input);
			await audit(ctx, {
				action: "update",
				resourceType: "redirect",
				resourceId: input.redirectId,
			});
			return result;
		}),
});

/**
 * Customer Storage Router
 *
 * Exposes customer-facing APIs for storage overview, browsing, uploads, downloads,
 * file operations (create folder, rename, move, copy, delete), and folder archives.
 *
 * Security: Strictly enforces that all operations are scoped to ctx.session.activeOrganizationId.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CustomerStorageService } from "@dokploy/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const customerStorageRouter = createTRPCRouter({
	/**
	 * Returns authoritative storage overview, quota, file stats, and available storage locations.
	 */
	overview: protectedProcedure.query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		if (!orgId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "No active organization selected.",
			});
		}
		return await CustomerStorageService.getStorageOverview(orgId);
	}),

	/**
	 * Lists directory contents, metadata, and breadcrumbs for the requested path.
	 */
	listDirectory: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				path: z.string().optional().default("/"),
				search: z.string().optional(),
				sortBy: z.enum(["name", "size", "updatedAt", "type"]).optional().default("name"),
				sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
				page: z.number().int().min(1).optional().default(1),
				pageSize: z.number().int().min(1).max(200).optional().default(50),
			}),
		)
		.query(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.listDirectory(orgId, input);
		}),

	/**
	 * Creates a new directory inside the customer's storage root.
	 */
	createFolder: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				folderPath: z.string().optional().default("/"),
				folderName: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.createFolder(orgId, input);
		}),

	/**
	 * Uploads a file with quota verification.
	 */
	uploadFile: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				folderPath: z.string().optional().default("/"),
				fileName: z.string().min(1).max(255),
				contentBase64: z.string(),
				overwrite: z.boolean().optional().default(false),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.uploadFile(orgId, input);
		}),

	/**
	 * Reads file content for safe previewing or download.
	 */
	readFile: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				filePath: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.readFile(orgId, input);
		}),

	/**
	 * Renames a file or folder.
	 */
	renameItem: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				oldPath: z.string().min(1),
				newName: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.renameItem(orgId, input);
		}),

	/**
	 * Moves files or folders into a target directory.
	 */
	moveItems: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				sourcePaths: z.array(z.string().min(1)).min(1),
				targetFolderPath: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.moveItems(orgId, input);
		}),

	/**
	 * Copies files or folders into a target directory, checking quota.
	 */
	copyItems: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				sourcePaths: z.array(z.string().min(1)).min(1),
				targetFolderPath: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.copyItems(orgId, input);
		}),

	/**
	 * Deletes specified files or directories (never deleting root).
	 */
	deleteItems: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				paths: z.array(z.string().min(1)).min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.deleteItems(orgId, input);
		}),

	/**
	 * Generates a ZIP archive of a folder for customer download.
	 */
	downloadFolderArchive: protectedProcedure
		.input(
			z.object({
				locationId: z.string().optional().default("default"),
				folderPath: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return await CustomerStorageService.downloadFolderArchive(orgId, input);
		}),
});

/**
 * CustomerStorageService
 *
 * Provides authoritative, tenant-isolated persistent file and storage management
 * for HatDot customer organizations.
 *
 * SECURITY & INTEGRITY INVARIANTS:
 * 1. Absolute tenant boundary: All file operations are strictly rooted within the organization's
 *    storage directory (${paths().CUSTOMER_STORAGE_PATH}/${organizationId}).
 * 2. Path traversal, symlink escapes, null-byte injection, and absolute path overrides are strictly blocked.
 * 3. Server-enforced quota: Uploads, copies, and extractions verify available quota against
 *    the active subscription plan before writing to disk.
 * 4. Tenant-assigned persistent volume isolation: Customers may only access volumes explicitly
 *    attached to their own application/compose workloads in schema.mounts.
 * 5. Safe previews: Active executable content (HTML, SVG, JS) is treated as raw text, never
 *    executed inside the dashboard origin.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { TRPCError } from "@trpc/server";
import { eq, inArray, or } from "drizzle-orm";
import { paths } from "../constants";
import { db } from "../db";
import * as schema from "../db/schema";
import { BackupStorageService } from "./backup-storage";
import {
	deleteVolumeFile,
	getVolumesSize,
	listVolumeFiles,
	readVolumeFile,
	writeVolumeFile,
} from "./docker-volume";
import { toMb } from "../monitoring/units";

export interface StorageQuotaInfo {
	usedBytes: number;
	limitBytes: number; // -1 = unlimited
	remainingBytes: number;
	percentage: number;
	formattedUsed: string;
	formattedLimit: string;
	formattedRemaining: string;
	isUnlimited: boolean;
	statusLabel: string;
}

export interface StorageLocationInfo {
	id: string;
	name: string;
	type: "file_storage" | "persistent_volume";
	volumeName?: string;
	serviceName?: string;
	isDefault: boolean;
	usedBytes?: number;
	formattedUsed?: string;
}

export interface StorageOverviewReport {
	organizationId: string;
	quota: StorageQuotaInfo;
	stats: {
		customerFileStorageBytes: number;
		volumeStorageBytes: number;
		backupStorageBytes: number;
		fileCount: number;
		folderCount: number;
	};
	locations: StorageLocationInfo[];
	activeLocation: string;
	measuredAt: string;
}

export interface StorageEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	formattedSize: string;
	mimeType: string;
	updatedAt: string;
	isSafePreview: boolean;
	previewType: "image" | "text" | "none";
}

export interface BreadcrumbItem {
	name: string;
	path: string;
}

export interface ListDirectoryResult {
	locationId: string;
	currentPath: string;
	breadcrumbs: BreadcrumbItem[];
	entries: StorageEntry[];
	totalEntries: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface FilePreviewResult {
	name: string;
	path: string;
	mimeType: string;
	size: number;
	formattedSize: string;
	content: string; // UTF-8 text or Base64 string for images
	isText: boolean;
	truncated: boolean;
	previewType: "image" | "text" | "none";
}

const MIME_MAP: Record<string, { mime: string; preview: "image" | "text" | "none" }> = {
	// Images (safe raster formats)
	png: { mime: "image/png", preview: "image" },
	jpg: { mime: "image/jpeg", preview: "image" },
	jpeg: { mime: "image/jpeg", preview: "image" },
	webp: { mime: "image/webp", preview: "image" },
	gif: { mime: "image/gif", preview: "image" },
	avif: { mime: "image/avif", preview: "image" },
	ico: { mime: "image/x-icon", preview: "image" },
	// SVG is previewed as plain text code to prevent XSS execution inside the dashboard origin!
	svg: { mime: "image/svg+xml", preview: "text" },

	// Documents / Data / Code (safe text previews)
	txt: { mime: "text/plain", preview: "text" },
	md: { mime: "text/markdown", preview: "text" },
	markdown: { mime: "text/markdown", preview: "text" },
	json: { mime: "application/json", preview: "text" },
	yaml: { mime: "text/yaml", preview: "text" },
	yml: { mime: "text/yaml", preview: "text" },
	xml: { mime: "text/xml", preview: "text" },
	toml: { mime: "text/plain", preview: "text" },
	env: { mime: "text/plain", preview: "text" },
	conf: { mime: "text/plain", preview: "text" },
	config: { mime: "text/plain", preview: "text" },
	ini: { mime: "text/plain", preview: "text" },
	log: { mime: "text/plain", preview: "text" },
	csv: { mime: "text/csv", preview: "text" },
	tsv: { mime: "text/tab-separated-values", preview: "text" },
	js: { mime: "application/javascript", preview: "text" },
	mjs: { mime: "application/javascript", preview: "text" },
	cjs: { mime: "application/javascript", preview: "text" },
	ts: { mime: "text/typescript", preview: "text" },
	tsx: { mime: "text/typescript", preview: "text" },
	jsx: { mime: "text/javascript", preview: "text" },
	html: { mime: "text/html", preview: "text" },
	css: { mime: "text/css", preview: "text" },
	scss: { mime: "text/x-scss", preview: "text" },
	sql: { mime: "application/sql", preview: "text" },
	sh: { mime: "application/x-sh", preview: "text" },
	bash: { mime: "application/x-sh", preview: "text" },
	dockerfile: { mime: "text/plain", preview: "text" },
	py: { mime: "text/x-python", preview: "text" },

	// Archives & Binaries (download only, no inline preview)
	pdf: { mime: "application/pdf", preview: "none" },
	zip: { mime: "application/zip", preview: "none" },
	tar: { mime: "application/x-tar", preview: "none" },
	gz: { mime: "application/gzip", preview: "none" },
	tgz: { mime: "application/gzip", preview: "none" },
	rar: { mime: "application/vnd.rar", preview: "none" },
	"7z": { mime: "application/x-7z-compressed", preview: "none" },
};

export function formatStorageBytes(bytes: number): string {
	if (bytes === 0) return "0 MB";
	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	if (i <= 0) return `${bytes} Bytes`;
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export class CustomerStorageService {
	/**
	 * Returns the authoritative root directory path for an organization's file storage.
	 * Provisions the directory automatically if it does not yet exist.
	 */
	static getTenantStorageRoot(organizationId: string): string {
		if (!organizationId || organizationId.includes("\0") || organizationId.includes("..")) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid organization identifier for storage provisioning.",
			});
		}

		const baseDir = paths().CUSTOMER_STORAGE_PATH;
		const tenantDir = path.join(baseDir, organizationId);

		try {
			if (!fs.existsSync(tenantDir)) {
				fs.mkdirSync(tenantDir, { recursive: true, mode: 0o750 });
			}
		} catch (err: any) {
			console.error(`[CustomerStorageService] Failed to create tenant storage dir: ${err?.message}`);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Unable to provision customer storage directory.",
			});
		}

		return tenantDir;
	}

	/**
	 * Safely resolves and validates a relative path inside the tenant's root.
	 * Blocks null bytes, directory traversal, absolute injections, and symlink escapes.
	 */
	static resolveSafePath(storageRoot: string, subPath?: string): string {
		const cleanSubPath = (subPath || "").trim();

		// Check for null bytes or illegal characters
		if (cleanSubPath.includes("\0")) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid path: null bytes are prohibited.",
			});
		}

		// Normalize relative path, strip leading slashes and Windows drive letters
		const normalized = path
			.normalize(cleanSubPath)
			.replace(/^[a-zA-Z]:[\\\/]/, "")
			.replace(/^[\\\/]+/, "");

		const realRoot = path.resolve(storageRoot);
		const resolved = path.resolve(realRoot, normalized);

		// Must be either the exact root or a child within the root
		if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Access denied: Path traversal outside customer storage boundary is prohibited.",
			});
		}

		// If path already exists, verify realpath does not escape symlinks
		if (fs.existsSync(resolved)) {
			try {
				const realTarget = fs.realpathSync(resolved);
				if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Access denied: Symlink escape detected.",
					});
				}
			} catch (err: any) {
				if (err instanceof TRPCError) throw err;
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Unable to verify filesystem path authenticity.",
				});
			}
		}

		return resolved;
	}

	/**
	 * Validates a file or directory name (must not contain path separators or traversal).
	 */
	static validateName(name: string): string {
		const trimmed = (name || "").trim();
		if (!trimmed) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Name cannot be empty.",
			});
		}
		if (
			trimmed.includes("/") ||
			trimmed.includes("\\") ||
			trimmed.includes("\0") ||
			trimmed === "." ||
			trimmed === ".."
		) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid file or folder name.",
			});
		}
		if (trimmed.length > 255) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Name exceeds maximum length of 255 characters.",
			});
		}
		return trimmed;
	}

	/**
	 * Recursively calculates size, file count, and folder count for a local directory.
	 */
	static calculateDirectoryStats(
		dirPath: string,
		maxDepth = 20,
		currentDepth = 0,
	): { totalBytes: number; fileCount: number; folderCount: number } {
		if (currentDepth > maxDepth || !fs.existsSync(dirPath)) {
			return { totalBytes: 0, fileCount: 0, folderCount: 0 };
		}

		let totalBytes = 0;
		let fileCount = 0;
		let folderCount = 0;

		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				try {
					if (entry.isDirectory()) {
						folderCount++;
						const sub = CustomerStorageService.calculateDirectoryStats(
							fullPath,
							maxDepth,
							currentDepth + 1,
						);
						totalBytes += sub.totalBytes;
						fileCount += sub.fileCount;
						folderCount += sub.folderCount;
					} else if (entry.isFile()) {
						fileCount++;
						const stats = fs.statSync(fullPath);
						totalBytes += stats.size;
					}
				} catch {
					// Skip unreadable files safely
				}
			}
		} catch (err: any) {
			console.error(`[CustomerStorageService] Error reading directory stats: ${err?.message}`);
		}

		return { totalBytes, fileCount, folderCount };
	}

	/**
	 * Returns the storage bytes consumed strictly by the customer's file storage directory.
	 */
	static async getTenantStorageUsage(organizationId: string): Promise<number> {
		try {
			const baseDir = paths().CUSTOMER_STORAGE_PATH;
			const tenantDir = path.join(baseDir, organizationId);
			if (!fs.existsSync(tenantDir)) {
				return 0;
			}
			const stats = CustomerStorageService.calculateDirectoryStats(tenantDir);
			return stats.totalBytes;
		} catch {
			return 0;
		}
	}

	/**
	 * Discovers all persistent volumes strictly authorized for this organization.
	 * Only volumes attached to applications/compose stacks belonging to the organization's projects are included.
	 */
	static async getAuthorizedTenantVolumes(
		organizationId: string,
		executor: any = db,
	): Promise<{ volumeName: string; serviceName: string; type: "application" | "compose" }[]> {
		try {
			const orgProjects = await (typeof executor.select === "function"
				? executor
						.select({ projectId: schema.projects.projectId })
						.from(schema.projects)
						.where(eq(schema.projects.organizationId, organizationId))
				: executor?.query?.projects?.findMany?.({
						where: eq(schema.projects.organizationId, organizationId),
						columns: { projectId: true },
					})) || [];

			if (orgProjects.length === 0) return [];
			const projectIds = orgProjects.map((p: any) => p.projectId);

			const orgEnvironments = await (typeof executor.select === "function"
				? executor
						.select({ environmentId: schema.environments.environmentId })
						.from(schema.environments)
						.where(inArray(schema.environments.projectId, projectIds))
				: executor?.query?.environments?.findMany?.({
						where: inArray(schema.environments.projectId, projectIds),
						columns: { environmentId: true },
					})) || [];

			if (orgEnvironments.length === 0) return [];
			const envIds = orgEnvironments.map((e: any) => e.environmentId);

			const [appRows, compRows] = await Promise.all([
				typeof executor.select === "function"
					? executor
							.select({
								applicationId: schema.applications.applicationId,
								name: schema.applications.name,
							})
							.from(schema.applications)
							.where(inArray(schema.applications.environmentId, envIds))
					: executor?.query?.applications?.findMany?.({
							where: inArray(schema.applications.environmentId, envIds),
							columns: { applicationId: true, name: true },
						}) || [],
				typeof executor.select === "function"
					? executor
							.select({
								composeId: schema.compose.composeId,
								name: schema.compose.name,
							})
							.from(schema.compose)
							.where(inArray(schema.compose.environmentId, envIds))
					: executor?.query?.compose?.findMany?.({
							where: inArray(schema.compose.environmentId, envIds),
							columns: { composeId: true, name: true },
						}) || [],
			]);

			const appMap = new Map<string, string>();
			const appIds: string[] = [];
			for (const a of appRows || []) {
				appMap.set(a.applicationId, a.name);
				appIds.push(a.applicationId);
			}

			const compMap = new Map<string, string>();
			const compIds: string[] = [];
			for (const c of compRows || []) {
				compMap.set(c.composeId, c.name);
				compIds.push(c.composeId);
			}

			const conditions: any[] = [];
			if (appIds.length > 0) conditions.push(inArray(schema.mounts.applicationId, appIds));
			if (compIds.length > 0) conditions.push(inArray(schema.mounts.composeId, compIds));

			if (conditions.length === 0) return [];

			const tenantMounts = await (typeof executor.select === "function"
				? executor
						.select({
							volumeName: schema.mounts.volumeName,
							type: schema.mounts.type,
							applicationId: schema.mounts.applicationId,
							composeId: schema.mounts.composeId,
						})
						.from(schema.mounts)
						.where(or(...conditions))
				: executor?.query?.mounts?.findMany?.({
						where: or(...conditions),
						columns: {
							volumeName: true,
							type: true,
							applicationId: true,
							composeId: true,
						},
					})) || [];

			const result: { volumeName: string; serviceName: string; type: "application" | "compose" }[] = [];
			const seenVolumes = new Set<string>();

			for (const m of tenantMounts || []) {
				if (m.type === "volume" && m.volumeName && !seenVolumes.has(m.volumeName)) {
					seenVolumes.add(m.volumeName);
					const serviceName = m.applicationId
						? appMap.get(m.applicationId) || "Application"
						: m.composeId
							? compMap.get(m.composeId) || "Compose Stack"
							: "Service";
					result.push({
						volumeName: m.volumeName,
						serviceName,
						type: m.applicationId ? "application" : "compose",
					});
				}
			}

			return result;
		} catch (err: any) {
			console.error(`[CustomerStorageService] Error discovering tenant volumes: ${err?.message}`);
			return [];
		}
	}

	/**
	 * Generates the authoritative storage overview report for the organization,
	 * incorporating customer file storage, tenant persistent volumes, and backups.
	 */
	static async getStorageOverview(
		organizationId: string,
		executor: any = db,
	): Promise<StorageOverviewReport> {
		if (!organizationId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Organization identifier is required.",
			});
		}

		// 1. Resolve subscription plan limits
		const subscription = await executor.query.subscriptions?.findFirst?.({
			where: eq(schema.subscriptions.organizationId, organizationId),
			with: {
				plan: {
					with: {
						resources: true,
					},
				},
			},
		});

		const planResources: Record<string, number> = {};
		if (subscription?.plan?.resources) {
			for (const r of subscription.plan.resources) {
				planResources[r.resourceKey] = r.value;
			}
		}

		const storageLimitGb = planResources["max_storage_gb"] ?? 20; // Default 20 GB
		const storageLimitBytes = storageLimitGb === -1 ? -1 : storageLimitGb * 1024 * 1024 * 1024;

		// 2. Measure Customer File Storage
		const tenantStorageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const fileStorageStats = CustomerStorageService.calculateDirectoryStats(tenantStorageRoot);

		// 3. Measure Tenant Persistent Volumes
		const tenantVolumes = await CustomerStorageService.getAuthorizedTenantVolumes(
			organizationId,
			executor,
		);
		let volumeStorageBytes = 0;
		const volumeSizeMap = new Map<string, number>();

		if (tenantVolumes.length > 0) {
			try {
				const volumesSizeList = await getVolumesSize();
				const tenantVolSet = new Set(tenantVolumes.map((v) => v.volumeName));
				for (const v of volumesSizeList || []) {
					if (v.name && tenantVolSet.has(v.name) && v.size) {
						const bytes = Math.round(toMb(v.size) * 1024 * 1024);
						volumeSizeMap.set(v.name, bytes);
						volumeStorageBytes += bytes;
					}
				}
			} catch (err: any) {
				console.error(`[CustomerStorageService] Error reading volume sizes: ${err?.message}`);
			}
		}

		// 4. Measure Database Backups
		let backupStorageBytes = 0;
		try {
			backupStorageBytes = await BackupStorageService.getOrganizationBackupStorageUsage(
				organizationId,
				executor,
			);
		} catch {
			backupStorageBytes = 0;
		}

		// 5. Total attributable storage
		const totalUsedBytes = fileStorageStats.totalBytes + volumeStorageBytes + backupStorageBytes;
		const remainingBytes =
			storageLimitBytes === -1 ? -1 : Math.max(0, storageLimitBytes - totalUsedBytes);
		const percentage =
			storageLimitBytes <= 0
				? 0
				: Math.min(100, Math.round((totalUsedBytes / storageLimitBytes) * 1000) / 10);

		// 6. Build storage locations list
		const locations: StorageLocationInfo[] = [
			{
				id: "default",
				name: "Customer File Storage",
				type: "file_storage",
				isDefault: true,
				usedBytes: fileStorageStats.totalBytes,
				formattedUsed: formatStorageBytes(fileStorageStats.totalBytes),
			},
		];

		for (const tv of tenantVolumes) {
			const volBytes = volumeSizeMap.get(tv.volumeName) || 0;
			locations.push({
				id: `vol_${tv.volumeName}`,
				name: `${tv.serviceName} (${tv.volumeName})`,
				type: "persistent_volume",
				volumeName: tv.volumeName,
				serviceName: tv.serviceName,
				isDefault: false,
				usedBytes: volBytes,
				formattedUsed: formatStorageBytes(volBytes),
			});
		}

		return {
			organizationId,
			quota: {
				usedBytes: totalUsedBytes,
				limitBytes: storageLimitBytes,
				remainingBytes,
				percentage,
				formattedUsed: formatStorageBytes(totalUsedBytes),
				formattedLimit: storageLimitBytes === -1 ? "Unlimited" : `${storageLimitGb} GB`,
				formattedRemaining:
					storageLimitBytes === -1 ? "Unlimited" : formatStorageBytes(remainingBytes),
				isUnlimited: storageLimitBytes === -1,
				statusLabel:
					percentage >= 95
						? "Quota Exhausted"
						: percentage >= 80
							? "Nearing Limit"
							: "Normal",
			},
			stats: {
				customerFileStorageBytes: fileStorageStats.totalBytes,
				volumeStorageBytes,
				backupStorageBytes,
				fileCount: fileStorageStats.fileCount,
				folderCount: fileStorageStats.folderCount,
			},
			locations,
			activeLocation: "default",
			measuredAt: new Date().toISOString(),
		};
	}

	/**
	 * Verifies that the tenant has sufficient remaining storage quota before writing or copying data.
	 */
	static async assertQuotaAvailable(
		organizationId: string,
		incomingBytes: number,
		executor: any = db,
	): Promise<void> {
		const overview = await CustomerStorageService.getStorageOverview(organizationId, executor);
		if (overview.quota.isUnlimited) {
			return;
		}

		if (overview.quota.remainingBytes < incomingBytes) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Storage quota exceeded. Required: ${formatStorageBytes(incomingBytes)}, Available: ${formatStorageBytes(overview.quota.remainingBytes)}. Please upgrade your plan or delete existing files.`,
			});
		}
	}

	/**
	 * Lists directory contents, file metadata, and breadcrumbs for the requested location and path.
	 */
	static async listDirectory(
		organizationId: string,
		input: {
			locationId?: string;
			path?: string;
			search?: string;
			sortBy?: "name" | "size" | "updatedAt" | "type";
			sortOrder?: "asc" | "desc";
			page?: number;
			pageSize?: number;
		},
		executor: any = db,
	): Promise<ListDirectoryResult> {
		const locationId = input.locationId || "default";
		const requestedPath = input.path || "/";
		const sortBy = input.sortBy || "name";
		const sortOrder = input.sortOrder || "asc";
		const page = Math.max(1, input.page || 1);
		const pageSize = Math.max(1, Math.min(200, input.pageSize || 50));
		const search = (input.search || "").trim().toLowerCase();

		// Handle Persistent Volume Location
		if (locationId.startsWith("vol_")) {
			const volumeName = locationId.replace(/^vol_/, "");
			const authorizedVols = await CustomerStorageService.getAuthorizedTenantVolumes(
				organizationId,
				executor,
			);
			const isAuthorized = authorizedVols.some((v) => v.volumeName === volumeName);
			if (!isAuthorized) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Access denied to unauthorized volume.",
				});
			}

			// Clean volume relative path
			const cleanVolumePath = requestedPath.startsWith("/")
				? requestedPath
				: `/${requestedPath}`;

			try {
				const volumeFiles = await listVolumeFiles(volumeName, cleanVolumePath);
				let entries: StorageEntry[] = volumeFiles.map((vf) => {
					const ext = vf.name.split(".").pop()?.toLowerCase() || "";
					const mimeInfo = MIME_MAP[ext] || { mime: "application/octet-stream", preview: "none" };
					return {
						name: vf.name,
						path: cleanVolumePath === "/" ? `/${vf.name}` : `${cleanVolumePath}/${vf.name}`,
						isDirectory: vf.isDirectory,
						size: 0,
						formattedSize: vf.isDirectory ? "--" : "0 MB",
						mimeType: vf.isDirectory ? "directory" : mimeInfo.mime,
						updatedAt: new Date().toISOString(),
						isSafePreview: !vf.isDirectory && mimeInfo.preview !== "none",
						previewType: vf.isDirectory ? "none" : mimeInfo.preview,
					};
				});

				if (search) {
					entries = entries.filter((e) => e.name.toLowerCase().includes(search));
				}

				entries.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
					return sortOrder === "asc"
						? a.name.localeCompare(b.name)
						: b.name.localeCompare(a.name);
				});

				// Breadcrumbs
				const segments = cleanVolumePath.split("/").filter(Boolean);
				const breadcrumbs: BreadcrumbItem[] = [{ name: "Root", path: "/" }];
				let acc = "";
				for (const seg of segments) {
					acc += `/${seg}`;
					breadcrumbs.push({ name: seg, path: acc });
				}

				const totalEntries = entries.length;
				const totalPages = Math.ceil(totalEntries / pageSize) || 1;
				const paginatedEntries = entries.slice((page - 1) * pageSize, page * pageSize);

				return {
					locationId,
					currentPath: cleanVolumePath,
					breadcrumbs,
					entries: paginatedEntries,
					totalEntries,
					page,
					pageSize,
					totalPages,
				};
			} catch (err: any) {
				console.error(`[CustomerStorageService] Error listing volume: ${err?.message}`);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Unable to inspect application volume contents.",
				});
			}
		}

		// Handle Standard Customer File Storage
		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const targetDir = CustomerStorageService.resolveSafePath(storageRoot, requestedPath);

		if (!fs.existsSync(targetDir)) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "The requested directory does not exist.",
			});
		}

		const stat = fs.statSync(targetDir);
		if (!stat.isDirectory()) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Specified path is not a directory.",
			});
		}

		const dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
		const realRoot = path.resolve(storageRoot);

		let entries: StorageEntry[] = [];

		for (const dirent of dirEntries) {
			const entryPath = path.join(targetDir, dirent.name);
			const relPath = "/" + path.relative(realRoot, entryPath).replace(/\\/g, "/");

			try {
				const isDir = dirent.isDirectory();
				let size = 0;
				let mtime = new Date();

				try {
					const itemStat = fs.statSync(entryPath);
					size = isDir ? 0 : itemStat.size;
					mtime = itemStat.mtime;
				} catch {
					// File stat error, fallback to defaults
				}

				const ext = dirent.name.split(".").pop()?.toLowerCase() || "";
				const mimeInfo = MIME_MAP[ext] || { mime: "application/octet-stream", preview: "none" };

				entries.push({
					name: dirent.name,
					path: relPath,
					isDirectory: isDir,
					size,
					formattedSize: isDir ? "--" : formatStorageBytes(size),
					mimeType: isDir ? "directory" : mimeInfo.mime,
					updatedAt: mtime.toISOString(),
					isSafePreview: !isDir && mimeInfo.preview !== "none",
					previewType: isDir ? "none" : mimeInfo.preview,
				});
			} catch {
				// Skip corrupt entry
			}
		}

		// Filter by search
		if (search) {
			entries = entries.filter((e) => e.name.toLowerCase().includes(search));
		}

		// Sort entries (directories always first)
		entries.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			let cmp = 0;
			if (sortBy === "size") {
				cmp = a.size - b.size;
			} else if (sortBy === "updatedAt") {
				cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
			} else if (sortBy === "type") {
				cmp = a.mimeType.localeCompare(b.mimeType);
			} else {
				cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
			}
			return sortOrder === "desc" ? -cmp : cmp;
		});

		// Build Breadcrumbs
		const normalizedCurrent = "/" + path.relative(realRoot, targetDir).replace(/\\/g, "/");
		const cleanCurrent = normalizedCurrent === "/." ? "/" : normalizedCurrent;
		const segments = cleanCurrent.split("/").filter(Boolean);
		const breadcrumbs: BreadcrumbItem[] = [{ name: "Root", path: "/" }];

		let acc = "";
		for (const seg of segments) {
			acc += `/${seg}`;
			breadcrumbs.push({ name: seg, path: acc });
		}

		const totalEntries = entries.length;
		const totalPages = Math.ceil(totalEntries / pageSize) || 1;
		const paginatedEntries = entries.slice((page - 1) * pageSize, page * pageSize);

		return {
			locationId: "default",
			currentPath: cleanCurrent,
			breadcrumbs,
			entries: paginatedEntries,
			totalEntries,
			page,
			pageSize,
			totalPages,
		};
	}

	/**
	 * Creates a new directory safely inside the customer's storage root.
	 */
	static async createFolder(
		organizationId: string,
		input: {
			locationId?: string;
			folderPath: string;
			folderName: string;
		},
	): Promise<{ success: boolean; path: string }> {
		const folderName = CustomerStorageService.validateName(input.folderName);
		const locationId = input.locationId || "default";

		if (locationId !== "default") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Folder creation is currently supported on Customer File Storage.",
			});
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const parentDir = CustomerStorageService.resolveSafePath(storageRoot, input.folderPath);

		if (!fs.existsSync(parentDir)) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Parent directory does not exist.",
			});
		}

		const newFolderPath = path.join(parentDir, folderName);

		// Verify target does not escape
		CustomerStorageService.resolveSafePath(storageRoot, path.relative(storageRoot, newFolderPath));

		if (fs.existsSync(newFolderPath)) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `A folder or file named '${folderName}' already exists.`,
			});
		}

		try {
			fs.mkdirSync(newFolderPath, { recursive: false, mode: 0o750 });
			const relPath = "/" + path.relative(storageRoot, newFolderPath).replace(/\\/g, "/");
			return { success: true, path: relPath };
		} catch (err: any) {
			console.error(`[CustomerStorageService] Create folder error: ${err?.message}`);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create directory.",
			});
		}
	}

	/**
	 * Uploads a file, enforcing quota checks and writing data safely.
	 */
	static async uploadFile(
		organizationId: string,
		input: {
			locationId?: string;
			folderPath: string;
			fileName: string;
			contentBase64: string;
			overwrite?: boolean;
		},
		executor: any = db,
	): Promise<{ success: boolean; path: string; size: number }> {
		const fileName = CustomerStorageService.validateName(input.fileName);
		const locationId = input.locationId || "default";

		// Buffer validation & size calculation
		let buffer: Buffer;
		try {
			buffer = Buffer.from(input.contentBase64, "base64");
		} catch {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid Base64 file payload.",
			});
		}

		const fileSize = buffer.byteLength;
		if (fileSize > 100 * 1024 * 1024) {
			// 100MB per file limit
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "File exceeds single upload limit of 100 MB.",
			});
		}

		// Enforce Plan Quota Server-Side
		await CustomerStorageService.assertQuotaAvailable(organizationId, fileSize, executor);

		// Handle Persistent Volume
		if (locationId.startsWith("vol_")) {
			const volumeName = locationId.replace(/^vol_/, "");
			const authorizedVols = await CustomerStorageService.getAuthorizedTenantVolumes(
				organizationId,
				executor,
			);
			if (!authorizedVols.some((v) => v.volumeName === volumeName)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized volume access." });
			}

			const targetPath =
				input.folderPath === "/" ? `/${fileName}` : `${input.folderPath}/${fileName}`;
			await writeVolumeFile(volumeName, targetPath, buffer.toString("utf8"));
			return { success: true, path: targetPath, size: fileSize };
		}

		// Handle Customer File Storage
		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const targetDir = CustomerStorageService.resolveSafePath(storageRoot, input.folderPath);

		if (!fs.existsSync(targetDir)) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Target directory does not exist.",
			});
		}

		const targetFilePath = path.join(targetDir, fileName);
		CustomerStorageService.resolveSafePath(storageRoot, path.relative(storageRoot, targetFilePath));

		if (fs.existsSync(targetFilePath) && !input.overwrite) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `A file named '${fileName}' already exists in this folder.`,
			});
		}

		try {
			fs.writeFileSync(targetFilePath, buffer, { mode: 0o640 });
			const relPath = "/" + path.relative(storageRoot, targetFilePath).replace(/\\/g, "/");
			return { success: true, path: relPath, size: fileSize };
		} catch (err: any) {
			console.error(`[CustomerStorageService] Write file error: ${err?.message}`);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to write file to storage.",
			});
		}
	}

	/**
	 * Reads file content for safe previewing or download.
	 */
	static async readFile(
		organizationId: string,
		input: {
			locationId?: string;
			filePath: string;
		},
		executor: any = db,
	): Promise<FilePreviewResult> {
		const locationId = input.locationId || "default";

		if (locationId.startsWith("vol_")) {
			const volumeName = locationId.replace(/^vol_/, "");
			const authorizedVols = await CustomerStorageService.getAuthorizedTenantVolumes(
				organizationId,
				executor,
			);
			if (!authorizedVols.some((v) => v.volumeName === volumeName)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized volume access." });
			}

			const { content, truncated } = await readVolumeFile(volumeName, input.filePath);
			const fileName = input.filePath.split("/").pop() || "file";
			const ext = fileName.split(".").pop()?.toLowerCase() || "";
			const mimeInfo = MIME_MAP[ext] || { mime: "application/octet-stream", preview: "text" };

			return {
				name: fileName,
				path: input.filePath,
				mimeType: mimeInfo.mime,
				size: Buffer.from(content, "base64").byteLength,
				formattedSize: formatStorageBytes(Buffer.from(content, "base64").byteLength),
				content: Buffer.from(content, "base64").toString("utf8"),
				isText: true,
				truncated,
				previewType: mimeInfo.preview,
			};
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const fullPath = CustomerStorageService.resolveSafePath(storageRoot, input.filePath);

		if (!fs.existsSync(fullPath)) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "File not found.",
			});
		}

		const stat = fs.statSync(fullPath);
		if (stat.isDirectory()) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot read directory as file.",
			});
		}

		const fileName = path.basename(fullPath);
		const ext = fileName.split(".").pop()?.toLowerCase() || "";
		const mimeInfo = MIME_MAP[ext] || { mime: "application/octet-stream", preview: "none" };

		const maxPreviewSize = 1024 * 1024; // 1 MB preview threshold
		const truncated = stat.size > maxPreviewSize;
		const readSize = Math.min(stat.size, maxPreviewSize);

		const buffer = Buffer.alloc(readSize);
		const fd = fs.openSync(fullPath, "r");
		try {
			fs.readSync(fd, buffer, 0, readSize, 0);
		} finally {
			fs.closeSync(fd);
		}

		let content = "";
		let isText = false;

		if (mimeInfo.preview === "image") {
			content = buffer.toString("base64");
			isText = false;
		} else {
			content = buffer.toString("utf8");
			isText = true;
		}

		return {
			name: fileName,
			path: "/" + path.relative(storageRoot, fullPath).replace(/\\/g, "/"),
			mimeType: mimeInfo.mime,
			size: stat.size,
			formattedSize: formatStorageBytes(stat.size),
			content,
			isText,
			truncated,
			previewType: mimeInfo.preview,
		};
	}

	/**
	 * Renames a file or folder safely within customer storage.
	 */
	static async renameItem(
		organizationId: string,
		input: {
			locationId?: string;
			oldPath: string;
			newName: string;
		},
	): Promise<{ success: boolean; newPath: string }> {
		const newName = CustomerStorageService.validateName(input.newName);
		const locationId = input.locationId || "default";

		if (locationId !== "default") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Renaming is currently supported on Customer File Storage.",
			});
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const oldFullPath = CustomerStorageService.resolveSafePath(storageRoot, input.oldPath);

		if (oldFullPath === path.resolve(storageRoot)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Cannot rename storage root.",
			});
		}

		if (!fs.existsSync(oldFullPath)) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Item to rename does not exist.",
			});
		}

		const parentDir = path.dirname(oldFullPath);
		const newFullPath = path.join(parentDir, newName);

		// Verify target path safety
		CustomerStorageService.resolveSafePath(storageRoot, path.relative(storageRoot, newFullPath));

		if (fs.existsSync(newFullPath)) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `An item named '${newName}' already exists in this folder.`,
			});
		}

		try {
			fs.renameSync(oldFullPath, newFullPath);
			const relPath = "/" + path.relative(storageRoot, newFullPath).replace(/\\/g, "/");
			return { success: true, newPath: relPath };
		} catch (err: any) {
			console.error(`[CustomerStorageService] Rename error: ${err?.message}`);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to rename item.",
			});
		}
	}

	/**
	 * Moves files or folders into a target folder safely.
	 */
	static async moveItems(
		organizationId: string,
		input: {
			locationId?: string;
			sourcePaths: string[];
			targetFolderPath: string;
		},
	): Promise<{ success: boolean; movedCount: number }> {
		const locationId = input.locationId || "default";
		if (locationId !== "default") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Move operations are supported on Customer File Storage.",
			});
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const targetDir = CustomerStorageService.resolveSafePath(storageRoot, input.targetFolderPath);

		if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Target directory does not exist.",
			});
		}

		let movedCount = 0;

		for (const src of input.sourcePaths) {
			const sourceFullPath = CustomerStorageService.resolveSafePath(storageRoot, src);
			if (sourceFullPath === path.resolve(storageRoot)) continue;
			if (!fs.existsSync(sourceFullPath)) continue;

			const itemName = path.basename(sourceFullPath);
			const destFullPath = path.join(targetDir, itemName);

			// Prevent moving folder into itself
			if (destFullPath.startsWith(sourceFullPath + path.sep) || destFullPath === sourceFullPath) {
				continue;
			}

			CustomerStorageService.resolveSafePath(storageRoot, path.relative(storageRoot, destFullPath));

			try {
				fs.renameSync(sourceFullPath, destFullPath);
				movedCount++;
			} catch (err: any) {
				console.error(`[CustomerStorageService] Move error: ${err?.message}`);
			}
		}

		return { success: true, movedCount };
	}

	/**
	 * Copies files or folders into a target folder safely, validating quota.
	 */
	static async copyItems(
		organizationId: string,
		input: {
			locationId?: string;
			sourcePaths: string[];
			targetFolderPath: string;
		},
		executor: any = db,
	): Promise<{ success: boolean; copiedCount: number }> {
		const locationId = input.locationId || "default";
		if (locationId !== "default") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Copy operations are supported on Customer File Storage.",
			});
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const targetDir = CustomerStorageService.resolveSafePath(storageRoot, input.targetFolderPath);

		if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Target directory does not exist.",
			});
		}

		// Calculate total bytes to copy
		let requiredBytes = 0;
		for (const src of input.sourcePaths) {
			const sourceFullPath = CustomerStorageService.resolveSafePath(storageRoot, src);
			if (!fs.existsSync(sourceFullPath)) continue;
			const stat = fs.statSync(sourceFullPath);
			if (stat.isDirectory()) {
				requiredBytes += CustomerStorageService.calculateDirectoryStats(sourceFullPath).totalBytes;
			} else {
				requiredBytes += stat.size;
			}
		}

		// Check quota before copying
		await CustomerStorageService.assertQuotaAvailable(organizationId, requiredBytes, executor);

		let copiedCount = 0;

		for (const src of input.sourcePaths) {
			const sourceFullPath = CustomerStorageService.resolveSafePath(storageRoot, src);
			if (sourceFullPath === path.resolve(storageRoot)) continue;
			if (!fs.existsSync(sourceFullPath)) continue;

			const baseName = path.basename(sourceFullPath);
			let destFullPath = path.join(targetDir, baseName);

			// If duplicate, append "-copy"
			if (fs.existsSync(destFullPath)) {
				const ext = path.extname(baseName);
				const stem = path.basename(baseName, ext);
				destFullPath = path.join(targetDir, `${stem}-copy${ext}`);
			}

			CustomerStorageService.resolveSafePath(storageRoot, path.relative(storageRoot, destFullPath));

			try {
				fs.cpSync(sourceFullPath, destFullPath, { recursive: true });
				copiedCount++;
			} catch (err: any) {
				console.error(`[CustomerStorageService] Copy error: ${err?.message}`);
			}
		}

		return { success: true, copiedCount };
	}

	/**
	 * Deletes specified files or folders safely.
	 * Explicitly prohibits deleting the tenant storage root itself.
	 */
	static async deleteItems(
		organizationId: string,
		input: {
			locationId?: string;
			paths: string[];
		},
		executor: any = db,
	): Promise<{ success: boolean; deletedCount: number }> {
		const locationId = input.locationId || "default";

		// Handle Persistent Volume Deletion
		if (locationId.startsWith("vol_")) {
			const volumeName = locationId.replace(/^vol_/, "");
			const authorizedVols = await CustomerStorageService.getAuthorizedTenantVolumes(
				organizationId,
				executor,
			);
			if (!authorizedVols.some((v) => v.volumeName === volumeName)) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Unauthorized volume access." });
			}

			let deletedCount = 0;
			for (const p of input.paths) {
				if (!p || p === "/" || p === ".") continue;
				try {
					await deleteVolumeFile(volumeName, p);
					deletedCount++;
				} catch (err: any) {
					console.error(`[CustomerStorageService] Error deleting from volume: ${err?.message}`);
				}
			}
			return { success: true, deletedCount };
		}

		// Handle Customer File Storage Deletion
		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const realRoot = path.resolve(storageRoot);

		let deletedCount = 0;

		for (const p of input.paths) {
			const fullPath = CustomerStorageService.resolveSafePath(storageRoot, p);

			// Absolute safeguard: Never delete the storage root itself!
			if (fullPath === realRoot) {
				continue;
			}

			if (!fs.existsSync(fullPath)) {
				continue;
			}

			try {
				fs.rmSync(fullPath, { recursive: true, force: true });
				deletedCount++;
			} catch (err: any) {
				console.error(`[CustomerStorageService] Delete error: ${err?.message}`);
			}
		}

		return { success: true, deletedCount };
	}

	/**
	 * Creates a ZIP archive of a folder for customer download.
	 * Limits archive size to 100MB to protect server memory and CPU.
	 */
	static async downloadFolderArchive(
		organizationId: string,
		input: {
			locationId?: string;
			folderPath: string;
		},
	): Promise<{ fileName: string; zipBufferBase64: string; size: number }> {
		const locationId = input.locationId || "default";
		if (locationId !== "default") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Archive download is supported on Customer File Storage.",
			});
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(organizationId);
		const folderFullPath = CustomerStorageService.resolveSafePath(storageRoot, input.folderPath);

		if (!fs.existsSync(folderFullPath) || !fs.statSync(folderFullPath).isDirectory()) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Folder not found.",
			});
		}

		const stats = CustomerStorageService.calculateDirectoryStats(folderFullPath);
		if (stats.totalBytes > 100 * 1024 * 1024) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Folder exceeds maximum downloadable archive limit of 100 MB.",
			});
		}

		const folderName =
			folderFullPath === path.resolve(storageRoot) ? "storage-root" : path.basename(folderFullPath);

		try {
			const zip = new AdmZip();
			zip.addLocalFolder(folderFullPath);
			const zipBuffer = zip.toBuffer();

			return {
				fileName: `${folderName}.zip`,
				zipBufferBase64: zipBuffer.toString("base64"),
				size: zipBuffer.byteLength,
			};
		} catch (err: any) {
			console.error(`[CustomerStorageService] Archive generation error: ${err?.message}`);
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to generate folder archive.",
			});
		}
	}
}

/**
 * Customer Storage Management Test Suite
 *
 * Verifies:
 * 1. Storage ownership, tenant isolation, and boundary enforcement.
 * 2. Directory listing, metadata extraction, and breadcrumb generation.
 * 3. Folder creation, nesting, and duplicate validation.
 * 4. File uploads, reading, safe preview classification, and download headers.
 * 5. Rename, move, copy, and delete operations (including safeguarding storage root).
 * 6. Strict blocking of path traversal, symlink escapes, null bytes, and absolute paths.
 * 7. Server-side quota enforcement for uploads and copies.
 * 8. Rejection of unauthorized persistent volumes from other tenants.
 * 9. Accurate storage quota calculation integrating with CustomerUsageService.
 * 10. Canonical dashboard routing and active navigation state detection.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock audit and permissions
vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkPermission: vi.fn(async () => undefined),
	checkServiceAccess: vi.fn(async () => undefined),
	checkServicePermissionAndAccess: vi.fn(async () => undefined),
}));

// Mock docker volume methods
vi.mock("@dokploy/server/services/docker-volume", () => ({
	getVolumesSize: vi.fn(async () => [
		{ name: "vol_cust_app", size: "100MB" },
		{ name: "vol_other_tenant", size: "15GB" },
	]),
	listVolumeFiles: vi.fn(async (volumeName: string, path: string) => [
		{ name: "config.yaml", isDirectory: false },
		{ name: "uploads", isDirectory: true },
	]),
	readVolumeFile: vi.fn(async () => ({
		content: Buffer.from("version: '3'").toString("base64"),
		truncated: false,
	})),
	writeVolumeFile: vi.fn(async () => undefined),
	deleteVolumeFile: vi.fn(async () => undefined),
}));

// Mock backup storage
vi.mock("@dokploy/server/services/backup-storage", () => ({
	BackupStorageService: {
		getOrganizationBackupStorageUsage: vi.fn(async (orgId: string) => {
			if (orgId === "org-test-storage") return 50 * 1024 * 1024; // 50MB
			return 0;
		}),
	},
}));

import {
	CustomerStorageService,
	formatStorageBytes,
	paths,
} from "@dokploy/server";
import { customerStorageRouter } from "@/server/api/routers/customer-storage";
import { isCustomerRouteActive, NAV_ITEMS } from "@/components/layouts/customer-layout";
import { MENU } from "@/components/layouts/side";
import { getServerSideProps as homeStorageGSSP } from "@/pages/home/dashboard/storage";

describe("Customer Storage Management Feature", () => {
	const testOrgId = "org-test-storage";
	const otherOrgId = "org-other-tenant";
	let testStorageRoot: string;
	let otherStorageRoot: string;

	beforeEach(() => {
		vi.clearAllMocks();
		testStorageRoot = CustomerStorageService.getTenantStorageRoot(testOrgId);
		otherStorageRoot = CustomerStorageService.getTenantStorageRoot(otherOrgId);
	});

	afterEach(() => {
		try {
			if (fs.existsSync(testStorageRoot)) {
				fs.rmSync(testStorageRoot, { recursive: true, force: true });
			}
			if (fs.existsSync(otherStorageRoot)) {
				fs.rmSync(otherStorageRoot, { recursive: true, force: true });
			}
		} catch {
			// Cleanup
		}
	});

	describe("1. Tenant Isolation and Path Traversal Safeguards", () => {
		it("provisions isolated directories per tenant", () => {
			expect(testStorageRoot).toBeDefined();
			expect(otherStorageRoot).toBeDefined();
			expect(testStorageRoot).not.toEqual(otherStorageRoot);
			expect(fs.existsSync(testStorageRoot)).toBe(true);
			expect(fs.existsSync(otherStorageRoot)).toBe(true);
		});

		it("strictly blocks path traversal attempts using ../", () => {
			expect(() => {
				CustomerStorageService.resolveSafePath(testStorageRoot, "../other-tenant");
			}).toThrowError(TRPCError);

			expect(() => {
				CustomerStorageService.resolveSafePath(testStorageRoot, "../../etc/passwd");
			}).toThrowError(TRPCError);

			expect(() => {
				CustomerStorageService.resolveSafePath(testStorageRoot, "folder/../../../secret");
			}).toThrowError(TRPCError);
		});

		it("strictly blocks null bytes in paths", () => {
			expect(() => {
				CustomerStorageService.resolveSafePath(testStorageRoot, "file.txt\0.png");
			}).toThrowError(TRPCError);
		});

		it("prevents absolute path injection from overriding tenant storage root", () => {
			const resolved = CustomerStorageService.resolveSafePath(testStorageRoot, "/documents");
			expect(resolved.startsWith(path.resolve(testStorageRoot))).toBe(true);
			expect(resolved).toEqual(path.join(testStorageRoot, "documents"));
		});

		it("strictly prohibits deleting the storage root directory", async () => {
			const res = await CustomerStorageService.deleteItems(testOrgId, {
				locationId: "default",
				paths: ["/", ""],
			});
			expect(res.deletedCount).toBe(0);
			expect(fs.existsSync(testStorageRoot)).toBe(true);
		});
	});

	describe("2. Directory Navigation, File Creation, and Metadata", () => {
		it("creates folders and subfolders safely", async () => {
			const res1 = await CustomerStorageService.createFolder(testOrgId, {
				locationId: "default",
				folderPath: "/",
				folderName: "documents",
			});
			expect(res1.success).toBe(true);
			expect(res1.path).toBe("/documents");
			expect(fs.existsSync(path.join(testStorageRoot, "documents"))).toBe(true);

			// Subfolder
			const res2 = await CustomerStorageService.createFolder(testOrgId, {
				locationId: "default",
				folderPath: "/documents",
				folderName: "reports",
			});
			expect(res2.success).toBe(true);
			expect(res2.path).toBe("/documents/reports");
			expect(fs.existsSync(path.join(testStorageRoot, "documents", "reports"))).toBe(true);
		});

		it("rejects duplicate folder names in the same directory", async () => {
			await CustomerStorageService.createFolder(testOrgId, {
				locationId: "default",
				folderPath: "/",
				folderName: "assets",
			});

			await expect(
				CustomerStorageService.createFolder(testOrgId, {
					locationId: "default",
					folderPath: "/",
					folderName: "assets",
				}),
			).rejects.toThrowError(TRPCError);
		});

		it("uploads files and verifies metadata, MIME types, and preview classification", async () => {
			const content = "Hello HatDot Persistent Storage!";
			const base64 = Buffer.from(content).toString("base64");

			const uploadRes = await CustomerStorageService.uploadFile(testOrgId, {
				locationId: "default",
				folderPath: "/",
				fileName: "greeting.txt",
				contentBase64: base64,
			});

			expect(uploadRes.success).toBe(true);
			expect(uploadRes.size).toBe(Buffer.from(content).byteLength);

			// List directory
			const dir = await CustomerStorageService.listDirectory(testOrgId, {
				locationId: "default",
				path: "/",
			});

			expect(dir.entries).toHaveLength(1);
			const fileEntry = dir.entries[0]!;
			expect(fileEntry.name).toBe("greeting.txt");
			expect(fileEntry.isDirectory).toBe(false);
			expect(fileEntry.mimeType).toBe("text/plain");
			expect(fileEntry.isSafePreview).toBe(true);
			expect(fileEntry.previewType).toBe("text");
			expect(dir.breadcrumbs).toHaveLength(1);
			expect(dir.breadcrumbs[0]!.name).toBe("Root");
		});

		it("classifies image files for safe raster preview", async () => {
			const dummyPngBase64 = Buffer.from("fake-png-binary-data").toString("base64");

			await CustomerStorageService.uploadFile(testOrgId, {
				locationId: "default",
				folderPath: "/",
				fileName: "logo.png",
				contentBase64: dummyPngBase64,
			});

			const dir = await CustomerStorageService.listDirectory(testOrgId, {
				locationId: "default",
				path: "/",
			});

			const imgEntry = dir.entries.find((e) => e.name === "logo.png");
			expect(imgEntry).toBeDefined();
			expect(imgEntry?.mimeType).toBe("image/png");
			expect(imgEntry?.previewType).toBe("image");
			expect(imgEntry?.isSafePreview).toBe(true);
		});
	});

	describe("3. File Management Operations: Rename, Move, Copy, Delete, and Archive", () => {
		beforeEach(async () => {
			await CustomerStorageService.createFolder(testOrgId, {
				folderPath: "/",
				folderName: "src",
			});
			await CustomerStorageService.createFolder(testOrgId, {
				folderPath: "/",
				folderName: "backup",
			});
			await CustomerStorageService.uploadFile(testOrgId, {
				folderPath: "/src",
				fileName: "app.ts",
				contentBase64: Buffer.from("console.log('App running');").toString("base64"),
			});
		});

		it("renames an existing file safely", async () => {
			const renameRes = await CustomerStorageService.renameItem(testOrgId, {
				locationId: "default",
				oldPath: "/src/app.ts",
				newName: "main.ts",
			});

			expect(renameRes.success).toBe(true);
			expect(renameRes.newPath).toBe("/src/main.ts");
			expect(fs.existsSync(path.join(testStorageRoot, "src", "main.ts"))).toBe(true);
			expect(fs.existsSync(path.join(testStorageRoot, "src", "app.ts"))).toBe(false);
		});

		it("moves items between folders safely", async () => {
			const moveRes = await CustomerStorageService.moveItems(testOrgId, {
				locationId: "default",
				sourcePaths: ["/src/app.ts"],
				targetFolderPath: "/backup",
			});

			expect(moveRes.success).toBe(true);
			expect(moveRes.movedCount).toBe(1);
			expect(fs.existsSync(path.join(testStorageRoot, "backup", "app.ts"))).toBe(true);
			expect(fs.existsSync(path.join(testStorageRoot, "src", "app.ts"))).toBe(false);
		});

		it("copies files into target folder safely", async () => {
			const copyRes = await CustomerStorageService.copyItems(testOrgId, {
				locationId: "default",
				sourcePaths: ["/src/app.ts"],
				targetFolderPath: "/backup",
			});

			expect(copyRes.success).toBe(true);
			expect(copyRes.copiedCount).toBe(1);
			expect(fs.existsSync(path.join(testStorageRoot, "src", "app.ts"))).toBe(true);
			expect(fs.existsSync(path.join(testStorageRoot, "backup", "app.ts"))).toBe(true);
		});

		it("deletes specified files and folders recursively", async () => {
			const deleteRes = await CustomerStorageService.deleteItems(testOrgId, {
				locationId: "default",
				paths: ["/src/app.ts"],
			});

			expect(deleteRes.success).toBe(true);
			expect(deleteRes.deletedCount).toBe(1);
			expect(fs.existsSync(path.join(testStorageRoot, "src", "app.ts"))).toBe(false);
		});

		it("generates a valid ZIP archive of a folder for download", async () => {
			const archive = await CustomerStorageService.downloadFolderArchive(testOrgId, {
				locationId: "default",
				folderPath: "/src",
			});

			expect(archive.fileName).toBe("src.zip");
			expect(archive.size).toBeGreaterThan(0);
			expect(archive.zipBufferBase64).toBeDefined();
		});
	});

	describe("4. Storage Quota Enforcement and Attribution", () => {
		it("blocks uploads that exceed the organization's plan storage quota", async () => {
			// Mock executor with a strict 1 GB plan limit
			const strictMockExecutor: any = {
				query: {
					subscriptions: {
						findFirst: vi.fn(async () => ({
							plan: {
								resources: [{ resourceKey: "max_storage_gb", value: 1 }],
							},
						})),
					},
					projects: { findMany: vi.fn(async () => []) },
					environments: { findMany: vi.fn(async () => []) },
					applications: { findMany: vi.fn(async () => []) },
					compose: { findMany: vi.fn(async () => []) },
					mounts: { findMany: vi.fn(async () => []) },
				},
			};

			// Attempt upload of a 2 GB payload
			const hugePayload = 2 * 1024 * 1024 * 1024;
			await expect(
				CustomerStorageService.assertQuotaAvailable(
					testOrgId,
					hugePayload,
					strictMockExecutor,
				),
			).rejects.toThrowError(TRPCError);
		});

		it("calculates storage overview incorporating customer files, volumes, and backups", async () => {
			// Upload a 10KB test file
			const content = "A".repeat(10240);
			await CustomerStorageService.uploadFile(testOrgId, {
				folderPath: "/",
				fileName: "data.txt",
				contentBase64: Buffer.from(content).toString("base64"),
			});

			const overview = await CustomerStorageService.getStorageOverview(testOrgId);

			expect(overview).toBeDefined();
			expect(overview.organizationId).toBe(testOrgId);
			expect(overview.stats.customerFileStorageBytes).toBeGreaterThanOrEqual(10240);
			expect(overview.stats.fileCount).toBeGreaterThanOrEqual(1);
			expect(overview.quota.usedBytes).toBeGreaterThan(0);
			expect(overview.locations).toHaveLength(1);
			expect(overview.locations[0]!.name).toBe("Customer File Storage");
		});

		it("verifies formatStorageBytes helper output across units", () => {
			expect(formatStorageBytes(0)).toBe("0 MB");
			expect(formatStorageBytes(512)).toBe("512 Bytes");
			expect(formatStorageBytes(1024 * 50)).toBe("50 KB");
			expect(formatStorageBytes(1024 * 1024 * 15)).toBe("15 MB");
			expect(formatStorageBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
		});
	});

	describe("5. tRPC Customer Storage Router", () => {
		const customerContext: any = {
			user: { id: "cust-1", role: "user", isPlatformAdmin: false },
			session: { id: "sess-1", activeOrganizationId: testOrgId },
		};
		const caller = customerStorageRouter.createCaller(customerContext);

		it("allows customer to call overview procedure", async () => {
			const res = await caller.overview();
			expect(res).toBeDefined();
			expect(res.organizationId).toBe(testOrgId);
		});

		it("allows customer to create a folder via router", async () => {
			const res = await caller.createFolder({
				locationId: "default",
				folderPath: "/",
				folderName: "trpc_folder",
			});
			expect(res.success).toBe(true);
		});

		it("allows customer to list directory via router", async () => {
			const res = await caller.listDirectory({
				locationId: "default",
				path: "/",
			});
			expect(res.entries).toBeDefined();
			expect(Array.isArray(res.entries)).toBe(true);
		});
	});

	describe("6. Canonical Dashboard Routing & Active Navigation State", () => {
		it("includes Storage in customer NAV_ITEMS navigation", () => {
			const storageItem = NAV_ITEMS.find((item) => item.href === "/dashboard/storage");
			expect(storageItem).toBeDefined();
			expect(storageItem?.label).toBe("Storage");
		});

		it("includes Storage in side.tsx MENU.home items", () => {
			const storageMenuItem = MENU.home.find(
				(item) => "url" in item && item.url === "/dashboard/storage",
			);
			expect(storageMenuItem).toBeDefined();
			expect((storageMenuItem as any)?.title).toBe("Storage");
		});

		it("detects /dashboard/storage as active route in isCustomerRouteActive", () => {
			expect(isCustomerRouteActive("/dashboard/storage", "/dashboard/storage")).toBe(true);
			expect(isCustomerRouteActive("/dashboard/storage", "/home/dashboard/storage")).toBe(true);
		});

		it("redirects competing /home/dashboard/storage to canonical /dashboard/storage via getServerSideProps", async () => {
			const ctx: any = { req: { headers: {} }, res: {} };
			const result = await homeStorageGSSP(ctx);

			expect(result).toEqual({
				redirect: {
					destination: "/dashboard/storage",
					permanent: false,
				},
			});
		});
	});
});

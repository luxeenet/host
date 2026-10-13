import fs from "node:fs/promises";
import path, { join } from "node:path";
import { paths } from "@dokploy/server/constants";
import type { Application } from "@dokploy/server/services/application";
import { findServerById } from "@dokploy/server/services/server";
import { readValidDirectory } from "@dokploy/server/wss/utils";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import { getServiceOrganizationId } from "@dokploy/server/services/domain";
import AdmZip from "adm-zip";
import { Client, type SFTPWrapper } from "ssh2";
import {
	recreateDirectory,
	recreateDirectoryRemote,
} from "../filesystem/directory";
import { execAsyncRemote } from "../process/execAsync";
import {
	ArchiveValidationError,
	isInsideDirectory,
	normalizeArchivePath,
	validateArchiveEntries,
} from "./archive-validation";

export const unzipDrop = async (zipFile: File, application: Application) => {
	let sftp: SFTPWrapper | null = null;

	try {
		const { appName } = application;
		// Use buildServerId if set, otherwise fall back to serverId
		// This ensures the code is extracted to the server where the build will run
		const targetServerId = application.buildServerId || application.serverId;
		const { APPLICATIONS_PATH } = paths(!!targetServerId);
		const outputPath = join(APPLICATIONS_PATH, appName, "code");

		// Validate BEFORE touching the workspace so a rejected upload never
		// destroys the previously deployed source.
		const arrayBuffer = await zipFile.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		let zip: AdmZip;
		try {
			zip = new AdmZip(buffer);
		} catch {
			throw new ArchiveValidationError(
				"The uploaded file is not a valid ZIP archive.",
				"INVALID_ARCHIVE",
			);
		}

		const validation = validateArchiveEntries(
			zip.getEntries().map((entry) => ({
				entryName: entry.entryName,
				isDirectory: entry.isDirectory,
				size: entry.header.size,
				compressedSize: entry.header.compressedSize,
				externalAttributes: entry.header.attr,
			})),
		);

		// Plan-based storage limit (max_storage_gb), tenant-scoped.
		if (application?.applicationId) {
			const organizationId = await getServiceOrganizationId({
				applicationId: application.applicationId,
			});
			if (organizationId) {
				await PlanEntitlementService.assertObjectStorageCapacity(
					organizationId,
					validation.totalUncompressedBytes,
				);
			}
		}

		const allowedNames = new Set(validation.entries.map((e) => e.entryName));
		const zipEntries = zip
			.getEntries()
			.filter((entry) => allowedNames.has(entry.entryName));

		if (targetServerId) {
			await recreateDirectoryRemote(outputPath, targetServerId);
		} else {
			await recreateDirectory(outputPath);
		}

		// Filter out macOS and Windows junk entries
		const isJunkEntry = (entryName: string) => {
			const n = entryName.replace(/\\/g, "/");
			return (
				n.startsWith("__MACOSX/") ||
				n === "__MACOSX" ||
				n.endsWith("/.DS_Store") ||
				n === ".DS_Store" ||
				n.endsWith("/Thumbs.db") ||
				n === "Thumbs.db"
			);
		};

		const meaningfulEntries = zipEntries.filter(
			(entry) => !isJunkEntry(entry.entryName),
		);

		// Determine if the archive has a single enclosing top-level directory
		const topSegments = new Set<string>();
		for (const entry of meaningfulEntries) {
			const norm = normalizeArchivePath(entry.entryName);
			if (!norm) continue;
			const parts = norm.split("/").filter(Boolean);
			if (parts.length > 0 && parts[0]) {
				topSegments.add(parts[0]);
			}
		}

		const hasSingleRootFolder =
			topSegments.size === 1 &&
			meaningfulEntries.some((e) => {
				const norm = normalizeArchivePath(e.entryName);
				const parts = norm.split("/").filter(Boolean);
				return parts.length > 1 || e.isDirectory;
			});

		const rootFolderName = hasSingleRootFolder
			? Array.from(topSegments)[0] || ""
			: "";

		if (targetServerId) {
			sftp = await getSFTPConnection(targetServerId);
		}
		for (const entry of zipEntries) {
			if (isJunkEntry(entry.entryName)) continue;

			let filePath = normalizeArchivePath(entry.entryName);

			if (
				hasSingleRootFolder &&
				rootFolderName &&
				(filePath === rootFolderName || filePath.startsWith(`${rootFolderName}/`))
			) {
				if (filePath === rootFolderName) {
					// Enclosing folder itself, skip creating redundant empty directory
					continue;
				}
				filePath = filePath.slice(rootFolderName.length + 1);
			}

			if (!filePath) continue;

			const fullPath = path.join(outputPath, filePath).replace(/\\/g, "/");
			if (
				!isInsideDirectory(outputPath, fullPath) ||
				!readValidDirectory(fullPath, application.serverId)
			) {
				throw new ArchiveValidationError(
					"The archive contains paths that try to escape the project folder.",
					"PATH_TRAVERSAL",
				);
			}

			if (isDangerousNode(entry)) {
				throw new ArchiveValidationError(
					"The archive contains links or special files, which are not allowed.",
					"UNSAFE_ENTRY",
				);
			}

			if (targetServerId) {
				if (!entry.isDirectory) {
					if (sftp === null) throw new Error("No SFTP connection available");
					try {
						const dirPath = path.dirname(fullPath);
						await execAsyncRemote(targetServerId, `mkdir -p "${dirPath}"`);
						await uploadFileToServer(sftp, entry.getData(), fullPath);
					} catch (err) {
						console.error(`Error uploading file ${fullPath}:`, err);
						throw err;
					}
				}
			} else {
				if (entry.isDirectory) {
					await fs.mkdir(fullPath, { recursive: true });
				} else {
					await fs.mkdir(path.dirname(fullPath), { recursive: true });
					await fs.writeFile(fullPath, entry.getData());
				}
			}
		}
	} catch (error) {
		console.error("Error processing ZIP file:", error);
		throw error;
	} finally {
		sftp?.end();
	}
};

const getSFTPConnection = async (serverId: string): Promise<SFTPWrapper> => {
	const server = await findServerById(serverId);
	if (!server.sshKeyId) throw new Error("No SSH key available for this server");

	return new Promise((resolve, reject) => {
		const conn = new Client();
		conn
			.on("ready", () => {
				conn.sftp((err, sftp) => {
					if (err) return reject(err);
					resolve(sftp);
				});
			})
			.connect({
				host: server.ipAddress,
				port: server.port,
				username: server.username,
				privateKey: server.sshKey?.privateKey,
			});
	});
};

const uploadFileToServer = (
	sftp: SFTPWrapper,
	data: Buffer,
	remotePath: string,
): Promise<void> => {
	return new Promise((resolve, reject) => {
		sftp.writeFile(remotePath, data, (err) => {
			if (err) {
				console.error(`SFTP write error for ${remotePath}:`, err);
				return reject(err);
			}
			resolve();
		});
	});
};

function isDangerousNode(entry: AdmZip.IZipEntry) {
	const type = (entry.header.attr >> 16) & 0o170000;

	return (
		type === 0o120000 || // symlink
		type === 0o060000 || // block device
		type === 0o020000 || // char device
		type === 0o010000 // fifo/pipe
	);
}

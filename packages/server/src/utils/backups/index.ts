import { CLEANUP_CRON_JOB } from "@dokploy/server/constants";
import { member } from "@dokploy/server/db/schema";
import type { BackupSchedule } from "@dokploy/server/services/backup";
import { BackupStorageService } from "@dokploy/server/services/backup-storage";
import { findDestinationById } from "@dokploy/server/services/destination";
import { getAllServers } from "@dokploy/server/services/server";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { eq } from "drizzle-orm";
import { scheduleJob } from "node-schedule";
import { db } from "../../db/index";
import { startLogCleanup } from "../access-log/handler";
import { cleanupAll } from "../docker/utils";
import { sendDockerCleanupNotifications } from "../notifications/docker-cleanup";
import { execAsync, execAsyncRemote } from "../process/execAsync";
import { redactRcloneCredentials } from "./redact";
import { getS3Credentials, normalizeS3Path, scheduleBackup } from "./utils";

export const initCronJobs = async () => {
	console.log("Setting up cron jobs....");

	const admin = await db.query.member.findFirst({
		where: eq(member.role, "owner"),
		with: {
			user: true,
		},
	});

	if (!admin) {
		return;
	}

	const webServerSettings = await getWebServerSettings();

	if (webServerSettings?.enableDockerCleanup) {
		try {
			scheduleJob("docker-cleanup", CLEANUP_CRON_JOB, async () => {
				console.log(
					`Docker Cleanup ${new Date().toLocaleString()}]  Running docker cleanup`,
				);

				await cleanupAll();

				await sendDockerCleanupNotifications(admin.user.id);
			});
		} catch (error) {
			console.error("[Backup] Docker Cleanup Error", error);
		}
	}

	const servers = await getAllServers();

	for (const server of servers) {
		const { serverId, enableDockerCleanup, name } = server;
		if (enableDockerCleanup) {
			try {
				scheduleJob(serverId, CLEANUP_CRON_JOB, async () => {
					console.log(
						`SERVER-BACKUP[${new Date().toLocaleString()}] Running Cleanup ${name}`,
					);

					await cleanupAll(serverId);

					await sendDockerCleanupNotifications(
						admin.user.id,
						`Docker cleanup for Server ${name} (${serverId})`,
					);
				});
			} catch (error) {
				console.error(`[Backup] ${error}`);
			}
		}
	}

	const backups = await db.query.backups.findMany({
		with: {
			destination: true,
			postgres: true,
			mariadb: true,
			mysql: true,
			mongo: true,
			libsql: true,
			user: true,
			compose: true,
		},
	});

	for (const backup of backups) {
		try {
			if (backup.enabled) {
				scheduleBackup(backup);
				console.log(
					`[Backup] ${backup.databaseType} Enabled with cron: [${backup.schedule}]`,
				);
			}
		} catch (error) {
			console.error(`[Backup] ${backup.databaseType} Error`, error);
		}
	}

	if (webServerSettings?.logCleanupCron) {
		try {
			console.log(
				"Starting log requests cleanup",
				webServerSettings.logCleanupCron,
			);
			await startLogCleanup(webServerSettings.logCleanupCron);
		} catch (error) {
			console.error("[Backup] Log Cleanup Error", error);
		}
	}
};

const getServiceAppName = (backup: BackupSchedule): string => {
	if (backup.compose?.appName) {
		return backup.serviceName
			? `${backup.compose.appName}_${backup.serviceName}`
			: backup.compose.appName;
	}
	const serviceAppName =
		backup.postgres?.appName ||
		backup.mysql?.appName ||
		backup.mariadb?.appName ||
		backup.mongo?.appName ||
		backup.libsql?.appName;
	return serviceAppName || backup.appName;
};

export const keepLatestNBackups = async (
	backup: BackupSchedule,
	serverId?: string | null,
) => {
	if (!backup.keepLatestCount || backup.keepLatestCount <= 0) return;

	try {
		const destination = await findDestinationById(backup.destinationId);
		const rcloneFlags = getS3Credentials(destination);
		const appName = getServiceAppName(backup);
		const prefixPath = normalizeS3Path(backup.prefix);
		const backupFilesPath = `:s3:${destination.bucket}/${appName}/${prefixPath}`;

		const rcloneList = `rclone lsf ${rcloneFlags.join(" ")} --include "*${backup.databaseType === "web-server" ? ".zip" : ".{sql.gz,bson.gz}"}" ${backupFilesPath}`;
		const listOutput = serverId
			? await execAsyncRemote(serverId, rcloneList)
			: await execAsync(rcloneList);

		const files = listOutput.stdout
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean)
			.sort()
			.reverse();

		if (files.length > backup.keepLatestCount) {
			const filesToDelete = files.slice(backup.keepLatestCount);
			for (const file of filesToDelete) {
				const deleteCommand = `rclone deletefile ${rcloneFlags.join(" ")} "${backupFilesPath}${file}"`;
				if (serverId) {
					await execAsyncRemote(serverId, deleteCommand).catch(() => {});
				} else {
					await execAsync(deleteCommand).catch(() => {});
				}
			}

			const objectKeys = filesToDelete.map(
				(file) => `${appName}/${prefixPath}${file}`,
			);
			await BackupStorageService.markBackupsDeleted(
				destination.destinationId,
				objectKeys,
			);
		}
	} catch (error) {
		console.error(redactRcloneCredentials(String(error)));
	}
};

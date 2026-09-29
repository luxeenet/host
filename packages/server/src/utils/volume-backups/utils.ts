import path from "node:path";
import { paths } from "@dokploy/server/constants";
import { BackupStorageService } from "@dokploy/server/services/backup-storage";
import {
	createDeploymentVolumeBackup,
	updateDeploymentStatus,
} from "@dokploy/server/services/deployment";
import { findDestinationById } from "@dokploy/server/services/destination";
import { findVolumeBackupById } from "@dokploy/server/services/volume-backups";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { scheduledJobs, scheduleJob } from "node-schedule";
import { getBackupTimestamp, getS3Credentials, normalizeS3Path } from "../backups/utils";
import { sendVolumeBackupNotifications } from "../notifications/volume-backup";
import {
	createVolumeBackupTarCommand,
	createVolumeBackupUploadCommand,
	getVolumeServiceAppName,
} from "./backup";

// Helper functions to extract project info from volume backup
const getProjectName = (
	volumeBackup: Awaited<ReturnType<typeof findVolumeBackupById>>,
): string => {
	const services = [
		volumeBackup.application,
		volumeBackup.compose,
		volumeBackup.postgres,
		volumeBackup.mysql,
		volumeBackup.mariadb,
		volumeBackup.mongo,
		volumeBackup.redis,
		volumeBackup.libsql,
	];

	for (const service of services) {
		if (service?.environment?.project?.name) {
			return service.environment.project.name;
		}
	}

	return "Unknown Project";
};

const getOrganizationId = (
	volumeBackup: Awaited<ReturnType<typeof findVolumeBackupById>>,
): string => {
	const services = [
		volumeBackup.application,
		volumeBackup.compose,
		volumeBackup.postgres,
		volumeBackup.mysql,
		volumeBackup.mariadb,
		volumeBackup.mongo,
		volumeBackup.redis,
		volumeBackup.libsql,
	];

	for (const service of services) {
		if (service?.environment?.project?.organizationId) {
			return service.environment.project.organizationId;
		}
	}

	return "";
};

export const scheduleVolumeBackup = async (volumeBackupId: string) => {
	const volumeBackup = await findVolumeBackupById(volumeBackupId);
	scheduleJob(volumeBackupId, volumeBackup.cronExpression, async () => {
		await runVolumeBackup(volumeBackupId);
	});
};

export const removeVolumeBackupJob = async (volumeBackupId: string) => {
	const currentJob = scheduledJobs[volumeBackupId];
	currentJob?.cancel();
};

const cleanupOldVolumeBackups = async (
	volumeBackup: Awaited<ReturnType<typeof findVolumeBackupById>>,
	serverId?: string | null,
) => {
	const { keepLatestCount, prefix, volumeName } = volumeBackup;
	const destination = await findDestinationById(volumeBackup.destinationId);

	if (!keepLatestCount || keepLatestCount <= 0) return;

	try {
		const rcloneFlags = getS3Credentials(destination);
		const s3AppName = getVolumeServiceAppName(volumeBackup);
		const prefixPath = normalizeS3Path(prefix || "");
		const backupFilesPath = `:s3:${destination.bucket}/${s3AppName}/${prefixPath}`;
		const listCommand = `rclone lsf ${rcloneFlags.join(" ")} --include \"${volumeName}-*.tar\" ${backupFilesPath}`;

		const listOutput = serverId
			? await execAsyncRemote(serverId, listCommand)
			: await execAsync(listCommand);

		const files = listOutput.stdout
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean)
			.sort()
			.reverse();

		if (files.length > keepLatestCount) {
			const filesToDelete = files.slice(keepLatestCount);
			for (const file of filesToDelete) {
				const deleteCommand = `rclone deletefile ${rcloneFlags.join(" ")} "${backupFilesPath}${file}"`;
				if (serverId) {
					await execAsyncRemote(serverId, deleteCommand).catch(() => {});
				} else {
					await execAsync(deleteCommand).catch(() => {});
				}
			}

			const objectKeys = filesToDelete.map(
				(file) => `${s3AppName}/${prefixPath}${file}`,
			);
			await BackupStorageService.markBackupsDeleted(
				destination.destinationId,
				objectKeys,
			);
		}
	} catch (error) {
		console.error("Volume backup retention error", error);
	}
};

export const runVolumeBackup = async (volumeBackupId: string) => {
	const volumeBackup = await findVolumeBackupById(volumeBackupId);
	const serverId =
		volumeBackup.application?.serverId || volumeBackup.compose?.serverId;
	const destination = await findDestinationById(volumeBackup.destinationId);
	const deployment = await createDeploymentVolumeBackup({
		volumeBackupId: volumeBackup.volumeBackupId,
		title: "Volume Backup",
		description: "Volume Backup",
	});
	const projectName = getProjectName(volumeBackup);
	const organizationId = getOrganizationId(volumeBackup) || destination.organizationId;
	const { VOLUME_BACKUPS_PATH } = paths(!!serverId);
	const s3AppName = getVolumeServiceAppName(volumeBackup);
	const backupFileName = `${volumeBackup.volumeName}-${getBackupTimestamp()}.tar`;
	const bucketDestination = `${s3AppName}/${normalizeS3Path(volumeBackup.prefix || "")}${backupFileName}`;
	const rcloneFlags = getS3Credentials(destination);
	const rcloneDestination = `:s3:${destination.bucket}/${bucketDestination}`;
	const volumeBackupPath = path.join(VOLUME_BACKUPS_PATH, volumeBackup.appName);

	let quotaReservationId: string | null = null;

	try {
		// 1. Create local tar and restart service
		const tarCommand = await createVolumeBackupTarCommand(
			volumeBackup,
			backupFileName,
		);
		const tarCommandWithLog = `(${tarCommand}) >> ${deployment.logPath} 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, tarCommandWithLog);
		} else {
			await execAsync(tarCommandWithLog);
		}

		// 2. Stat local backup file size
		const statCommand = `stat -c%s "${volumeBackupPath}/${backupFileName}" 2>/dev/null || stat -f%z "${volumeBackupPath}/${backupFileName}" 2>/dev/null || wc -c < "${volumeBackupPath}/${backupFileName}"`;
		let statOutput: string;
		if (serverId) {
			const res = await execAsyncRemote(serverId, statCommand);
			statOutput = res.stdout;
		} else {
			const res = await execAsync(statCommand);
			statOutput = res.stdout;
		}

		const sizeBytes = parseInt(statOutput.trim(), 10) || 0;

		// 3. Reserve quota atomically
		if (sizeBytes > 0) {
			const reservation = await BackupStorageService.reserveBackupStorage({
				organizationId,
				destinationId: destination.destinationId,
				backupId: volumeBackup.volumeBackupId,
				objectKey: bucketDestination,
				bytes: sizeBytes,
			});
			quotaReservationId = reservation.id;
		}

		// 4. Upload to S3
		const uploadCommand = createVolumeBackupUploadCommand({
			rcloneFlags,
			volumeBackupPath,
			backupFileName,
			rcloneDestination,
		});
		const uploadCommandWithLog = `(${uploadCommand}) >> ${deployment.logPath} 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, uploadCommandWithLog);
		} else {
			await execAsync(uploadCommandWithLog);
		}

		// 5. Commit reservation
		if (quotaReservationId) {
			await BackupStorageService.commitBackupStorage(
				quotaReservationId,
				sizeBytes,
			);
		}

		if (volumeBackup.keepLatestCount && volumeBackup.keepLatestCount > 0) {
			await cleanupOldVolumeBackups(volumeBackup, serverId);
		}

		await updateDeploymentStatus(deployment.deploymentId, "done");

		// Map service type to match notification function expectations
		const mappedServiceType =
			volumeBackup.serviceType === "mongo"
				? "mongodb"
				: volumeBackup.serviceType;

		try {
			await sendVolumeBackupNotifications({
				projectName,
				applicationName: volumeBackup.name,
				volumeName: volumeBackup.volumeName,
				serviceType: mappedServiceType,
				type: "success",
				organizationId,
			});
		} catch (notificationError) {
			console.error(
				"Failed to send volume backup success notification",
				notificationError,
			);
		}
	} catch (error) {
		if (quotaReservationId) {
			await BackupStorageService.releaseBackupStorage(quotaReservationId).catch(
				() => {},
			);
		}

		// delete all the .tar files for this backup
		const command = `rm -rf "${volumeBackupPath}/${backupFileName}"`;
		if (serverId) {
			await execAsyncRemote(serverId, command).catch(() => {});
		} else {
			await execAsync(command).catch(() => {});
		}
		await updateDeploymentStatus(deployment.deploymentId, "error");

		// Send error notification
		const mappedServiceType =
			volumeBackup.serviceType === "mongo"
				? "mongodb"
				: volumeBackup.serviceType;

		try {
			await sendVolumeBackupNotifications({
				projectName,
				applicationName: volumeBackup.name,
				volumeName: volumeBackup.volumeName,
				serviceType: mappedServiceType,
				type: "error",
				organizationId,
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		} catch (notificationError) {
			console.error(
				"Failed to send volume backup error notification",
				notificationError,
			);
		}
		throw error;
	}
};

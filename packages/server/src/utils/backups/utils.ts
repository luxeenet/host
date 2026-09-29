import { logger } from "@dokploy/server/lib/logger";
import type { BackupSchedule } from "@dokploy/server/services/backup";
import { BackupStorageService } from "@dokploy/server/services/backup-storage";
import type { Destination } from "@dokploy/server/services/destination";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import { execAsync, execAsyncRemote } from "@dokploy/server/utils/process/execAsync";
import { scheduledJobs, scheduleJob } from "node-schedule";
import { quote } from "shell-quote";
import { keepLatestNBackups } from "./index";
import { runComposeBackup } from "./compose";
import { runLibsqlBackup } from "./libsql";
import { runMariadbBackup } from "./mariadb";
import { runMongoBackup } from "./mongo";
import { runMySqlBackup } from "./mysql";
import { runPostgresBackup } from "./postgres";
import { redactRcloneCredentials } from "./redact";
import { runWebServerBackup } from "./web-server";

export const scheduleBackup = (backup: BackupSchedule) => {
	const {
		schedule,
		backupId,
		databaseType,
		postgres,
		mysql,
		mongo,
		mariadb,
		libsql,
		compose,
	} = backup;
	scheduleJob(backupId, schedule, async () => {
		if (backup.backupType === "database") {
			if (databaseType === "postgres" && postgres) {
				await runPostgresBackup(postgres, backup);
				await keepLatestNBackups(backup, postgres.serverId);
			} else if (databaseType === "mysql" && mysql) {
				await runMySqlBackup(mysql, backup);
				await keepLatestNBackups(backup, mysql.serverId);
			} else if (databaseType === "mongo" && mongo) {
				await runMongoBackup(mongo, backup);
				await keepLatestNBackups(backup, mongo.serverId);
			} else if (databaseType === "mariadb" && mariadb) {
				await runMariadbBackup(mariadb, backup);
				await keepLatestNBackups(backup, mariadb.serverId);
			} else if (databaseType === "libsql" && libsql) {
				await runLibsqlBackup(libsql, backup);
				await keepLatestNBackups(backup, libsql.serverId);
			} else if (databaseType === "web-server") {
				await runWebServerBackup(backup);
				await keepLatestNBackups(backup);
			}
		} else if (backup.backupType === "compose" && compose) {
			await runComposeBackup(compose, backup);
			await keepLatestNBackups(backup, compose.serverId);
		}
	});
};

export const removeScheduleBackup = (backupId?: string | null) => {
	if (!backupId) return;
	const currentJob = scheduledJobs[backupId];
	currentJob?.cancel();
};

export const getBackupTimestamp = () =>
	new Date().toISOString().replace(/[:.]/g, "-");

export const normalizeS3Path = (prefix?: string | null) => {
	if (!prefix) return "";
	// Trim whitespace and remove leading/trailing slashes
	const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
	// Return empty string if prefix is empty, otherwise append trailing slash
	return normalizedPrefix ? `${normalizedPrefix}/` : "";
};

export const getS3Credentials = (destination: Destination) => {
	const { accessKey, secretAccessKey, region, endpoint, provider } =
		destination;
	const rcloneFlags = [
		`--s3-access-key-id=${quote([accessKey || ""])}`,
		`--s3-secret-access-key=${quote([secretAccessKey || ""])}`,
		`--s3-region=${quote([region || ""])}`,
		`--s3-endpoint=${quote([endpoint || ""])}`,
		"--s3-no-check-bucket",
		"--s3-force-path-style",
	];

	if (provider) {
		rcloneFlags.unshift(`--s3-provider=${quote([provider])}`);
	}

	if (destination.additionalFlags?.length) {
		rcloneFlags.push(...destination.additionalFlags);
	}

	return rcloneFlags;
};

// User-controlled values (database name, user, password) are passed to the
// container as environment variables via `docker exec -e VAR=<escaped>` and
// referenced as "$VAR" inside the inner shell, so they never appear in the
// inner command text. The -e value is escaped for the outer shell with
// shell-quote; the inner script is single-quoted and reads the env vars.
export const getPostgresBackupCommand = (
	database?: string | null,
	databaseUser?: string | null,
) => {
	return `docker exec -e DB_NAME=${quote([database || ""])} -e DB_USER=${quote([databaseUser || ""])} -i $CONTAINER_ID bash -c 'set -o pipefail; pg_dump -Fc --no-acl --no-owner -h localhost -U "$DB_USER" --no-password "$DB_NAME" | gzip'`;
};

export const getMariadbBackupCommand = (
	database?: string | null,
	databaseUser?: string | null,
	databasePassword?: string | null,
) => {
	return `docker exec -e DB_NAME=${quote([database || ""])} -e DB_USER=${quote([databaseUser || ""])} -e DB_PASS=${quote([databasePassword || ""])} -i $CONTAINER_ID bash -c 'set -o pipefail; mariadb-dump --user="$DB_USER" --password="$DB_PASS" --single-transaction --quick --databases "$DB_NAME" | gzip'`;
};

export const getMysqlBackupCommand = (
	database?: string | null,
	databasePassword?: string | null,
) => {
	return `docker exec -e DB_NAME=${quote([database || ""])} -e DB_PASS=${quote([databasePassword || ""])} -i $CONTAINER_ID bash -c 'set -o pipefail; mysqldump --default-character-set=utf8mb4 -u root --password="$DB_PASS" --single-transaction --no-tablespaces --quick "$DB_NAME" | gzip'`;
};

export const getMongoBackupCommand = (
	database?: string | null,
	databaseUser?: string | null,
	databasePassword?: string | null,
) => {
	return `docker exec -e DB_NAME=${quote([database || ""])} -e DB_USER=${quote([databaseUser || ""])} -e DB_PASS=${quote([databasePassword || ""])} -i $CONTAINER_ID bash -c 'set -o pipefail; mongodump -d "$DB_NAME" -u "$DB_USER" -p "$DB_PASS" --archive --authenticationDatabase admin --gzip'`;
};

export const getLibsqlBackupCommand = (database?: string | null) => {
	return `docker exec -e DB_NAME=${quote([database || ""])} -i $CONTAINER_ID sh -c 'tar cf - -C /var/lib/sqld "$DB_NAME" | gzip'`;
};

export const getServiceContainerCommand = (appName?: string | null) => {
	return `docker ps -q --filter "status=running" --filter "label=com.docker.swarm.service.name=${appName || ""}" | head -n 1`;
};

export const getComposeContainerCommand = (
	appName?: string | null,
	serviceName?: string | null,
	composeType?: "stack" | "docker-compose" | null,
) => {
	if (composeType === "stack") {
		return `docker ps -q --filter "status=running" --filter "label=com.docker.stack.namespace=${appName || ""}" --filter "label=com.docker.swarm.service.name=${appName || ""}_${serviceName || ""}" | head -n 1`;
	}
	return `docker ps -q --filter "status=running" --filter "label=com.docker.compose.project=${appName || ""}" --filter "label=com.docker.compose.service=${serviceName || ""}" | head -n 1`;
};

const getContainerSearchCommand = (backup: BackupSchedule) => {
	const {
		backupType,
		postgres,
		mysql,
		mariadb,
		mongo,
		libsql,
		compose,
		serviceName,
	} = backup;

	if (backupType === "database") {
		const appName =
			postgres?.appName ||
			mysql?.appName ||
			mariadb?.appName ||
			mongo?.appName ||
			libsql?.appName;
		return getServiceContainerCommand(appName || "");
	}
	if (backupType === "compose") {
		const { appName, composeType } = compose || {};
		return getComposeContainerCommand(
			appName || "",
			serviceName || "",
			composeType,
		);
	}
};

export const generateBackupCommand = (backup: BackupSchedule) => {
	const { backupType, databaseType } = backup;
	switch (databaseType) {
		case "postgres": {
			const postgres = backup.postgres;
			if (backupType === "database" && postgres) {
				return getPostgresBackupCommand(
					backup.database,
					postgres.databaseUser,
				);
			}
			if (backupType === "compose" && backup.metadata?.postgres) {
				return getPostgresBackupCommand(
					backup.database,
					backup.metadata.postgres.databaseUser,
				);
			}
			break;
		}
		case "mysql": {
			const mysql = backup.mysql;
			if (backupType === "database" && mysql) {
				return getMysqlBackupCommand(
					backup.database,
					mysql.databaseRootPassword,
				);
			}
			if (backupType === "compose" && backup.metadata?.mysql) {
				return getMysqlBackupCommand(
					backup.database,
					backup.metadata.mysql.databaseRootPassword || "",
				);
			}
			break;
		}
		case "mariadb": {
			const mariadb = backup.mariadb;
			if (backupType === "database" && mariadb) {
				return getMariadbBackupCommand(
					backup.database,
					mariadb.databaseUser,
					mariadb.databasePassword,
				);
			}
			if (backupType === "compose" && backup.metadata?.mariadb) {
				return getMariadbBackupCommand(
					backup.database,
					backup.metadata.mariadb.databaseUser,
					backup.metadata.mariadb.databasePassword,
				);
			}
			break;
		}
		case "mongo": {
			const mongo = backup.mongo;
			if (backupType === "database" && mongo) {
				return getMongoBackupCommand(
					backup.database,
					mongo.databaseUser,
					mongo.databasePassword,
				);
			}
			if (backupType === "compose" && backup.metadata?.mongo) {
				return getMongoBackupCommand(
					backup.database,
					backup.metadata.mongo.databaseUser,
					backup.metadata.mongo.databasePassword,
				);
			}
			break;
		}
		case "libsql": {
			if (backupType === "database") {
				return getLibsqlBackupCommand(backup.database);
			}
			break;
		}
		default:
			throw new Error(`Database type not supported: ${databaseType}`);
	}

	return null;
};

export const getBackupCommand = (
	backup: BackupSchedule,
	rcloneFlags: string[],
	rcloneDestination: string,
	logPath: string,
) => {
	const containerSearch = getContainerSearchCommand(backup);
	const backupCommand = generateBackupCommand(backup);
	const rcloneCommand = `rclone rcat ${rcloneFlags.join(" ")} "${rcloneDestination}"`;
	const rcloneDeleteCommand = `rclone deletefile ${rcloneFlags.join(" ")} "${rcloneDestination}"`;

	logger.info(
		{
			containerSearch,
			backupCommand,
			rcloneCommand: redactRcloneCredentials(rcloneCommand),
			logPath,
		},
		`Executing backup command: ${backup.databaseType} ${backup.backupType}`,
	);

	return `
	set -eo pipefail;
	echo "[$(date)] Starting backup process..." >> ${logPath};
	echo "[$(date)] Executing backup command..." >> ${logPath};
	CONTAINER_ID=$(${containerSearch});

	if [ -z "$CONTAINER_ID" ]; then
		echo "[$(date)] ❌ Error: Container not found" >> ${logPath};
		exit 1;
	fi;

	echo "[$(date)] Container Up: $CONTAINER_ID" >> ${logPath};
	echo "[$(date)] Starting backup and upload to S3..." >> ${logPath};

	UPLOAD_OUTPUT=$({ ${backupCommand} | ${rcloneCommand}; } 2>&1 >/dev/null) || {
		echo "[$(date)] ❌ Error: Backup failed" >> ${logPath};
		echo "Error: $UPLOAD_OUTPUT" >> ${logPath};
		${rcloneDeleteCommand} >/dev/null 2>&1 || true;
		exit 1;
	};

	echo "[$(date)] ✅ Backup uploaded to S3 successfully" >> ${logPath};
	echo "Backup done ✅" >> ${logPath};
	`;
};

export interface ExecuteDatabaseBackupOptions {
	backup: BackupSchedule;
	organizationId: string;
	destination: Destination;
	bucketDestination: string;
	logPath: string;
	serverId?: string | null;
}

export const executeDatabaseBackup = async ({
	backup,
	organizationId,
	destination,
	bucketDestination,
	logPath,
	serverId,
}: ExecuteDatabaseBackupOptions) => {
	const rcloneFlags = getS3Credentials(destination);
	const rcloneDestination = `:s3:${destination.bucket}/${bucketDestination}`;
	const containerSearch = getContainerSearchCommand(backup);
	const backupCommand = generateBackupCommand(backup);

	// 1. Verify plan entitlement limit
	const snapshot = await PlanEntitlementService.getPlanSnapshot(organizationId);
	const limitGb = snapshot?.resources["backup_storage_gb"] ?? -1;
	const isUnlimited = limitGb === -1;

	if (isUnlimited) {
		// For unlimited plan (-1), stream directly via rcat
		const streamCmd = getBackupCommand(
			backup,
			rcloneFlags,
			rcloneDestination,
			logPath,
		);
		if (serverId) {
			await execAsyncRemote(serverId, streamCmd);
		} else {
			await execAsync(streamCmd, { shell: "/bin/bash" });
		}
		return;
	}

	// For finite quota: dump to local temp file, stat exact size, reserve quota under atomic lock, copy to S3, commit reservation
	const prepScript = `
	set -eo pipefail;
	echo "[$(date)] Starting backup process..." >> ${logPath};
	CONTAINER_ID=$(${containerSearch});
	if [ -z "$CONTAINER_ID" ]; then
		echo "[$(date)] ❌ Error: Container not found" >> ${logPath};
		exit 1;
	fi;
	echo "[$(date)] Container Up: $CONTAINER_ID" >> ${logPath};
	echo "[$(date)] Creating local database dump..." >> ${logPath};
	TEMP_DIR=$(mktemp -d /tmp/dokploy-db-backup-XXXXXX);
	BACKUP_FILE="$TEMP_DIR/backup.dump";
	({ ${backupCommand} > "$BACKUP_FILE"; } 2>&1) >> ${logPath} || {
		echo "[$(date)] ❌ Error: Database dump failed" >> ${logPath};
		rm -rf "$TEMP_DIR";
		exit 1;
	};
	SIZE_BYTES=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || wc -c < "$BACKUP_FILE");
	echo "DOKPLOY_BACKUP_SIZE:$SIZE_BYTES";
	echo "DOKPLOY_TEMP_DIR:$TEMP_DIR";
	`;

	logger.info(
		{
			containerSearch,
			backupCommand,
			logPath,
			organizationId,
		},
		`Executing finite-quota backup dump: ${backup.databaseType} ${backup.backupType}`,
	);

	let prepOutput: string;
	if (serverId) {
		const res = await execAsyncRemote(serverId, prepScript);
		prepOutput = res.stdout;
	} else {
		const res = await execAsync(prepScript, { shell: "/bin/bash" });
		prepOutput = res.stdout;
	}

	const sizeMatch = prepOutput.match(/DOKPLOY_BACKUP_SIZE:(\d+)/);
	const dirMatch = prepOutput.match(/DOKPLOY_TEMP_DIR:(\S+)/);

	const rawSize = sizeMatch?.[1];
	const rawDir = dirMatch?.[1];

	if (!rawSize || !rawDir) {
		throw new Error(
			"Failed to determine backup file size or temporary directory",
		);
	}

	const sizeBytes = parseInt(rawSize, 10);
	const tempDir: string = rawDir;
	let reservationId: string | null = null;

	try {
		// Atomic quota reservation
		const reservation = await BackupStorageService.reserveBackupStorage({
			organizationId,
			destinationId: destination.destinationId,
			backupId: backup.backupId,
			objectKey: bucketDestination,
			bytes: sizeBytes,
		});
		reservationId = reservation.id;

		// Upload using rclone copyto
		const uploadScript = `
		set -eo pipefail;
		echo "[$(date)] Uploading backup to S3 ($(${sizeBytes} bytes))..." >> ${logPath};
		UPLOAD_OUTPUT=$({ rclone copyto ${rcloneFlags.join(" ")} "${tempDir}/backup.dump" "${rcloneDestination}"; } 2>&1) || {
			echo "[$(date)] ❌ Error: Upload to S3 failed" >> ${logPath};
			echo "Error: $UPLOAD_OUTPUT" >> ${logPath};
			rm -rf "${tempDir}";
			rclone deletefile ${rcloneFlags.join(" ")} "${rcloneDestination}" >/dev/null 2>&1 || true;
			exit 1;
		};
		rm -rf "${tempDir}";
		echo "[$(date)] ✅ Backup uploaded to S3 successfully" >> ${logPath};
		echo "Backup done ✅" >> ${logPath};
		`;

		if (serverId) {
			await execAsyncRemote(serverId, uploadScript);
		} else {
			await execAsync(uploadScript, { shell: "/bin/bash" });
		}

		// Commit reservation
		await BackupStorageService.commitBackupStorage(reservationId, sizeBytes);
	} catch (error) {
		// Clean up remote temp directory if it exists
		if (tempDir) {
			const cleanupCmd = `rm -rf ${quote([tempDir])}`;
			if (serverId) {
				await execAsyncRemote(serverId, cleanupCmd).catch(() => {});
			} else {
				await execAsync(cleanupCmd).catch(() => {});
			}
		}

		if (reservationId) {
			await BackupStorageService.releaseBackupStorage(reservationId).catch(() => {});
		}

		throw error;
	}
};

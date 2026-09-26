import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { volumeBackups, } from "../db/schema";
export const findVolumeBackupById = async (volumeBackupId) => {
    const volumeBackup = await db.query.volumeBackups.findFirst({
        where: eq(volumeBackups.volumeBackupId, volumeBackupId),
        with: {
            application: {
                columns: {
                    applicationId: true,
                    appName: true,
                    serverId: true,
                },
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            postgres: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            mysql: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            mariadb: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            mongo: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            redis: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            compose: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            libsql: {
                with: {
                    environment: {
                        with: {
                            project: true,
                        },
                    },
                },
            },
            destination: {
                columns: {
                    accessKey: false,
                    secretAccessKey: false,
                },
            },
        },
    });
    if (!volumeBackup) {
        throw new TRPCError({
            code: "NOT_FOUND",
            message: "Volume backup not found",
        });
    }
    return volumeBackup;
};
export const createVolumeBackup = async (volumeBackup) => {
    const newVolumeBackup = await db
        .insert(volumeBackups)
        .values(volumeBackup)
        .returning()
        .then((e) => e[0]);
    return newVolumeBackup;
};
export const removeVolumeBackup = async (volumeBackupId) => {
    await db
        .delete(volumeBackups)
        .where(eq(volumeBackups.volumeBackupId, volumeBackupId));
};
export const updateVolumeBackup = async (volumeBackupId, volumeBackup) => {
    return await db
        .update(volumeBackups)
        .set(volumeBackup)
        .where(eq(volumeBackups.volumeBackupId, volumeBackupId))
        .returning()
        .then((e) => e[0]);
};

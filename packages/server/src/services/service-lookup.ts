import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

export type ServiceKind =
	| "application"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql"
	| "compose";

export interface ServiceLookupResult {
	serviceType: ServiceKind;
	serviceId: string;
	organizationId: string;
	projectId: string;
	environmentId: string;
	name: string;
	appName: string;
	serverId?: string | null;
	memoryLimit: string | null;
	memoryReservation: string | null;
	cpuLimit: string | null;
	cpuReservation: string | null;
}

/**
 * Fast lookup of any managed service by its Docker appName.
 * Resolves service identity, configuration, environment, project, and organization ownership.
 */
export async function findServiceByAppName(
	appName: string,
	executor: any = db,
): Promise<ServiceLookupResult | null> {
	if (!appName || appName === "dokploy") {
		return null;
	}

	// 1. Applications
	const app = await executor.query.applications?.findFirst({
		where: eq(schema.applications.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (app) {
		return {
			serviceType: "application",
			serviceId: app.applicationId,
			organizationId: app.environment?.project?.organizationId ?? "",
			projectId: app.environment?.project?.projectId ?? "",
			environmentId: app.environmentId,
			name: app.name,
			appName: app.appName,
			serverId: app.serverId,
			memoryLimit: app.memoryLimit ?? null,
			memoryReservation: app.memoryReservation ?? null,
			cpuLimit: app.cpuLimit ?? null,
			cpuReservation: app.cpuReservation ?? null,
		};
	}

	// 2. Postgres
	const pg = await executor.query.postgres?.findFirst({
		where: eq(schema.postgres.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (pg) {
		return {
			serviceType: "postgres",
			serviceId: pg.postgresId,
			organizationId: pg.environment?.project?.organizationId ?? "",
			projectId: pg.environment?.project?.projectId ?? "",
			environmentId: pg.environmentId,
			name: pg.name,
			appName: pg.appName,
			serverId: pg.serverId,
			memoryLimit: pg.memoryLimit ?? null,
			memoryReservation: pg.memoryReservation ?? null,
			cpuLimit: pg.cpuLimit ?? null,
			cpuReservation: pg.cpuReservation ?? null,
		};
	}

	// 3. MySQL
	const mysql = await executor.query.mysql?.findFirst({
		where: eq(schema.mysql.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mysql) {
		return {
			serviceType: "mysql",
			serviceId: mysql.mysqlId,
			organizationId: mysql.environment?.project?.organizationId ?? "",
			projectId: mysql.environment?.project?.projectId ?? "",
			environmentId: mysql.environmentId,
			name: mysql.name,
			appName: mysql.appName,
			serverId: mysql.serverId,
			memoryLimit: mysql.memoryLimit ?? null,
			memoryReservation: mysql.memoryReservation ?? null,
			cpuLimit: mysql.cpuLimit ?? null,
			cpuReservation: mysql.cpuReservation ?? null,
		};
	}

	// 4. MariaDB
	const mariadb = await executor.query.mariadb?.findFirst({
		where: eq(schema.mariadb.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mariadb) {
		return {
			serviceType: "mariadb",
			serviceId: mariadb.mariadbId,
			organizationId: mariadb.environment?.project?.organizationId ?? "",
			projectId: mariadb.environment?.project?.projectId ?? "",
			environmentId: mariadb.environmentId,
			name: mariadb.name,
			appName: mariadb.appName,
			serverId: mariadb.serverId,
			memoryLimit: mariadb.memoryLimit ?? null,
			memoryReservation: mariadb.memoryReservation ?? null,
			cpuLimit: mariadb.cpuLimit ?? null,
			cpuReservation: mariadb.cpuReservation ?? null,
		};
	}

	// 5. MongoDB
	const mongo = await executor.query.mongo?.findFirst({
		where: eq(schema.mongo.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mongo) {
		return {
			serviceType: "mongo",
			serviceId: mongo.mongoId,
			organizationId: mongo.environment?.project?.organizationId ?? "",
			projectId: mongo.environment?.project?.projectId ?? "",
			environmentId: mongo.environmentId,
			name: mongo.name,
			appName: mongo.appName,
			serverId: mongo.serverId,
			memoryLimit: mongo.memoryLimit ?? null,
			memoryReservation: mongo.memoryReservation ?? null,
			cpuLimit: mongo.cpuLimit ?? null,
			cpuReservation: mongo.cpuReservation ?? null,
		};
	}

	// 6. Redis
	const redis = await executor.query.redis?.findFirst({
		where: eq(schema.redis.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (redis) {
		return {
			serviceType: "redis",
			serviceId: redis.redisId,
			organizationId: redis.environment?.project?.organizationId ?? "",
			projectId: redis.environment?.project?.projectId ?? "",
			environmentId: redis.environmentId,
			name: redis.name,
			appName: redis.appName,
			serverId: redis.serverId,
			memoryLimit: redis.memoryLimit ?? null,
			memoryReservation: redis.memoryReservation ?? null,
			cpuLimit: redis.cpuLimit ?? null,
			cpuReservation: redis.cpuReservation ?? null,
		};
	}

	// 7. LibSQL
	const libsql = await executor.query.libsql?.findFirst({
		where: eq(schema.libsql.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (libsql) {
		return {
			serviceType: "libsql",
			serviceId: libsql.libsqlId,
			organizationId: libsql.environment?.project?.organizationId ?? "",
			projectId: libsql.environment?.project?.projectId ?? "",
			environmentId: libsql.environmentId,
			name: libsql.name,
			appName: libsql.appName,
			serverId: libsql.serverId,
			memoryLimit: libsql.memoryLimit ?? null,
			memoryReservation: libsql.memoryReservation ?? null,
			cpuLimit: libsql.cpuLimit ?? null,
			cpuReservation: libsql.cpuReservation ?? null,
		};
	}

	// 8. Compose
	const compose = await executor.query.compose?.findFirst({
		where: eq(schema.compose.appName, appName),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (compose) {
		return {
			serviceType: "compose",
			serviceId: compose.composeId,
			organizationId: compose.environment?.project?.organizationId ?? "",
			projectId: compose.environment?.project?.projectId ?? "",
			environmentId: compose.environmentId,
			name: compose.name,
			appName: compose.appName,
			serverId: compose.serverId,
			memoryLimit: null,
			memoryReservation: null,
			cpuLimit: null,
			cpuReservation: null,
		};
	}

	return null;
}

/**
 * Fast lookup of any service by its primary service ID.
 */
export async function findServiceById(
	serviceId: string,
	executor: any = db,
): Promise<ServiceLookupResult | null> {
	if (!serviceId) {
		return null;
	}

	// 1. Applications
	const app = await executor.query.applications?.findFirst({
		where: eq(schema.applications.applicationId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (app) {
		return {
			serviceType: "application",
			serviceId: app.applicationId,
			organizationId: app.environment?.project?.organizationId ?? "",
			projectId: app.environment?.project?.projectId ?? "",
			environmentId: app.environmentId,
			name: app.name,
			appName: app.appName,
			serverId: app.serverId,
			memoryLimit: app.memoryLimit ?? null,
			memoryReservation: app.memoryReservation ?? null,
			cpuLimit: app.cpuLimit ?? null,
			cpuReservation: app.cpuReservation ?? null,
		};
	}

	// 2. Postgres
	const pg = await executor.query.postgres?.findFirst({
		where: eq(schema.postgres.postgresId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (pg) {
		return {
			serviceType: "postgres",
			serviceId: pg.postgresId,
			organizationId: pg.environment?.project?.organizationId ?? "",
			projectId: pg.environment?.project?.projectId ?? "",
			environmentId: pg.environmentId,
			name: pg.name,
			appName: pg.appName,
			serverId: pg.serverId,
			memoryLimit: pg.memoryLimit ?? null,
			memoryReservation: pg.memoryReservation ?? null,
			cpuLimit: pg.cpuLimit ?? null,
			cpuReservation: pg.cpuReservation ?? null,
		};
	}

	// 3. MySQL
	const mysql = await executor.query.mysql?.findFirst({
		where: eq(schema.mysql.mysqlId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mysql) {
		return {
			serviceType: "mysql",
			serviceId: mysql.mysqlId,
			organizationId: mysql.environment?.project?.organizationId ?? "",
			projectId: mysql.environment?.project?.projectId ?? "",
			environmentId: mysql.environmentId,
			name: mysql.name,
			appName: mysql.appName,
			serverId: mysql.serverId,
			memoryLimit: mysql.memoryLimit ?? null,
			memoryReservation: mysql.memoryReservation ?? null,
			cpuLimit: mysql.cpuLimit ?? null,
			cpuReservation: mysql.cpuReservation ?? null,
		};
	}

	// 4. MariaDB
	const mariadb = await executor.query.mariadb?.findFirst({
		where: eq(schema.mariadb.mariadbId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mariadb) {
		return {
			serviceType: "mariadb",
			serviceId: mariadb.mariadbId,
			organizationId: mariadb.environment?.project?.organizationId ?? "",
			projectId: mariadb.environment?.project?.projectId ?? "",
			environmentId: mariadb.environmentId,
			name: mariadb.name,
			appName: mariadb.appName,
			serverId: mariadb.serverId,
			memoryLimit: mariadb.memoryLimit ?? null,
			memoryReservation: mariadb.memoryReservation ?? null,
			cpuLimit: mariadb.cpuLimit ?? null,
			cpuReservation: mariadb.cpuReservation ?? null,
		};
	}

	// 5. MongoDB
	const mongo = await executor.query.mongo?.findFirst({
		where: eq(schema.mongo.mongoId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (mongo) {
		return {
			serviceType: "mongo",
			serviceId: mongo.mongoId,
			organizationId: mongo.environment?.project?.organizationId ?? "",
			projectId: mongo.environment?.project?.projectId ?? "",
			environmentId: mongo.environmentId,
			name: mongo.name,
			appName: mongo.appName,
			serverId: mongo.serverId,
			memoryLimit: mongo.memoryLimit ?? null,
			memoryReservation: mongo.memoryReservation ?? null,
			cpuLimit: mongo.cpuLimit ?? null,
			cpuReservation: mongo.cpuReservation ?? null,
		};
	}

	// 6. Redis
	const redis = await executor.query.redis?.findFirst({
		where: eq(schema.redis.redisId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (redis) {
		return {
			serviceType: "redis",
			serviceId: redis.redisId,
			organizationId: redis.environment?.project?.organizationId ?? "",
			projectId: redis.environment?.project?.projectId ?? "",
			environmentId: redis.environmentId,
			name: redis.name,
			appName: redis.appName,
			serverId: redis.serverId,
			memoryLimit: redis.memoryLimit ?? null,
			memoryReservation: redis.memoryReservation ?? null,
			cpuLimit: redis.cpuLimit ?? null,
			cpuReservation: redis.cpuReservation ?? null,
		};
	}

	// 7. LibSQL
	const libsql = await executor.query.libsql?.findFirst({
		where: eq(schema.libsql.libsqlId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (libsql) {
		return {
			serviceType: "libsql",
			serviceId: libsql.libsqlId,
			organizationId: libsql.environment?.project?.organizationId ?? "",
			projectId: libsql.environment?.project?.projectId ?? "",
			environmentId: libsql.environmentId,
			name: libsql.name,
			appName: libsql.appName,
			serverId: libsql.serverId,
			memoryLimit: libsql.memoryLimit ?? null,
			memoryReservation: libsql.memoryReservation ?? null,
			cpuLimit: libsql.cpuLimit ?? null,
			cpuReservation: libsql.cpuReservation ?? null,
		};
	}

	// 8. Compose
	const compose = await executor.query.compose?.findFirst({
		where: eq(schema.compose.composeId, serviceId),
		with: {
			environment: {
				with: {
					project: true,
				},
			},
		},
	});
	if (compose) {
		return {
			serviceType: "compose",
			serviceId: compose.composeId,
			organizationId: compose.environment?.project?.organizationId ?? "",
			projectId: compose.environment?.project?.projectId ?? "",
			environmentId: compose.environmentId,
			name: compose.name,
			appName: compose.appName,
			serverId: compose.serverId,
			memoryLimit: null,
			memoryReservation: null,
			cpuLimit: null,
			cpuReservation: null,
		};
	}

	return null;
}

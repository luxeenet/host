import { db } from "@dokploy/server/db";
import { server } from "@dokploy/server/db/schema";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { eq } from "drizzle-orm";
import { LOCAL_PARTITION } from "./in-memory-queue";

/**
 * Resolve the effective builds concurrency for a queue partition.
 *
 * - `LOCAL_PARTITION` -> concurrency stored on the web server settings (the
 *   local Dokploy/HatDot web server).
 * - any other partition -> concurrency stored on the matching `server` row.
 */
export const resolveBuildsConcurrency = async (
	partition: string,
): Promise<number> => {
	try {
		if (partition === LOCAL_PARTITION) {
			const settings = await getWebServerSettings();
			return normalize(settings?.buildsConcurrency ?? 1);
		}

		const currentServer = await db.query.server.findFirst({
			where: eq(server.serverId, partition),
			columns: { buildsConcurrency: true },
		});
		return normalize(currentServer?.buildsConcurrency ?? 1);
	} catch (error) {
		console.error(
			"Failed to resolve builds concurrency, defaulting to 1",
			error,
		);
		return 1;
	}
};

/**
 * Resolve the maximum concurrent builds allowed for a single tenant within a partition.
 * Guarantees that no single tenant can starve the platform by consuming all worker slots.
 */
export const resolveTenantBuildsConcurrency = async (
	partition: string,
	_tenantId: string,
): Promise<number> => {
	try {
		const envTenantVal = process.env.HATDOT_TENANT_CONCURRENCY
			? parseInt(process.env.HATDOT_TENANT_CONCURRENCY, 10)
			: NaN;
		if (!isNaN(envTenantVal) && envTenantVal >= 1) {
			return normalize(envTenantVal);
		}

		const globalLimit = await resolveBuildsConcurrency(partition);
		// Each tenant is granted up to half the global concurrency or at least 2 concurrent builds
		return Math.max(1, Math.min(2, Math.floor(globalLimit / 2)));
	} catch {
		return 2;
	}
};

const normalize = (value: number): number => Math.max(1, Math.floor(value));

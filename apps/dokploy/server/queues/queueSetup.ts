import os from "node:os";
import { IS_CLOUD } from "@dokploy/server";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { resolveBuildsConcurrency, resolveTenantBuildsConcurrency } from "./concurrency";
import { processDeploymentJob } from "./deployments-queue";
import { type InMemoryJob, InMemoryQueue, LOCAL_PARTITION } from "./in-memory-queue";
import type { DeploymentJob } from "./queue-types";

/**
 * Deployment queue.
 *
 * Self-hosted uses an in-memory, per-group FIFO queue with configurable
 * concurrency per server. Cloud does not use the queue at all — deployments
 * run directly in the background — so we expose a no-op.
 */

interface DeploymentQueue {
	add: (
		name: string,
		data: DeploymentJob,
		opts?: Record<string, unknown>,
	) => Promise<{ id: string }>;
	getJobs: (states?: Array<"waiting" | "active">) => Promise<InMemoryJob[]>;
	close: () => Promise<void>;
	on: (...args: unknown[]) => void;
	run: () => Promise<void>;
	removeWaiting: (predicate: (data: DeploymentJob) => boolean) => number;
	clearWaiting: () => number;
}

const createNoopQueue = (): DeploymentQueue => ({
	add: () => Promise.resolve({ id: "noop" }),
	getJobs: () => Promise.resolve([]),
	close: () => Promise.resolve(),
	on: () => {},
	run: () => Promise.resolve(),
	removeWaiting: () => 0,
	clearWaiting: () => 0,
});

const createInMemoryQueue = (): DeploymentQueue => {
	const queue = new InMemoryQueue({
		resolveConcurrency: async (partition) => {
			const resolved = await resolveBuildsConcurrency(partition);
			if (partition === LOCAL_PARTITION) {
				const envVal = process.env.HATDOT_MAX_CONCURRENT_BUILDS
					? parseInt(process.env.HATDOT_MAX_CONCURRENT_BUILDS, 10)
					: NaN;
				if (!isNaN(envVal) && envVal >= 1) {
					return envVal;
				}
				if (resolved > 1) {
					return resolved;
				}
				const cpuCount = typeof os !== "undefined" && os.cpus ? os.cpus().length : 4;
				return Math.max(4, cpuCount);
			}
			return resolved;
		},
		resolveTenantConcurrency: async (partition, tenantId) => {
			const envTenant = process.env.HATDOT_TENANT_CONCURRENCY
				? parseInt(process.env.HATDOT_TENANT_CONCURRENCY, 10)
				: NaN;
			if (!isNaN(envTenant) && envTenant >= 1) {
				return envTenant;
			}
			const globalLim = await resolveBuildsConcurrency(partition);
			return Math.max(1, Math.min(2, Math.floor(Math.max(4, globalLim) / 2)));
		},
	});
	queue.process(processDeploymentJob);

	return {
		add: (_name, data, opts) => queue.add(data, opts),
		getJobs: (states) => queue.getJobs(states),
		close: () => queue.close(),
		on: () => {},
		run: () => queue.run(),
		removeWaiting: (predicate) => queue.removeWaiting(predicate),
		clearWaiting: () => queue.clearWaiting(),
	};
};

// Use a global singleton so the deployment queue is shared across every module
// instance. In dev (tsx/Next) the same file can be evaluated more than once
// (relative import in server.ts vs `@/` alias in the routers); without this the
// worker and the `add()` calls would land on different queue instances.
const globalForQueue = globalThis as unknown as {
	__dokployDeploymentQueue?: DeploymentQueue;
};

if (!globalForQueue.__dokployDeploymentQueue) {
	globalForQueue.__dokployDeploymentQueue = !IS_CLOUD
		? createInMemoryQueue()
		: createNoopQueue();
}

const myQueue: DeploymentQueue = globalForQueue.__dokployDeploymentQueue;

/** Start processing jobs. Called once on server startup (self-hosted). */
export const startDeploymentWorker = () => myQueue.run();

export const getJobsByApplicationId = async (applicationId: string) => {
	const jobs = await myQueue.getJobs();
	return jobs.filter(
		(job) => (job.data as any)?.applicationId === applicationId,
	);
};

export const getJobsByComposeId = async (composeId: string) => {
	const jobs = await myQueue.getJobs();
	return jobs.filter((job) => (job.data as any)?.composeId === composeId);
};

if (!IS_CLOUD) {
	process.on("SIGTERM", () => {
		myQueue.close();
		process.exit(0);
	});
}

export const cleanQueuesByApplication = async (applicationId: string) => {
	const removed = myQueue.removeWaiting(
		(data) => (data as any)?.applicationId === applicationId,
	);
	if (removed > 0) {
		console.log(
			`Removed ${removed} waiting job(s) for application ${applicationId}`,
		);
	}
};

export const cleanQueuesByCompose = async (composeId: string) => {
	const removed = myQueue.removeWaiting(
		(data) => (data as any)?.composeId === composeId,
	);
	if (removed > 0) {
		console.log(`Removed ${removed} waiting job(s) for compose ${composeId}`);
	}
};

export const cleanAllDeploymentQueue = async () => {
	myQueue.clearWaiting();
	return true;
};

export const killDockerBuild = async (
	type: "application" | "compose",
	serverId: string | null,
	appName?: string,
) => {
	try {
		if (!appName) {
			console.warn(
				"[killDockerBuild] Aborting kill: appName must be provided to avoid killing concurrent customer builds.",
			);
			return;
		}

		// Sanitize appName to alphanumeric, hyphens, and underscores to prevent shell injection
		const safeAppName = appName.replace(/[^a-zA-Z0-9_-]/g, "");
		if (!safeAppName) return;

		// Targeted kill: send SIGINT/SIGTERM only to processes matching the specific application/compose name
		// This terminates docker build, nixpacks, or compose processes for THIS service only,
		// without touching any other customer's concurrent builds.
		const command = `pkill -15 -f "${safeAppName}" || pkill -2 -f "${safeAppName}"`;

		if (serverId) {
			await execAsyncRemote(serverId, command);
		} else {
			await execAsync(command);
		}
	} catch (error) {
		console.error("[killDockerBuild] Error terminating build:", error);
	}
};

export { myQueue };

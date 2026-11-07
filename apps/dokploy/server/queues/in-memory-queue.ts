import type { DeploymentJob } from "./queue-types";

/**
 * In-memory deployment queue for self-hosted instances.
 *
 * Replaces BullMQ/Redis for deployments. The model is per-group FIFO with a
 * configurable concurrency per partition (server):
 *
 * - Jobs are partitioned by `serverId` (the local web server uses the
 *   `LOCAL_PARTITION` key). Each partition runs up to `concurrency` jobs at
 *   the same time, so two different applications can build concurrently.
 * - Within a partition, jobs that belong to the same group (same application
 *   or compose) never run in parallel — they are serialized FIFO. This avoids
 *   two builds of the same service stepping on each other (same code dir,
 *   same container name, etc).
 *
 * The concurrency is resolved lazily per partition through `resolveConcurrency`
 * so it can be gated by the enterprise license at run time (a non-licensed
 * instance always resolves to 1).
 *
 * The public surface (`add`, `getJobs`, `close`, `on`) mirrors the subset of
 * BullMQ used by the routers so it can be a drop-in replacement.
 */

export const LOCAL_PARTITION = "__local__";

export type JobState = "waiting" | "active";

export interface InMemoryJob {
	id: string;
	name: string;
	data: DeploymentJob;
	timestamp: number;
	processedOn?: number;
	finishedOn?: number;
	failedReason?: string;
	getState: () => Promise<JobState>;
	remove: () => Promise<void>;
}

type Processor = (job: InMemoryJob) => Promise<void>;

/** Resolve the partition key (serverId) a job belongs to. */
export const getPartition = (data: DeploymentJob): string =>
	data.serverId ?? LOCAL_PARTITION;

/** Resolve the FIFO group a job belongs to (the service being deployed). */
export const getGroup = (data: DeploymentJob): string => {
	if (data.applicationType === "compose") {
		return `compose:${data.composeId}`;
	}
	return `application:${data.applicationId}`;
};

/** Resolve the tenant / organization a job belongs to. */
export const getTenant = (data: DeploymentJob): string =>
	data.organizationId || "__default__";

interface InternalJob {
	id: string;
	name: string;
	data: DeploymentJob;
	timestamp: number;
	processedOn?: number;
	finishedOn?: number;
	failedReason?: string;
	state: JobState;
	partition: string;
	group: string;
	tenant: string;
}

interface Partition {
	waiting: InternalJob[];
	/** Groups currently running in this partition. */
	activeGroups: Set<string>;
	active: InternalJob[];
	draining?: boolean;
	needsDrain?: boolean;
}

export interface InMemoryQueueOptions {
	/**
	 * Returns the max number of jobs that may run in parallel for a given
	 * partition. Called on every scheduling tick so license/config changes are
	 * picked up without restarting the queue. Must return a value >= 1.
	 */
	resolveConcurrency: (partition: string) => Promise<number> | number;
	/**
	 * Returns the max number of concurrent jobs allowed for a single tenant
	 * within a partition. Defaults to global concurrency if unconfigured.
	 */
	resolveTenantConcurrency?: (
		partition: string,
		tenantId: string,
	) => Promise<number> | number;
	/** Optional hard ceiling per tenant across all scheduling ticks. */
	maxConcurrentPerTenant?: number;
	/** Monotonic clock; injectable for tests. Defaults to Date.now. */
	now?: () => number;
}

export class InMemoryQueue {
	private partitions = new Map<string, Partition>();
	private processor: Processor | null = null;
	private running = false;
	private seq = 0;
	private readonly resolveConcurrency: InMemoryQueueOptions["resolveConcurrency"];
	private readonly resolveTenantConcurrency?: InMemoryQueueOptions["resolveTenantConcurrency"];
	private readonly maxConcurrentPerTenant?: number;
	private readonly now: () => number;

	constructor(options: InMemoryQueueOptions) {
		this.resolveConcurrency = options.resolveConcurrency;
		this.resolveTenantConcurrency = options.resolveTenantConcurrency;
		this.maxConcurrentPerTenant = options.maxConcurrentPerTenant;
		this.now = options.now ?? (() => Date.now());
	}

	private getPartitionState(key: string): Partition {
		let partition = this.partitions.get(key);
		if (!partition) {
			partition = { waiting: [], activeGroups: new Set(), active: [] };
			this.partitions.set(key, partition);
		}
		return partition;
	}

	/**
	 * Register the worker that processes each job. Registering a processor also
	 * starts the queue: in dev (tsx/Next) the module that calls `run()` and the
	 * module that calls `add()` can resolve to different instances, so we must
	 * not depend on a separate `run()` call to flip `running` on.
	 */
	process(processor: Processor) {
		this.processor = processor;
		this.running = true;
		this.schedule();
	}

	run() {
		this.running = true;
		this.schedule();
		return Promise.resolve();
	}

	async add(
		data: DeploymentJob,
		opts?: { jobId?: string; [key: string]: unknown },
	): Promise<{ id: string }> {
		const id = opts?.jobId || `job-${++this.seq}`;
		const partitionKey = getPartition(data);
		const partition = this.getPartitionState(partitionKey);

		// If a job with this deterministic id already exists in waiting or active, return existing job without duplicating
		const existing = [...partition.waiting, ...partition.active].find(
			(job) => job.id === id,
		);
		if (existing) {
			return { id: existing.id };
		}

		const job: InternalJob = {
			id,
			name: "deployments",
			data,
			timestamp: this.now(),
			state: "waiting",
			partition: partitionKey,
			group: getGroup(data),
			tenant: getTenant(data),
		};
		partition.waiting.push(job);
		this.schedule();
		return { id };
	}

	private toPublic(job: InternalJob): InMemoryJob {
		return {
			id: job.id,
			name: job.name,
			data: job.data,
			timestamp: job.timestamp,
			processedOn: job.processedOn,
			finishedOn: job.finishedOn,
			getState: () => Promise.resolve(job.state),
			remove: () => this.remove(job.id),
		};
	}

	/** Snapshot of jobs in the requested states (defaults to waiting + active). */
	getJobs(states?: JobState[]): Promise<InMemoryJob[]> {
		const wantWaiting = !states || states.includes("waiting");
		const wantActive = !states || states.includes("active");
		const jobs: InMemoryJob[] = [];
		for (const partition of this.partitions.values()) {
			if (wantWaiting) {
				jobs.push(...partition.waiting.map((job) => this.toPublic(job)));
			}
			if (wantActive) {
				jobs.push(...partition.active.map((job) => this.toPublic(job)));
			}
		}
		return Promise.resolve(jobs);
	}

	/** Remove a single waiting job by id. Active jobs cannot be removed. */
	remove(id: string): Promise<void> {
		for (const partition of this.partitions.values()) {
			const before = partition.waiting.length;
			partition.waiting = partition.waiting.filter((job) => job.id !== id);
			if (partition.waiting.length !== before) break;
		}
		return Promise.resolve();
	}

	/** Remove waiting jobs matching a predicate. Active jobs are not affected. */
	removeWaiting(predicate: (data: DeploymentJob) => boolean): number {
		let removed = 0;
		for (const partition of this.partitions.values()) {
			partition.waiting = partition.waiting.filter((job) => {
				const match = predicate(job.data);
				if (match) removed++;
				return !match;
			});
		}
		return removed;
	}

	/** Drop every waiting job across all partitions. */
	clearWaiting(): number {
		let removed = 0;
		for (const partition of this.partitions.values()) {
			removed += partition.waiting.length;
			partition.waiting = [];
		}
		return removed;
	}

	on() {
		// No-op: kept for BullMQ API compatibility (error events, etc).
	}

	close() {
		this.running = false;
		return Promise.resolve();
	}

	private schedule() {
		if (!this.running || !this.processor) return;
		for (const key of this.partitions.keys()) {
			void this.drainPartition(key);
		}
	}

	private async findNextEligibleJobIndex(
		key: string,
		partition: Partition,
		concurrency: number,
		tenantLimits: Map<string, number>,
		activePerTenant: Map<string, number>,
	): Promise<number> {
		let selectedIndex = -1;
		let lowestActiveLoad = Infinity;

		for (let i = 0; i < partition.waiting.length; i++) {
			const candidate = partition.waiting[i]!;
			if (partition.activeGroups.has(candidate.group)) {
				continue;
			}

			const tenantActiveCount = activePerTenant.get(candidate.tenant) || 0;
			let maxTenantConcurrency = tenantLimits.get(candidate.tenant);
			if (maxTenantConcurrency === undefined) {
				if (this.resolveTenantConcurrency) {
					maxTenantConcurrency = Math.max(
						1,
						await this.resolveTenantConcurrency(key, candidate.tenant),
					);
				} else if (typeof this.maxConcurrentPerTenant === "number") {
					maxTenantConcurrency = Math.max(1, this.maxConcurrentPerTenant);
				} else {
					maxTenantConcurrency = concurrency;
				}
				tenantLimits.set(candidate.tenant, maxTenantConcurrency);
			}

			if (tenantActiveCount >= maxTenantConcurrency) {
				continue;
			}

			// Fair scheduling: pick candidate whose tenant has fewest active jobs
			if (tenantActiveCount < lowestActiveLoad) {
				lowestActiveLoad = tenantActiveCount;
				selectedIndex = i;
				// Minimum possible load is 0 - earliest candidate with 0 active is optimal
				if (lowestActiveLoad === 0) {
					break;
				}
			}
		}

		return selectedIndex;
	}

	private async drainPartition(key: string) {
		const partition = this.partitions.get(key);
		if (!partition || !this.processor) return;
		if (partition.draining) {
			partition.needsDrain = true;
			return;
		}

		partition.draining = true;
		try {
			const concurrency = Math.max(1, await this.resolveConcurrency(key));
			const tenantLimits = new Map<string, number>();

			while (partition.active.length < concurrency) {
				// Count active jobs per tenant in this partition
				const activePerTenant = new Map<string, number>();
				for (const activeJob of partition.active) {
					activePerTenant.set(
						activeJob.tenant,
						(activePerTenant.get(activeJob.tenant) || 0) + 1,
					);
				}

				// Find next eligible waiting job using fair scheduling
				const nextJobIndex = await this.findNextEligibleJobIndex(
					key,
					partition,
					concurrency,
					tenantLimits,
					activePerTenant,
				);

				if (nextJobIndex === -1) {
					// No eligible jobs available for scheduling at this tick
					break;
				}

				const job = partition.waiting.splice(nextJobIndex, 1)[0];
				if (!job) break;

				job.state = "active";
				job.processedOn = this.now();
				partition.activeGroups.add(job.group);
				partition.active.push(job);

				void this.runJob(job);
			}
		} finally {
			partition.draining = false;
			if (partition.needsDrain) {
				partition.needsDrain = false;
				void this.drainPartition(key);
			}
		}
	}

	private async runJob(job: InternalJob) {
		try {
			await this.processor?.(this.toPublic(job));
		} catch (error) {
			job.failedReason = error instanceof Error ? error.message : String(error);
			console.error("In-memory deployment job failed", error);
		} finally {
			job.finishedOn = this.now();
			const partition = this.partitions.get(job.partition);
			if (partition) {
				partition.active = partition.active.filter((j) => j.id !== job.id);
				partition.activeGroups.delete(job.group);
			}
			// A slot (and possibly the group) freed up — try to schedule more.
			void this.drainPartition(job.partition);
		}
	}
}

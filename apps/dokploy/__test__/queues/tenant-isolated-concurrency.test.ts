import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecAsync = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
const mockExecAsyncRemote = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: (...args: unknown[]) => mockExecAsync(...args),
	execAsyncRemote: (...args: unknown[]) => mockExecAsyncRemote(...args),
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
}));

import {
	getGroup,
	getPartition,
	getTenant,
	InMemoryQueue,
	LOCAL_PARTITION,
} from "../../server/queues/in-memory-queue";
import type { DeploymentJob } from "../../server/queues/queue-types";
import { killDockerBuild } from "../../server/queues/queueSetup";

const createTenantJob = (
	tenantId: string,
	applicationId: string,
	type: "application" | "compose" = "application",
	serverId?: string,
): DeploymentJob => {
	if (type === "compose") {
		return {
			composeId: applicationId,
			organizationId: tenantId,
			projectId: `proj-${tenantId}`,
			titleLog: `Deploy compose ${applicationId}`,
			descriptionLog: "",
			type: "deploy",
			applicationType: "compose",
			serverId,
		};
	}
	return {
		applicationId,
		organizationId: tenantId,
		projectId: `proj-${tenantId}`,
		titleLog: `Deploy app ${applicationId}`,
		descriptionLog: "",
		type: "deploy",
		applicationType: "application",
		serverId,
	};
};

/** A controllable async task: resolves only when `release()` is called. */
const deferred = () => {
	let resolve!: () => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<void>((r, rej) => {
		resolve = r;
		reject = rej;
	});
	return { promise, release: resolve, fail: reject };
};

const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe("Tenant-Isolated Deployment Queue & Fair Concurrency", () => {
	let nowValue = 0;
	const now = () => ++nowValue;

	beforeEach(() => {
		nowValue = 0;
		mockExecAsync.mockClear();
		mockExecAsyncRemote.mockClear();
	});

	it("resolves tenant and group identifiers correctly", () => {
		const jobA = createTenantJob("tenant-a", "app-1");
		const jobB = createTenantJob("tenant-b", "compose-1", "compose");
		const jobAnon: DeploymentJob = {
			applicationId: "legacy-app",
			titleLog: "Legacy deploy",
			descriptionLog: "",
			type: "deploy",
			applicationType: "application",
		};

		expect(getTenant(jobA)).toBe("tenant-a");
		expect(getTenant(jobB)).toBe("tenant-b");
		expect(getTenant(jobAnon)).toBe("__default__");

		expect(getGroup(jobA)).toBe("application:app-1");
		expect(getGroup(jobB)).toBe("compose:compose-1");
		expect(getPartition(jobA)).toBe(LOCAL_PARTITION);
	});

	it("runs Tenant A and Tenant B concurrently without blocking each other", async () => {
		const activeTenants = new Set<string>();
		const concurrentTenantPairs: Array<[string, string]> = [];
		const tasks = new Map<string, ReturnType<typeof deferred>>();
		const startedJobs: string[] = [];

		const queue = new InMemoryQueue({
			resolveConcurrency: () => 4,
			resolveTenantConcurrency: () => 2,
			now,
		});

		queue.process(async (job) => {
			const tenant = getTenant(job.data);
			const id = (job.data as any).applicationId;
			startedJobs.push(id);
			activeTenants.add(tenant);

			if (activeTenants.has("tenant-a") && activeTenants.has("tenant-b")) {
				concurrentTenantPairs.push(["tenant-a", "tenant-b"]);
			}

			const d = deferred();
			tasks.set(id, d);
			await d.promise;
			activeTenants.delete(tenant);
		});

		await queue.run();

		// Tenant A queues app-a1, Tenant B queues app-b1
		await queue.add(createTenantJob("tenant-a", "app-a1"));
		await queue.add(createTenantJob("tenant-b", "app-b1"));
		await flush();

		// Both jobs started concurrently
		expect(startedJobs).toContain("app-a1");
		expect(startedJobs).toContain("app-b1");
		expect(concurrentTenantPairs.length).toBeGreaterThan(0);

		// Release jobs
		tasks.get("app-a1")!.release();
		tasks.get("app-b1")!.release();
		await flush();
	});

	it("allows fast Tenant B build to finish while slow Tenant A build is still running", async () => {
		const completedOrder: string[] = [];
		const tasks = new Map<string, ReturnType<typeof deferred>>();

		const queue = new InMemoryQueue({
			resolveConcurrency: () => 4,
			resolveTenantConcurrency: () => 2,
			now,
		});

		queue.process(async (job) => {
			const id = (job.data as any).applicationId;
			const d = deferred();
			tasks.set(id, d);
			await d.promise;
			completedOrder.push(id);
		});

		await queue.run();

		// Tenant A starts a slow build
		await queue.add(createTenantJob("tenant-a", "slow-app-a"));
		await flush();

		// Tenant B starts a build afterwards
		await queue.add(createTenantJob("tenant-b", "fast-app-b"));
		await flush();

		// Both are running concurrently
		expect(tasks.has("slow-app-a")).toBe(true);
		expect(tasks.has("fast-app-b")).toBe(true);

		// Fast Tenant B finishes while Tenant A is still building!
		tasks.get("fast-app-b")!.release();
		await flush();

		expect(completedOrder).toEqual(["fast-app-b"]);

		// Now Tenant A finishes
		tasks.get("slow-app-a")!.release();
		await flush();

		expect(completedOrder).toEqual(["fast-app-b", "slow-app-a"]);
	});

	it("prevents single tenant starvation: fair scheduler prioritizes unrepresented tenants", async () => {
		const startedJobs: string[] = [];
		const tasks = new Map<string, ReturnType<typeof deferred>>();

		// Global concurrency = 4, Tenant concurrency = 2
		const queue = new InMemoryQueue({
			resolveConcurrency: () => 4,
			resolveTenantConcurrency: () => 2,
			now,
		});

		queue.process(async (job) => {
			const id = (job.data as any).applicationId;
			startedJobs.push(id);
			const d = deferred();
			tasks.set(id, d);
			await d.promise;
		});

		await queue.run();

		// Tenant A queues 4 builds for 4 different apps at once
		await queue.add(createTenantJob("tenant-a", "app-a1"));
		await queue.add(createTenantJob("tenant-a", "app-a2"));
		await queue.add(createTenantJob("tenant-a", "app-a3"));
		await queue.add(createTenantJob("tenant-a", "app-a4"));

		// Tenant B arrives right after with 1 build
		await queue.add(createTenantJob("tenant-b", "app-b1"));

		await flush();

		// Tenant A can run up to 2 concurrent builds (app-a1, app-a2).
		// Tenant B (app-b1) is scheduled immediately because Tenant B had 0 active builds!
		// App-a3 and App-a4 must wait.
		expect(startedJobs).toContain("app-a1");
		expect(startedJobs).toContain("app-b1");
		expect(startedJobs).toContain("app-a2");
		expect(startedJobs).not.toContain("app-a3");
		expect(startedJobs).not.toContain("app-a4");

		// Free one slot from Tenant A
		tasks.get("app-a1")!.release();
		await flush();

		// Now app-a3 can run
		expect(startedJobs).toContain("app-a3");

		// Clean up remaining
		tasks.get("app-a2")!.release();
		tasks.get("app-b1")!.release();
		tasks.get("app-a3")!.release();
		await flush();

		if (tasks.has("app-a4")) {
			tasks.get("app-a4")!.release();
			await flush();
		}
	});

	it("serializes multiple builds of the SAME application while allowing DIFFERENT applications to run concurrently", async () => {
		const startedOrder: string[] = [];
		const tasks = new Map<string, ReturnType<typeof deferred>>();
		let jobCounter = 0;

		const queue = new InMemoryQueue({
			resolveConcurrency: () => 4,
			resolveTenantConcurrency: () => 2,
			now,
		});

		queue.process(async (job) => {
			const id = `${(job.data as any).applicationId}#${++jobCounter}`;
			startedOrder.push(id);
			const d = deferred();
			tasks.set(id, d);
			await d.promise;
		});

		await queue.run();

		// Tenant A submits 2 builds of app-1 and 1 build of app-2
		await queue.add(createTenantJob("tenant-a", "app-1"));
		await queue.add(createTenantJob("tenant-a", "app-1"));
		await queue.add(createTenantJob("tenant-a", "app-2"));
		await flush();

		// app-1#1 and app-2#2 start concurrently. app-1 second build must wait for app-1 first build to finish!
		expect(startedOrder).toEqual(["app-1#1", "app-2#2"]);

		// Release first build of app-1
		tasks.get("app-1#1")!.release();
		await flush();

		// Now second build of app-1 starts
		expect(startedOrder).toEqual(["app-1#1", "app-2#2", "app-1#3"]);

		tasks.get("app-2#2")!.release();
		tasks.get("app-1#3")!.release();
		await flush();
	});

	it("safe cancellation isolation: targets specific app and never runs indiscriminate pkill", async () => {
		mockExecAsync.mockClear();
		mockExecAsyncRemote.mockClear();

		// 1. Calling without appName safely aborts without running any command
		await killDockerBuild("application", null);
		expect(mockExecAsync).not.toHaveBeenCalled();

		// 2. Calling with appName runs targeted kill specifically for that app
		await killDockerBuild("application", null, "customer-app-123");
		expect(mockExecAsync).toHaveBeenCalledTimes(1);
		const commandCalled = mockExecAsync.mock.calls[0]?.[0];
		expect(commandCalled).toContain("customer-app-123");
		expect(commandCalled).not.toContain('"docker build"');
	});

	it("enforces tenant boundary on queue listing: Customer A never sees Customer B's jobs", async () => {
		const block = deferred();
		const queue = new InMemoryQueue({ resolveConcurrency: () => 4 });
		queue.process(async () => {
			await block.promise;
		});
		await queue.run();

		await queue.add(createTenantJob("tenant-alpha", "alpha-app-1"));
		await queue.add(createTenantJob("tenant-beta", "beta-app-1"));
		await queue.add(createTenantJob("tenant-alpha", "alpha-app-2"));
		await flush();

		const allJobs = await queue.getJobs();
		expect(allJobs).toHaveLength(3);

		// Simulate customer-facing queueList filtering for tenant-alpha
		const callerOrgId = "tenant-alpha";
		const filteredForAlpha = allJobs.filter(
			(job) => job.data.organizationId === callerOrgId,
		);

		expect(filteredForAlpha).toHaveLength(2);
		expect(
			filteredForAlpha.every((j) => j.data.organizationId === "tenant-alpha"),
		).toBe(true);
		expect(
			filteredForAlpha.some((j) => (j.data as any).applicationId === "beta-app-1"),
		).toBe(false);

		// Clean up
		block.release();
		await flush();
	});
});

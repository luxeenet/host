import { createHmac } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory PostgreSQL platform settings store simulating multi-replica Postgres DB
interface StoredSetting {
	id: string;
	key: string;
	value: string | null;
	description?: string | null;
	updatedAt: Date;
}

const dbStore = new Map<string, StoredSetting>();
let dbFailureSimulated = false;

const mockValidateRequest = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => ({
	github: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
	},
	applications: {
		findMany: vi.fn(),
	},
	compose: {
		findMany: vi.fn(),
	},
	platformSettings: {
		findFirst: vi.fn(),
	},
}));

// In-memory queue with deterministic jobId support simulating Redis / BullMQ / InMemoryQueue
interface EnqueuedJob {
	id: string;
	name: string;
	data: any;
	opts?: any;
}
const queueStore: EnqueuedJob[] = [];
let queueFailureSimulated = false;

const mockQueueAdd = vi.hoisted(() =>
	vi.fn().mockImplementation(async (name: string, data: any, opts?: any) => {
		if (queueFailureSimulated) {
			throw new Error("Redis connection dropped / command timeout");
		}
		const id = opts?.jobId || `job-${queueStore.length + 1}`;
		// Idempotency: return existing job if id matches
		const existing = queueStore.find((j) => j.id === id);
		if (existing) {
			return { id: existing.id };
		}
		const job: EnqueuedJob = { id, name, data, opts };
		queueStore.push(job);
		return { id };
	}),
);

const mockVerify = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockShouldDeploy = vi.hoisted(() => vi.fn(() => true));

vi.mock("@dokploy/server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dokploy/server")>();
	return {
		...actual,
		validateRequest: mockValidateRequest,
		shouldDeploy: mockShouldDeploy,
	};
});

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			github: mockDbQuery.github,
			applications: mockDbQuery.applications,
			compose: mockDbQuery.compose,
			platformSettings: {
				findFirst: vi.fn(async ({ where }: any) => {
					if (dbFailureSimulated) {
						throw new Error("PostgreSQL connection refused: 5432");
					}
					// Find by key
					for (const setting of dbStore.values()) {
						return setting;
					}
					return undefined;
				}),
			},
		},
		insert: vi.fn((_table: any) => ({
			values: vi.fn(async (row: any) => {
				if (dbFailureSimulated) {
					throw new Error("PostgreSQL connection refused: 5432");
				}
				if (dbStore.has(row.key)) {
					const error: any = new Error(
						`duplicate key value violates unique constraint "paas_platform_setting_key_unique"`,
					);
					error.code = "23505";
					throw error;
				}
				const stored: StoredSetting = {
					id: `set-${Date.now()}-${Math.random()}`,
					key: row.key,
					value: row.value,
					description: row.description,
					updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(),
				};
				dbStore.set(row.key, stored);
				return stored;
			}),
		})),
		update: vi.fn((_table: any) => ({
			set: vi.fn((values: any) => ({
				where: vi.fn(async (_condition: any) => {
					if (dbFailureSimulated) {
						throw new Error("PostgreSQL connection refused: 5432");
					}
					for (const [k, v] of dbStore.entries()) {
						if (values.value !== undefined) v.value = values.value;
						if (values.updatedAt !== undefined) v.updatedAt = values.updatedAt;
						dbStore.set(k, v);
						return [v];
					}
					return [];
				}),
			})),
		})),
		delete: vi.fn((_table: any) => ({
			where: vi.fn(async (_condition: any) => {
				if (dbFailureSimulated) {
					throw new Error("PostgreSQL connection refused: 5432");
				}
				let deletedCount = 0;
				for (const [k, v] of Array.from(dbStore.entries())) {
					if (k.startsWith("webhook:github:delivery:")) {
						// Only delete if expired
						const expiredThreshold = Date.now() - 24 * 60 * 60 * 1000;
						if (v.updatedAt.getTime() < expiredThreshold) {
							dbStore.delete(k);
							deletedCount++;
						}
					}
				}
				return { rowCount: deletedCount };
			}),
		})),
	},
}));

vi.mock("@octokit/webhooks", () => ({
	Webhooks: vi.fn().mockImplementation(function Webhooks() {
		return {
			verify: mockVerify,
		};
	}),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	myQueue: {
		add: mockQueueAdd,
	},
}));

import webhookHandler from "@/pages/api/deploy/github";
import {
	_clearDeliveryCacheForTesting,
	claimGithubDelivery,
	cleanupExpiredGithubDeliveries,
	markGithubDeliveryFailed,
	markGithubDeliveryQueued,
} from "@dokploy/server/utils/providers/github-delivery-dedup";

const WEBHOOK_SECRET = "webhook_secret_concurrency_test";

const createValidPushRequest = (deliveryId: string): NextApiRequest => {
	const body = {
		installation: { id: 8888 },
		ref: "refs/heads/main",
		repository: {
			name: "my-web-app",
			owner: { login: "octo-org" },
		},
		head_commit: {
			id: "c0ffee1234567890",
			message: "feat: reliable deploy",
		},
		commits: [],
	};
	const rawPayload = JSON.stringify(body);
	const signature = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(rawPayload).digest("hex")}`;

	return {
		headers: {
			"x-hub-signature-256": signature,
			"x-github-delivery": deliveryId,
			"x-github-event": "push",
		},
		body,
	} as unknown as NextApiRequest;
};

const buildRes = () => {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(payload: unknown) {
			res.body = payload;
			return res;
		},
	};
	return res;
};

describe("GitHub Webhook Reliability, Concurrency & Crash Recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_clearDeliveryCacheForTesting();
		dbStore.clear();
		queueStore.length = 0;
		dbFailureSimulated = false;
		queueFailureSimulated = false;

		mockDbQuery.github.findFirst.mockResolvedValue({
			githubId: "gh-app-1",
			githubInstallationId: 8888,
			githubWebhookSecret: WEBHOOK_SECRET,
		});

		mockDbQuery.applications.findMany.mockResolvedValue([
			{
				applicationId: "app-prod-1",
				appName: "production-service",
				sourceType: "github",
				autoDeploy: true,
				triggerType: "push",
				branch: "main",
				repository: "my-web-app",
				owner: "octo-org",
				githubId: "gh-app-1",
				watchPaths: [],
			},
		]);

		mockDbQuery.compose.findMany.mockResolvedValue([]);
		mockVerify.mockResolvedValue(true);
	});

	it("1. Two simultaneous requests with the same delivery ID enqueue exactly ONE deployment job", async () => {
		const deliveryId = "delivery-concurrent-pair-1";
		const req1 = createValidPushRequest(deliveryId);
		const req2 = createValidPushRequest(deliveryId);
		const res1 = buildRes();
		const res2 = buildRes();

		await Promise.all([
			webhookHandler(req1, res1 as unknown as NextApiResponse),
			webhookHandler(req2, res2 as unknown as NextApiResponse),
		]);

		expect(res1.statusCode).toBe(200);
		expect(res2.statusCode).toBe(200);

		// One must succeed in deploying, the other must acknowledge duplicate/processing
		const bodies = [res1.body as any, res2.body as any];
		const deployed = bodies.find((b) => b?.message?.includes("Deployed 1 apps"));
		const deduplicated = bodies.find((b) =>
			b?.message?.includes("Delivery already processed") ||
			b?.message?.includes("Delivery currently being processed")
		);

		expect(deployed).toBeDefined();
		expect(deduplicated).toBeDefined();

		// Crucial assertion: exactly one deployment job was enqueued
		expect(queueStore).toHaveLength(1);
		expect(queueStore[0]?.id).toBe(`deploy:gh:${deliveryId}:app:app-prod-1`);
	});

	it("2. Ten simultaneous requests with the same delivery ID produce no more than ONE deployment job", async () => {
		const deliveryId = "delivery-concurrent-ten-burst";
		const requests = Array.from({ length: 10 }, () => ({
			req: createValidPushRequest(deliveryId),
			res: buildRes(),
		}));

		await Promise.all(
			requests.map(({ req, res }) =>
				webhookHandler(req, res as unknown as NextApiResponse),
			),
		);

		for (const { res } of requests) {
			expect(res.statusCode).toBe(200);
		}

		// Exactly one job in queue
		expect(queueStore).toHaveLength(1);
		expect(queueStore[0]?.id).toBe(`deploy:gh:${deliveryId}:app:app-prod-1`);
	});

	it("3. Multiple application replicas processing the same delivery share atomic state", async () => {
		const deliveryId = "delivery-cross-replica-test";
		
		// Replica 1 claims delivery
		const claim1 = await claimGithubDelivery(deliveryId);
		expect(claim1.canProcess).toBe(true);

		// Replica 2 attempts to claim same delivery from shared DB
		const claim2 = await claimGithubDelivery(deliveryId);
		expect(claim2.canProcess).toBe(false);
		expect(claim2.reason).toBe("CURRENTLY_PROCESSING");

		// Replica 1 enqueues and commits QUEUED
		await markGithubDeliveryQueued(deliveryId, ["job-1"]);

		// Replica 2 receives subsequent retry
		const claim3 = await claimGithubDelivery(deliveryId);
		expect(claim3.canProcess).toBe(false);
		expect(claim3.reason).toBe("ALREADY_QUEUED");
	});

	it("4. Redis accepting a job while application crashes before updating PostgreSQL reconciles safely without duplicate jobs", async () => {
		const deliveryId = "delivery-crash-after-redis-accept";
		const deterministicJobId = `deploy:gh:${deliveryId}:app:app-prod-1`;

		// Step A: First request claims delivery and enqueues to Redis
		const claim = await claimGithubDelivery(deliveryId);
		expect(claim.canProcess).toBe(true);

		await mockQueueAdd("deployments", { applicationId: "app-prod-1" }, { jobId: deterministicJobId });
		expect(queueStore).toHaveLength(1);

		// Process crashes here! PostgreSQL was NOT updated with markGithubDeliveryQueued.
		// PostgreSQL still has state: "PROCESSING" with claimedAt: T0.

		// Step B: GitHub retry arrives after processing timeout (stale processing takeover)
		const retryClaim = await claimGithubDelivery(deliveryId, {
			now: Date.now() + 65_000,
			processingTimeoutMs: 60_000,
		});
		expect(retryClaim.canProcess).toBe(true);

		// Re-enqueues with deterministic jobId
		const retryAdd = await mockQueueAdd(
			"deployments",
			{ applicationId: "app-prod-1" },
			{ jobId: deterministicJobId },
		);
		expect(retryAdd.id).toBe(deterministicJobId);

		// Queue reconciled: STILL EXACTLY ONE JOB
		expect(queueStore).toHaveLength(1);

		// Now commits QUEUED state
		await markGithubDeliveryQueued(deliveryId, [deterministicJobId]);
	});

	it("5. Redis rejecting a job marks delivery as FAILED and returns error", async () => {
		const deliveryId = "delivery-redis-rejected";
		queueFailureSimulated = true;

		const req = createValidPushRequest(deliveryId);
		const res = buildRes();

		await webhookHandler(req, res as unknown as NextApiResponse);

		expect(res.statusCode).toBe(400);
		expect((res.body as any)?.message).toBe("Error deploying Application");

		// Check stored delivery state
		const key = `webhook:github:delivery:${deliveryId}`;
		const stored = dbStore.get(key);
		expect(stored).toBeDefined();
		const parsed = JSON.parse(stored!.value!);
		expect(parsed.state).toBe("FAILED");
		expect(parsed.error).toContain("Redis connection dropped");
	});

	it("6. PostgreSQL becoming unavailable fails safely without unhandled crash", async () => {
		const deliveryId = "delivery-postgres-down";
		dbFailureSimulated = true;

		const req = createValidPushRequest(deliveryId);
		const res = buildRes();

		await webhookHandler(req, res as unknown as NextApiResponse);

		// Does not crash; falls back to in-memory deduplication gracefully
		expect(res.statusCode).toBe(200);
		expect(queueStore).toHaveLength(1);
	});

	it("7. A worker crashing while processing allows a subsequent worker to reclaim after timeout", async () => {
		const deliveryId = "delivery-worker-crash";
		const startTime = 1_000_000;

		// Worker 1 claims delivery at startTime and crashes mid-execution
		const claim1 = await claimGithubDelivery(deliveryId, { now: startTime });
		expect(claim1.canProcess).toBe(true);

		// Immediate second claim is rejected (active processing)
		const claimImmediate = await claimGithubDelivery(deliveryId, { now: startTime + 10_000 });
		expect(claimImmediate.canProcess).toBe(false);
		expect(claimImmediate.reason).toBe("CURRENTLY_PROCESSING");

		// After processing timeout (60 seconds), Worker 2 reclaims
		const claim2 = await claimGithubDelivery(deliveryId, { now: startTime + 65_000 });
		expect(claim2.canProcess).toBe(true);

		await markGithubDeliveryQueued(deliveryId, ["job-reclaimed"]);
	});

	it("8. A legitimate retry after a failed queue operation succeeds and transitions to QUEUED", async () => {
		const deliveryId = "delivery-failed-retry";

		// Initial claim and failure
		await claimGithubDelivery(deliveryId);
		await markGithubDeliveryFailed(deliveryId, new Error("Temporary network glitch"));

		// Retry arrives from GitHub
		const retryClaim = await claimGithubDelivery(deliveryId);
		expect(retryClaim.canProcess).toBe(true);

		// Completes deployment
		await markGithubDeliveryQueued(deliveryId, ["job-recovered"]);

		const key = `webhook:github:delivery:${deliveryId}`;
		const stored = dbStore.get(key);
		const parsed = JSON.parse(stored!.value!);
		expect(parsed.state).toBe("QUEUED");
	});

	it("9. Expiration cleanup deletes expired deliveries while preserving active processing and platform settings", async () => {
		const now = Date.now();
		const oldTime = new Date(now - 25 * 60 * 60 * 1000); // 25 hours ago

		// Old completed delivery (should be deleted)
		dbStore.set("webhook:github:delivery:old-uuid", {
			id: "s1",
			key: "webhook:github:delivery:old-uuid",
			value: JSON.stringify({ state: "QUEUED", expiresAt: now - 1000 }),
			updatedAt: oldTime,
		});

		// Active processing delivery (MUST NOT be deleted)
		dbStore.set("webhook:github:delivery:active-uuid", {
			id: "s2",
			key: "webhook:github:delivery:active-uuid",
			value: JSON.stringify({ state: "PROCESSING", claimedAt: now, expiresAt: now + 86400000 }),
			updatedAt: new Date(now),
		});

		// Core platform setting (MUST NEVER be deleted)
		dbStore.set("maintenance_mode", {
			id: "s3",
			key: "maintenance_mode",
			value: "false",
			updatedAt: oldTime,
		});

		const deletedCount = await cleanupExpiredGithubDeliveries(now);
		expect(deletedCount).toBe(1);

		// Verify state of datastore
		expect(dbStore.has("webhook:github:delivery:old-uuid")).toBe(false);
		expect(dbStore.has("webhook:github:delivery:active-uuid")).toBe(true);
		expect(dbStore.has("maintenance_mode")).toBe(true);
	});
});


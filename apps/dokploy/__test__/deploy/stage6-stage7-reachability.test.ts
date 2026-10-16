import { verifyContainerReadiness } from "@dokploy/server/services/application";
import { verifyApplicationLiveUrl } from "@dokploy/server/services/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRemoteDocker: vi.fn(),
	dnsResolve: vi.fn(),
}));

vi.mock("@dokploy/server/utils/servers/remote-docker", () => ({
	getRemoteDocker: mocks.getRemoteDocker,
}));

vi.mock("node:dns", () => ({
	default: {
		resolve4: vi.fn((_host: string, cb: (err: any, ips?: string[]) => void) =>
			cb(null, ["93.184.216.34"]),
		),
		resolve6: vi.fn((_host: string, cb: (err: any, ips?: string[]) => void) =>
			cb(null, []),
		),
	},
	resolve4: vi.fn((_host: string, cb: (err: any, ips?: string[]) => void) =>
		cb(null, ["93.184.216.34"]),
	),
	resolve6: vi.fn((_host: string, cb: (err: any, ips?: string[]) => void) =>
		cb(null, []),
	),
}));

// Provide proper mock database with chainable methods
let mockAppDomains: any[] = [];
let mockApplication: any = {};

vi.mock("@dokploy/server/db", () => {
	const createChainable = (resolvedValue: any): any => {
		const chain: any = {
			set: vi.fn(() => chain),
			where: vi.fn(() => chain),
			returning: vi.fn().mockResolvedValue(resolvedValue),
			from: vi.fn(() => chain),
			innerJoin: vi.fn(() => chain),
			then: (resolve: (v: any) => void) => resolve(resolvedValue),
		};
		return chain;
	};

	return {
		db: {
			select: vi.fn(() => createChainable(mockAppDomains)),
			insert: vi.fn(() => createChainable([])),
			update: vi.fn(() => createChainable([])),
			delete: vi.fn(() => createChainable([])),
			query: {
				applications: {
					findFirst: vi.fn(() => Promise.resolve(mockApplication)),
				},
				domains: {
					findMany: vi.fn(() => Promise.resolve(mockAppDomains)),
				},
			},
		},
	};
});

describe("Stage 6 & Stage 7 Verification: Container Readiness and Public URL Reachability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApplication = {
			applicationId: "app-1",
			appName: "test-app",
			applicationStatus: "done",
			environment: {
				project: {
					organizationId: "org-1",
				},
			},
		};
		mockAppDomains = [
			{
				domainId: "d-1",
				host: "app.example.com",
				https: false,
				path: "/",
				enabled: true,
			},
		];
		mocks.dnsResolve.mockResolvedValue(["93.184.216.34"]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Stage 6: verifyContainerReadiness", () => {
		it("converges and returns running when Docker Swarm task reaches running state", async () => {
			mocks.getRemoteDocker.mockResolvedValue({
				listTasks: vi.fn().mockResolvedValue([
					{
						DesiredState: "running",
						Status: { State: "running" },
					},
				]),
			});

			const res = await verifyContainerReadiness("test-app", null, {
				timeoutMs: 1000,
				intervalMs: 10,
			});
			expect(res.status).toBe("running");
			expect((res as any).taskCount).toBe(1);
		});

		it("detects premature container exit and extracts non-zero exit code", async () => {
			mocks.getRemoteDocker.mockResolvedValue({
				listTasks: vi.fn().mockResolvedValue([
					{
						DesiredState: "running",
						Status: {
							State: "failed",
							ContainerStatus: { ExitCode: 1 },
						},
					},
				]),
			});

			const res = await verifyContainerReadiness("test-app", null, {
				timeoutMs: 1000,
				intervalMs: 10,
			});
			expect(res.status).toBe("failed");
			expect((res as any).error).toContain("Process exited with code 1");
		});

		it("bounds retries and returns actionable timeout error when tasks do not converge within deadline", async () => {
			mocks.getRemoteDocker.mockResolvedValue({
				listTasks: vi.fn().mockResolvedValue([
					{
						DesiredState: "running",
						Status: { State: "preparing" },
					},
				]),
			});

			const res = await verifyContainerReadiness("slow-app", null, {
				timeoutMs: 50,
				intervalMs: 10,
			});
			expect(res.status).toBe("failed");
			expect((res as any).error).toContain("did not reach running state within 0.05s");
		});
	});

	describe("Stage 7: verifyApplicationLiveUrl", () => {
		it("verifies live reachability when public endpoint returns HTTP 200", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
				status: 200,
				url: "http://app.example.com/",
			} as any);

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			expect(result.isLive).toBe(true);
			expect(result.checks.dnsResolves).toBe(true);
			expect(result.checks.appResponding).toBe(true);
			expect(result.statusCode).toBe(200);
			fetchSpy.mockRestore();
		});

		it("identifies HTTP 502 Bad Gateway and provides actionable upstream diagnostic", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
				status: 502,
				url: "http://app.example.com/",
			} as any);

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			expect(result.isLive).toBe(false);
			expect(result.statusCode).toBe(502);
			expect(result.details).toContain("Traefik returned HTTP 502 (Bad Gateway / Upstream Unreachable)");
			expect(result.details).toContain("Verify application upstream port");
			fetchSpy.mockRestore();
		});

		it("handles pending TLS certificate (DEPTH_ZERO_SELF_SIGNED_CERT) with HTTP fallback and diagnostic", async () => {
			mockAppDomains = [
				{
					domainId: "d-3",
					host: "app.example.com",
					https: true,
					path: "/",
					enabled: true,
				},
			];

			const tlsError = new TypeError("fetch failed");
			(tlsError as any).cause = {
				code: "DEPTH_ZERO_SELF_SIGNED_CERT",
				message: "self-signed certificate in certificate chain",
			};

			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
				if (String(url).startsWith("https://")) {
					throw tlsError;
				}
				// HTTP fallback succeeds
				return {
					status: 200,
					url: "http://app.example.com/",
				} as any;
			});

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			expect(result.isLive).toBe(true);
			expect(result.checks.appResponding).toBe(true);
			expect(result.checks.httpsActive).toBe(false);
			expect(result.message).toContain("HTTPS certificate provisioning is in progress");
			fetchSpy.mockRestore();
		});

		it("provides meaningful diagnostic for connection refused (ECONNREFUSED)", async () => {
			const connError = new TypeError("fetch failed");
			(connError as any).cause = {
				code: "ECONNREFUSED",
				message: "connect ECONNREFUSED 93.184.216.34:80",
			};

			const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(connError);

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			expect(result.isLive).toBe(false);
			expect(result.details).toContain("Connection refused (ECONNREFUSED)");
			expect(result.details).toContain("Routing layer or host port is not accepting connections");
			fetchSpy.mockRestore();
		});

		it("provides meaningful diagnostic for connection timeout (ETIMEDOUT / AbortError)", async () => {
			const timeoutError = new Error("The operation was aborted");
			timeoutError.name = "AbortError";

			const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(timeoutError);

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			expect(result.isLive).toBe(false);
			expect(result.details).toContain("Connection timed out connecting to");
			fetchSpy.mockRestore();
		});

		it("never exposes secrets, environment variables, or authorization credentials in verification results", async () => {
			mockApplication.env = "SECRET_KEY=super-secret-123\nAPI_TOKEN=tok_abc123\nDATABASE_URL=postgres://user:pass@db:5432/db";

			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
				status: 401,
				url: "http://app.example.com/",
			} as any);

			const result = await verifyApplicationLiveUrl("app-1", { maxRetries: 1 });
			const serialized = JSON.stringify(result);
			expect(serialized).not.toContain("super-secret-123");
			expect(serialized).not.toContain("tok_abc123");
			expect(serialized).not.toContain("pass@db");
			fetchSpy.mockRestore();
		});
	});
});

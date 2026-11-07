import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @dokploy/server
vi.mock("@dokploy/server", () => ({
	execAsync: vi.fn(),
	execAsyncRemote: vi.fn(),
	IS_CLOUD: false,
}));

import { execAsync, execAsyncRemote } from "@dokploy/server";
import {
	validateContainerSecurity,
	trackSessionStart,
	trackSessionEnd,
	getActiveOrgSessions,
	resetActiveSessionsForTest,
} from "../../server/wss/terminal-security";
import { getLogType } from "../../components/dashboard/docker/logs/utils";
import { PlanEntitlementService } from "../../../../packages/server/src/services/plan-entitlement";

describe("HatDot Application Terminal Security & Terminology Normalization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetActiveSessionsForTest();
	});

	describe("Terminal Security Preflight Checks (validateContainerSecurity)", () => {
		it("allows a normal, safe application container", async () => {
			const safeContainerInspect = JSON.stringify({
				Privileged: false,
				Binds: ["/var/data:/app/data"],
				NetworkMode: "bridge",
				User: "app",
				Labels: {
					"com.docker.swarm.service.name": "hatdot-app-123_web",
				},
				Name: "/hatdot-app-123-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: safeContainerInspect,
			});

			const result = await validateContainerSecurity(
				"container-123",
				"hatdot-app-123",
				null,
				false,
			);

			expect(result.allowed).toBe(true);
			expect(result.appNameMatches).toBe(true);
			expect(result.configuredUser).toBe("app");
		});

		it("rejects container running in privileged mode", async () => {
			const privilegedInspect = JSON.stringify({
				Privileged: true,
				Binds: [],
				NetworkMode: "bridge",
				User: "root",
				Labels: {
					"com.docker.swarm.service.name": "hatdot-app-123_web",
				},
				Name: "/hatdot-app-123-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: privilegedInspect,
			});

			const result = await validateContainerSecurity(
				"container-123",
				"hatdot-app-123",
				null,
				false,
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("running in privileged mode");
		});

		it("rejects container with mounted docker.sock", async () => {
			const dockerSockInspect = JSON.stringify({
				Privileged: false,
				Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
				NetworkMode: "bridge",
				User: "node",
				Labels: {
					"com.docker.compose.project": "hatdot-app-123",
				},
				Name: "/hatdot-app-123-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: dockerSockInspect,
			});

			const result = await validateContainerSecurity(
				"container-123",
				"hatdot-app-123",
				null,
				false,
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Docker socket is mounted");
		});

		it("rejects container mounting sensitive host filesystems like /etc or /root", async () => {
			const sensitiveMountInspect = JSON.stringify({
				Privileged: false,
				Binds: ["/etc:/host/etc"],
				NetworkMode: "bridge",
				User: "node",
				Labels: {
					"com.docker.compose.project": "hatdot-app-123",
				},
				Name: "/hatdot-app-123-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: sensitiveMountInspect,
			});

			const result = await validateContainerSecurity(
				"container-123",
				"hatdot-app-123",
				null,
				false,
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("Sensitive host directory (/etc)");
		});

		it("rejects container with host networking mode for customers", async () => {
			const hostNetworkInspect = JSON.stringify({
				Privileged: false,
				Binds: [],
				NetworkMode: "host",
				User: "node",
				Labels: {
					"com.docker.compose.project": "hatdot-app-123",
				},
				Name: "/hatdot-app-123-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: hostNetworkInspect,
			});

			const result = await validateContainerSecurity(
				"container-123",
				"hatdot-app-123",
				null,
				false,
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("host networking cannot be accessed");
		});

		it("rejects container if appName does not match (cross-tenant IDOR protection)", async () => {
			const mismatchedInspect = JSON.stringify({
				Privileged: false,
				Binds: [],
				NetworkMode: "bridge",
				User: "node",
				Labels: {
					"com.docker.compose.project": "foreign-tenant-app",
				},
				Name: "/foreign-tenant-app-web-1",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: mismatchedInspect,
			});

			const result = await validateContainerSecurity(
				"foreign-container-999",
				"hatdot-customer-app",
				null,
				false,
			);

			expect(result.allowed).toBe(false);
			expect(result.appNameMatches).toBe(false);
			expect(result.reason).toContain("does not belong to your authorized application");
		});

		it("allows platform administrators to bypass security restrictions for diagnostics", async () => {
			const privilegedHostSockInspect = JSON.stringify({
				Privileged: true,
				Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
				NetworkMode: "host",
				User: "root",
				Labels: {},
				Name: "/admin-debug-container",
			});

			(execAsync as any).mockResolvedValueOnce({
				stdout: privilegedHostSockInspect,
			});

			const result = await validateContainerSecurity(
				"admin-container",
				undefined,
				null,
				true, // isPlatformAdmin
			);

			expect(result.allowed).toBe(true);
			expect(result.configuredUser).toBe("root");
		});
	});

	describe("Active Session Concurrency Tracking", () => {
		it("tracks session start and end per organization", () => {
			const orgA = "org-alpha";
			const orgB = "org-beta";

			expect(getActiveOrgSessions(orgA)).toBe(0);
			expect(getActiveOrgSessions(orgB)).toBe(0);

			expect(trackSessionStart(orgA)).toBe(1);
			expect(trackSessionStart(orgA)).toBe(2);
			expect(trackSessionStart(orgB)).toBe(1);

			expect(getActiveOrgSessions(orgA)).toBe(2);
			expect(getActiveOrgSessions(orgB)).toBe(1);

			expect(trackSessionEnd(orgA)).toBe(1);
			expect(getActiveOrgSessions(orgA)).toBe(1);

			expect(trackSessionEnd(orgA)).toBe(0);
			expect(getActiveOrgSessions(orgA)).toBe(0);

			// Ending when 0 clamps at 0
			expect(trackSessionEnd(orgA)).toBe(0);
			expect(getActiveOrgSessions(orgA)).toBe(0);

			// Org B is unchanged
			expect(getActiveOrgSessions(orgB)).toBe(1);
		});
	});

	describe("Log Classification Hardening", () => {
		it("classifies spawn xdg-open ENOENT as warning instead of error", () => {
			const xdgOpenLog = "Error: spawn xdg-open ENOENT";
			const result = getLogType(xdgOpenLog);
			expect(result.type).toBe("warning");
		});

		it("classifies xdg-open not found as warning", () => {
			const xdgNotFoundLog = "/bin/sh: line 1: xdg-open: not found";
			const result = getLogType(xdgNotFoundLog);
			expect(result.type).toBe("warning");
		});

		it("classifies failed to open browser as warning", () => {
			const browserWarning = "Failed to open browser in headless container environment";
			const result = getLogType(browserWarning);
			expect(result.type).toBe("warning");
		});

		it("preserves fatal application crash as error", () => {
			const crashLog = "Fatal error: Uncaught exception in main handler";
			const result = getLogType(crashLog);
			expect(result.type).toBe("error");
		});
	});

	describe("Plan Entitlement Terminal Gating", () => {
		it("mentions application terminals when denying terminal access", async () => {
			const mockExecutor = {
				query: {
					user: { findFirst: vi.fn().mockResolvedValue(null) },
					organization: { findFirst: vi.fn().mockResolvedValue(null) },
				},
			};

			const activeSpy = vi
				.spyOn(PlanEntitlementService, "checkSubscriptionActive")
				.mockResolvedValueOnce({ allowed: true });

			const snapshotSpy = vi
				.spyOn(PlanEntitlementService, "getPlanSnapshot")
				.mockResolvedValueOnce({
					plan: "hobby",
					status: "active",
					maxConcurrentDeployments: 1,
					maxApplications: 2,
					maxDatabases: 1,
					maxDomains: 2,
					maxCpuCores: 1,
					maxRamMb: 1024,
					maxStorageGb: 10,
					maxBandwidthGbPerMonth: 50,
					features: {
						docker_access: false,
						terminal: false,
						web_terminal: false,
						terminal_access: false,
						advanced_cluster: false,
					},
				} as any);

			const result = await PlanEntitlementService.checkCanUseTerminal(
				"org-hobby",
				mockExecutor,
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("upgrade to access application terminals");

			activeSpy.mockRestore();
			snapshotSpy.mockRestore();
		});
	});
});


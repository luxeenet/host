import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the permission + server helpers the wss authorizer composes.
const mockHasPermission = vi.hoisted(() => vi.fn());
const mockFindMember = vi.hoisted(() => vi.fn());
const mockCheckServiceAccess = vi.hoisted(() => vi.fn());
vi.mock("@dokploy/server/services/permission", () => ({
	hasPermission: mockHasPermission,
	findMemberByUserId: mockFindMember,
	checkServiceAccess: mockCheckServiceAccess,
}));

const mockGetAccessibleServerIds = vi.hoisted(() => vi.fn());
const mockIsCloud = vi.hoisted(() => ({ value: true }));
vi.mock("@dokploy/server", () => ({
	getAccessibleServerIds: mockGetAccessibleServerIds,
	get IS_CLOUD() {
		return mockIsCloud.value;
	},
}));

const mockPlanCheckCanUseTerminal = vi.hoisted(() => vi.fn());
vi.mock("@dokploy/server/services/plan-entitlement", () => ({
	PlanEntitlementService: {
		checkCanUseTerminal: mockPlanCheckCanUseTerminal,
	},
}));

import {
	canAccessDockerOverWss,
	canAccessTerminalOverWss,
} from "@/server/wss/authorize";

const USER = { id: "user-1", isPlatformAdmin: false };
const ADMIN_USER = { id: "admin-1", isPlatformAdmin: true };
const SESSION = { activeOrganizationId: "org-1" };

beforeEach(() => {
	vi.clearAllMocks();
	mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: true });
});

describe("canAccessDockerOverWss", () => {
	it("denies when there is no user or session", async () => {
		expect(await canAccessDockerOverWss(null, SESSION)).toBe(false);
		expect(await canAccessDockerOverWss(USER, null)).toBe(false);
	});

	it("denies a member without docker permission for generic docker access", async () => {
		mockHasPermission.mockResolvedValue(false);
		expect(await canAccessDockerOverWss(USER, SESSION)).toBe(false);
	});

	it("denies generic host docker access to normal customer in cloud mode", async () => {
		mockIsCloud.value = true;
		mockHasPermission.mockResolvedValue(true);
		expect(await canAccessDockerOverWss(USER, SESSION)).toBe(false);
	});

	it("allows generic host docker access to platform admin in cloud mode", async () => {
		mockIsCloud.value = true;
		mockHasPermission.mockResolvedValue(true);
		expect(await canAccessDockerOverWss(ADMIN_USER, SESSION)).toBe(true);
	});

	it("allows generic host docker access in self-hosted mode when caller has docker permission", async () => {
		mockIsCloud.value = false;
		mockHasPermission.mockResolvedValue(true);
		expect(await canAccessDockerOverWss(USER, SESSION)).toBe(true);
		mockIsCloud.value = true;
	});

	it("denies a remote server the caller cannot access, even with docker permission", async () => {
		mockHasPermission.mockResolvedValue(true);
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["other-server"]));
		expect(await canAccessDockerOverWss(USER, SESSION, "srv-1")).toBe(false);
	});

	it("allows a remote server the caller can access", async () => {
		mockHasPermission.mockResolvedValue(true);
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["srv-1"]));
		expect(await canAccessDockerOverWss(USER, SESSION, "srv-1")).toBe(true);
	});

	it("denies when the container belongs to a service the caller cannot access", async () => {
		mockCheckServiceAccess.mockRejectedValue(new Error("no access"));
		expect(await canAccessDockerOverWss(USER, SESSION, null, "svc-1")).toBe(
			false,
		);
	});

	it("allows customer service container access when plan entitles terminal and user has service access", async () => {
		mockCheckServiceAccess.mockResolvedValue(undefined);
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: true });

		expect(
			await canAccessDockerOverWss(USER, SESSION, null, "svc-customer-1"),
		).toBe(true);
	});

	it("denies customer service container access when plan does not entitle terminal", async () => {
		mockCheckServiceAccess.mockResolvedValue(undefined);
		mockPlanCheckCanUseTerminal.mockResolvedValue({
			allowed: false,
			reason: "Terminal access is not included in your current plan",
		});

		expect(
			await canAccessDockerOverWss(USER, SESSION, null, "svc-customer-1"),
		).toBe(false);
	});

	it("allows system admin to access service container even if plan check fails", async () => {
		mockCheckServiceAccess.mockResolvedValue(undefined);
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: false });

		expect(
			await canAccessDockerOverWss(ADMIN_USER, SESSION, null, "svc-customer-1"),
		).toBe(true);
	});
});

describe("canAccessTerminalOverWss", () => {
	it("Cloud mode: denies local host terminal to org owner or admin who is not platform admin", async () => {
		mockIsCloud.value = true;
		mockFindMember.mockResolvedValue({ role: "owner" });
		expect(await canAccessTerminalOverWss(USER, SESSION, "local")).toBe(false);

		mockFindMember.mockResolvedValue({ role: "admin" });
		expect(await canAccessTerminalOverWss(USER, SESSION, "local")).toBe(false);
	});

	it("Cloud mode: allows local host terminal to platform admin", async () => {
		mockIsCloud.value = true;
		expect(await canAccessTerminalOverWss(ADMIN_USER, SESSION, "local")).toBe(true);
	});

	it("Self-hosted mode: allows local host terminal to org owner or admin", async () => {
		mockIsCloud.value = false;
		mockFindMember.mockResolvedValue({ role: "owner" });
		expect(await canAccessTerminalOverWss(USER, SESSION, "local")).toBe(true);

		mockFindMember.mockResolvedValue({ role: "admin" });
		expect(await canAccessTerminalOverWss(USER, SESSION, "local")).toBe(true);

		mockFindMember.mockResolvedValue({ role: "member" });
		expect(await canAccessTerminalOverWss(USER, SESSION, "local")).toBe(false);
		mockIsCloud.value = true;
	});

	it("gates a remote server terminal on server access and plan entitlement", async () => {
		mockHasPermission.mockResolvedValue(true);
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["srv-1"]));
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: true });

		expect(await canAccessTerminalOverWss(USER, SESSION, "srv-1")).toBe(true);
		expect(await canAccessTerminalOverWss(USER, SESSION, "srv-2")).toBe(false);
	});

	it("denies remote server terminal when plan lacks terminal entitlement", async () => {
		mockHasPermission.mockResolvedValue(true);
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["srv-1"]));
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: false });

		expect(await canAccessTerminalOverWss(USER, SESSION, "srv-1")).toBe(false);
	});

	it("denies a remote server terminal without the server.terminal permission", async () => {
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["srv-1"]));
		mockHasPermission.mockResolvedValue(false);
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: true });

		expect(await canAccessTerminalOverWss(USER, SESSION, "srv-1")).toBe(false);
		expect(mockHasPermission).toHaveBeenCalledWith(
			{ user: { id: USER.id }, session: { activeOrganizationId: "org-1" } },
			{ server: ["terminal"] },
		);
	});

	it("allows a remote server terminal with the server.terminal permission and plan entitlement", async () => {
		mockGetAccessibleServerIds.mockResolvedValue(new Set(["srv-1"]));
		mockHasPermission.mockResolvedValue(true);
		mockPlanCheckCanUseTerminal.mockResolvedValue({ allowed: true });

		expect(await canAccessTerminalOverWss(USER, SESSION, "srv-1")).toBe(true);
	});
});


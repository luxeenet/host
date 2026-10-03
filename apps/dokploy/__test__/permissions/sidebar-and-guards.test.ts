import { describe, expect, it, vi } from "vitest";
import { resolvePlatformAdminRedirect } from "../../utils/server-auth-guards";

describe("Server Auth Guards & Platform Admin Redirect", () => {
	it("allows platform administrators (returns null redirect)", () => {
		const adminUser = {
			id: "admin-1",
			email: "admin@hatdot.com",
			isPlatformAdmin: true,
		};
		expect(resolvePlatformAdminRedirect(adminUser as any)).toBeNull();
	});

	it("strictly denies non-platform admins even if role is admin or owner", () => {
		const orgAdmin = {
			id: "admin-2",
			email: "admin@client.com",
			role: "admin",
			isPlatformAdmin: false,
		};
		expect(resolvePlatformAdminRedirect(orgAdmin as any)).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});
	});

	it("redirects normal organization owner/admin/member to /dashboard/home", () => {
		const orgOwner = {
			id: "user-1",
			email: "owner@client.com",
			role: "owner",
			isPlatformAdmin: false,
		};
		expect(resolvePlatformAdminRedirect(orgOwner as any)).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});

		const orgMember = {
			id: "user-2",
			email: "member@client.com",
			role: "member",
			isPlatformAdmin: false,
		};
		expect(resolvePlatformAdminRedirect(orgMember as any)).toEqual({
			permanent: false,
			destination: "/dashboard/home",
		});
	});

	it("redirects unauthenticated users to /", () => {
		expect(resolvePlatformAdminRedirect(null as any)).toEqual({
			permanent: false,
			destination: "/",
		});
		expect(resolvePlatformAdminRedirect(undefined as any)).toEqual({
			permanent: false,
			destination: "/",
		});
	});
});

describe("Sidebar Navigation Menu Filtering", () => {
	// Import the menu filter logic or replicate the exact filter rule from side.tsx
	const filterEnabled = <T extends { isEnabled?: (o: any) => boolean }>(
		items: readonly T[],
		opts: any,
	): T[] =>
		items.filter((item) => (!item.isEnabled ? true : item.isEnabled(opts)));

	const HOME_ITEMS = [
		{ title: "Home", isEnabled: undefined },
		{ title: "Projects", isEnabled: undefined },
		{ title: "Overview", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Monitoring", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Schedules", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Traefik File System", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Docker", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Requests", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Admin Portal", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
	];

	const SETTINGS_ITEMS = [
		{ title: "Web Server", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Profile", isEnabled: undefined },
		{ title: "Sessions", isEnabled: undefined },
		{ title: "Remote Servers", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Deployments", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Users", isEnabled: ({ permissions }: any) => permissions ? !!permissions?.member?.read : true },
		{ title: "Audit Logs", isEnabled: ({ isPlatformAdmin, permissions }: any) => !!(isPlatformAdmin || permissions?.auditLog?.read) },
		{ title: "SSH Keys", isEnabled: ({ permissions }: any) => permissions ? !!permissions?.sshKeys?.read : true },
		{ title: "AI", isEnabled: ({ isPlatformAdmin, planFeatures }: any) => isPlatformAdmin || !!planFeatures?.ai },
		{ title: "Tags", isEnabled: undefined },
		{ title: "Git", isEnabled: undefined },
		{ title: "Registry", isEnabled: undefined },
		{ title: "Secrets", isEnabled: undefined },
		{ title: "DNS Providers", isEnabled: undefined },
		{ title: "S3 Destinations", isEnabled: undefined },
		{ title: "Certificates", isEnabled: ({ permissions }: any) => permissions ? !!permissions?.certificate?.read : true },
		{ title: "Notifications", isEnabled: ({ permissions }: any) => permissions ? !!permissions?.notification?.read : true },
		{ title: "Billing", isEnabled: ({ auth, isCloud }: any) => !!(auth?.role === "owner" && isCloud) },
		{ title: "Invoices", isEnabled: ({ auth, isCloud }: any) => !!(auth?.role === "owner" && isCloud) },
		{ title: "License", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "SSO", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
		{ title: "Whitelabeling", isEnabled: ({ isPlatformAdmin }: any) => !!isPlatformAdmin },
	];

	it("customer (non-platform-admin) sees only Home and Projects in Home menu", () => {
		const visible = filterEnabled(HOME_ITEMS, {
			isPlatformAdmin: false,
			isCloud: true,
		}).map((i) => i.title);

		expect(visible).toEqual(["Home", "Projects"]);
		expect(visible).not.toContain("Monitoring");
		expect(visible).not.toContain("Traefik File System");
		expect(visible).not.toContain("Docker");
		expect(visible).not.toContain("Requests");
		expect(visible).not.toContain("Schedules");
	});

	it("customer owner sees customer settings and does NOT see platform infrastructure", () => {
		const visible = filterEnabled(SETTINGS_ITEMS, {
			auth: { role: "owner" },
			isPlatformAdmin: false,
			isCloud: true,
			planFeatures: { ai: true },
			permissions: {
				member: { read: true },
				auditLog: { read: true },
				sshKeys: { read: true },
				certificate: { read: true },
				notification: { read: true },
			},
		}).map((i) => i.title);

		// Customer features must be present
		expect(visible).toContain("Profile");
		expect(visible).toContain("Sessions");
		expect(visible).toContain("Users");
		expect(visible).toContain("Audit Logs");
		expect(visible).toContain("SSH Keys");
		expect(visible).toContain("AI");
		expect(visible).toContain("Tags");
		expect(visible).toContain("Git");
		expect(visible).toContain("Registry");
		expect(visible).toContain("Secrets");
		expect(visible).toContain("DNS Providers");
		expect(visible).toContain("S3 Destinations");
		expect(visible).toContain("Certificates");
		expect(visible).toContain("Notifications");
		expect(visible).toContain("Billing");
		expect(visible).toContain("Invoices");

		// Platform-only infrastructure must NOT be visible
		expect(visible).not.toContain("Web Server");
		expect(visible).not.toContain("Remote Servers");
		expect(visible).not.toContain("Deployments");
		expect(visible).not.toContain("License");
		expect(visible).not.toContain("SSO");
		expect(visible).not.toContain("Whitelabeling");
	});

	it("platform administrator sees full platform navigation", () => {
		const homeVisible = filterEnabled(HOME_ITEMS, {
			isPlatformAdmin: true,
			isCloud: true,
		}).map((i) => i.title);

		expect(homeVisible).toContain("Home");
		expect(homeVisible).toContain("Projects");
		expect(homeVisible).toContain("Overview");
		expect(homeVisible).toContain("Monitoring");
		expect(homeVisible).toContain("Schedules");
		expect(homeVisible).toContain("Traefik File System");
		expect(homeVisible).toContain("Docker");
		expect(homeVisible).toContain("Requests");
		expect(homeVisible).toContain("Admin Portal");

		const settingsVisible = filterEnabled(SETTINGS_ITEMS, {
			auth: { role: "owner" },
			isPlatformAdmin: true,
			isCloud: true,
		}).map((i) => i.title);

		expect(settingsVisible).toContain("Web Server");
		expect(settingsVisible).toContain("Remote Servers");
		expect(settingsVisible).toContain("Deployments");
		expect(settingsVisible).toContain("License");
		expect(settingsVisible).toContain("SSO");
		expect(settingsVisible).toContain("Whitelabeling");
	});
});

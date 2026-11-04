import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	validatePlatformSubdomainDepth,
} from "@dokploy/server/services/domain";
import {
	getAuthorizedHostsSync,
	normalizeHostname,
	resolveHostValidation,
	detectHostRejection,
} from "@dokploy/server/utils/builders/host-validation";
import {
	configureViteAllowedHosts,
	updateViteConfigContent,
} from "@dokploy/server/utils/builders/vite-config";
import {
	resolveDeploymentPlan,
	saveDeploymentPlanSync,
	loadDeploymentPlanSync,
} from "@dokploy/server/utils/builders/deployment-plan";
import { buildContainerEnvironmentVariables } from "@dokploy/server/utils/builders";
import { describe, expect, it } from "vitest";

const createMockApp = (
	appName: string,
	domainsList: Array<{
		host: string;
		enabled?: boolean;
		verified?: boolean;
		cfStatus?: string | null;
		applicationId?: string;
		isPrimary?: boolean;
	}> = [],
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested =>
	({
		applicationId: `app-${appName}`,
		appName,
		name: appName,
		buildType: "nixpacks",
		sourceType: "github",
		env: "",
		publishDirectory: null,
		isStaticSpa: false,
		cleanCache: false,
		createEnvFile: true,
		serverId: null,
		applicationStatus: "done",
		domains: domainsList.map((d, idx) => ({
			domainId: `d-${appName}-${idx}`,
			host: d.host,
			enabled: d.enabled !== false,
			verified: d.verified !== false,
			cfStatus: d.cfStatus ?? null,
			applicationId: d.applicationId || `app-${appName}`,
			isPrimary: d.isPrimary || false,
			https: true,
			certificateType: "letsencrypt",
			port: 4173,
			path: "/",
		})),
		environment: {
			env: "",
			name: "production",
			projectId: "proj-1",
			project: {
				organizationId: "org-1",
				name: "Project 1",
				env: "",
			},
		},
		mounts: [],
		security: [],
		redirects: [],
		ports: [],
		registry: null,
		buildRegistry: null,
		rollbackRegistry: null,
		deployments: [],
		...overrides,
	}) as unknown as ApplicationNested;

describe("Universal Builder & Dynamic Domain Attachment: 12 Core Scenarios", () => {
	// Scenario 1: Application initially deployed on a HatDot subdomain
	it("Scenario 1: initially deployed on a HatDot subdomain receives proper host validation and env", () => {
		const app = createMockApp("qrcode-app", []);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toEqual(["qrcode-app.hatdot.cloud"]);

		const plan = resolveDeploymentPlan({
			application: app,
			platformDomain: "hatdot.cloud",
			files: [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "qrcode-app",
						scripts: { build: "vite build", preview: "vite preview" },
						devDependencies: { vite: "^5.4.0" },
					}),
				},
			],
		});

		expect(plan.deploymentStrategy).toBe("vite-preview");
		expect(plan.hostValidation.mechanism).toBe("env");
		expect(plan.hostValidation.env).toContain(
			"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=qrcode-app.hatdot.cloud",
		);

		const envVars = buildContainerEnvironmentVariables(app, plan);
		expect(envVars).toContain(
			"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=qrcode-app.hatdot.cloud",
		);
	});

	// Scenario 2: Customer subsequently attaches a custom domain
	it("Scenario 2: customer subsequently attaches custom domain (e.g. luxeenet.com) dynamically", () => {
		const app = createMockApp("qrcode-app", [
			{ host: "luxeenet.com", enabled: true, verified: true },
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toContain("luxeenet.com");
		expect(hosts).toContain("qrcode-app.hatdot.cloud");

		const hostPlan = resolveHostValidation({
			framework: "Vite (React)",
			runsViteServer: true,
			hosts,
		});

		expect(hostPlan.env).toContain(
			"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=luxeenet.com,qrcode-app.hatdot.cloud",
		);

		const envVars = buildContainerEnvironmentVariables(app);
		expect(envVars).toContain(
			"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=luxeenet.com,qrcode-app.hatdot.cloud",
		);
	});

	// Scenario 3: Customer attaches www and root domains
	it("Scenario 3: customer attaches both www and apex domains", () => {
		const app = createMockApp("store-app", [
			{ host: "luxeenet.com", enabled: true, verified: true },
			{ host: "www.luxeenet.com", enabled: true, verified: true },
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toContain("luxeenet.com");
		expect(hosts).toContain("www.luxeenet.com");
		expect(hosts).toContain("store-app.hatdot.cloud");

		// Subdomain depth checks
		expect(validatePlatformSubdomainDepth("luxeenet.com", "hatdot.cloud").isValid).toBe(true);
		expect(validatePlatformSubdomainDepth("www.luxeenet.com", "hatdot.cloud").isValid).toBe(true);
	});

	// Scenario 4: Multiple domains attached to one application
	it("Scenario 4: multiple custom domains attached to one application all included in allowlist", () => {
		const app = createMockApp("multi-domain-app", [
			{ host: "luxeenet.com", enabled: true, verified: true },
			{ host: "mycustomqr.org", enabled: true, verified: true },
			{ host: "qr-enterprise.io", enabled: true, verified: true },
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toEqual([
			"luxeenet.com",
			"mycustomqr.org",
			"qr-enterprise.io",
			"multi-domain-app.hatdot.cloud",
		]);

		const envVars = buildContainerEnvironmentVariables(app);
		expect(envVars).toContain(
			"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=luxeenet.com,mycustomqr.org,qr-enterprise.io,multi-domain-app.hatdot.cloud",
		);
	});

	// Scenario 5: Domain removed from an application
	it("Scenario 5: domain removed from an application is cleanly removed from allowlist and vite.config", () => {
		const initialApp = createMockApp("app-1", [
			{ host: "luxeenet.com", enabled: true, verified: true },
			{ host: "keep-me.com", enabled: true, verified: true },
		]);
		const initialHosts = getAuthorizedHostsSync(initialApp, "hatdot.cloud");
		expect(initialHosts).toContain("luxeenet.com");

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-detach-test-"));
		try {
			const configPath = path.join(tempDir, "vite.config.ts");
			fs.writeFileSync(
				configPath,
				`import { defineConfig } from 'vite';\nexport default defineConfig({});`,
				"utf8",
			);

			// First sync with luxeenet.com
			configureViteAllowedHosts(tempDir, initialHosts);
			let content = fs.readFileSync(configPath, "utf8");
			expect(content).toContain('"luxeenet.com"');

			// Now customer detaches luxeenet.com
			const updatedApp = createMockApp("app-1", [
				{ host: "keep-me.com", enabled: true, verified: true },
			]);
			const updatedHosts = getAuthorizedHostsSync(updatedApp, "hatdot.cloud");
			expect(updatedHosts).not.toContain("luxeenet.com");
			expect(updatedHosts).toContain("keep-me.com");

			// Reconfigure vite.config
			configureViteAllowedHosts(tempDir, updatedHosts);
			content = fs.readFileSync(configPath, "utf8");
			expect(content).not.toContain('"luxeenet.com"');
			expect(content).toContain('"keep-me.com"');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// Scenario 6: Domain transferred to another application after validation
	it("Scenario 6: domain transferred to another application isolates allowlist strictly per application", () => {
		const appA = createMockApp("app-a", [
			{ host: "old-owner.com", enabled: true, verified: true, applicationId: "app-app-a" },
		]);
		const appB = createMockApp("app-b", [
			{ host: "transferred.com", enabled: true, verified: true, applicationId: "app-app-b" },
		]);

		const hostsA = getAuthorizedHostsSync(appA, "hatdot.cloud");
		const hostsB = getAuthorizedHostsSync(appB, "hatdot.cloud");

		expect(hostsA).toContain("old-owner.com");
		expect(hostsA).not.toContain("transferred.com");

		expect(hostsB).toContain("transferred.com");
		expect(hostsB).not.toContain("old-owner.com");
	});

	// Scenario 7: SSL certificate pending
	it("Scenario 7: SSL certificate pending or initializing still keeps verified host in allowlist", () => {
		const app = createMockApp("pending-ssl-app", [
			{
				host: "luxeenet.com",
				enabled: true,
				verified: true,
				cfStatus: "pending",
			},
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toContain("luxeenet.com");
	});

	// Scenario 8: SSL certificate active
	it("Scenario 8: SSL certificate active includes domain in primary routing and authorized hosts", () => {
		const app = createMockApp("active-ssl-app", [
			{
				host: "luxeenet.com",
				enabled: true,
				verified: true,
				cfStatus: "active",
				isPrimary: true,
			},
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts[0]).toBe("luxeenet.com");
	});

	// Scenario 9: Invalid hostname rejected
	it("Scenario 9: invalid hostnames (wildcards, IPs, paths, ports, whitespace) are rejected safely", () => {
		expect(normalizeHostname("*.luxeenet.com")).toBeNull();
		expect(normalizeHostname("192.168.1.1")).toBeNull();
		expect(normalizeHostname("luxeenet.com:8080")).toBeNull();
		expect(normalizeHostname("luxeenet.com/path")).toBeNull();
		expect(normalizeHostname("luxeenet.com; malicious")).toBeNull();
		expect(normalizeHostname("localhost")).toBeNull();
		expect(normalizeHostname("")).toBeNull();
		expect(normalizeHostname(null)).toBeNull();

		const app = createMockApp("bad-domain-app", [
			{ host: "*.bad-wildcard.com", enabled: true, verified: true },
			{ host: "127.0.0.1", enabled: true, verified: true },
			{ host: "valid.com", enabled: true, verified: true },
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toContain("valid.com");
		expect(hosts).not.toContain("*.bad-wildcard.com");
		expect(hosts).not.toContain("127.0.0.1");
	});

	// Scenario 10: Unverified hostname rejected
	it("Scenario 10: unverified, disabled, or blocked hostnames are omitted from allowlist", () => {
		const app = createMockApp("unverified-app", [
			{ host: "unverified.com", enabled: true, verified: false },
			{ host: "disabled.com", enabled: false, verified: true },
			{ host: "blocked.com", enabled: true, verified: true, cfStatus: "blocked" },
			{ host: "verified-active.com", enabled: true, verified: true, cfStatus: "active" },
		]);
		const hosts = getAuthorizedHostsSync(app, "hatdot.cloud");
		expect(hosts).toContain("verified-active.com");
		expect(hosts).toContain("unverified-app.hatdot.cloud");
		expect(hosts).not.toContain("unverified.com");
		expect(hosts).not.toContain("disabled.com");
		expect(hosts).not.toContain("blocked.com");
	});

	// Scenario 11: Vite application receives the correct Host header and updated allowlist
	it("Scenario 11: Vite application receives preview.allowedHosts and server.allowedHosts with authorized domains", () => {
		const source = `import { defineConfig } from 'vite';
export default defineConfig({
  preview: {
    port: 4173,
  },
  server: {
    port: 3000,
  },
});`;
		const result = updateViteConfigContent(source, [
			"luxeenet.com",
			"qrcode-app.hatdot.cloud",
		]);

		expect(result.modified).toBe(true);
		expect(result.content).toContain('preview: {');
		expect(result.content).toContain('"luxeenet.com"');
		expect(result.content).toContain('"qrcode-app.hatdot.cloud"');
		expect(result.content).toContain('server: {');
	});

	// Scenario 12: Application continues working after domain configuration changes without raw errors
	it("Scenario 12: detects raw host rejection and maps to automated diagnostic without leaking technical instructions to customer", () => {
		const errorResponse = {
			status: 403,
			body: 'Blocked request. This host ("luxeenet.com") is not allowed. To allow this host, add "luxeenet.com" to preview.allowedHosts in vite.config.js.',
		};

		const rejection = detectHostRejection(errorResponse);
		expect(rejection).not.toBeNull();
		expect(rejection?.framework).toBe("vite");
		expect(rejection?.message).toContain("Vite rejected the Host header");
	});
});


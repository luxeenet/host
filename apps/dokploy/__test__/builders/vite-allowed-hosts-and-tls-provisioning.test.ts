import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	validatePlatformSubdomainDepth,
} from "@dokploy/server/services/domain";
import {
	configureViteAllowedHosts,
	getAuthorizedHostsSync,
	updateViteConfigContent,
} from "@dokploy/server/utils/builders/vite-config";
import { createRouterConfig } from "@dokploy/server/utils/traefik/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Universal Deployment Engine: Vite allowedHosts Automation", () => {
	it("injects allowedHosts into standard vite.config.ts with defineConfig", () => {
		const source = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`;
		const result = updateViteConfigContent(source, [
			"haly-myapp-a27eec.hatdot.cloud",
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain('preview: {');
		expect(result.content).toContain('"haly-myapp-a27eec.hatdot.cloud"');
		expect(result.content).toContain('server: {');
		expect(result.content).toContain("plugins: [react()]"); // Preserves plugins
	});

	it("injects allowedHosts into arrow function defineConfig in vite.config.ts", () => {
		const source = `import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/app/' : '/',
}));`;
		const result = updateViteConfigContent(source, [
			"butax-qrcode-pukssj.hatdot.cloud",
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain('"butax-qrcode-pukssj.hatdot.cloud"');
		expect(result.content).toContain("base: mode === 'production' ? '/app/' : '/'");
	});

	it("injects allowedHosts into existing preview block without allowedHosts", () => {
		const source = `import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
});`;
		const result = updateViteConfigContent(source, [
			"haly-myapp-a27eec.hatdot.cloud",
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain('port: 4173');
		expect(result.content).toContain('host: \'0.0.0.0\'');
		expect(result.content).toContain('allowedHosts: ["haly-myapp-a27eec.hatdot.cloud"]');
	});

	it("preserves existing user allowedHosts array and appends authorized hostnames without duplicates", () => {
		const source = `import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    allowedHosts: ['internal.local', 'staging.company.com'],
  },
});`;
		const result = updateViteConfigContent(source, [
			"staging.company.com", // existing, should not duplicate
			"haly-myapp-a27eec.hatdot.cloud", // new
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain("'internal.local'");
		expect(result.content).toContain("'staging.company.com'");
		expect(result.content).toContain('"haly-myapp-a27eec.hatdot.cloud"');
		expect(result.addedHosts).toEqual(["haly-myapp-a27eec.hatdot.cloud"]);
	});

	it("respects customer's intentional allowedHosts: true without overwriting", () => {
		const source = `import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    allowedHosts: true,
  },
});`;
		const result = updateViteConfigContent(source, [
			"haly-myapp-a27eec.hatdot.cloud",
		]);
		expect(result.modified).toBe(false);
		expect(result.content).toBe(source);
		expect(result.addedHosts).toHaveLength(0);
	});

	it("supports CommonJS module.exports in vite.config.cjs", () => {
		const source = `const react = require('@vitejs/plugin-react');

module.exports = {
  plugins: [react()],
};`;
		const result = updateViteConfigContent(source, [
			"haly-myapp-a27eec.hatdot.cloud",
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain('"haly-myapp-a27eec.hatdot.cloud"');
		expect(result.content).toContain("plugins: [react()]");
	});

	it("supports ESM export default object in vite.config.js", () => {
		const source = `export default {
  build: {
    outDir: 'dist',
  },
};`;
		const result = updateViteConfigContent(source, [
			"haly-myapp-a27eec.hatdot.cloud",
		]);
		expect(result.modified).toBe(true);
		expect(result.content).toContain('"haly-myapp-a27eec.hatdot.cloud"');
		expect(result.content).toContain("outDir: 'dist'");
	});

	it("rejects localhost and 127.0.0.1 from clean hosts", () => {
		const source = `export default defineConfig({});`;
		const result = updateViteConfigContent(source, [
			"localhost",
			"127.0.0.1",
			"0.0.0.0",
		]);
		expect(result.modified).toBe(false);
	});

	it("creates backup file and modifies vite.config.ts in filesystem", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-test-"));
		try {
			const configPath = path.join(tempDir, "vite.config.ts");
			const originalContent = `import { defineConfig } from 'vite';\nexport default defineConfig({});`;
			fs.writeFileSync(configPath, originalContent, "utf8");

			const res = configureViteAllowedHosts(tempDir, [
				"haly-myapp-a27eec.hatdot.cloud",
			]);
			expect(res.success).toBe(true);
			expect(res.modified).toBe(true);
			expect(res.file).toBe("vite.config.ts");

			// Backup exists and matches original
			const backupPath = `${configPath}.hatdot-backup`;
			expect(fs.existsSync(backupPath)).toBe(true);
			expect(fs.readFileSync(backupPath, "utf8")).toBe(originalContent);

			// Modified config contains allowedHosts
			const modifiedContent = fs.readFileSync(configPath, "utf8");
			expect(modifiedContent).toContain('"haly-myapp-a27eec.hatdot.cloud"');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("auto-generates vite.config.mjs when package.json has vite dependency and no config exists", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-gen-test-"));
		try {
			const pkgPath = path.join(tempDir, "package.json");
			fs.writeFileSync(
				pkgPath,
				JSON.stringify({
					name: "test-vite-app",
					devDependencies: { vite: "^5.4.0" },
				}),
				"utf8",
			);

			const res = configureViteAllowedHosts(tempDir, [
				"butax-qrcode-pukssj.hatdot.cloud",
			]);
			expect(res.success).toBe(true);
			expect(res.created).toBe(true);
			expect(res.file).toBe("vite.config.mjs");

			const createdConfig = path.join(tempDir, "vite.config.mjs");
			expect(fs.existsSync(createdConfig)).toBe(true);
			const content = fs.readFileSync(createdConfig, "utf8");
			expect(content).toContain('"butax-qrcode-pukssj.hatdot.cloud"');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

describe("Universal Deployment Engine: Multi-Tenant Host Isolation", () => {
	it("isolates authorized hosts strictly to the specific application", () => {
		const tenantA_App: any = {
			appName: "haly-myapp-a27eec",
			domains: [
				{ host: "custom-a.com", enabled: true },
				{ host: "disabled.com", enabled: false },
			],
		};
		const tenantB_App: any = {
			appName: "butax-qrcode-pukssj",
			domains: [{ host: "custom-b.org", enabled: true }],
		};

		const hostsA = getAuthorizedHostsSync(tenantA_App, "hatdot.cloud");
		const hostsB = getAuthorizedHostsSync(tenantB_App, "hatdot.cloud");

		// Tenant A checks
		expect(hostsA).toContain("haly-myapp-a27eec.hatdot.cloud");
		expect(hostsA).toContain("custom-a.com");
		expect(hostsA).not.toContain("disabled.com");
		expect(hostsA).not.toContain("butax-qrcode-pukssj.hatdot.cloud");
		expect(hostsA).not.toContain("custom-b.org");

		// Tenant B checks
		expect(hostsB).toContain("butax-qrcode-pukssj.hatdot.cloud");
		expect(hostsB).toContain("custom-b.org");
		expect(hostsB).not.toContain("haly-myapp-a27eec.hatdot.cloud");
		expect(hostsB).not.toContain("custom-a.com");
	});
});

describe("Universal Deployment Engine: TLS & Subdomain Depth Verification", () => {
	it("accepts valid single-level platform subdomains covered by *.hatdot.cloud wildcard", () => {
		const check1 = validatePlatformSubdomainDepth(
			"haly-myapp-a27eec.hatdot.cloud",
			"hatdot.cloud",
		);
		expect(check1.isValid).toBe(true);

		const check2 = validatePlatformSubdomainDepth(
			"butax-qrcode-pukssj.hatdot.cloud",
			"hatdot.cloud",
		);
		expect(check2.isValid).toBe(true);
	});

	it("rejects nested multi-level platform subdomains (e.g. www.<app>.hatdot.cloud) that cause NET::ERR_CERT_AUTHORITY_INVALID", () => {
		const check1 = validatePlatformSubdomainDepth(
			"www.haly-myapp-a27eec.hatdot.cloud",
			"hatdot.cloud",
		);
		expect(check1.isValid).toBe(false);
		expect(check1.error).toContain("wildcard certificate");
		expect(check1.error).toContain("NET::ERR_CERT_AUTHORITY_INVALID");
		expect(check1.error).toContain("haly-myapp-a27eec.hatdot.cloud");

		const check2 = validatePlatformSubdomainDepth(
			"www.butax-qrcode-pukssj.hatdot.cloud",
			"hatdot.cloud",
		);
		expect(check2.isValid).toBe(false);
		expect(check2.error).toContain("wildcard certificate");
	});

	it("allows custom domains with www (e.g. www.example.com) because Let's Encrypt issues per-domain certs", () => {
		const checkApex = validatePlatformSubdomainDepth(
			"example.com",
			"hatdot.cloud",
		);
		expect(checkApex.isValid).toBe(true);

		const checkWww = validatePlatformSubdomainDepth(
			"www.example.com",
			"hatdot.cloud",
		);
		expect(checkWww.isValid).toBe(true);
	});
});

describe("Universal Deployment Engine: Traefik Router TLS Configuration", () => {
	const mockApp: any = {
		appName: "test-app",
		redirects: [],
		security: [],
	};

	const createMockDomain = (overrides: Partial<Domain> = {}): Domain => ({
		domainId: "domain-1",
		host: "haly-myapp-a27eec.hatdot.cloud",
		https: true,
		port: 4173,
		path: null,
		serviceName: "app-service",
		domainType: "application",
		uniqueConfigKey: 1,
		createdAt: new Date().toISOString(),
		composeId: null,
		customCertResolver: null,
		applicationId: "app-1",
		previewDeploymentId: null,
		certificateType: "letsencrypt",
		internalPath: "/",
		stripPath: false,
		middlewares: [],
		forwardAuthEnabled: false,
		enabled: true,
		customEntrypoint: null,
		...overrides,
	});

	it("configures certResolver: 'letsencrypt' when https is true", async () => {
		const mockDomain = createMockDomain({
			domainId: "domain-1",
			host: "haly-myapp-a27eec.hatdot.cloud",
			https: true,
			port: 4173,
			certificateType: "letsencrypt",
		});

		const routerConfig = await createRouterConfig(
			mockApp,
			mockDomain,
			"websecure",
		);

		expect(routerConfig.entryPoints).toEqual(["websecure"]);
		expect(routerConfig.tls).toBeDefined();
		expect(routerConfig.tls?.certResolver).toBe("letsencrypt");
	});

	it("ensures https: true with certificateType 'none' falls back to letsencrypt rather than leaving tls undefined", async () => {
		const mockDomain = createMockDomain({
			domainId: "domain-2",
			host: "butax-qrcode-pukssj.hatdot.cloud",
			https: true,
			port: 3000,
			certificateType: "none", // misconfigured or legacy
			uniqueConfigKey: 2,
		});

		const routerConfig = await createRouterConfig(
			mockApp,
			mockDomain,
			"websecure",
		);

		// Must configure tls to avoid Traefik serving default self-signed cert
		expect(routerConfig.tls).toBeDefined();
		expect(routerConfig.tls?.certResolver).toBe("letsencrypt");
	});

	it("omits tls when https is false and certificateType is none", async () => {
		const mockDomain = createMockDomain({
			domainId: "domain-3",
			host: "internal.local",
			https: false,
			port: 80,
			certificateType: "none",
			uniqueConfigKey: 3,
		});

		const routerConfig = await createRouterConfig(
			mockApp,
			mockDomain,
			"web",
		);

		expect(routerConfig.entryPoints).toEqual(["web"]);
		expect(routerConfig.tls).toBeUndefined();
	});
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "toml";
import {
	generateNixpacksToml,
	inspectBuildDependencies,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
} from "@dokploy/server/utils/builders/runtime-resolver";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import { resolveDeploymentPlan } from "@dokploy/server/utils/builders/deployment-plan";
import type { ApplicationNested } from "@dokploy/server/utils/builders";

const createMockApp = (
	name: string,
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested =>
	({
		applicationId: `app-${name}`,
		appName: name,
		name,
		buildType: "nixpacks",
		sourceType: "github",
		env: "",
		publishDirectory: null,
		isStaticSpa: false,
		cleanCache: false,
		createEnvFile: true,
		railpackVersion: "0.15.4",
		herokuVersion: "24",
		dockerfile: "Dockerfile",
		dockerContextPath: null,
		dockerBuildStage: null,
		buildPath: "/",
		command: null,
		args: [],
		memoryLimit: null,
		memoryReservation: null,
		cpuLimit: null,
		cpuReservation: null,
		restartPolicySwarm: null,
		placementSwarm: null,
		updateConfigSwarm: null,
		rollbackConfigSwarm: null,
		modeSwarm: null,
		serverId: "default-server",
		ports: [],
		environment: {
			env: "",
			project: {
				env: "",
			},
		},
		...overrides,
	}) as ApplicationNested;

describe("HatDot Universal Builder: Build-Time Dependency Retention & Diagnostics", () => {
	describe("1. npm devDependencies Retention & Install Commands", () => {
		it("generates 'npm ci --include=dev --include=optional' when package-lock.json is present", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "package-lock.json", path: "package-lock.json" },
				],
				packageJsonContent: JSON.stringify({
					name: "digital-agency-website",
					scripts: {
						build: "vite build",
						preview: "vite preview",
					},
					dependencies: {
						react: "^18.3.1",
						"react-dom": "^18.3.1",
					},
					devDependencies: {
						vite: "^5.4.2",
						"@vitejs/plugin-react": "^4.3.1",
					},
				}),
			});

			expect(res.packageManager).toBe("npm");
			expect(res.installCommand).toBe("npm ci --include=dev --include=optional");
			expect(res.buildCommand).toBe("npm run build");
		});

		it("generates 'npm install --include=dev --include=optional' when lockfile is absent", () => {
			const res = resolvePackageManagerAndCommands({
				files: [{ name: "package.json", path: "package.json" }],
				packageJsonContent: JSON.stringify({
					name: "digital-agency-website",
					scripts: {
						build: "vite build",
					},
					devDependencies: {
						vite: "^5.4.2",
					},
				}),
			});

			expect(res.packageManager).toBe("npm");
			expect(res.installCommand).toBe(
				"npm install --include=dev --include=optional",
			);
		});

		it("sets NPM_CONFIG_PRODUCTION='false' in generated nixpacks.toml", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				installCmd: "npm ci --include=dev --include=optional",
				buildCmd: "npm run build",
			});

			expect(toml).toContain('NPM_CONFIG_PRODUCTION = ""');
			expect(toml).toContain('cmds = ["npm ci --include=dev --include=optional"]');

			const parsed = parseToml(toml);
			expect(parsed.variables?.NPM_CONFIG_PRODUCTION).toBe("");
			expect(parsed.phases?.install?.cmds).toEqual([
				"npm ci --include=dev --include=optional",
			]);
		});
	});

	describe("2. Package Manager Parity: pnpm, Yarn, and Bun", () => {
		it("generates 'pnpm install --frozen-lockfile --prod=false' when build is required", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "pnpm-lock.yaml", path: "pnpm-lock.yaml" },
				],
				packageJsonContent: JSON.stringify({
					name: "pnpm-vite-app",
					scripts: {
						build: "vite build",
					},
					dependencies: {
						react: "^18.3.1",
					},
					devDependencies: {
						vite: "^5.4.2",
					},
				}),
			});

			expect(res.packageManager).toBe("pnpm");
			expect(res.installCommand).toBe("pnpm install --frozen-lockfile --prod=false");
			expect(res.buildCommand).toBe("pnpm run build");
		});

		it("preserves 'pnpm install --frozen-lockfile' when no build step is needed", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "pnpm-lock.yaml", path: "pnpm-lock.yaml" },
				],
				packageJsonContent: JSON.stringify({
					name: "pnpm-server",
					scripts: {
						start: "node server.js",
					},
				}),
			});

			expect(res.packageManager).toBe("pnpm");
			expect(res.installCommand).toBe("pnpm install --frozen-lockfile");
		});

		it("generates 'yarn install --frozen-lockfile --production=false' when build is required", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "yarn.lock", path: "yarn.lock" },
				],
				packageJsonContent: JSON.stringify({
					name: "yarn-vite-app",
					scripts: {
						build: "vite build",
					},
					devDependencies: {
						vite: "^5.4.2",
					},
				}),
			});

			expect(res.packageManager).toBe("yarn");
			expect(res.installCommand).toBe(
				"yarn install --frozen-lockfile --production=false",
			);
			expect(res.buildCommand).toBe("yarn build");
		});

		it("generates 'bun install --frozen-lockfile' with bun.lockb", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "bun.lockb", path: "bun.lockb" },
				],
				packageJsonContent: JSON.stringify({
					name: "bun-app",
					scripts: {
						build: "bun run build",
					},
				}),
			});

			expect(res.packageManager).toBe("bun");
			expect(res.installCommand).toBe("bun install --frozen-lockfile");
			expect(res.buildCommand).toBe("bun run build");
		});
	});

	describe("3. Vite React / SWC Configuration Dependency Inspection", () => {
		it("detects no issues when @vitejs/plugin-react is declared in devDependencies", () => {
			const result = inspectBuildDependencies({
				files: [
					{
						name: "vite.config.js",
						path: "vite.config.js",
						content: `
							import { defineConfig } from 'vite';
							import react from '@vitejs/plugin-react';

							export default defineConfig({
								plugins: [react()],
							});
						`,
					},
				],
				packageJsonContent: JSON.stringify({
					name: "vite-react-app",
					dependencies: {
						react: "^18.3.1",
						"react-dom": "^18.3.1",
					},
					devDependencies: {
						vite: "^5.4.2",
						"@vitejs/plugin-react": "^4.3.1",
					},
				}),
			});

			expect(result.diagnostics).toHaveLength(0);
			expect(result.missingDependencies).toHaveLength(0);
			expect(result.checkedFiles).toEqual(["vite.config.js"]);
		});

		it("detects no issues when @vitejs/plugin-react is declared in dependencies", () => {
			const result = inspectBuildDependencies({
				files: [
					{
						name: "vite.config.ts",
						path: "vite.config.ts",
						content: `
							import { defineConfig } from 'vite';
							import react from '@vitejs/plugin-react';
							export default defineConfig({ plugins: [react()] });
						`,
					},
				],
				packageJsonContent: JSON.stringify({
					name: "vite-react-app",
					dependencies: {
						"@vitejs/plugin-react": "^4.3.1",
						react: "^18.3.1",
					},
					devDependencies: {
						vite: "^5.4.2",
					},
				}),
			});

			expect(result.diagnostics).toHaveLength(0);
			expect(result.missingDependencies).toHaveLength(0);
		});

		it("emits actionable diagnostic when @vitejs/plugin-react is genuinely undeclared", () => {
			const result = inspectBuildDependencies({
				files: [
					{
						name: "vite.config.js",
						path: "vite.config.js",
						content: `
							import { defineConfig } from 'vite';
							import react from '@vitejs/plugin-react';

							export default defineConfig({
								plugins: [react()],
							});
						`,
					},
				],
				packageJsonContent: JSON.stringify({
					name: "digital-agency-website",
					dependencies: {
						react: "^18.3.1",
						"react-dom": "^18.3.1",
					},
					devDependencies: {
						vite: "^5.4.2",
						// NOTICE: @vitejs/plugin-react is MISSING!
					},
				}),
			});

			expect(result.diagnostics).toHaveLength(1);
			expect(result.missingDependencies).toEqual(["@vitejs/plugin-react"]);

			const diag = result.diagnostics[0];
			expect(diag?.code).toBe("UNDECLARED_BUILD_DEPENDENCY");
			expect(diag?.packageName).toBe("@vitejs/plugin-react");
			expect(diag?.configFile).toBe("vite.config.js");
			expect(diag?.severity).toBe("error");
			expect(diag?.message).toContain("imports '@vitejs/plugin-react'");
			expect(diag?.message).toContain("not declared in package.json");
			expect(diag?.remediation).toContain("npm install -D @vitejs/plugin-react");
		});

		it("emits actionable diagnostic when @vitejs/plugin-react-swc is undeclared in vite.config.ts", () => {
			const result = inspectBuildDependencies({
				files: [
					{
						name: "vite.config.ts",
						path: "vite.config.ts",
						content: `
							import { defineConfig } from 'vite';
							import reactSwc from '@vitejs/plugin-react-swc';
							export default defineConfig({ plugins: [reactSwc()] });
						`,
					},
				],
				packageJsonContent: JSON.stringify({
					name: "vite-swc-app",
					dependencies: { react: "^18.3.1" },
					devDependencies: { vite: "^5.4.2" },
				}),
			});

			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.packageName).toBe("@vitejs/plugin-react-swc");
			expect(result.diagnostics[0]?.configFile).toBe("vite.config.ts");
		});

		it("ignores Node.js built-ins and relative path imports in config files", () => {
			const result = inspectBuildDependencies({
				files: [
					{
						name: "vite.config.js",
						path: "vite.config.js",
						content: `
							import path from 'path';
							import { fileURLToPath } from 'node:url';
							import customPlugin from './plugins/custom.js';
							import { defineConfig } from 'vite';

							export default defineConfig({
								plugins: [customPlugin()],
							});
						`,
					},
				],
				packageJsonContent: JSON.stringify({
					name: "custom-app",
					devDependencies: { vite: "^5.4.2" },
				}),
			});

			expect(result.diagnostics).toHaveLength(0);
			expect(result.missingDependencies).toHaveLength(0);
		});
	});

	describe("4. End-to-End DeploymentPlan Integration", () => {
		it("creates valid plan with installCommand for declared Vite React app", () => {
			const app = createMockApp("agency-site", {
				env: "NODE_ENV=production\n",
			});

			const plan = resolveDeploymentPlan({
				application: app,
				files: [
					{
						name: "package.json",
						path: "package.json",
						content: JSON.stringify({
							name: "digital-agency-website",
							scripts: {
								build: "vite build",
								preview: "vite preview",
							},
							dependencies: {
								react: "^18.3.1",
								"react-dom": "^18.3.1",
							},
							devDependencies: {
								vite: "^5.4.2",
								"@vitejs/plugin-react": "^4.3.1",
							},
						}),
					},
					{
						name: "package-lock.json",
						path: "package-lock.json",
						content: "{}",
					},
					{
						name: "vite.config.js",
						path: "vite.config.js",
						content: `
							import { defineConfig } from 'vite';
							import react from '@vitejs/plugin-react';
							export default defineConfig({ plugins: [react()] });
						`,
					},
				],
			});

			expect(plan.packageManager).toBe("npm");
			expect(plan.installCommand?.command).toBe(
				"npm ci --include=dev --include=optional",
			);
			expect(plan.buildCommand?.command).toBe("npm run build");
			expect(plan.deploymentStrategy).toBe("vite-preview");
			expect(plan.port.value).toBe(4173);

			// Diagnostic should NOT have undeclared dependencies
			const undeclaredDiag = plan.diagnostics.find(
				(d) => d.code === "UNDECLARED_BUILD_DEPENDENCY",
			);
			expect(undeclaredDiag).toBeUndefined();
		});

		it("includes error diagnostic in DeploymentPlan when Vite plugin is genuinely missing", () => {
			const app = createMockApp("broken-site", {
				env: "NODE_ENV=production\n",
			});

			const plan = resolveDeploymentPlan({
				application: app,
				files: [
					{
						name: "package.json",
						path: "package.json",
						content: JSON.stringify({
							name: "broken-agency-website",
							scripts: {
								build: "vite build",
								preview: "vite preview",
							},
							dependencies: {
								react: "^18.3.1",
							},
							devDependencies: {
								vite: "^5.4.2",
								// @vitejs/plugin-react missing!
							},
						}),
					},
					{
						name: "package-lock.json",
						path: "package-lock.json",
						content: "{}",
					},
					{
						name: "vite.config.js",
						path: "vite.config.js",
						content: `
							import { defineConfig } from 'vite';
							import react from '@vitejs/plugin-react';
							export default defineConfig({ plugins: [react()] });
						`,
					},
				],
			});

			const undeclaredDiag = plan.diagnostics.find(
				(d) => d.code === "UNDECLARED_BUILD_DEPENDENCY",
			);
			expect(undeclaredDiag).toBeDefined();
			expect(undeclaredDiag?.severity).toBe("error");
			expect(undeclaredDiag?.message).toContain("@vitejs/plugin-react");
			expect(undeclaredDiag?.remediation).toContain(
				"npm install -D @vitejs/plugin-react",
			);
		});
	});

	describe("5. Customer File Immutability", () => {
		it("never modifies customer package.json, lockfile, or source files", () => {
			const tmpDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "hatdot-immutability-test-"),
			);
			try {
				const pkgJsonPath = path.join(tmpDir, "package.json");
				const lockfilePath = path.join(tmpDir, "package-lock.json");
				const viteConfigPath = path.join(tmpDir, "vite.config.js");

				const initialPkg = JSON.stringify(
					{
						name: "customer-immutable-project",
						version: "1.0.0",
						scripts: { build: "vite build", preview: "vite preview" },
						dependencies: { react: "^18.3.1" },
						devDependencies: {
							vite: "^5.4.2",
							"@vitejs/plugin-react": "^4.3.1",
						},
					},
					null,
					2,
				);
				const initialLock = '{\n  "name": "customer-immutable-project"\n}\n';
				const initialViteConfig = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`;

				fs.writeFileSync(pkgJsonPath, initialPkg);
				fs.writeFileSync(lockfilePath, initialLock);
				fs.writeFileSync(viteConfigPath, initialViteConfig);

				const app = createMockApp("immutable-app");
				// Execute planning and Nixpacks command generation
				resolveDeploymentPlan({
					application: app,
					buildAppDirectory: tmpDir,
				});
				getNixpacksCommand(app);

				// Verify exact byte-level content immutability
				expect(fs.readFileSync(pkgJsonPath, "utf-8")).toBe(initialPkg);
				expect(fs.readFileSync(lockfilePath, "utf-8")).toBe(initialLock);
				expect(fs.readFileSync(viteConfigPath, "utf-8")).toBe(initialViteConfig);
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("6. Nixpacks Preflight Shell Script Validation", () => {
		it("preflight shell contains npm ci with --include=dev --include=optional and missing dependency check", () => {
			const app = createMockApp("shell-check-app");
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain("npm ci --include=dev --include=optional");
			expect(cmd).toContain("UNDECLARED_BUILD_DEPENDENCY");
			expect(cmd).toContain("pnpm install --frozen-lockfile --prod=false");
			expect(cmd).toContain("yarn install --frozen-lockfile --production=false");
			expect(cmd).toContain("Cannot find package");
		});
	});
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parse as parseToml } from "toml";
import {
	generateNixpacksToml,
	normalizeNixpacksToml,
	validateNixpacksToml,
	NixpacksConfigSchema,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
} from "@dokploy/server/utils/builders/runtime-resolver";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import { resolveDeploymentPlan } from "@dokploy/server/utils/builders/deployment-plan";
import { NIXPKGS_ARCHIVES } from "@dokploy/server/utils/builders/runtime-catalog";
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
		networkSwarm: null,
		labelsSwarm: null,
		healthCheckSwarm: null,
		stopGracePeriodSwarm: null,
		ulimitsSwarm: null,
		endpointSpecSwarm: null,
		serverId: null,
		buildServerId: null,
		applicationStatus: "idle",
		createdAt: new Date().toISOString(),
		description: "",
		icon: null,
		customGitUrl: "https://github.com/example/repo.git",
		customGitBranch: "main",
		customGitBuildPath: "",
		customGitSSHKeyId: null,
		environmentId: "env-1",
		autoDeploy: true,
		mounts: [],
		security: [],
		redirects: [],
		ports: [],
		registry: null,
		buildRegistry: null,
		rollbackRegistry: null,
		environment: {
			environmentId: "env-1",
			name: "production",
			isDefault: false,
			createdAt: new Date().toISOString(),
			description: "",
			projectId: "proj-1",
			env: "",
			project: {
				projectId: "proj-1",
				name: "Production Project",
				description: "",
				createdAt: new Date().toISOString(),
				organizationId: "org-1",
				env: "",
			},
		},
		...overrides,
	} as ApplicationNested);

describe("HatDot Nixpacks TOML Provider Serialization & Schema Conformance Suite", () => {
	let testTempDir: string;

	beforeEach(() => {
		testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hatdot-nixpacks-test-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(testTempDir, { recursive: true, force: true });
		} catch {}
	});

	// 1. Node.js + Vite 8 / Rolldown using Node.js 22.13.1
	describe("1. Node.js + Vite 8 / Rolldown using Node.js 22.13.1", () => {
		it("generates schema-valid nixpacks.toml with top-level providers and pinned Node 22.13.1 archive", () => {
			const packageJson = {
				name: "vite8-rolldown-app",
				version: "1.0.0",
				type: "module",
				scripts: {
					dev: "vite",
					build: "vite build",
					preview: "vite preview",
				},
				dependencies: {
					react: "^19.0.0",
					"react-dom": "^19.0.0",
					rolldown: "^1.0.0-beta.1",
					vite: "^8.0.0",
				},
			};

			const pkgContent = JSON.stringify(packageJson, null, 2);
			fs.writeFileSync(path.join(testTempDir, "package.json"), pkgContent, "utf-8");

			const runtime = resolveNodeRuntime({ packageJsonContent: pkgContent });
			expect(runtime.resolvedVersion).toBe("22.13.1");
			expect(runtime.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.MODERN_22_13.commit);

			const toml = generateNixpacksToml({
				providers: ["node"],
				nixpkgsArchive: runtime.nixpkgsArchive,
				installCmd: "npm ci --include=dev --include=optional",
				buildCmd: "npm run build",
				startCmd: "npm run preview -- --port 4173 --host 0.0.0.0",
			});

			// Assert TOML text structure
			expect(toml).toMatch(/^providers\s*=\s*\["node"\]/m);
			expect(toml).toContain("[variables]");
			expect(toml).toContain('NPM_CONFIG_PRODUCTION = ""');
			expect(toml).toContain('NPM_CONFIG_UPDATE_NOTIFIER = "false"');
			expect(toml).toContain(`nixpkgsArchive = "${NIXPKGS_ARCHIVES.MODERN_22_13.commit}"`);

			// Crucial ordering check: providers MUST appear BEFORE [variables]
			const providersIndex = toml.indexOf('providers = ["node"]');
			const variablesIndex = toml.indexOf("[variables]");
			expect(providersIndex).toBeGreaterThanOrEqual(0);
			expect(variablesIndex).toBeGreaterThanOrEqual(0);
			expect(providersIndex).toBeLessThan(variablesIndex);

			// Validate with Nixpacks schema
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.variables).toBeDefined();
			expect(validated.variables?.NPM_CONFIG_PRODUCTION).toBe("");
			expect((validated.variables as any)?.providers).toBeUndefined();
			expect(validated.phases?.setup?.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.MODERN_22_13.commit);
			expect(validated.start?.cmd).toBe("npm run preview -- --port 4173 --host 0.0.0.0");
		});
	});

	// 2. A standard Vite/React project
	describe("2. Standard Vite/React Project", () => {
		it("correctly identifies Vite preview strategy, binds port 4173, and emits top-level providers", () => {
			const packageJson = {
				name: "standard-vite-react",
				version: "0.1.0",
				scripts: {
					dev: "vite",
					build: "vite build",
					preview: "vite preview",
				},
				dependencies: {
					react: "^18.3.1",
					"react-dom": "^18.3.1",
					vite: "^5.4.2",
				},
			};

			const pkgContent = JSON.stringify(packageJson, null, 2);
			fs.writeFileSync(path.join(testTempDir, "package.json"), pkgContent, "utf-8");

			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "package.json", path: "package.json" }],
				packageJsonContent: pkgContent,
			});

			expect(pm.startCommand).toBe("npm run preview -- --port 4173 --host 0.0.0.0");

			const toml = generateNixpacksToml({
				providers: ["node"],
				installCmd: pm.installCommand,
				buildCmd: pm.buildCommand,
				startCmd: pm.startCommand,
			});

			expect(toml).toMatch(/^providers\s*=\s*\["node"\]/m);
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.start?.cmd).toBe("npm run preview -- --port 4173 --host 0.0.0.0");
		});
	});

	// 3. Next.js and at least one additional supported framework (Python Streamlit)
	describe("3. Next.js & Multi-Framework Support", () => {
		it("generates schema-valid configuration for Next.js", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				installCmd: "npm ci",
				buildCmd: "npm run build",
				startCmd: "next start --port 3000 --hostname 0.0.0.0",
			});

			expect(toml).toMatch(/^providers\s*=\s*\["node"\]/m);
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.start?.cmd).toBe("next start --port 3000 --hostname 0.0.0.0");
			expect((validated.variables as any)?.providers).toBeUndefined();
		});

		it("generates schema-valid configuration for Python Streamlit", () => {
			const toml = generateNixpacksToml({
				providers: ["python"],
				setupCmds: [
					"python3 -m venv --copies /opt/venv 2>/dev/null || python -m venv --copies /opt/venv || true",
					"/opt/venv/bin/python -m ensurepip --upgrade 2>/dev/null || true",
				],
				installCmd: "pip install -r requirements.txt",
				startCmd: "streamlit run app.py --server.port=8501 --server.address=0.0.0.0",
			});

			expect(toml).toMatch(/^providers\s*=\s*\["python"\]/m);
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["python"]);
			expect(validated.phases?.setup?.cmds).toHaveLength(2);
			expect(validated.start?.cmd).toContain("streamlit run");
			expect((validated.variables as any)?.providers).toBeUndefined();
		});

		it("generates schema-valid configuration for Go", () => {
			const toml = generateNixpacksToml({
				providers: ["go"],
				buildCmd: "go build -o app .",
				startCmd: "./app",
			});

			expect(toml).toMatch(/^providers\s*=\s*\["go"\]/m);
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["go"]);
			expect(validated.phases?.build?.cmds).toEqual(["go build -o app ."]);
			expect(validated.start?.cmd).toBe("./app");
		});
	});

	// 4. Project with runtime variables, including existing NPM_CONFIG_PRODUCTION handling
	describe("4. Runtime Variables & NPM_CONFIG_PRODUCTION Handling", () => {
		it("preserves NPM_CONFIG_PRODUCTION and NPM_CONFIG_UPDATE_NOTIFIER in [variables] section without nesting providers", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				variables: {
					PORT: "4173",
					HOST: "0.0.0.0",
					API_ENDPOINT: "https://api.hatdot.cloud",
				},
				startCmd: "npm run preview",
			});

			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.variables).toEqual({
				NPM_CONFIG_PRODUCTION: "",
				NPM_CONFIG_UPDATE_NOTIFIER: "false",
				PORT: "4173",
				HOST: "0.0.0.0",
				API_ENDPOINT: "https://api.hatdot.cloud",
			});
			expect((validated.variables as any)?.providers).toBeUndefined();
		});

		it("coerces non-string values safely into strings to satisfy Nixpacks HashMap<String, String> schema", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				variables: {
					IS_ENABLED: true as any,
					WORKERS_COUNT: 4 as any,
					TAGS: ["production", "primary"] as any,
				},
			});

			const validated = validateNixpacksToml(toml);
			expect(validated.variables?.IS_ENABLED).toBe("true");
			expect(validated.variables?.WORKERS_COUNT).toBe("4");
			expect(validated.variables?.TAGS).toBe("production,primary");
			expect(typeof validated.variables?.IS_ENABLED).toBe("string");
			expect(typeof validated.variables?.WORKERS_COUNT).toBe("string");
			expect(typeof validated.variables?.TAGS).toBe("string");
		});

		it("drops any accidental 'providers' key passed in variables dictionary", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				variables: {
					providers: ["malformed", "sequence"] as any,
					CUSTOM_VAR: "valid_string",
				},
			});

			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.variables?.CUSTOM_VAR).toBe("valid_string");
			expect((validated.variables as any)?.providers).toBeUndefined();
		});
	});

	// 5. Provider configuration combined with [variables] and other TOML sections
	describe("5. TOML Section Ordering & Separation", () => {
		it("maintains strict TOML ordering: top-level providers first, then [variables], [phases], [start]", () => {
			const toml = generateNixpacksToml({
				providers: ["node", "python"],
				nixpkgsArchive: "archive-sha",
				nixPkgs: ["nodejs_22", "python311"],
				setupCmds: ["echo setup"],
				installCmd: "npm ci",
				buildCmd: "npm run build",
				startCmd: "node index.js",
			});

			const lines = toml.split("\n");
			let sawProviders = false;
			let sawFirstSection = false;

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith("providers =")) {
					sawProviders = true;
					expect(sawFirstSection).toBe(false); // providers must appear BEFORE any [section]
				}
				if (/^\[.+\]$/.test(trimmed)) {
					sawFirstSection = true;
				}
			}

			expect(sawProviders).toBe(true);
			expect(sawFirstSection).toBe(true);

			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["node", "python"]);
			expect(validated.phases?.setup?.nixpkgsArchive).toBe("archive-sha");
			expect(validated.phases?.setup?.nixPkgs).toEqual(["nodejs_22", "python311"]);
			expect(validated.phases?.install?.cmds).toEqual(["npm ci"]);
			expect(validated.phases?.build?.cmds).toEqual(["npm run build"]);
			expect(validated.start?.cmd).toBe("node index.js");
		});
	});

	// 6. Correct placement and types of all generated configuration fields
	describe("6. Field Types & Placement Conformance", () => {
		it("emits arrays and strings with exact schema types", () => {
			const toml = generateNixpacksToml({
				providers: ["node"],
				nixPkgs: ["pkgA", "pkgB"],
				setupCmds: ["cmd1", "cmd2"],
				installCmd: "install-cmd",
				buildCmd: "build-cmd",
				startCmd: "start-cmd",
			});

			const parsed = parseToml(toml);
			expect(Array.isArray(parsed.providers)).toBe(true);
			expect(Array.isArray(parsed.phases.setup.nixPkgs)).toBe(true);
			expect(Array.isArray(parsed.phases.setup.cmds)).toBe(true);
			expect(Array.isArray(parsed.phases.install.cmds)).toBe(true);
			expect(Array.isArray(parsed.phases.build.cmds)).toBe(true);
			expect(typeof parsed.start.cmd).toBe("string");
			expect(typeof parsed.variables).toBe("object");
		});
	});

	// 7. Parsing every generated fixture with actual Nixpacks parser / schema validation
	describe("7. Full Schema Validation of All Standard Fixtures", () => {
		it("validates empty options fallback", () => {
			const toml = generateNixpacksToml({});
			const validated = validateNixpacksToml(toml);
			expect(validated.variables?.NPM_CONFIG_PRODUCTION).toBe("");
			expect(validated.providers).toBeUndefined();
		});

		it("validates Python-only options", () => {
			const toml = generateNixpacksToml({
				providers: ["python"],
				installCmd: "pip install -r requirements.txt",
			});
			const validated = validateNixpacksToml(toml);
			expect(validated.providers).toEqual(["python"]);
			expect(validated.phases?.install?.cmds).toEqual(["pip install -r requirements.txt"]);
		});
	});

	// 8. Regression protection against variables.providers accidentally becoming an array
	describe("8. Regression Protection Against variables.providers Sequence Error", () => {
		it("rejects invalid TOML where providers is nested inside [variables]", () => {
			const brokenToml = `# Broken TOML mimicking production defect
[variables]
NPM_CONFIG_PRODUCTION = ""
NPM_CONFIG_UPDATE_NOTIFIER = "false"

providers = ["node"]

[start]
cmd = "npm run preview"
`;

			expect(() => validateNixpacksToml(brokenToml)).toThrow();

			try {
				validateNixpacksToml(brokenToml);
			} catch (err: any) {
				// Assert error specifically flags variables.providers receiving array instead of string
				expect(JSON.stringify(err)).toContain("providers");
				expect(JSON.stringify(err)).toContain("variables");
			}
		});

		it("normalizes and heals broken TOML by hoisting providers to top level", () => {
			const brokenToml = `# Broken TOML mimicking production defect
[variables]
NPM_CONFIG_PRODUCTION = ""
NPM_CONFIG_UPDATE_NOTIFIER = "false"

providers = ["node"]

[start]
cmd = "npm run preview"
`;

			const normalized = normalizeNixpacksToml(brokenToml);

			// Assert normalized TOML is valid
			const validated = validateNixpacksToml(normalized);
			expect(validated.providers).toEqual(["node"]);
			expect(validated.variables?.NPM_CONFIG_PRODUCTION).toBe("");
			expect((validated.variables as any)?.providers).toBeUndefined();
			expect(validated.start?.cmd).toBe("npm run preview");
		});
	});

	// 9. Preservation of customer package.json and lockfile contents
	describe("9. Preservation of Customer Files & Lockfiles", () => {
		it("does not mutate customer package.json or lockfile during resolution or command generation", () => {
			const originalPackageJson = JSON.stringify(
				{
					name: "unmodified-customer-app",
					version: "1.0.0",
					dependencies: {
						react: "^19.0.0",
						vite: "^8.0.0",
						rolldown: "^1.0.0",
					},
				},
				null,
				2,
			);

			const originalLockfile = `{"name": "unmodified-customer-app", "lockfileVersion": 3, "packages": {}}`;

			const pkgPath = path.join(testTempDir, "package.json");
			const lockPath = path.join(testTempDir, "package-lock.json");

			fs.writeFileSync(pkgPath, originalPackageJson, "utf-8");
			fs.writeFileSync(lockPath, originalLockfile, "utf-8");

			const app = createMockApp("unmodified-customer-app");

			// Run plan resolution and command generation
			const plan = resolveDeploymentPlan({
				application: app,
				buildAppDirectory: testTempDir,
			});

			const cmd = getNixpacksCommand(app);

			// Assert customer files on disk are completely untouched
			const postPkg = fs.readFileSync(pkgPath, "utf-8");
			const postLock = fs.readFileSync(lockPath, "utf-8");

			expect(postPkg).toBe(originalPackageJson);
			expect(postLock).toBe(originalLockfile);
		});
	});

	// 10. Existing startup-command, port, and host-validation behavior
	describe("10. Startup Command, Port & Host Validation Parity", () => {
		it("resolves preview command on port 4173 with authorized hosts for Vite apps", () => {
			const app = createMockApp("vite-auth-hosts", {
				command: null,
			});

			const plan = resolveDeploymentPlan({
				application: app,
				platformDomain: "hatdot.cloud",
				files: [
					{
						name: "package.json",
						path: "package.json",
						content: JSON.stringify({
							name: "vite-app",
							scripts: { preview: "vite preview", build: "vite build" },
							dependencies: { vite: "^5.0.0" },
						}),
					},
				],
			});

			expect(plan.deploymentStrategy).toBe("vite-preview");
			expect(plan.port.value).toBe(4173);
			expect(plan.startCommand.intended).toBe("npm run preview");
			expect(plan.startCommand.effective).toBe("npm run preview -- --port 4173 --host 0.0.0.0");
			expect(plan.startCommand.effective).toContain("--port 4173");
			expect(plan.startCommand.effective).toContain("--host 0.0.0.0");
		});

		it("preflight shell contains safe hoisting logic preventing variables.providers nesting", () => {
			const app = createMockApp("shell-preflight-test");
			const bash = getNixpacksCommand(app);

			// Check that shell preflight contains hoisting logic and safe prepending
			expect(bash).toContain("Ensure providers is serialized at top level");
			expect(bash).toContain('providers = ["node"]');
			expect(bash).toContain("unset NPM_CONFIG_PRODUCTION");
		});
	});
});

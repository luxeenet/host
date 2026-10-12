import {
	detectFrameworkFromFiles,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import type { ApplicationNested } from "@dokploy/server/utils/builders";
import { getDockerCommand } from "@dokploy/server/utils/builders/docker-file";
import { getHerokuCommand } from "@dokploy/server/utils/builders/heroku";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import { getPaketoCommand } from "@dokploy/server/utils/builders/paketo";
import {
	parseNodeVersion,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
} from "@dokploy/server/utils/builders/runtime-resolver";
import {
	generateNginxConfig,
	generateStaticDockerfile,
	getStaticCommand,
} from "@dokploy/server/utils/builders/static";
import { describe, expect, it } from "vitest";

const createMockApp = (
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested =>
	({
		applicationId: "mock-app-1",
		appName: "test-app",
		name: "Test Application",
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
		buildArgs: "",
		buildSecrets: "",
		serverId: null,
		environmentId: "env-1",
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
	}) as ApplicationNested;

describe("Universal Deployment Engine — Runtime & Compatibility Layer", () => {
	describe("1. Node.js Runtime Resolution & EOL Protection", () => {
		it("detects Node.js 18 in package.json engines and upgrades to supported LTS (Node 20)", () => {
			const res = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({
					engines: { node: "18" },
				}),
			});
			expect(res.isEol).toBe(true);
			expect(res.requestedVersion).toBe("18");
			expect(res.resolvedVersion).toBe("20");
			expect(res.nixPackage).toBe("nodejs_20");
			expect(res.warning).toContain("End-Of-Life");
		});

		it("detects Node.js 18 in .nvmrc and upgrades to supported LTS", () => {
			const res = resolveNodeRuntime({
				nvmrcContent: "v18.19.0\n",
			});
			expect(res.isEol).toBe(true);
			expect(res.requestedVersion).toBe("v18.19.0");
			expect(res.resolvedVersion).toBe("20");
			expect(res.nixPackage).toBe("nodejs_20");
		});

		it("detects Node.js 18 in .node-version", () => {
			const res = resolveNodeRuntime({
				nodeVersionContent: "18",
			});
			expect(res.isEol).toBe(true);
			expect(res.resolvedVersion).toBe("20");
		});

		it("detects older removed EOL versions (16, 14, 12) and upgrades safely", () => {
			for (const eolVer of ["16", "14", "12", "10"]) {
				const res = resolveNodeRuntime({
					nvmrcContent: eolVer,
				});
				expect(res.isEol).toBe(true);
				expect(res.resolvedVersion).toBe("20");
			}
		});

		it("preserves explicit supported Node.js 20 LTS", () => {
			const res = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({
					engines: { node: "^20.11.0" },
				}),
			});
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("20");
			expect(res.nixPackage).toBe("nodejs_20");
		});

		it("preserves explicit supported Node.js 22 Active LTS", () => {
			const res = resolveNodeRuntime({
				nvmrcContent: "22",
			});
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("22");
			expect(res.nixPackage).toBe("nodejs_22");
		});

		it("defaults to Node.js 22 LTS when no version is specified", () => {
			const res = resolveNodeRuntime({});
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("22");
			expect(res.nixPackage).toBe("nodejs_22");
		});

		it("correctly parses complex semver strings", () => {
			expect(parseNodeVersion("v18.19.0")).toBe(18);
			expect(parseNodeVersion(">=20.0.0")).toBe(20);
			expect(parseNodeVersion("^22.4.1")).toBe(22);
			expect(parseNodeVersion("~18.2")).toBe(18);
		});
	});

	describe("2. Package Manager and Lockfile Alignment", () => {
		it("detects npm from package-lock.json and generates frozen npm ci", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "package-lock.json", path: "package-lock.json" }],
				packageJsonContent: JSON.stringify({
					scripts: { build: "tsc", start: "node index.js" },
				}),
			});
			expect(pm.packageManager).toBe("npm");
			expect(pm.installCommand).toBe("npm ci");
			expect(pm.buildCommand).toBe("npm run build");
			expect(pm.startCommand).toBe("npm start");
		});

		it("detects pnpm from pnpm-lock.yaml and uses frozen lockfile", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "pnpm-lock.yaml", path: "pnpm-lock.yaml" }],
				packageJsonContent: JSON.stringify({
					scripts: { build: "next build", start: "next start" },
				}),
			});
			expect(pm.packageManager).toBe("pnpm");
			expect(pm.installCommand).toBe("pnpm install --frozen-lockfile");
			expect(pm.buildCommand).toBe("pnpm run build");
			expect(pm.startCommand).toBe("pnpm start");
		});

		it("detects Bun from bun.lockb and never runs npm ci", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "bun.lockb", path: "bun.lockb" }],
				packageJsonContent: JSON.stringify({
					scripts: { build: "bun build ./index.ts", start: "bun run index.ts" },
				}),
			});
			expect(pm.packageManager).toBe("bun");
			expect(pm.installCommand).toBe("bun install --frozen-lockfile");
			expect(pm.buildCommand).toBe("bun run build");
			expect(pm.startCommand).toBe("bun start");
			expect(pm.installCommand).not.toContain("npm");
		});

		it("detects Yarn from yarn.lock", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "yarn.lock", path: "yarn.lock" }],
				packageJsonContent: JSON.stringify({
					scripts: { build: "vite build", start: "vite preview" },
				}),
			});
			expect(pm.packageManager).toBe("yarn");
			expect(pm.installCommand).toBe("yarn install --frozen-lockfile");
			expect(pm.buildCommand).toBe("yarn build");
			expect(pm.startCommand).toBe("yarn start");
		});

		it("handles conflicting lockfiles deterministically based on explicit packageManager declaration", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [
					{ name: "package-lock.json", path: "package-lock.json" },
					{ name: "bun.lockb", path: "bun.lockb" },
				],
				packageJsonContent: JSON.stringify({
					packageManager: "bun@1.1.0",
					scripts: { build: "bun run build" },
				}),
			});
			expect(pm.hasConflictingLockfiles).toBe(true);
			expect(pm.packageManager).toBe("bun");
			expect(pm.installCommand).toBe("bun install --frozen-lockfile");
			expect(pm.buildCommand).toBe("bun run build");
			expect(pm.installCommand).not.toContain("npm ci");
		});

		it("does not invent build or start commands if missing from package.json", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "package-lock.json", path: "package-lock.json" }],
				packageJsonContent: JSON.stringify({
					name: "no-scripts-app",
				}),
			});
			expect(pm.buildCommand).toBeUndefined();
			expect(pm.startCommand).toBeUndefined();
		});
	});

	describe("3. Nixpacks Command Generation & Runtime Preflight", () => {
		it("generates Nixpacks command with shell preflight handling EOL Node.js 18", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain("Starting Nixpacks build...");
			expect(cmd).toContain("nixpacks build");
			expect(cmd).toContain("REQUESTED_NODE=");
			expect(cmd).toContain("NIXPACKS_NODE_VERSION=20");
			expect(cmd).toContain("bun install --frozen-lockfile");
			expect(cmd).toContain("pnpm install --frozen-lockfile");
		});

		it("passes --no-cache when cleanCache is enabled", () => {
			const app = createMockApp({ cleanCache: true });
			const cmd = getNixpacksCommand(app);
			expect(cmd).toContain("--no-cache");
		});

		it("includes user environment variables in args", () => {
			const app = createMockApp({ env: "PORT=8080\nMY_VAR=hello" });
			const cmd = getNixpacksCommand(app);
			expect(cmd).toContain("--env PORT");
			expect(cmd).toContain("8080");
			expect(cmd).toContain("--env MY_VAR");
			expect(cmd).toContain("hello");
		});

		it("supports publishDirectory for static copy", () => {
			const app = createMockApp({ publishDirectory: "dist" });
			const cmd = getNixpacksCommand(app);
			expect(cmd).toContain("--no-error-without-start");
			expect(cmd).toContain("docker cp");
			expect(cmd).toContain("dist");
		});
	});

	describe("4. Static HTML Websites & SPAs", () => {
		it("generates production Nginx configuration with gzip and asset protection", () => {
			const conf = generateNginxConfig(false);
			expect(conf).toContain("gzip on;");
			expect(conf).toContain("error_page 404 /404.html;");
			expect(conf).toContain("try_files $uri =404;");
			expect(conf).toContain("try_files $uri $uri/ =404;");
		});

		it("configures SPA client-side routing fallback without rewriting missing assets", () => {
			const conf = generateNginxConfig(true);
			// Static assets must return 404
			expect(conf).toContain("try_files $uri =404;");
			// Non-asset client routes fallback to index.html
			expect(conf).toContain("try_files $uri $uri/ /index.html;");
			// API routes must return 404
			expect(conf).toContain("location /api/ {\n      try_files $uri =404;");
		});

		it("generates static command with Dockerfile and Nginx", () => {
			const app = createMockApp({
				buildType: "static",
				publishDirectory: "public",
				isStaticSpa: true,
			});
			const cmd = getStaticCommand(app);
			const dockerfile = generateStaticDockerfile("public");
			expect(dockerfile).toContain("FROM nginx:alpine");
			expect(dockerfile).toContain("COPY public .");
			expect(cmd).toContain("nginx.conf");
			expect(cmd).toContain("Dockerfile");
		});
	});

	describe("5. Dockerfile Builder", () => {
		it("generates Docker build command with Dockerfile check", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				dockerfile: "Dockerfile",
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("docker build -t test-app -f");
			expect(cmd).toContain("Dockerfile not found at:");
			expect(cmd).toContain("Docker build completed.");
		});

		it("respects multi-stage target", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				dockerBuildStage: "production",
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("--target production");
		});

		it("respects cleanCache with --no-cache", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				cleanCache: true,
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("--no-cache");
		});

		it("passes build arguments and secrets safely", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				buildArgs: "APP_ENV=production",
				buildSecrets: "API_SECRET=my-secret-token",
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("--build-arg APP_ENV");
			expect(cmd).toContain("production");
			expect(cmd).toContain("--secret type=env,id=API_SECRET");
		});
	});

	describe("6. Cloud Native Buildpacks (Heroku & Paketo)", () => {
		it("generates Heroku pack build command with pack CLI check", () => {
			const app = createMockApp({
				buildType: "heroku_buildpacks",
				herokuVersion: "24",
			});
			const cmd = getHerokuCommand(app);
			expect(cmd).toContain("pack build test-app");
			expect(cmd).toContain("--builder heroku/builder:24");
			expect(cmd).toContain("command -v pack");
		});

		it("generates Paketo pack build command with Jammy builder", () => {
			const app = createMockApp({
				buildType: "paketo_buildpacks",
			});
			const cmd = getPaketoCommand(app);
			expect(cmd).toContain("pack build test-app");
			expect(cmd).toContain("--builder paketobuildpacks/builder-jammy-full");
		});

		it("passes --clear-cache when cleanCache is enabled", () => {
			const app = createMockApp({ cleanCache: true });
			expect(getHerokuCommand(app)).toContain("--clear-cache");
			expect(getPaketoCommand(app)).toContain("--clear-cache");
		});
	});

	describe("7. Deterministic Framework & Static Detection", () => {
		it("detects plain static HTML site without package.json", () => {
			const files: FileEntry[] = [
				{
					name: "index.html",
					path: "index.html",
					content: "<!DOCTYPE html><html><body><h1>Static</h1></body></html>",
				},
				{
					name: "styles.css",
					path: "styles.css",
					content: "body { background: black; }",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Static HTML");
			expect(res.buildType).toBe("static");
			expect(res.suggestedPort).toBe(80);
			expect(res.buildCommand).toBeUndefined();
			expect(res.isStaticSpa).toBe(false);
		});

		it("detects static HTML in public subdirectory", () => {
			const files: FileEntry[] = [
				{
					name: "index.html",
					path: "public/index.html",
					content: "<!DOCTYPE html><html></html>",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Static HTML");
			expect(res.buildType).toBe("static");
			expect(res.publishDirectory).toBe("public");
			expect(res.suggestedPort).toBe(80);
		});

		it("detects Vite React SPA with dist output directory", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "my-vite-spa",
						dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
						devDependencies: { vite: "^5.2.0" },
						scripts: { build: "vite build", preview: "vite preview" },
					}),
				},
				{
					name: "pnpm-lock.yaml",
					path: "pnpm-lock.yaml",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Vite (React)");
			expect(res.buildType).toBe("nixpacks");
			expect(res.publishDirectory).toBe("dist");
			expect(res.isStaticSpa).toBe(true);
			expect(res.packageManager).toBe("pnpm");
			expect(res.buildCommand).toBe("pnpm build");
		});

		it("detects Node.js application and identifies packageManager", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "express-api",
						dependencies: { express: "^4.19.0" },
						scripts: { build: "tsc", start: "node index.js" },
					}),
				},
				{
					name: "bun.lockb",
					path: "bun.lockb",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Node.js (Express)");
			expect(res.packageManager).toBe("bun");
			expect(res.buildCommand).toBe("bun run build");
			expect(res.startCommand).toBe("bun start");
		});

		it("detects nixpacks.toml project override", () => {
			const files: FileEntry[] = [
				{
					name: "nixpacks.toml",
					path: "nixpacks.toml",
					content: "[phases.setup]\nnixPkgs = ['nodejs_22']",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Nixpacks Configured Project");
			expect(res.buildType).toBe("nixpacks");
			expect(res.confidence).toBe("high");
		});

		it("detects project.toml Cloud Native Buildpack", () => {
			const files: FileEntry[] = [
				{
					name: "project.toml",
					path: "project.toml",
					content: "[project]\nid = 'io.buildpacks.sample'",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Cloud Native Buildpack");
			expect(res.buildType).toBe("paketo_buildpacks");
			expect(res.confidence).toBe("high");
		});
	});

	describe("8. Runtime.txt & Edge-case Compatibility", () => {
		it("detects runtime.txt with nodejs-18 and upgrades safely to Node 20 LTS", () => {
			const res = resolveNodeRuntime({
				runtimeTxtContent: "nodejs-18.19.0\n",
			});
			expect(res.isEol).toBe(true);
			expect(res.resolvedVersion).toBe("20");
			expect(res.nixPackage).toBe("nodejs_20");
		});

		it("detects runtime.txt with nodejs-22 and preserves it", () => {
			const res = resolveNodeRuntime({
				runtimeTxtContent: "nodejs-22\n",
			});
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("22");
			expect(res.nixPackage).toBe("nodejs_22");
		});

		it("flags conflicting lockfiles when both package-lock.json and bun.lockb exist", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [
					{ name: "package-lock.json", path: "package-lock.json" },
					{ name: "bun.lockb", path: "bun.lockb" },
				],
				packageJsonContent: JSON.stringify({
					name: "dual-lockfile-app",
					scripts: { build: "bun run build" },
				}),
			});
			expect(pm.hasConflictingLockfiles).toBe(true);
			expect(pm.conflicts?.length).toBeGreaterThan(1);
			// Ensures build and install never mismatch
			if (pm.packageManager === "bun") {
				expect(pm.installCommand).toBe("bun install --frozen-lockfile");
				expect(pm.buildCommand).toBe("bun run build");
			} else if (pm.packageManager === "npm") {
				expect(pm.installCommand).toBe("npm ci");
				expect(pm.buildCommand).toBe("npm run build");
			}
		});
	});

	describe("9. Static Serving, MIME Types & Caddy / Nginx Parity", () => {
		it("ensures asset routes never rewrite to index.html and have immutable caching", () => {
			const conf = generateNginxConfig(true);
			expect(conf).toContain(
				'Cache-Control "public, max-age=31536000, immutable"',
			);
			expect(conf).toContain("try_files $uri =404;");
		});

		it("ensures API requests return 404 rather than SPA index.html fallback", () => {
			const conf = generateNginxConfig(true);
			expect(conf).toContain("location /api/ {\n      try_files $uri =404;");
		});

		it("enables Gzip compression for web asset types", () => {
			const conf = generateNginxConfig(false);
			expect(conf).toContain("gzip on;");
			expect(conf).toContain("gzip_comp_level 6;");
			expect(conf).toContain("image/svg+xml");
			expect(conf).toContain("application/javascript");
		});
	});

	describe("10. Deployment Lifecycle & Error Containment", () => {
		it("Nixpacks command contains preflight shell that catches EOL Node and outputs actionable remediation", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);
			expect(cmd).toContain("has reached End-Of-Life and has been removed");
			expect(cmd).toContain(
				"Remediation: Upgrade your project to Node.js 20 or 22",
			);
			expect(cmd).toContain("NIX_STATUS=${PIPESTATUS[0]}");
		});

		it("Dockerfile command validates existence and fails with explicit error rather than generic failure", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				dockerfile: "./custom/Dockerfile",
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("❌ Dockerfile not found at:");
			expect(cmd).toContain(
				"Please verify the Dockerfile path in your application settings.",
			);
			expect(cmd).toContain(
				"❌ Docker build failed. Inspect the Docker engine logs above for details.",
			);
		});

		it("Buildpack builders verify CLI availability before starting build", () => {
			const appHeroku = createMockApp({ buildType: "heroku_buildpacks" });
			const cmdHeroku = getHerokuCommand(appHeroku);
			expect(cmdHeroku).toContain("command -v pack");
			expect(cmdHeroku).toContain("Buildpack CLI 'pack' is not installed");

			const appPaketo = createMockApp({ buildType: "paketo_buildpacks" });
			const cmdPaketo = getPaketoCommand(appPaketo);
			expect(cmdPaketo).toContain("command -v pack");
			expect(cmdPaketo).toContain("Buildpack CLI 'pack' is not installed");
		});
	});
});

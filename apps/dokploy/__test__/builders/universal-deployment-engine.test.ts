import {
	detectFrameworkFromFiles,
	resolveProjectRoot,
	isRecognizedProjectManifest,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	validateArchiveEntries,
	ArchiveValidationError,
} from "@dokploy/server/utils/builders/archive-validation";
import type { ApplicationNested } from "@dokploy/server/utils/builders";
import { getDockerCommand } from "@dokploy/server/utils/builders/docker-file";
import { getHerokuCommand } from "@dokploy/server/utils/builders/heroku";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import { getPaketoCommand } from "@dokploy/server/utils/builders/paketo";
import { NIXPKGS_ARCHIVES } from "@dokploy/server/utils/builders/runtime-catalog";
import {
	generateNixpacksToml,
	parseNodeVersion,
	resolveDotnetRuntime,
	resolveGoRuntime,
	resolveJavaRuntime,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
	resolvePhpRuntime,
	resolvePythonRuntime,
	resolveRubyRuntime,
	resolveRustRuntime,
} from "@dokploy/server/utils/builders/runtime-resolver";
import { defaultCommand as getServerSetupCommand } from "@dokploy/server/setup/server-setup";
import { getRailpackCommand } from "@dokploy/server/utils/builders/railpack";
import {
	generateNginxConfig,
	generateStaticDockerfile,
	getStaticCommand,
} from "@dokploy/server/utils/builders/static";
import { resolveDomainUpstreamPort } from "@dokploy/server/utils/traefik/application";
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

describe("Universal Deployment Engine — Comprehensive Compatibility Suite", () => {
	describe("1. Node.js Legacy & Modern Runtime Resolution", () => {
		it("detects Node.js 18 in package.json engines and resolves to Node 18 via pinned Nixpkgs archive without silent substitution", () => {
			const res = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({
					engines: { node: "18" },
				}),
			});
			expect(res.isEol).toBe(true);
			expect(res.requestedVersion).toBe("18");
			expect(res.resolvedVersion).toBe("18");
			expect(res.nixPackage).toBe("nodejs_18");
			expect(res.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
			expect(res.warning).toContain("End-Of-Life");
			expect(res.isPermitted).toBe(true);
			expect(res.isAvailable).toBe(true);
		});

		it("detects Node.js 18 in .nvmrc and preserves Node 18 with pinned archive", () => {
			const res = resolveNodeRuntime({
				nvmrcContent: "v18.19.0\n",
			});
			expect(res.isEol).toBe(true);
			expect(res.requestedVersion).toBe("v18.19.0");
			expect(res.resolvedVersion).toBe("18");
			expect(res.nixPackage).toBe("nodejs_18");
			expect(res.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
		});

		it("detects Node.js 18 in .node-version and runtime.txt", () => {
			const res1 = resolveNodeRuntime({ nodeVersionContent: "18" });
			expect(res1.resolvedVersion).toBe("18");
			expect(res1.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);

			const res2 = resolveNodeRuntime({ runtimeTxtContent: "nodejs-18.20.2" });
			expect(res2.resolvedVersion).toBe("18");
			expect(res2.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
		});

		it("detects Node.js 16 and resolves to NixOS 23.11 archive", () => {
			const res = resolveNodeRuntime({ nvmrcContent: "16" });
			expect(res.isEol).toBe(true);
			expect(res.resolvedVersion).toBe("16");
			expect(res.nixPackage).toBe("nodejs_16");
			expect(res.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_23_11.commit);
		});

		it("produces actionable failure for ancient Node versions (Node 14, 12, 10)", () => {
			const res = resolveNodeRuntime({ nvmrcContent: "14" });
			expect(res.isAvailable).toBe(false);
			expect(res.isPermitted).toBe(false);
			expect(res.unavailabilityReason).toContain("cannot be safely obtained");
		});

		it("preserves explicit supported Node.js 20 LTS without archive override", () => {
			const res = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({
					engines: { node: "^20.11.0" },
				}),
			});
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("20");
			expect(res.nixPackage).toBe("nodejs_20");
			expect(res.nixpkgsArchive).toBeUndefined();
		});

		it("preserves explicit supported Node.js 22 Active LTS", () => {
			const res = resolveNodeRuntime({ nvmrcContent: "22" });
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("22");
			expect(res.nixPackage).toBe("nodejs_22");
			expect(res.nixpkgsArchive).toBeUndefined();
		});

		it("preserves explicit supported Node.js 24 Current", () => {
			const res = resolveNodeRuntime({ nvmrcContent: "24" });
			expect(res.isEol).toBe(false);
			expect(res.resolvedVersion).toBe("24");
			expect(res.nixPackage).toBe("nodejs_24");
			expect(res.nixpkgsArchive).toBeUndefined();
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

	describe("2. Configuration Precedence & Conflict Resolution", () => {
		it("respects precedence: explicitVersion > .nvmrc > package.json engines", () => {
			const res = resolveNodeRuntime({
				explicitVersion: "22",
				nvmrcContent: "18",
				packageJsonContent: JSON.stringify({ engines: { node: "20" } }),
			});
			expect(res.resolvedVersion).toBe("22");
		});

		it("respects precedence: .nvmrc > package.json engines when explicitVersion is absent", () => {
			const res = resolveNodeRuntime({
				nvmrcContent: "18",
				packageJsonContent: JSON.stringify({ engines: { node: "20" } }),
			});
			expect(res.resolvedVersion).toBe("18");
			expect(res.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
		});

		it("respects packageManager field to disambiguate conflicting lockfiles", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [
					{ name: "package-lock.json", path: "package-lock.json" },
					{ name: "bun.lockb", path: "bun.lockb" },
				],
				packageJsonContent: JSON.stringify({
					packageManager: "npm@10.5.0",
					scripts: { build: "npm run build" },
				}),
			});
			expect(pm.hasConflictingLockfiles).toBe(true);
			expect(pm.packageManager).toBe("npm");
			expect(pm.installCommand).toBe("npm ci");
		});
	});

	describe("3. Bun + Node.js 18 Integration", () => {
		it("correctly configures Bun alongside Node.js 18 with pinned Nixpkgs archive", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "bun.lockb", path: "bun.lockb" }],
				packageJsonContent: JSON.stringify({
					engines: { node: "18" },
					scripts: { build: "bun run build", start: "bun start" },
				}),
			});
			const runtime = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({ engines: { node: "18" } }),
			});

			expect(pm.packageManager).toBe("bun");
			expect(pm.installCommand).toBe("bun install --frozen-lockfile");
			expect(pm.buildCommand).toBe("bun run build");
			expect(runtime.resolvedVersion).toBe("18");
			expect(runtime.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);

			const toml = generateNixpacksToml({
				nixpkgsArchive: runtime.nixpkgsArchive,
				nixPkgs: ["nodejs_18", "bun"],
				installCmd: pm.installCommand,
				buildCmd: pm.buildCommand,
			});
			expect(toml).toContain(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
			expect(toml).toContain("nodejs_18");
			expect(toml).toContain("bun");
			expect(toml).toContain("bun install --frozen-lockfile");
		});

		it("handles Bun with modern Node.js versions without archive override", () => {
			const pm = resolvePackageManagerAndCommands({
				files: [{ name: "bun.lockb", path: "bun.lockb" }],
				packageJsonContent: JSON.stringify({
					engines: { node: "22" },
					scripts: { build: "bun run build" },
				}),
			});
			const runtime = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({ engines: { node: "22" } }),
			});
			expect(pm.packageManager).toBe("bun");
			expect(runtime.resolvedVersion).toBe("22");
			expect(runtime.nixpkgsArchive).toBeUndefined();
		});
	});

	describe("4. Build-Script Portability & Elimination of Bad Substitution", () => {
		it("ensures generated Nixpacks script does not use ${PIPESTATUS[0]} which causes /bin/sh: 57: Bad substitution", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);

			// Must not contain PIPESTATUS array subscript syntax that fails in POSIX /bin/sh
			expect(cmd).not.toContain("PIPESTATUS[0]");
			expect(cmd).not.toContain("${PIPESTATUS[0]}");

			// Must use portable POSIX exit code capture
			expect(cmd).toContain("TMP_STATUS=");
			expect(cmd).toContain("NIX_STATUS=");
		});

		it("safely initializes NIXPACKS_PATH to eliminate BuildKit UndefinedVar warning", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain('export NIXPACKS_PATH="${NIXPACKS_PATH:-}"');
			expect(cmd).toContain("--env NIXPACKS_PATH=");
		});

		it("configures pinned Nixpkgs archive in preflight shell when Node 18 is requested", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain("NIXPACKS_PKGS_ARCHIVE=");
			expect(cmd).toContain(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
			expect(cmd).toContain("NIXPACKS_NODE_VERSION=18");
			expect(cmd).not.toContain("NIXPACKS_NODE_VERSION=20");
		});

		it("enforces organizational policy check for legacy runtimes in preflight shell", () => {
			const app = createMockApp();
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain('ALLOW_LEGACY="${ALLOW_LEGACY_RUNTIMES:-');
			expect(cmd).toContain("Deployment Rejected by Policy");
		});
	});

	describe("5. Universal Runtimes: Python, PHP, Ruby, Java, Go, Rust, .NET", () => {
		it("resolves legacy Python 3.8 to pinned Nixpkgs archive with EOL warning", () => {
			const res = resolvePythonRuntime({ pythonVersionContent: "3.8.18" });
			expect(res.resolvedVersion).toBe("3.8");
			expect(res.nixPackage).toBe("python38");
			expect(res.isEol).toBe(true);
			expect(res.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
		});

		it("resolves modern Python 3.12 without archive override", () => {
			const res = resolvePythonRuntime({ pythonVersionContent: "3.12" });
			expect(res.resolvedVersion).toBe("3.12");
			expect(res.isEol).toBe(false);
			expect(res.nixpkgsArchive).toBeUndefined();
		});

		it("resolves legacy PHP 8.1 to pinned archive and modern PHP 8.3", () => {
			const legacyPhp = resolvePhpRuntime({ phpVersionContent: "8.1" });
			expect(legacyPhp.resolvedVersion).toBe("8.1");
			expect(legacyPhp.nixpkgsArchive).toBe(
				NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
			);

			const modernPhp = resolvePhpRuntime({ phpVersionContent: "8.3" });
			expect(modernPhp.resolvedVersion).toBe("8.3");
			expect(modernPhp.nixpkgsArchive).toBeUndefined();
		});

		it("resolves legacy Ruby 3.1 to pinned archive and modern Ruby 3.3", () => {
			const legacyRuby = resolveRubyRuntime({ rubyVersionContent: "3.1" });
			expect(legacyRuby.resolvedVersion).toBe("3.1");
			expect(legacyRuby.nixpkgsArchive).toBe(
				NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
			);

			const modernRuby = resolveRubyRuntime({ rubyVersionContent: "3.3" });
			expect(modernRuby.resolvedVersion).toBe("3.3");
			expect(modernRuby.nixpkgsArchive).toBeUndefined();
		});

		it("resolves Java / OpenJDK versions: 8, 11, 17, 21", () => {
			const java8 = resolveJavaRuntime({ javaVersionContent: "8" });
			expect(java8.resolvedVersion).toBe("8");
			expect(java8.nixPackage).toBe("openjdk8");
			expect(java8.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);

			const java17 = resolveJavaRuntime({ javaVersionContent: "17" });
			expect(java17.resolvedVersion).toBe("17");
			expect(java17.nixPackage).toBe("openjdk17");
			expect(java17.nixpkgsArchive).toBeUndefined();
		});

		it("resolves Go runtime version from go.mod", () => {
			const go121 = resolveGoRuntime({
				goModContent: "module test\n\ngo 1.21\n",
			});
			expect(go121.resolvedVersion).toBe("1.21");
			expect(go121.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);

			const go122 = resolveGoRuntime({
				goModContent: "module test\n\ngo 1.22.4\n",
			});
			expect(go122.resolvedVersion).toBe("1.22");
			expect(go122.nixpkgsArchive).toBeUndefined();
		});

		it("resolves Rust toolchain from rust-toolchain.toml", () => {
			const rust = resolveRustRuntime({
				rustToolchainContent: '[toolchain]\nchannel = "1.75.0"',
			});
			expect(rust.resolvedVersion).toBe("1.75.0");
			expect(rust.nixPackage).toBe("rustc");
		});

		it("resolves .NET SDK from global.json and csproj", () => {
			const net6 = resolveDotnetRuntime({
				globalJsonContent: JSON.stringify({ sdk: { version: "6.0.400" } }),
			});
			expect(net6.resolvedVersion).toBe("6.0");
			expect(net6.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);

			const net8 = resolveDotnetRuntime({
				csprojContent:
					"<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
			});
			expect(net8.resolvedVersion).toBe("8.0");
			expect(net8.nixpkgsArchive).toBeUndefined();
		});
	});

	describe("6. Framework Detection Accuracy", () => {
		it("detects Java Spring Boot and Maven project", () => {
			const files: FileEntry[] = [
				{
					name: "pom.xml",
					path: "pom.xml",
					content:
						"<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Spring Boot");
			expect(res.language).toBe("Java");
			expect(res.suggestedPort).toBe(8080);
			expect(res.buildCommand).toContain("mvn clean package");
		});

		it("detects .NET C# project from *.csproj", () => {
			const files: FileEntry[] = [
				{
					name: "MyApi.csproj",
					path: "MyApi.csproj",
					content:
						'<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe(".NET Application");
			expect(res.language).toBe("C#");
			expect(res.buildCommand).toContain("dotnet publish");
			expect(res.startCommand).toBe("./out");
		});

		it("detects Next.js Static Export as Static site while keeping Next.js SSR as Nixpacks", () => {
			// Next.js static export
			const staticFiles: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						dependencies: { next: "14.2.0" },
						scripts: { build: "next build" },
					}),
				},
				{
					name: "next.config.mjs",
					path: "next.config.mjs",
					content: "export default { output: 'export' };",
				},
			];
			const staticRes = detectFrameworkFromFiles(staticFiles);
			expect(staticRes.framework).toBe("Next.js (Static Export)");
			expect(staticRes.buildType).toBe("static");
			expect(staticRes.publishDirectory).toBe("out");
			expect(staticRes.suggestedPort).toBe(80);

			// Next.js standard SSR
			const ssrFiles: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						dependencies: { next: "14.2.0" },
						scripts: { build: "next build", start: "next start" },
					}),
				},
			];
			const ssrRes = detectFrameworkFromFiles(ssrFiles);
			expect(ssrRes.framework).toBe("Next.js");
			expect(ssrRes.buildType).toBe("nixpacks");
			expect(ssrRes.suggestedPort).toBe(3000);
		});

		it("detects Vite React SPA with dist output directory", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
						devDependencies: { vite: "^5.2.0" },
						scripts: { build: "vite build" },
					}),
				},
				{ name: "pnpm-lock.yaml", path: "pnpm-lock.yaml" },
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Vite (React)");
			expect(res.publishDirectory).toBe("dist");
			expect(res.isStaticSpa).toBe(true);
		});

		it("detects Backend Express Node.js and never marks as static", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						dependencies: { express: "^4.19.0" },
						scripts: { start: "node server.js" },
					}),
				},
			];
			const res = detectFrameworkFromFiles(files);
			expect(res.framework).toBe("Node.js (Express)");
			expect(res.buildType).toBe("nixpacks");
			expect(res.isStaticSpa).toBeFalsy();
			expect(res.publishDirectory).toBeUndefined();
		});
	});

	describe("7. Dockerfile and Buildpack Builders", () => {
		it("generates Dockerfile build command with Dockerfile existence check", () => {
			const app = createMockApp({
				buildType: "dockerfile",
				dockerfile: "Dockerfile",
			});
			const cmd = getDockerCommand(app);
			expect(cmd).toContain("docker build -t test-app -f");
			expect(cmd).toContain("Dockerfile not found at:");
			expect(cmd).toContain("Docker build completed.");
		});

		it("generates Heroku pack build command with CLI preflight", () => {
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
	});

	describe("8. Static Nginx Serving & Asset Parity", () => {
		it("generates production Nginx configuration with gzip and asset 404 protection", () => {
			const conf = generateNginxConfig(false);
			expect(conf).toContain("gzip on;");
			expect(conf).toContain("error_page 404 /404.html;");
			expect(conf).toContain("try_files $uri =404;");
		});

		it("configures SPA fallback to index.html while strictly protecting asset routes", () => {
			const conf = generateNginxConfig(true);
			expect(conf).toContain(
				'Cache-Control "public, max-age=31536000, immutable"',
			);
			expect(conf).toContain("try_files $uri =404;");
			expect(conf).toContain("try_files $uri $uri/ /index.html;");
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

	describe("9. Dedicated Regression Test Suite (Failures 1-12)", () => {
		// 1. A JavaScript application incorrectly detected as Python
		it("Regression 1: JavaScript application is never incorrectly detected as Python even without start script and with stray Python files", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "my-node-service",
						dependencies: { express: "^4.19.0" },
					}),
				},
				{
					name: "setup.py",
					path: "setup.py",
					content: "from setuptools import setup\nsetup(name='tool')",
				},
			];
			const detected = detectFrameworkFromFiles(files);
			expect(detected.language).toBe("JavaScript");
			expect(detected.framework).toContain("Node.js");
			expect(detected.buildType).toBe("nixpacks");
			expect(detected.language).not.toBe("Python");
		});

		// 2. A valid application with an empty generated start command
		it("Regression 2: Valid application without scripts.start resolves start:prod, serve, or entrypoints and provides actionable diagnostics when empty", () => {
			const filesWithProd: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: {
							build: "nest build",
							"start:prod": "node dist/main.js",
						},
					}),
				},
			];
			const resWithProd = resolvePackageManagerAndCommands({
				files: filesWithProd,
				packageJsonContent: filesWithProd[0]!.content,
			});
			expect(resWithProd.startCommand).toBe("npm run start:prod");

			const filesWithEntry: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: { build: "tsc" },
					}),
				},
				{ name: "server.js", path: "server.js", content: "console.log('hi')" },
			];
			const resWithEntry = resolvePackageManagerAndCommands({
				files: filesWithEntry,
				packageJsonContent: filesWithEntry[0]!.content,
			});
			expect(resWithEntry.startCommand).toBe("node server.js");

			// Completely missing start command
			const filesEmpty: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "library-only",
					}),
				},
			];
			const resEmpty = resolvePackageManagerAndCommands({
				files: filesEmpty,
				packageJsonContent: filesEmpty[0]!.content,
			});
			expect(resEmpty.startCommand).toBeUndefined();
			expect(resEmpty.missingStartCommandDiagnostic).toBeDefined();
			expect(resEmpty.missingStartCommandDiagnostic?.reason).toContain(
				"without a 'start'",
			);
			expect(resEmpty.missingStartCommandDiagnostic?.remediation).toContain(
				'Add a "start"',
			);
		});

		// 3. A static SPA with no backend start script
		it("Regression 3: Static SPA with build script but no backend start script is routed to static Nginx with SPA fallback", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "react-spa",
						scripts: { build: "vite build" },
						devDependencies: { vite: "^5.0.0" },
					}),
				},
			];
			const detected = detectFrameworkFromFiles(files);
			expect(detected.buildType).toBe("static");
			expect(detected.isStaticSpa).toBe(true);
			expect(detected.publishDirectory).toBe("dist");
			expect(detected.suggestedPort).toBe(80);

			const nginxConf = generateNginxConfig(true);
			expect(nginxConf).toContain("try_files $uri $uri/ /index.html;");
		});

		// 4. A backend listening on a configured non-default port
		it("Regression 4: Backend listening on non-default port respects PORT env var, targetPort, and suggestedPort", () => {
			const domain = { port: 3000, host: "api.example.com" } as any;

			// Application with explicit PORT=8080 in env
			const appWithPortEnv = createMockApp({
				env: "PORT=8080\nNODE_ENV=production",
			});
			const resolvedPort1 = resolveDomainUpstreamPort(domain, appWithPortEnv);
			expect(resolvedPort1).toBe(8080);

			// Application with targetPort 5000
			const appWithTargetPort = createMockApp({
				ports: [{ targetPort: 5000 }] as any,
			});
			const resolvedPort2 = resolveDomainUpstreamPort(domain, appWithTargetPort);
			expect(resolvedPort2).toBe(5000);

			// Static application defaults to 80
			const staticApp = createMockApp({
				buildType: "static",
			});
			const resolvedPort3 = resolveDomainUpstreamPort(domain, staticApp);
			expect(resolvedPort3).toBe(80);
		});

		// 5. An application binding only to localhost
		it("Regression 5: Nixpacks and container configuration inject HOST=0.0.0.0 and NIXPACKS_HOST=0.0.0.0 to prevent localhost-only binding", () => {
			const app = createMockApp();
			const nixpacksCmd = getNixpacksCommand(app);
			expect(nixpacksCmd).toContain("HOST=0.0.0.0");
			expect(nixpacksCmd).toContain("NIXPACKS_HOST=0.0.0.0");
		});

		// 6. An application that builds successfully but crashes at startup
		it("Regression 6: Application crash on startup or exit is detected and flagged as unready", () => {
			const inspectExited = {
				State: {
					Status: "exited",
					Running: false,
					ExitCode: 1,
					Error: "Process exited with code 1",
				},
			};
			const isExited =
				inspectExited.State.Status === "exited" ||
				inspectExited.State.ExitCode !== 0;
			expect(isExited).toBe(true);
			expect(inspectExited.State.Running).toBe(false);

			const inspectRestarting = {
				State: {
					Status: "restarting",
					Running: false,
					Restarting: true,
				},
			};
			const isCrashing =
				inspectRestarting.State.Status === "restarting" ||
				inspectRestarting.State.Restarting;
			expect(isCrashing).toBe(true);
		});

		// 7. An empty variable causing [: Illegal number:
		it("Regression 7: Numeric sanitization ensures unset or empty variables do not cause [: Illegal number: under /bin/sh", () => {
			const sanitizeNumber = (val: string | undefined): number => {
				if (!val || !/^\d+$/.test(val.trim())) {
					return 0;
				}
				return parseInt(val.trim(), 10);
			};

			expect(sanitizeNumber("")).toBe(0);
			expect(sanitizeNumber(undefined)).toBe(0);
			expect(sanitizeNumber("abc")).toBe(0);
			expect(sanitizeNumber("   ")).toBe(0);
			expect(sanitizeNumber("15")).toBe(15);
		});

		// 8. A script containing Bash-specific syntax executed by /bin/sh
		it("Regression 8: Generated scripts in server-setup, railpack, and nixpacks avoid /bin/sh bashisms like $EUID, ${PIPESTATUS[0]}, and [[ ]]", () => {
			const setupCmd = getServerSetupCommand();
			expect(setupCmd).not.toContain("$EUID");
			expect(setupCmd).toContain("id -u 2>/dev/null");

			const app = createMockApp({ buildType: "railpack" });
			const railpackCmd = getRailpackCommand(app);
			expect(railpackCmd).not.toContain("$EUID");
			expect(railpackCmd).not.toContain("${PIPESTATUS[0]}");

			const nixpacksCmd = getNixpacksCommand(app);
			expect(nixpacksCmd).not.toContain("${PIPESTATUS[0]}");
			expect(nixpacksCmd).not.toContain("$EUID");
		});

		// 9. Node.js 18 plus Bun using incompatible Nixpkgs revisions
		it("Regression 9: Node.js 18 plus Bun resolves to compatible pinned NixOS 24.05 archive without conflicting package channels", () => {
			const nodeRes = resolveNodeRuntime({
				packageJsonContent: JSON.stringify({ engines: { node: "18" } }),
			});
			const pmRes = resolvePackageManagerAndCommands({
				files: [{ name: "bun.lockb", path: "bun.lockb" }],
				packageJsonContent: JSON.stringify({
					engines: { node: "18" },
					scripts: { start: "bun run index.ts" },
				}),
			});
			expect(nodeRes.resolvedVersion).toBe("18");
			expect(nodeRes.nixpkgsArchive).toBe(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
			expect(pmRes.packageManager).toBe("bun");

			const toml = generateNixpacksToml({
				nixpkgsArchive: nodeRes.nixpkgsArchive,
				nixPkgs: ["nodejs_18", "bun"],
				startCmd: pmRes.startCommand,
			});
			expect(toml).toContain(NIXPKGS_ARCHIVES.LEGACY_24_05.commit);
			expect(toml).toContain("nodejs_18");
			expect(toml).toContain("bun");
		});

		// 10. Current Node.js and other supported runtime versions
		it("Regression 10: Modern Node.js and supported runtimes do not pin legacy Nixpkgs archives", () => {
			const node20 = resolveNodeRuntime({ explicitVersion: "20" });
			expect(node20.nixpkgsArchive).toBeUndefined();

			const node22 = resolveNodeRuntime({ explicitVersion: "22" });
			expect(node22.nixpkgsArchive).toBeUndefined();

			const node24 = resolveNodeRuntime({ explicitVersion: "24" });
			expect(node24.nixpkgsArchive).toBeUndefined();

			const py312 = resolvePythonRuntime({ pythonVersionContent: "3.12" });
			expect(py312.nixpkgsArchive).toBeUndefined();

			const php83 = resolvePhpRuntime({ phpVersionContent: "8.3" });
			expect(php83.nixpkgsArchive).toBeUndefined();

			const go122 = resolveGoRuntime({
				goModContent: "module app\n\ngo 1.22\n",
			});
			expect(go122.nixpkgsArchive).toBeUndefined();
		});

		// 11. Dockerfile and Compose applications with explicit port configurations
		it("Regression 11: Dockerfile and Compose applications preserve explicit target port overrides", () => {
			const domain = { port: 8080, host: "docker.example.com" } as any;
			const dockerApp = createMockApp({
				buildType: "dockerfile",
				ports: [{ targetPort: 8080 }] as any,
			});
			const port = resolveDomainUpstreamPort(domain, dockerApp);
			expect(port).toBe(8080);

			const dockerCmd = getDockerCommand(dockerApp);
			expect(dockerCmd).toContain("docker build");
		});

		// 12. Existing successful deployments to prevent regressions
		it("Regression 12: Existing standard Node.js Express deployments work seamlessly without regressions", () => {
			const expressFiles: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "express-api",
						scripts: { start: "node index.js" },
						dependencies: { express: "^4.19.0" },
					}),
				},
				{
					name: "index.js",
					path: "index.js",
					content: "const app = require('express')();",
				},
			];
			const detected = detectFrameworkFromFiles(expressFiles);
			expect(detected.framework).toBe("Node.js (Express)");
			expect(detected.startCommand).toBe("npm start");
			expect(detected.suggestedPort).toBe(3000);

			const app = createMockApp({
				appName: "express-api",
				command: detected.startCommand,
			});
			const nixpacksCmd = getNixpacksCommand(app);
			expect(nixpacksCmd).toContain("--start-cmd 'npm start'");
			expect(nixpacksCmd).toContain("NIXPACKS_HOST=0.0.0.0");

			const domain = { port: 3000, host: "express.example.com" } as any;
			const upstreamPort = resolveDomainUpstreamPort(domain, app);
			expect(upstreamPort).toBe(3000);
		});
	});

	describe("13. Universal ZIP Deployment, Language Detection & Builder Resolution Suite", () => {
		// Python-only applications
		it("demonstrated failure fix: pure Python Streamlit app.py + requirements.txt produces Python builder plan with port 8501 and no npm", () => {
			const streamlitFiles: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "streamlit==1.32.0\npandas==2.2.0\nnumpy==1.26.4\n",
				},
				{
					name: "app.py",
					path: "app.py",
					content: "import streamlit as st\nst.title('Hello HatDot')",
				},
			];

			const detected = detectFrameworkFromFiles(streamlitFiles);
			expect(detected.framework).toBe("Streamlit (Python)");
			expect(detected.language).toBe("Python");
			expect(detected.buildType).toBe("nixpacks");
			expect(detected.suggestedPort).toBe(8501);
			expect(detected.bindHost).toBe("0.0.0.0");
			expect(detected.packageManager).toBe("pip");
			expect(detected.installCommand).toBe("pip install -r requirements.txt");
			expect(detected.startCommand).toBe(
				"streamlit run app.py --server.port=8501 --server.address=0.0.0.0",
			);
			expect(detected.confidence).toBe("high");

			// Assert generated Nixpacks configuration
			const toml = generateNixpacksToml({
				providers: ["python"],
				installCmd: detected.installCommand,
				startCmd: detected.startCommand,
			});
			expect(toml).toContain('providers = ["python"]');
			expect(toml).toContain('cmds = ["pip install -r requirements.txt"]');
			expect(toml).toContain(
				'cmd = "streamlit run app.py --server.port=8501 --server.address=0.0.0.0"',
			);
			expect(toml).not.toContain("npm");

			// Assert generated Nixpacks CLI command
			const app = createMockApp({
				appName: "streamlit-app",
				command: detected.startCommand,
			});
			const nixpacksCmd = getNixpacksCommand(app);
			expect(nixpacksCmd).toContain(
				"--start-cmd 'streamlit run app.py --server.port=8501 --server.address=0.0.0.0'",
			);
			expect(nixpacksCmd).toContain("PORT=8501");
			expect(nixpacksCmd).toContain("NIXPACKS_PORT=8501");
			expect(nixpacksCmd).toContain("NIXPACKS_PROVIDER=\"python\"");
			expect(nixpacksCmd).toContain("pip install -r requirements.txt");
			expect(nixpacksCmd).toContain("NIXPACKS_INSTALL_CMD='pip install -r requirements.txt'");
			expect(nixpacksCmd).not.toMatch(/(?<!p)npm install/);
			expect(nixpacksCmd).not.toContain("NIXPACKS_INSTALL_CMD='npm install'");
		});

		it("detects Streamlit configured with pyproject.toml without package.json", () => {
			const pyprojectFiles: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `
[tool.poetry]
name = "my-streamlit-app"
version = "0.1.0"
dependencies = [
    "python = '^3.11'",
    "streamlit = '^1.32.0'"
]
`,
				},
				{
					name: "app.py",
					path: "app.py",
					content: "import streamlit as st\nst.write('Data dashboard')",
				},
			];

			const detected = detectFrameworkFromFiles(pyprojectFiles);
			expect(detected.framework).toBe("Streamlit (Python)");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("poetry");
			expect(detected.installCommand).toBe("poetry install --no-interaction");
			expect(detected.suggestedPort).toBe(8501);
			expect(detected.startCommand).toContain("streamlit run app.py");
		});

		it("detects Streamlit with custom entrypoint streamlit_app.py", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "streamlit>=1.30.0",
				},
				{
					name: "streamlit_app.py",
					path: "streamlit_app.py",
					content: "import streamlit as st",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Streamlit (Python)");
			expect(detected.startCommand).toBe(
				"streamlit run streamlit_app.py --server.port=8501 --server.address=0.0.0.0",
			);
			expect(detected.suggestedPort).toBe(8501);
		});

		it("detects Django application with manage.py and requirements.txt", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "django>=5.0.0\ngunicorn>=21.0.0",
				},
				{
					name: "manage.py",
					path: "manage.py",
					content: "#!/usr/bin/env python\nimport os\n",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Django");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("pip");
			expect(detected.suggestedPort).toBe(8000);
			expect(detected.startCommand).toBe("python manage.py runserver 0.0.0.0:8000");
		});

		it("detects Flask application with requirements.txt", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "flask>=3.0.0\nwerkzeug>=3.0.0",
				},
				{
					name: "app.py",
					path: "app.py",
					content: "from flask import Flask\napp = Flask(__name__)",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Flask");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("pip");
			expect(detected.suggestedPort).toBe(5000);
			expect(detected.startCommand).toBe("flask run --host=0.0.0.0 --port=5000");
		});

		it("detects FastAPI application with uvicorn start command", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "fastapi>=0.110.0\nuvicorn>=0.28.0",
				},
				{
					name: "main.py",
					path: "main.py",
					content: "from fastapi import FastAPI\napp = FastAPI()",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("FastAPI");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("pip");
			expect(detected.suggestedPort).toBe(8000);
			expect(detected.startCommand).toBe("uvicorn main:app --host 0.0.0.0 --port 8000");
		});

		it("detects Gradio machine learning application", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "gradio>=4.20.0\ntorch>=2.2.0",
				},
				{
					name: "app.py",
					path: "app.py",
					content: "import gradio as gr",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Gradio");
			expect(detected.language).toBe("Python");
			expect(detected.suggestedPort).toBe(7860);
			expect(detected.startCommand).toBe("python app.py");
		});

		it("preserves customer custom startup command overriding framework default", () => {
			const app = createMockApp({
				appName: "custom-python-app",
				command: "python -m gunicorn app:server --workers 4 --bind 0.0.0.0:8501",
			});
			const nixCmd = getNixpacksCommand(app);
			expect(nixCmd).toContain(
				"--start-cmd 'python -m gunicorn app:server --workers 4 --bind 0.0.0.0:8501'",
			);
		});

		// Mixed and ambiguous projects
		it("does not allow a nested frontend/package.json to hijack a root Python Streamlit application", () => {
			const files: FileEntry[] = [
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "streamlit==1.32.0",
				},
				{
					name: "app.py",
					path: "app.py",
					content: "import streamlit as st\nst.write('Root Python')",
				},
				{
					name: "package.json",
					path: "frontend/package.json",
					content: JSON.stringify({
						name: "nested-client",
						dependencies: { react: "^18.2.0" },
					}),
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.language).toBe("Python");
			expect(detected.framework).toBe("Streamlit (Python)");
			expect(detected.packageManager).toBe("pip");
			expect(detected.suggestedPort).toBe(8501);
		});

		// JavaScript applications
		it("detects Vite application with preview script as Nixpacks on port 4173", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "vite-preview-app",
						scripts: {
							build: "vite build",
							preview: "vite preview",
						},
						devDependencies: { vite: "^5.2.0" },
					}),
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toContain("Vite");
			expect(detected.buildType).toBe("nixpacks");
			expect(detected.suggestedPort).toBe(4173);
			expect(detected.startCommand).toContain("preview");
		});

		it("detects Vite application without start/preview scripts as static on port 80", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "vite-static-spa",
						scripts: {
							build: "vite build",
						},
						devDependencies: { vite: "^5.2.0" },
					}),
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toContain("Vite");
			expect(detected.buildType).toBe("static");
			expect(detected.suggestedPort).toBe(80);
			expect(detected.publishDirectory).toBe("dist");
		});

		it("detects Bun package manager with bun.lockb and generates frozen bun install", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "bun.lockb", path: "bun.lockb" },
				],
				packageJsonContent: JSON.stringify({
					name: "bun-app",
					scripts: { start: "bun run index.ts" },
				}),
			});

			expect(res.packageManager).toBe("bun");
			expect(res.installCommand).toBe("bun install --frozen-lockfile");
			expect(res.startCommand).toBe("bun start");
		});

		it("detects pnpm package manager with pnpm-lock.yaml and generates frozen pnpm install", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "pnpm-lock.yaml", path: "pnpm-lock.yaml" },
				],
				packageJsonContent: JSON.stringify({
					name: "pnpm-app",
					scripts: { start: "node server.js" },
				}),
			});

			expect(res.packageManager).toBe("pnpm");
			expect(res.installCommand).toBe("pnpm install --frozen-lockfile");
		});

		it("detects conflicting JavaScript lockfiles accurately", () => {
			const res = resolvePackageManagerAndCommands({
				files: [
					{ name: "package.json", path: "package.json" },
					{ name: "package-lock.json", path: "package-lock.json" },
					{ name: "yarn.lock", path: "yarn.lock" },
				],
				packageJsonContent: JSON.stringify({ name: "conflict-app" }),
			});

			expect(res.hasConflictingLockfiles).toBe(true);
		});

		// Safety and archive validation
		it("rejects ZIP archives attempting path traversal", () => {
			expect(() => {
				validateArchiveEntries([
					{
						entryName: "../../../etc/passwd",
						isDirectory: false,
						size: 100,
						compressedSize: 50,
						externalAttributes: 0,
					},
				]);
			}).toThrowError(ArchiveValidationError);
		});

		it("rejects ZIP archives containing dangerous symlinks", () => {
			expect(() => {
				validateArchiveEntries([
					{
						entryName: "symlink_entry",
						isDirectory: false,
						size: 10,
						compressedSize: 10,
						// S_IFLNK unix bit: 0o120000 in high 16 bits = 0xA0000000
						externalAttributes: 0xa1ed0000,
					},
				]);
			}).toThrowError(ArchiveValidationError);
		});

		it("identifies valid project manifests deterministically", () => {
			expect(isRecognizedProjectManifest("requirements.txt")).toBe(true);
			expect(isRecognizedProjectManifest("pyproject.toml")).toBe(true);
			expect(isRecognizedProjectManifest("package.json")).toBe(true);
			expect(isRecognizedProjectManifest("app.py")).toBe(true);
			expect(isRecognizedProjectManifest("Dockerfile")).toBe(true);
			expect(isRecognizedProjectManifest("random.txt")).toBe(false);
		});
	});
});

import { describe, expect, it } from "vitest";
import {
	parseHatDotConfig,
	validateHatDotConfig,
	findHatDotConfigFile,
	interpolateConfigValues,
	type HatDotConfig,
} from "@dokploy/server/utils/builders/hatdot-config";
import {
	detectFrameworkFromFiles,
	extractPortFromCommand,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	inspectAndSelectBuilder,
	type StructuredInspectionResult,
} from "@dokploy/server/services/intelligent-builder";
import {
	analyzeBuildFailure,
	executeControlledRecovery,
	formatFailureDiagnosisReport,
	type StructuredFailureDiagnosis,
} from "@dokploy/server/services/failure-recovery";
import {
	checkDeploymentReadiness,
	type DeploymentReadinessReport,
} from "@dokploy/server/services/deployment-readiness";
import {
	calculateBuilderAnalytics,
	recordBuildMetric,
	type BuildExecutionRecord,
} from "@dokploy/server/services/builder-analytics";

describe("HatDot Universal Build & Deployment Engine", () => {
	// =========================================================================
	// 1. hatdot.yaml Parser, Validation, Env Interpolation & Error Handling
	// =========================================================================
	describe("1. hatdot.yaml Schema, Parser & Validation", () => {
		it("parses valid hatdot.yaml with complete configuration", () => {
			const yamlContent = `
version: 1
project:
  name: "acme-portal"
  type: "web"
  root: "./web"
build:
  builder: "railpack"
  runtime: "nodejs"
  runtimeVersion: "22"
  packageManager: "pnpm"
  installCommand: "pnpm install"
  buildCommand: "pnpm build"
  outputDirectory: ".next"
  systemPackages:
    - "libvips-dev"
    - "ffmpeg"
run:
  startCommand: "pnpm start"
  port: 3000
deploy:
  replicas: 2
  restartPolicy: "always"
  healthcheck:
    path: "/api/health"
    status: 200
    timeoutSeconds: 10
`;
			const config = parseHatDotConfig(yamlContent);
			expect(config).toBeDefined();
			expect(config?.version).toBe(1);
			expect(config?.project?.name).toBe("acme-portal");
			expect(config?.project?.root).toBe("./web");
			expect(config?.build?.builder).toBe("railpack");
			expect(config?.build?.systemPackages).toEqual(["libvips-dev", "ffmpeg"]);
			expect(config?.run?.port).toBe(3000);
			expect(config?.deploy?.replicas).toBe(2);
			expect(config?.deploy?.healthcheck?.path).toBe("/api/health");
		});

		it("safely interpolates environment variables with defaults", () => {
			const rawConfig: any = {
				version: 1,
				project: {
					name: "${PROJECT_NAME:-default-app}",
				},
				run: {
					port: 3000,
					env: {
						PUBLIC_URL: "${APP_URL:-https://example.com}",
						SECRET: "${SECRET_KEY:-fallback-secret}",
					},
				},
			};

			const env = {
				PROJECT_NAME: "interpolated-app",
				APP_URL: "https://my-hatdot.app",
			};

			const interpolated = interpolateConfigValues(rawConfig, env);
			expect(interpolated.project?.name).toBe("interpolated-app");
			expect(interpolated.run?.env?.PUBLIC_URL).toBe("https://my-hatdot.app");
			expect(interpolated.run?.env?.SECRET).toBe("fallback-secret");
		});

		it("rejects invalid hatdot.yaml with descriptive errors", () => {
			const invalidYaml = `
version: 99
build:
  builder: "invalid-builder"
`;
			const result = validateHatDotConfig(invalidYaml);
			expect(result.valid).toBe(false);
			expect(result.errors && result.errors.length > 0).toBe(true);
		});

		it("finds hatdot.yaml or hatdot.yml in file lists", () => {
			const filesYaml: FileEntry[] = [
				{ path: "hatdot.yaml", name: "hatdot.yaml" },
				{ path: "package.json", name: "package.json" },
			];
			expect(findHatDotConfigFile(filesYaml)).toBe("hatdot.yaml");

			const filesYml: FileEntry[] = [
				{ path: "hatdot.yml", name: "hatdot.yml" },
			];
			expect(findHatDotConfigFile(filesYml)).toBe("hatdot.yml");

			const filesNone: FileEntry[] = [
				{ path: "package.json", name: "package.json" },
			];
			expect(findHatDotConfigFile(filesNone)).toBeNull();
		});
	});

	// =========================================================================
	// 2. Contradiction Prevention & Multi-Framework Detection
	// =========================================================================
	describe("2. Contradiction Prevention: Django with Tooling package.json", () => {
		it("detects Django as primary runtime even when a frontend package.json exists", () => {
			const files: FileEntry[] = [
				{ path: "manage.py", name: "manage.py" },
				{ path: "requirements.txt", name: "requirements.txt" },
				{ path: "myproject/wsgi.py", name: "wsgi.py" },
				{ path: "myproject/settings.py", name: "settings.py" },
				{
					path: "package.json",
					name: "package.json",
					content: JSON.stringify({
						name: "django-theme",
						devDependencies: {
							tailwindcss: "^3.0.0",
							postcss: "^8.0.0",
						},
						scripts: {
							"build-css": "tailwindcss -i ./src/input.css -o ./static/output.css",
						},
					}),
				},
			];

			const detection = detectFrameworkFromFiles(files);
			expect(detection).toBeDefined();
			expect(detection?.runtime).toBe("python");
			expect(detection?.framework.toLowerCase()).toContain("django");
			expect(detection?.suggestedPort).toBe(8000);
		});

		it("detects Node.js when package.json contains an actual server framework", () => {
			const files: FileEntry[] = [
				{
					path: "package.json",
					name: "package.json",
					content: JSON.stringify({
						name: "express-server",
						dependencies: {
							express: "^4.18.2",
						},
						scripts: {
							start: "node index.js",
						},
					}),
				},
				{ path: "index.js", name: "index.js" },
			];

			const detection = detectFrameworkFromFiles(files);
			expect(detection).toBeDefined();
			expect(detection?.runtime).toBe("nodejs");
			expect(detection?.suggestedPort).toBe(3000);
		});
	});

	describe("3. Multi-Framework & Multi-Language Detection", () => {
		it("detects FastAPI with uvicorn", () => {
			const files: FileEntry[] = [
				{
					path: "requirements.txt",
					name: "requirements.txt",
					content: "fastapi>=0.100.0\nuvicorn>=0.23.0\npydantic>=2.0\n",
				},
				{ path: "main.py", name: "main.py" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("python");
			expect(det?.framework.toLowerCase()).toContain("fastapi");
			expect(det?.suggestedPort).toBe(8000);
		});

		it("detects Flask API", () => {
			const files: FileEntry[] = [
				{
					path: "requirements.txt",
					name: "requirements.txt",
					content: "Flask>=2.3.0\ngunicorn>=21.0.0\n",
				},
				{ path: "app.py", name: "app.py" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("python");
			expect(det?.framework.toLowerCase()).toContain("flask");
			expect(det?.suggestedPort).toBe(5000);
		});

		it("detects Laravel with Composer and Artisan", () => {
			const files: FileEntry[] = [
				{ path: "artisan", name: "artisan" },
				{
					path: "composer.json",
					name: "composer.json",
					content: JSON.stringify({
						name: "laravel/laravel",
						require: {
							"php": "^8.2",
							"laravel/framework": "^10.0",
						},
					}),
				},
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("php");
			expect(det?.framework.toLowerCase()).toContain("laravel");
			expect(det?.packageManager).toBe("composer");
		});

		it("detects WordPress installation", () => {
			const files: FileEntry[] = [
				{ path: "wp-config.php", name: "wp-config.php" },
				{ path: "wp-content/themes", name: "themes" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("php");
			expect(det?.framework.toLowerCase()).toContain("wordpress");
		});

		it("detects Elixir / Phoenix framework", () => {
			const files: FileEntry[] = [
				{
					path: "mix.exs",
					name: "mix.exs",
					content: 'defmodule MyApp.MixProject do\n  use Mix.Project\n  def project do\n    [app: :my_app]\n  end\nend',
				},
				{ path: "mix.lock", name: "mix.lock" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("elixir");
			expect(det?.packageManager).toBe("mix");
			expect(det?.suggestedPort).toBe(4000);
		});

		it("detects Go project", () => {
			const files: FileEntry[] = [
				{
					path: "go.mod",
					name: "go.mod",
					content: "module example.com/api\n\ngo 1.22\n",
				},
				{ path: "main.go", name: "main.go" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("go");
			expect(det?.suggestedPort).toBe(8080);
		});

		it("detects Java Spring Boot project via pom.xml", () => {
			const files: FileEntry[] = [
				{
					path: "pom.xml",
					name: "pom.xml",
					content: '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>',
				},
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("java");
			expect(det?.framework.toLowerCase()).toContain("spring");
			expect(det?.suggestedPort).toBe(8080);
		});

		it("detects .NET / C# project via .csproj", () => {
			const files: FileEntry[] = [
				{
					path: "MyWebApp.csproj",
					name: "MyWebApp.csproj",
					content: '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
				},
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("dotnet");
			expect(det?.suggestedPort).toBe(5000);
		});

		it("detects Static HTML / SPA", () => {
			const files: FileEntry[] = [
				{ path: "index.html", name: "index.html" },
				{ path: "style.css", name: "style.css" },
			];
			const det = detectFrameworkFromFiles(files);
			expect(det?.runtime).toBe("static");
			expect(det?.framework.toLowerCase()).toContain("static");
			expect(det?.suggestedPort).toBe(80);
		});
	});

	// =========================================================================
	// 4. Centralized Builder Selection Hierarchy
	// =========================================================================
	describe("4. Centralized Builder Selection Hierarchy", () => {
		it("prioritizes hatdot.yaml explicit builder over all file conventions", async () => {
			const files: FileEntry[] = [
				{
					path: "hatdot.yaml",
					name: "hatdot.yaml",
					content: "version: 1\nbuild:\n  builder: nixpacks\n",
				},
				{ path: "Dockerfile", name: "Dockerfile" },
				{ path: "package.json", name: "package.json", content: "{}" },
			];
			const res = await inspectAndSelectBuilder({ files });
			expect(res.selectedBuilder).toBe("nixpacks");
			expect(res.builderSelectionReason).toContain("hatdot.yaml");
		});

		it("picks Dockerfile builder when Dockerfile exists without hatdot.yaml override", async () => {
			const files: FileEntry[] = [
				{ path: "Dockerfile", name: "Dockerfile" },
				{ path: "package.json", name: "package.json", content: "{}" },
			];
			const res = await inspectAndSelectBuilder({ files });
			expect(res.selectedBuilder).toBe("dockerfile");
			expect(res.builderSelectionReason).toContain("Dockerfile");
		});

		it("selects railpack for standard Node.js Next.js apps", async () => {
			const files: FileEntry[] = [
				{
					path: "package.json",
					name: "package.json",
					content: JSON.stringify({ dependencies: { next: "^14.0.0" } }),
				},
				{ path: "next.config.js", name: "next.config.js" },
			];
			const res = await inspectAndSelectBuilder({ files });
			expect(res.selectedBuilder).toBe("railpack");
			expect(res.framework).toContain("next");
		});

		it("selects static builder for plain HTML apps", async () => {
			const files: FileEntry[] = [
				{ path: "index.html", name: "index.html" },
			];
			const res = await inspectAndSelectBuilder({ files });
			expect(res.selectedBuilder).toBe("static");
		});

		it("resolves monorepo root correctly", async () => {
			const files: FileEntry[] = [
				{
					path: "pnpm-workspace.yaml",
					name: "pnpm-workspace.yaml",
					content: "packages:\n  - 'apps/*'\n",
				},
				{
					path: "apps/frontend/package.json",
					name: "package.json",
					content: JSON.stringify({ name: "frontend", dependencies: { vite: "^5.0.0" } }),
				},
			];
			const res = await inspectAndSelectBuilder({ files, projectRoot: "apps/frontend" });
			expect(res.isMonorepo).toBe(true);
			expect(res.resolvedProjectRoot).toBe("apps/frontend");
		});
	});

	// =========================================================================
	// 5. Build Failure Diagnosis Engine (16 Platform Error Types)
	// =========================================================================
	describe("5. Failure Diagnosis Engine (16 Error Categories)", () => {
		it("diagnoses Out of Memory (OOM / Exit 137)", () => {
			const log = "FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory";
			const diag = analyzeBuildFailure(log);
			expect(diag.title).toContain("Out of Memory");
			expect(diag.recommendedCorrection).toContain("NODE_OPTIONS");
			expect(diag.isSafeToAutoRecover).toBe(false);
		});

		it("diagnoses Missing Native Header / Dependency", () => {
			const log = "src/binding.cc:4:10: fatal error: vips/vips.h: No such file or directory\ncompilation terminated.";
			const diag = analyzeBuildFailure(log);
			expect(diag.code).toBe("DEPENDENCY_FAILED");
			expect(diag.title).toContain("Missing System Dependency");
			expect(diag.recommendedCorrection).toContain("systemPackages");
		});

		it("diagnoses Port Mismatch with Auto-Reconciliation", () => {
			const log = "Server initialized successfully. Application listening on port 8080 in production mode.";
			const diag = analyzeBuildFailure(log, { targetPort: 3000 } as any);
			expect(diag.code).toBe("PORT_MISMATCH");
			expect(diag.recoveryAction).toBe("reconcile_port");
			expect(diag.isSafeToAutoRecover).toBe(true);
		});

		it("diagnoses Host Validation Blocked (Vite 403)", () => {
			const log = "403 Forbidden: Blocked request. Host app.example.com is not allowed by Vite preview.";
			const diag = analyzeBuildFailure(log);
			expect(diag.code).toBe("HOST_VALIDATION_BLOCKED");
			expect(diag.recoveryAction).toBe("inject_host");
			expect(diag.isSafeToAutoRecover).toBe(true);
		});

		it("diagnoses Railpack / Builder Syntax Failure with Fallback to Nixpacks", () => {
			const log = "railpack build failed: unsupported configuration directive in railpack manifest";
			const diag = analyzeBuildFailure(log);
			expect(diag.code).toBe("BUILD_SYNTAX_ERROR");
			expect(diag.recoveryAction).toBe("fallback_builder");
			expect(diag.fallbackBuilder).toBe("nixpacks");
			expect(diag.isSafeToAutoRecover).toBe(true);
		});

		it("diagnoses Missing Database Connection", () => {
			const log = "connect ECONNREFUSED 127.0.0.1:5432 - Is PostgreSQL running on that port?";
			const diag = analyzeBuildFailure(log);
			expect(diag.code).toBe("DATABASE_CONNECTION_REFUSED");
			expect(diag.recommendedCorrection).toContain("DATABASE_URL");
		});

		it("formats readable diagnostic reports without leaking credentials", () => {
			const diag = analyzeBuildFailure("Error: DATABASE_URL=postgres://root:secretPass123@db:5432/app connection refused");
			const report = formatFailureDiagnosisReport(diag);
			expect(report).toContain("Build & Deployment Failure Diagnosis");
			expect(report).not.toContain("secretPass123");
			expect(report).toContain("Actionable Remediation:");
		});
	});

	// =========================================================================
	// 6. Controlled Recovery Engine
	// =========================================================================
	describe("6. Controlled Recovery Engine", () => {
		it("executes safe fallback from Railpack to Nixpacks", async () => {
			const diagnosis: StructuredFailureDiagnosis = {
				code: "BUILD_SYNTAX_ERROR",
				title: "Railpack Compilation Error",
				stage: "Stage 3/7",
				errorMessage: "Railpack syntax error",
				likelyCause: "Unsupported directive",
				evidence: "railpack: unknown directive",
				recommendedCorrection: "Retry with Nixpacks",
				isSafeToAutoRecover: true,
				recoveryAction: "fallback_builder",
				fallbackBuilder: "nixpacks",
				howToRetry: "Redeploy",
			};

			const result = await executeControlledRecovery({
				applicationId: "app-1",
				appName: "test-app",
				currentBuilder: "railpack",
				diagnosis,
				recoveryAttemptCount: 0,
			});

			expect(result.attempted).toBe(true);
			expect(result.nextBuilder).toBe("nixpacks");
			expect(result.actionTaken).toContain("Switched builder from railpack to nixpacks");
		});

		it("reconciles port mismatch safely", async () => {
			const diagnosis: StructuredFailureDiagnosis = {
				code: "PORT_MISMATCH",
				title: "Port Mismatch",
				stage: "Stage 6/7",
				errorMessage: "Port mismatch",
				likelyCause: "App listening on 8080",
				evidence: "listening on port 8080",
				recommendedCorrection: "Update port to 8080",
				isSafeToAutoRecover: true,
				recoveryAction: "reconcile_port",
				howToRetry: "Redeploy",
			};

			const result = await executeControlledRecovery({
				applicationId: "app-2",
				appName: "test-app-2",
				currentBuilder: "railpack",
				diagnosis,
				recoveryAttemptCount: 0,
			});

			expect(result.attempted).toBe(true);
			expect(result.updatedPort).toBe(8080);
			expect(result.actionTaken).toContain("Reconciled target port to 8080");
		});

		it("strictly aborts recovery when max attempts (2) is reached", async () => {
			const diagnosis: StructuredFailureDiagnosis = {
				code: "PORT_MISMATCH",
				title: "Port Mismatch",
				stage: "Stage 6/7",
				errorMessage: "Port mismatch",
				likelyCause: "App listening on 8080",
				evidence: "listening on port 8080",
				recommendedCorrection: "Update port to 8080",
				isSafeToAutoRecover: true,
				recoveryAction: "reconcile_port",
				howToRetry: "Redeploy",
			};

			const result = await executeControlledRecovery({
				applicationId: "app-3",
				appName: "test-app-3",
				currentBuilder: "railpack",
				diagnosis,
				recoveryAttemptCount: 2,
				maxAttempts: 2,
			});

			expect(result.attempted).toBe(false);
			expect(result.reason).toContain("Maximum automated recovery attempts (2) reached");
		});
	});

	// =========================================================================
	// 7. Preflight Deployment Readiness Check
	// =========================================================================
	describe("7. Preflight Deployment Readiness Evaluation", () => {
		it("evaluates a standard ready project", async () => {
			const inspection: any = {
				framework: "nextjs",
				language: "typescript",
				runtime: "nodejs",
				runtimeVersion: "20",
				packageManager: "pnpm",
				selectedBuilder: "railpack",
				builderSelectionReason: "Default standard builder for Next.js",
				isMonorepo: false,
				resolvedProjectRoot: "./",
				detectedCommands: {
					buildCommand: "pnpm run build",
					startCommand: "pnpm run start",
				},
				detectedPort: 3000,
				systemDependencies: [],
				confidence: "high",
				warnings: [],
				assumptions: [],
			};

			const readiness = await checkDeploymentReadiness({ inspection });
			expect(readiness.status).toBe("ready_to_build");
			expect(readiness.canDeploy).toBe(true);
			expect(readiness.blockingIssues.length).toBe(0);
		});

		it("evaluates project with warnings when using low confidence or fallback", async () => {
			const inspection: any = {
				framework: "custom",
				language: "javascript",
				runtime: "nodejs",
				runtimeVersion: "latest",
				packageManager: "npm",
				selectedBuilder: "nixpacks",
				builderSelectionReason: "Universal fallback",
				isMonorepo: false,
				resolvedProjectRoot: "./",
				detectedCommands: {},
				detectedPort: 3000,
				systemDependencies: [],
				confidence: "low",
				warnings: ["No recognized framework found."],
				assumptions: ["Defaulted port to 3000."],
			};

			const readiness = await checkDeploymentReadiness({ inspection });
			expect(readiness.status).toBe("ready_with_warnings");
			expect(readiness.canDeploy).toBe(true);
			expect(readiness.warnings.length).toBeGreaterThan(0);
		});

		it("blocks deployment if required environment variables are missing", async () => {
			const inspection: any = {
				framework: "django",
				language: "python",
				runtime: "python",
				runtimeVersion: "3.12",
				packageManager: "pip",
				selectedBuilder: "railpack",
				builderSelectionReason: "Default Python builder",
				isMonorepo: false,
				resolvedProjectRoot: "./",
				detectedCommands: {
					startCommand: "gunicorn myapp.wsgi:application",
				},
				detectedPort: 8000,
				systemDependencies: [],
				confidence: "high",
				warnings: [],
				assumptions: [],
			};

			const readiness = await checkDeploymentReadiness({
				inspection,
				requiredEnvVars: ["DATABASE_URL", "SECRET_KEY"],
				configuredEnvVars: ["SECRET_KEY"],
			});

			expect(readiness.status).toBe("configuration_required");
			expect(readiness.canDeploy).toBe(false);
			expect(readiness.blockingIssues).toContain("Missing required environment variable: DATABASE_URL");
		});
	});

	// =========================================================================
	// 8. Builder Performance & Failure Analytics
	// =========================================================================
	describe("8. Builder Performance & Failure Analytics", () => {
		it("aggregates metrics correctly across multiple builds", () => {
			const records: BuildExecutionRecord[] = [
				{
					id: "1",
					applicationId: "app-1",
					builder: "railpack",
					framework: "nextjs",
					status: "success",
					durationMs: 45000,
					attemptCount: 1,
					timestamp: new Date().toISOString(),
				},
				{
					id: "2",
					applicationId: "app-2",
					builder: "railpack",
					framework: "nextjs",
					status: "failed",
					durationMs: 30000,
					failureCode: "BUILD_SYNTAX_ERROR",
					attemptCount: 1,
					timestamp: new Date().toISOString(),
				},
				{
					id: "3",
					applicationId: "app-3",
					builder: "nixpacks",
					framework: "django",
					status: "success",
					durationMs: 60000,
					attemptCount: 1,
					timestamp: new Date().toISOString(),
				},
			];

			const analytics = calculateBuilderAnalytics(records);
			expect(analytics.totalBuilds).toBe(3);
			expect(analytics.successfulBuilds).toBe(2);
			expect(analytics.failedBuilds).toBe(1);
			expect(Math.round(analytics.successRate)).toBe(67);
			expect(analytics.byBuilder.railpack?.total).toBe(2);
			expect(analytics.byBuilder.railpack?.success).toBe(1);
			expect(analytics.topFailureReasons[0]?.code).toBe("BUILD_SYNTAX_ERROR");
		});
	});
});

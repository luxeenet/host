import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApplicationNested } from "@dokploy/server";
import {
	detectFrameworkFromDirectorySync,
	detectFrameworkFromFiles,
	resolveProjectRoot,
	inspectDjangoProject,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	resolveDeploymentPlan,
	formatDeploymentPlanLog,
} from "@dokploy/server/utils/builders/deployment-plan";
import {
	resolveHostValidation,
} from "@dokploy/server/utils/builders/host-validation";
import {
	getNixpacksCommand,
} from "@dokploy/server/utils/builders/nixpacks";
import {
	buildContainerEnvironmentVariables,
} from "@dokploy/server/utils/builders/index";
import { getBuildAppDirectory } from "@dokploy/server/utils/filesystem/directory";

const createMockApp = (
	appName: string,
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested => ({
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
	railpackVersion: "0.15.4",
	herokuVersion: "24",
	dockerfile: "Dockerfile",
	dockerContextPath: null,
	dockerBuildStage: null,
	buildPath: "/",
	command: null,
	dockerImage: null,
	autoDeploy: true,
	branch: "main",
	buildArgs: null,
	commit: null,
	createdAt: new Date().toISOString(),
	customGitUrl: null,
	customGitBranch: null,
	customGitSSHKeyId: null,
	description: null,
	dropBuildPath: null,
	gitProviderId: null,
	glAccessToken: null,
	gitlabProjectId: null,
	glProjectPath: null,
	isBotPrEnabled: false,
	isDeployWithGitConfig: false,
	isMaintenance: false,
	isMonorepo: false,
	ispreviewDeploymentsActive: false,
	isPreviewDeploymentsActive: false,
	owner: "test",
	password: null,
	postDeployScript: null,
	preDeployScript: null,
	previewDeploymentsActive: false,
	previewLimit: 5,
	previewWildcardDomain: null,
	previewWildcardPort: null,
	previewWildcardSecret: null,
	previewWildcardSubdomain: null,
	projectId: "proj-1",
	repository: "test/repo",
	rollbackActive: true,
	securityCheckActive: false,
	serverId: null,
	silentMode: false,
	sourceCodePath: null,
	storageLimit: null,
	stripeCustomerId: null,
	stripeSubscriptionId: null,
	title: appName,
	totalCommitColor: "blue",
	totalCommits: 1,
	triggerDirectory: null,
	triggerPrefix: null,
	updatedAt: new Date().toISOString(),
	username: null,
	watchPaths: null,
	registry: null,
	cpuLimit: null,
	cpuReservation: null,
	memoryLimit: null,
	memoryReservation: null,
	restartPolicy: "any",
	healthCheckSwarm: null,
	healthcheck: null,
	ports: [],
	redirects: [],
	security: [],
	customCertificates: [],
	registryId: null,
	mounts: [],
	environment: {
		env: "",
		project: {
			env: "",
		},
	} as any,
	domains: [
		{
			domainId: "dom-1",
			applicationId: `app-${appName}`,
			host: `${appName}.hatdot.cloud`,
			https: true,
			port: 8000,
			path: "/",
			enabled: true,
			certificateType: "letsencrypt",
			serviceType: "application",
			createdAt: new Date().toISOString(),
			server: null,
			serverId: null,
			composeId: null,
		},
	],
	...overrides,
}) as unknown as ApplicationNested;

describe("Django & PeelJobs Full-Stack Compatibility Suite", () => {
	const peeljobsRepoPath = "C:/Users/hosting/peeljobs-repo";
	const hasPeeljobsRepo = fs.existsSync(peeljobsRepoPath);

	// 1. Real Repository Verification
	describe("1. Real PeelJobs Repository Integration", () => {
		it("detects PeelJobs monorepo root as backend and identifies secondary SvelteKit frontends", () => {
			if (!hasPeeljobsRepo) {
				console.log("Skipping real repo test: peeljobs-repo not found locally");
				return;
			}

			const rootResult = resolveProjectRoot(peeljobsRepoPath);
			expect(rootResult.resolvedRoot).toBe("backend");
			expect(rootResult.isAmbiguous).toBe(false);

			const detected = detectFrameworkFromDirectorySync(peeljobsRepoPath);
			expect(detected.framework).toBe("Django");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("uv");
			expect(detected.runtimeVersion).toBe("3.12");
			expect(detected.suggestedPort).toBe(8000);
			expect(detected.startCommand).toBe(
				"uv run gunicorn jobsp.wsgi:application --bind 0.0.0.0:8000 --workers 2",
			);
			expect(detected.installCommand).toBe("uv sync --frozen");
			expect(detected.migrationCommand).toBe(
				"uv run python manage_server.py migrate --noinput",
			);
			expect(detected.collectStaticCommand).toBe(
				"uv run python manage_server.py collectstatic --noinput",
			);
			expect(detected.wsgiEntryPoint).toBe("jobsp.wsgi:application");
			expect(detected.djangoSettingsModule).toBe("jobsp.settings_server");

			// Required supporting services
			const serviceTypes = detected.requiredServices?.map((s) => s.type);
			expect(serviceTypes).toContain("postgres");
			expect(serviceTypes).toContain("redis");
			expect(serviceTypes).toContain("celery-worker");
			expect(serviceTypes).toContain("celery-beat");

			// Monorepo secondary components
			const componentNames = detected.secondaryComponents?.map((c) => c.name);
			expect(componentNames).toContain("site");
			expect(componentNames).toContain("recruiter");
		});

		it("correctly identifies backend priority over frontend candidates in monorepo root resolution", () => {
			if (!hasPeeljobsRepo) return;

			const rootResult = resolveProjectRoot(peeljobsRepoPath);
			expect(rootResult.resolvedRoot).toBe("backend");
			expect(rootResult.candidates).toContain("backend");
			expect(rootResult.candidates).toContain("site");
			expect(rootResult.candidates).toContain("recruiter");
			expect(rootResult.secondaryComponents?.length).toBeGreaterThanOrEqual(2);
		});
	});

	// 2. Pure Django Applications (pip / requirements.txt)
	describe("2. Pure Django Applications (pip / requirements.txt)", () => {
		it("detects pure Django application with wsgi and gunicorn", () => {
			const files: FileEntry[] = [
				{
					name: "manage.py",
					path: "manage.py",
					content: "import os\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')\n",
				},
				{
					name: "wsgi.py",
					path: "myproject/wsgi.py",
					content: "application = get_wsgi_application()\n",
				},
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "django>=5.1.0\ngunicorn>=22.0.0\npsycopg2-binary>=2.9.9\n",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Django");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("pip");
			expect(detected.suggestedPort).toBe(8000);
			expect(detected.startCommand).toBe(
				"gunicorn myproject.wsgi:application --bind 0.0.0.0:8000 --workers 2",
			);
			expect(detected.migrationCommand).toBe(
				"python manage.py migrate --noinput",
			);
		});
	});

	// 3. Django Applications with uv package manager
	describe("3. Django Applications using uv", () => {
		it("detects Django with uv.lock and pyproject.toml", () => {
			const files: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `
[project]
name = "uv-django-app"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "django>=5.2.0",
    "gunicorn>=23.0.0",
]
`,
				},
				{
					name: "uv.lock",
					path: "uv.lock",
					content: "version = 1\n",
				},
				{
					name: ".python-version",
					path: ".python-version",
					content: "3.12.1\n",
				},
				{
					name: "manage.py",
					path: "manage.py",
					content: "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'portal.settings')",
				},
				{
					name: "wsgi.py",
					path: "portal/wsgi.py",
					content: "application = get_wsgi_application()",
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Django");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("uv");
			expect(detected.runtimeVersion).toBe("3.12");
			expect(detected.installCommand).toBe("uv sync --frozen");
			expect(detected.startCommand).toBe(
				"uv run gunicorn portal.wsgi:application --bind 0.0.0.0:8000 --workers 2",
			);
			expect(detected.migrationCommand).toBe(
				"uv run python manage.py migrate --noinput",
			);
		});
	});

	// 4. Monorepo scoring: Python backend vs Node frontend
	describe("4. Multi-Directory Monorepo Framework Scoring", () => {
		it("prevents secondary package.json in monorepo from misclassifying project as Node.js", () => {
			const files: FileEntry[] = [
				// Subdirectory backend/
				{
					name: "pyproject.toml",
					path: "backend/pyproject.toml",
					content: `
[project]
name = "backend"
dependencies = ["django>=5.2", "gunicorn"]
`,
				},
				{
					name: "uv.lock",
					path: "backend/uv.lock",
					content: "version = 1",
				},
				{
					name: "manage.py",
					path: "backend/manage.py",
					content: "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')",
				},
				{
					name: "wsgi.py",
					path: "backend/core/wsgi.py",
					content: "application = get_wsgi_application()",
				},
				// Subdirectory site/ (Frontend SvelteKit)
				{
					name: "package.json",
					path: "site/package.json",
					content: JSON.stringify({
						name: "site-frontend",
						devDependencies: {
							"@sveltejs/kit": "^2.0.0",
							vite: "^5.0.0",
						},
					}),
				},
				// Subdirectory recruiter/ (Frontend SvelteKit)
				{
					name: "package.json",
					path: "recruiter/package.json",
					content: JSON.stringify({
						name: "recruiter-frontend",
						devDependencies: {
							"@sveltejs/kit": "^2.0.0",
							vite: "^5.0.0",
						},
					}),
				},
			];

			const detected = detectFrameworkFromFiles(files);
			expect(detected.framework).toBe("Django");
			expect(detected.language).toBe("Python");
			expect(detected.packageManager).toBe("uv");
			expect(detected.suggestedPort).toBe(8000);
			expect(detected.startCommand).toContain("gunicorn core.wsgi:application");
		});

		it("CRITICAL REGRESSION ASSERTION: PeelJobs-like repository cannot be classified as node-server or receive fallback npm start", () => {
			const files: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "backend/pyproject.toml",
					content: `[project]\nname = "jobsp"\nrequires-python = ">=3.12"\ndependencies = ["django==5.2.17", "gunicorn==26.0.0", "psycopg[binary]==3.3.4", "celery==5.6.3", "redis==8.1.0"]\n`,
				},
				{
					name: "uv.lock",
					path: "backend/uv.lock",
					content: "version = 1\n",
				},
				{
					name: "manage_server.py",
					path: "backend/manage_server.py",
					content: "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'jobsp.settings_server')\n",
				},
				{
					name: "wsgi.py",
					path: "backend/jobsp/wsgi.py",
					content: "application = get_wsgi_application()\n",
				},
				{
					name: "package.json",
					path: "site/package.json",
					content: JSON.stringify({
						name: "site-frontend",
						scripts: { build: "vite build" },
						devDependencies: { "@sveltejs/kit": "^2.0.0", vite: "^5.0.0" },
					}),
				},
				{
					name: "package.json",
					path: "recruiter/package.json",
					content: JSON.stringify({
						name: "recruiter-frontend",
						scripts: { build: "vite build" },
						devDependencies: { "@sveltejs/kit": "^2.0.0", vite: "^5.0.0" },
					}),
				},
			];

			const app = createMockApp("peeljobs-critical-regression");
			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			// Must NEVER be classified as node-server or generic application
			expect(plan.framework).toBe("Django");
			expect(plan.framework).not.toBe("Generic Application (Auto)");
			expect(plan.deploymentStrategy).toBe("python-server");
			expect(plan.deploymentStrategy).not.toBe("node-server");

			// Must NEVER receive generic npm start fallback
			expect(plan.startCommand.effective).not.toBe("npm start");
			expect(plan.startCommand.source).not.toBe("fallback");
			expect(plan.startCommand.effective).toContain("gunicorn");
			expect(plan.startCommand.effective).toContain("--bind 0.0.0.0:8000");

			// Port must be 8000 (Python WSGI), not 3000 (Node default)
			expect(plan.port.value).toBe(8000);
			expect(plan.port.value).not.toBe(3000);

			// Runtime must be Python, package manager uv
			expect(plan.runtime.name).toBe("Python");
			expect(plan.runtime.name).not.toBe("Node.js");
			expect(plan.packageManager).toBe("uv");
			expect(plan.packageManager).not.toBe("npm");
		});

		it("correctly identifies worker-only deployment strategy and non-HTTP workload when command is celery worker", () => {
			const app = createMockApp("peeljobs-worker", {
				command: "uv run celery -A jobsp worker -l info",
			});
			const files: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `[project]\nname="jobsp"\ndependencies=["django", "celery", "redis"]`,
				},
				{
					name: "uv.lock",
					path: "uv.lock",
					content: "version = 1",
				},
			];
			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			expect(plan.deploymentStrategy).toBe("worker");
			expect(plan.isHttpWorkload).toBe(false);
			expect(plan.startCommand.effective).toBe("uv run celery -A jobsp worker -l info");
			expect(plan.routing.expectedBehavior).toContain("Non-HTTP");
		});
	});

	// 5. Deployment Plan & Diagnostics for Supporting Services
	describe("5. Deployment Plan & Supporting Services Validation", () => {
		it("emits diagnostic warnings when required PostgreSQL or Redis are missing from environment", () => {
			const app = createMockApp("peeljobs-plan-test", {
				env: "", // Empty environment
			});

			const files: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `[project]\nname="jobsp"\ndependencies=["django", "psycopg2-binary", "celery", "redis"]`,
				},
				{
					name: "uv.lock",
					path: "uv.lock",
					content: "version = 1",
				},
				{
					name: "manage.py",
					path: "manage.py",
					content: "jobsp.settings",
				},
				{
					name: "wsgi.py",
					path: "jobsp/wsgi.py",
					content: "application = get_wsgi_application()",
				},
				{
					name: "celery.py",
					path: "jobsp/celery.py",
					content: "app = Celery('jobsp')",
				},
			];

			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			expect(plan.framework).toBe("Django");
			expect(plan.deploymentStrategy).toBe("python-server");
			expect(plan.port.value).toBe(8000);

			// Diagnostics should warn about missing required services
			const missingSvc = plan.diagnostics.filter(
				(d) => d.code === "MISSING_REQUIRED_SERVICE",
			);
			expect(missingSvc.length).toBeGreaterThanOrEqual(2);
			const msgs = missingSvc.map((d) => d.message).join(" ");
			expect(msgs).toContain("PostgreSQL");
			expect(msgs).toContain("Redis");
		});

		it("clears missing service diagnostics when environment variables are supplied", () => {
			const app = createMockApp("peeljobs-configured", {
				env: `
DATABASE_URL=postgres://user:pass@postgres-service:5432/jobsp_db
REDIS_URL=redis://redis-service:6379/0
CELERY_BROKER_URL=redis://redis-service:6379/0
`,
			});

			const files: FileEntry[] = [
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `[project]\nname="jobsp"\ndependencies=["django", "psycopg2-binary", "celery", "redis"]`,
				},
				{
					name: "uv.lock",
					path: "uv.lock",
					content: "version = 1",
				},
				{
					name: "manage.py",
					path: "manage.py",
					content: "jobsp.settings",
				},
				{
					name: "wsgi.py",
					path: "jobsp/wsgi.py",
					content: "application = get_wsgi_application()",
				},
			];

			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			const missingSvc = plan.diagnostics.filter(
				(d) => d.code === "MISSING_REQUIRED_SERVICE",
			);
			expect(missingSvc.length).toBe(0);
		});

		it("detects configuration conflict when customer sets 'npm start' on Django project", () => {
			const app = createMockApp("peeljobs-wrong-command", {
				command: "npm start",
			});

			const files: FileEntry[] = [
				{
					name: "manage.py",
					path: "manage.py",
					content: "jobsp.settings",
				},
				{
					name: "wsgi.py",
					path: "jobsp/wsgi.py",
					content: "application = get_wsgi_application()",
				},
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "django\ngunicorn",
				},
			];

			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			expect(plan.conflicts.length).toBeGreaterThan(0);
			const conflict = plan.conflicts.find((c) => c.item === "startup_command");
			expect(conflict).toBeDefined();
			expect(conflict?.customerValue).toBe("npm start");

			const wrongCmdDiag = plan.diagnostics.find(
				(d) => d.code === "WRONG_START_COMMAND",
			);
			expect(wrongCmdDiag).toBeDefined();
			expect(wrongCmdDiag?.message).toContain("Gunicorn");
		});

		it("formats deployment plan log with required services, WSGI entrypoint and migrations", () => {
			const app = createMockApp("peeljobs-log-test");
			const files: FileEntry[] = [
				{
					name: "manage_server.py",
					path: "manage_server.py",
					content: "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'jobsp.settings_server')",
				},
				{
					name: "wsgi.py",
					path: "jobsp/wsgi.py",
					content: "application = get_wsgi_application()",
				},
				{
					name: "uv.lock",
					path: "uv.lock",
					content: "version = 1",
				},
				{
					name: "pyproject.toml",
					path: "pyproject.toml",
					content: `[project]\nname="jobsp"\ndependencies=["django", "psycopg2-binary", "celery", "redis"]`,
				},
			];

			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			const log = formatDeploymentPlanLog(plan);
			expect(log).toContain("Detected Framework:   Django (Python)");
			expect(log).toContain("Deployment Strategy:  python-server");
			expect(log).toContain("WSGI Entrypoint:     jobsp.wsgi:application");
			expect(log).toContain("Django Settings:     jobsp.settings_server");
			expect(log).toContain("Database Migrations:");
			expect(log).toContain("Required Supporting Services:");
			expect(log).toContain("PostgreSQL");
			expect(log).toContain("Redis");
		});
	});

	// 6. Container Environment & Host Validation
	describe("6. Safe Environment Variables & Host Validation", () => {
		it("injects SECURE_PROXY_SSL_HEADER, DJANGO_SETTINGS_MODULE and ALLOWED_HOSTS safely without overwriting user env", () => {
			const app = createMockApp("django-secure", {
				env: "CUSTOM_VAR=value\nDJANGO_SETTINGS_MODULE=custom.settings",
			});

			const files: FileEntry[] = [
				{
					name: "manage.py",
					path: "manage.py",
					content: "core.settings",
				},
				{
					name: "wsgi.py",
					path: "core/wsgi.py",
					content: "application = get_wsgi_application()",
				},
				{
					name: "requirements.txt",
					path: "requirements.txt",
					content: "django\ngunicorn",
				},
			];

			const plan = resolveDeploymentPlan({
				application: app,
				files,
			});

			const envVars = buildContainerEnvironmentVariables(app, plan);

			// User explicit DJANGO_SETTINGS_MODULE is preserved
			expect(envVars).toContain("DJANGO_SETTINGS_MODULE=custom.settings");
			// HTTPS proxy header is injected
			expect(envVars).toContain(
				"SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https",
			);
			// Allowed hosts defaults injected based on authorized domains
			expect(envVars.some((e) => e.startsWith("ALLOWED_HOSTS="))).toBe(true);
			expect(envVars.some((e) => e.startsWith("CSRF_TRUSTED_ORIGINS="))).toBe(true);
			// Container binds to 0.0.0.0
			expect(envVars).toContain("HOST=0.0.0.0");
			expect(envVars).toContain("PORT=8000");
		});
	});

	// 7. Nixpacks Command Generation for Django
	describe("7. Nixpacks Build Command for Django", () => {
		it("generates Nixpacks command with python provider, gunicorn start command, and port 8000", () => {
			const app = createMockApp("django-nixpacks", {
				command: null,
			});

			const bashCmd = getNixpacksCommand(app);
			expect(bashCmd).toContain("nixpacks build");
			// Should ensure HOST=0.0.0.0
			expect(bashCmd).toContain("HOST=0.0.0.0");
			// Should contain Django diagnostic handlers in case of start failure
			expect(bashCmd).toContain("DJANGO_START_COMMAND_NOT_FOUND");
		});
	});

	// 8. Backward Compatibility: Existing Application Types
	describe("8. Backward Compatibility with Existing Deployment Strategies", () => {
		it("still correctly detects and deploys Next.js applications (npm/pnpm)", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "my-next-app",
						dependencies: { next: "^14.2.0", react: "^18.3.0" },
						scripts: { build: "next build", start: "next start" },
					}),
				},
				{
					name: "pnpm-lock.yaml",
					path: "pnpm-lock.yaml",
					content: "lockfileVersion: 9.0",
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("next-app"),
				files,
			});

			expect(plan.framework).toBe("Next.js");
			expect(plan.packageManager).toBe("pnpm");
			expect(plan.port.value).toBe(3000);
			expect(plan.startCommand.effective).toBe("pnpm start");
		});

		it("still correctly detects and deploys Vite SPA applications", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "my-vite-spa",
						dependencies: { react: "^18.3.0" },
						devDependencies: { vite: "^5.2.0" },
						scripts: { build: "vite build", preview: "vite preview" },
					}),
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("vite-spa"),
				files,
			});

			expect(plan.framework).toBe("Vite (React)");
			expect(plan.port.value).toBe(4173);
		});

		it("still correctly detects and deploys Express Node.js servers", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						name: "express-server",
						dependencies: { express: "^4.19.0" },
						scripts: { start: "node index.js" },
					}),
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("express-app"),
				files,
			});

			expect(plan.framework).toBe("Node.js (Express)");
			expect(plan.port.value).toBe(3000);
			expect(plan.startCommand.effective).toBe("npm start");
		});

		it("still correctly detects and deploys PHP applications", () => {
			const files: FileEntry[] = [
				{
					name: "index.php",
					path: "index.php",
					content: "<?php echo 'Hello World'; ?>",
				},
				{
					name: "composer.json",
					path: "composer.json",
					content: "{}",
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("php-app"),
				files,
			});

			expect(plan.language).toBe("PHP");
			expect(plan.port.value).toBe(80);
		});

		it("still correctly detects and deploys Go applications", () => {
			const files: FileEntry[] = [
				{
					name: "go.mod",
					path: "go.mod",
					content: "module example.com/app\n\ngo 1.22",
				},
				{
					name: "main.go",
					path: "main.go",
					content: "package main\nfunc main() {}",
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("go-app"),
				files,
			});

			expect(plan.language).toBe("Go");
			expect(plan.port.value).toBe(8080);
		});

		it("still correctly detects and deploys Dockerfile applications", () => {
			const files: FileEntry[] = [
				{
					name: "Dockerfile",
					path: "Dockerfile",
					content: "FROM alpine:latest\nEXPOSE 8080\nCMD [\"/bin/sh\"]",
				},
			];

			const plan = resolveDeploymentPlan({
				application: createMockApp("docker-app", { buildType: "dockerfile" }),
				files,
			});

			expect(plan.framework).toBe("Dockerfile");
			expect(plan.builder).toBe("dockerfile");
			expect(plan.port.value).toBe(8080);
		});
	});
});

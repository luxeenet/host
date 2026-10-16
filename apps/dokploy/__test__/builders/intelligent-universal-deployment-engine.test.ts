import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	detectFrameworkFromFiles,
	extractPortFromCommand,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	validatePlatformSubdomainDepth,
} from "@dokploy/server/services/domain";
import {
	resolveDeploymentPlan,
	computeInputsFingerprint,
	formatDeploymentPlanLog,
	type DeploymentPlan,
} from "@dokploy/server/utils/builders/deployment-plan";
import {
	detectHostRejection,
	getAuthorizedHostsSync,
	normalizeHostname,
	resolveHostValidation,
} from "@dokploy/server/utils/builders/host-validation";
import {
	getNixpacksCommand,
} from "@dokploy/server/utils/builders/nixpacks";
import {
	resolveDomainUpstreamPort,
	createServiceConfig,
} from "@dokploy/server/utils/traefik/application";
import {
	classifyHttpResponse,
	verifyBuildArtifacts,
} from "@dokploy/server/utils/deployment/verification";
import {
	redactSensitiveInformation,
	formatCorrelatedLog,
	DIAGNOSTIC_CATALOG,
} from "@dokploy/server/utils/deployment/diagnostics";
import { describe, expect, it } from "vitest";

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
}) as ApplicationNested;

describe("Intelligent Universal Build & Deployment Engine", () => {
	// 1. Regression test: haly-myapp-a27eec.hatdot.cloud
	describe("1. Exact Regression: haly-myapp-a27eec.hatdot.cloud Vite + React + TS", () => {
		const viteFiles: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "haly-myapp",
					scripts: {
						dev: "vite",
						build: "tsc -b && vite build",
						preview: "vite preview",
					},
					dependencies: {
						react: "^18.3.1",
						"react-dom": "^18.3.1",
					},
					devDependencies: {
						typescript: "^5.5.3",
						vite: "^5.4.2",
						"@vitejs/plugin-react": "^4.3.1",
					},
				}),
			},
			{ name: "vite.config.ts", path: "vite.config.ts" },
		];

		it("resolves single source of truth plan with Vite preview, port 4173, and host validation", () => {
			const app = createMockApp("haly-myapp-a27eec");
			const plan = resolveDeploymentPlan({
				application: app,
				files: viteFiles,
				platformDomain: "hatdot.cloud",
			});

			expect(plan.framework).toBe("Vite (React)");
			expect(plan.language).toBe("TypeScript");
			expect(plan.deploymentStrategy).toBe("vite-preview");
			expect(plan.port.value).toBe(4173);
			expect(plan.port.bindAddress).toBe("0.0.0.0");
			expect(plan.startCommand.intended).toBe("npm run preview");
			expect(plan.startCommand.effective).toBe(
				"npm run preview -- --port 4173 --host 0.0.0.0",
			);
			expect(plan.startCommand.source).toBe("package_json_preview");

			// Host validation delivers assigned hostname via documented env var (no source edits)
			expect(plan.hostValidation.mechanism).toBe("env");
			expect(plan.hostValidation.env).toContain(
				"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=haly-myapp-a27eec.hatdot.cloud",
			);

			// Traefik upstream port matches container port exactly
			const domain: any = { host: "haly-myapp-a27eec.hatdot.cloud", port: 4173 };
			const upstreamPort = resolveDomainUpstreamPort(domain, {
				...app,
				suggestedPort: plan.port.value,
			});
			expect(upstreamPort).toBe(4173);
		});

		it("eliminates conflicting startup command resolution in Nixpacks command", () => {
			const app = createMockApp("haly-myapp-a27eec", {
				command: "npm run preview -- --port 4173 --host 0.0.0.0",
			});
			const cmd = getNixpacksCommand(app);

			// Must use the resolved preview command, never revert to 'npm start'
			expect(cmd).toContain("--start-cmd 'npm run preview -- --port 4173 --host 0.0.0.0'");
			expect(cmd).toContain("PORT=4173");
			expect(cmd).toContain("NIXPACKS_PORT=4173");
			expect(cmd).toContain("NIXPACKS_HOST=0.0.0.0");
		});

		it("recognizes Vite allowedHosts rejection with actionable diagnostic", () => {
			const response = {
				status: 403,
				body: "Blocked request. This host (haly-myapp-a27eec.hatdot.cloud) is not allowed",
			};
			const rejection = detectHostRejection(response);
			expect(rejection).not.toBeNull();
			expect(rejection?.framework).toBe("vite");
			expect(rejection?.message).toContain("Vite rejected the Host header");

			const classified = classifyHttpResponse(response.status, response.body);
			expect(classified.isHealthy).toBe(false);
			expect(classified.isHostRejected).toBe(true);
			expect(classified.diagnosticCode).toBe("HOST_VALIDATION_REJECTION");
		});
	});

	// 2. Vite projects with custom configuration
	describe("2. Vite Custom Configuration & Host Settings", () => {
		it("resolves custom preview port from package.json preview script", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: {
							preview: "vite preview --port 8080",
						},
						dependencies: { vite: "^5.0.0" },
					}),
				},
			];
			const app = createMockApp("custom-vite");
			const plan = resolveDeploymentPlan({ application: app, files });
			expect(plan.port.value).toBe(8080);
			expect(plan.startCommand.effective).toContain("--port 8080");
			expect(plan.startCommand.effective).toContain("--host 0.0.0.0");
		});
	});

	// 3. Framework Host Validation across multiple ecosystems
	describe("3. Multi-Framework Host Validation (Vite, Django, Rails, Webpack)", () => {
		it("detects Django DisallowedHost 400 rejection", () => {
			const rejection = detectHostRejection({
				status: 400,
				body: "DisallowedHost at /: Invalid HTTP_HOST header: 'myapp.hatdot.cloud'",
			});
			expect(rejection).not.toBeNull();
			expect(rejection?.framework).toBe("django");
			expect(rejection?.remediation).toContain("ALLOWED_HOSTS");
		});

		it("detects Rails Blocked Host 403 rejection", () => {
			const rejection = detectHostRejection({
				status: 403,
				body: "Blocked host: myapp.hatdot.cloud",
			});
			expect(rejection).not.toBeNull();
			expect(rejection?.framework).toBe("rails");
			expect(rejection?.remediation).toContain("config.hosts");
		});

		it("detects Webpack dev server Invalid Host Header", () => {
			const rejection = detectHostRejection({
				status: 200,
				body: "Invalid Host header",
			});
			expect(rejection).not.toBeNull();
			expect(rejection?.framework).toBe("webpack-dev-server");
		});

		it("provides diagnostic-only guidance for Django without mutating settings.py", () => {
			const hostPlan = resolveHostValidation({
				framework: "Django",
				language: "Python",
				hosts: ["django-app.hatdot.cloud"],
			});
			expect(hostPlan.mechanism).toBe("diagnostic-only");
			expect(hostPlan.remediation).toContain("DJANGO_ALLOWED_HOSTS");
		});
	});

	// 4. Node.js APIs using explicit and inferred ports
	describe("4. Node.js APIs & Port Precedence", () => {
		it("respects customer explicit port override above all inference", () => {
			const app = createMockApp("express-api", {
				ports: [{ targetPort: 8000 } as any],
				command: "npm start",
			});
			const plan = resolveDeploymentPlan({
				application: app,
				files: [
					{
						name: "package.json",
						path: "package.json",
						content: JSON.stringify({
							scripts: { start: "node server.js" },
						}),
					},
				],
			});
			expect(plan.port.value).toBe(8000);
			expect(plan.port.source).toBe("customer_override");
		});

		it("extracts port from startup command argument", () => {
			const app = createMockApp("fastify-api", {
				command: "node server.js --port 5050",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.port.value).toBe(5050);
			expect(plan.port.source).toBe("command_argument");
		});

		it("uses PORT environment variable when explicit port is not specified", () => {
			const app = createMockApp("api-app", {
				env: "PORT=4000\nNODE_ENV=production",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.port.value).toBe(4000);
			expect(plan.port.source).toBe("customer_env");
		});
	});

	// 5. Next.js, Nuxt, Remix, Astro, SvelteKit
	describe("5. Meta-Frameworks Production Startup", () => {
		it("resolves Next.js production server with port 3000", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: { build: "next build", start: "next start" },
						dependencies: { next: "14.2.5", react: "^18.3.1" },
					}),
				},
			];
			const plan = resolveDeploymentPlan({
				application: createMockApp("next-app"),
				files,
			});
			expect(plan.framework).toBe("Next.js");
			expect(plan.port.value).toBe(3000);
			expect(plan.startCommand.effective).toBe("npm start");
		});

		it("resolves Astro preview server with port 4321 and host 0.0.0.0", () => {
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: { build: "astro build", preview: "astro preview" },
						dependencies: { astro: "^4.15.0" },
					}),
				},
			];
			const plan = resolveDeploymentPlan({
				application: createMockApp("astro-app"),
				files,
			});
			expect(plan.port.value).toBe(4321);
			expect(plan.startCommand.effective).toContain("--port 4321");
			expect(plan.startCommand.effective).toContain("--host 0.0.0.0");
		});
	});

	// 6. Python, Go, Rust, PHP, Ruby, .NET
	describe("6. Universal Language Services", () => {
		it("resolves Python Streamlit on port 8501", () => {
			const plan = resolveDeploymentPlan({
				application: createMockApp("streamlit-app"),
				files: [
					{ name: "requirements.txt", path: "requirements.txt", content: "streamlit" },
					{ name: "app.py", path: "app.py", content: "import streamlit" },
				],
			});
			expect(plan.language).toBe("Python");
			expect(plan.port.value).toBe(8501);
		});

		it("resolves Go service on port 8080", () => {
			const plan = resolveDeploymentPlan({
				application: createMockApp("go-svc"),
				files: [{ name: "go.mod", path: "go.mod", content: "module example.com/svc" }],
			});
			expect(plan.language).toBe("Go");
			expect(plan.port.value).toBe(8080);
		});

		it("resolves Rust service on port 8080", () => {
			const plan = resolveDeploymentPlan({
				application: createMockApp("rust-svc"),
				files: [{ name: "Cargo.toml", path: "Cargo.toml", content: "[package]\nname = \"svc\"" }],
			});
			expect(plan.language).toBe("Rust");
			expect(plan.port.value).toBe(8080);
		});

		it("resolves .NET service on port 5000", () => {
			const plan = resolveDeploymentPlan({
				application: createMockApp("dotnet-app"),
				files: [{ name: "app.csproj", path: "app.csproj", content: "<Project />" }],
			});
			expect(plan.port.value).toBe(5000);
		});
	});

	// 7. Monorepo application roots
	describe("7. Monorepo & Nested Application Roots", () => {
		it("preserves configured buildPath as application root", () => {
			const app = createMockApp("monorepo-web", {
				buildPath: "/apps/web",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.rootDirectory).toBe("/apps/web");
		});
	});

	// 8. Conflicting startup commands
	describe("8. Conflicting Signals & Precedence", () => {
		it("flags conflict when customer specifies 'npm start' on a project with only 'preview' script", () => {
			const app = createMockApp("conflict-app", {
				command: "npm start",
			});
			const files: FileEntry[] = [
				{
					name: "package.json",
					path: "package.json",
					content: JSON.stringify({
						scripts: { preview: "vite preview" },
						dependencies: { vite: "^5.0.0" },
					}),
				},
			];
			const plan = resolveDeploymentPlan({ application: app, files });

			// Customer override is preserved (never silently replaced)
			expect(plan.startCommand.effective).toBe("npm start");
			expect(plan.startCommand.source).toBe("customer_override");

			// Conflict is documented with clear resolution advice
			expect(plan.conflicts.length).toBeGreaterThan(0);
			expect(plan.conflicts[0]?.item).toBe("startup_command");
		});
	});

	// 9. Hostname normalization & Tenant Isolation
	describe("9. Hostname Normalization, Tenant Isolation & Malicious Input", () => {
		it("normalizes valid domains and strips protocols, trailing dots, and ports", () => {
			expect(normalizeHostname("https://my-app.hatdot.cloud/")).toBe("my-app.hatdot.cloud");
			expect(normalizeHostname("custom.com:8080")).toBeNull(); // Reject port in host header
			expect(normalizeHostname("app.hatdot.cloud.")).toBe("app.hatdot.cloud");
		});

		it("rejects malicious, wildcard, IP, localhost, and traversal inputs", () => {
			expect(normalizeHostname("*.hatdot.cloud")).toBeNull();
			expect(normalizeHostname("localhost")).toBeNull();
			expect(normalizeHostname("127.0.0.1")).toBeNull();
			expect(normalizeHostname("0.0.0.0")).toBeNull();
			expect(normalizeHostname("; rm -rf /")).toBeNull();
			expect(normalizeHostname("app.com,other.com")).toBeNull();
			expect(normalizeHostname("../../../etc/passwd")).toBeNull();
		});

		it("strictly isolates authorized hosts per tenant application", () => {
			const appA = {
				...createMockApp("app-a", {
					applicationId: "app-a-id",
				}),
				domains: [
					{ host: "custom-a.com", enabled: true, applicationId: "app-a-id" },
					{ host: "tenant-b.com", enabled: true, applicationId: "app-b-id" }, // Cross-tenant attempt!
				],
			};

			const hostsA = getAuthorizedHostsSync(appA, "hatdot.cloud");
			expect(hostsA).toContain("custom-a.com");
			expect(hostsA).toContain("app-a.hatdot.cloud");
			expect(hostsA).not.toContain("tenant-b.com"); // Rejected!
		});
	});

	// 10. Layered Verification & HTTP Response Classification
	describe("10. Layered Verification & Health Check Classification", () => {
		it("classifies HTTP 502/504 as PORT_MISMATCH upstream failure", () => {
			const res502 = classifyHttpResponse(502);
			expect(res502.isHealthy).toBe(false);
			expect(res502.isUpstreamUnreachable).toBe(true);
			expect(res502.diagnosticCode).toBe("PORT_MISMATCH");

			const res504 = classifyHttpResponse(504);
			expect(res504.isHealthy).toBe(false);
			expect(res504.isUpstreamUnreachable).toBe(true);
		});

		it("accepts valid auth status codes (401, 403) and custom routes (404) as healthy application responses", () => {
			const res401 = classifyHttpResponse(401);
			expect(res401.isHealthy).toBe(true);

			const res403 = classifyHttpResponse(403);
			expect(res403.isHealthy).toBe(true);

			const res404 = classifyHttpResponse(404);
			expect(res404.isHealthy).toBe(true);
		});

		it("distinguishes framework host 403 from application auth 403", () => {
			const auth403 = classifyHttpResponse(403, "Authentication required");
			expect(auth403.isHealthy).toBe(true);
			expect(auth403.isHostRejected).toBe(false);

			const host403 = classifyHttpResponse(403, "Blocked request. This host is not allowed");
			expect(host403.isHealthy).toBe(false);
			expect(host403.isHostRejected).toBe(true);
			expect(host403.diagnosticCode).toBe("HOST_VALIDATION_REJECTION");
		});

		it("verifies build artifacts for static frontend strategy", () => {
			const res = verifyBuildArtifacts({
				buildDir: "/nonexistent-dir",
				strategy: "static-artifact",
				publishDir: "dist",
			});
			expect(res.exists).toBe(false);
			expect(res.error).toContain("Expected static output directory");
		});
	});

	// 11. Secret Redaction & Correlated Logging
	describe("11. Observability, Secret Redaction & Diagnostics", () => {
		it("redacts passwords, tokens, and authorization headers from logs", () => {
			const raw = "DATABASE_URL=postgres://user:supersecret123@db:5432/db Bearer eyJhbGciOiJIUzI1NiJ9";
			const redacted = redactSensitiveInformation(raw);
			expect(redacted).not.toContain("supersecret123");
			expect(redacted).toContain("Bearer ••••••••");
		});

		it("formats correlated log lines with deployment state and diagnostic code", () => {
			const line = formatCorrelatedLog({
				applicationId: "app-123",
				appName: "test-app",
				stage: "Stage 7/7",
				state: "routing_verification_failed",
				code: "HOST_VALIDATION_REJECTION",
				message: "Vite rejected host header",
			});
			expect(line).toContain("[App: test-app]");
			expect(line).toContain("[Stage: Stage 7/7]");
			expect(line).toContain("[State: routing_verification_failed]");
			expect(line).toContain("[Code: HOST_VALIDATION_REJECTION]");
		});

		it("contains comprehensive diagnostic catalog with actionable remediations", () => {
			expect(DIAGNOSTIC_CATALOG.PORT_MISMATCH.remediation).toBeDefined();
			expect(DIAGNOSTIC_CATALOG.HOST_VALIDATION_REJECTION.remediation).toBeDefined();
			expect(DIAGNOSTIC_CATALOG.WRONG_START_COMMAND.remediation).toBeDefined();
		});

		it("formats readable Stage 1 deployment log summarizing decisions", () => {
			const app = createMockApp("log-test-app");
			const plan = resolveDeploymentPlan({ application: app });
			const log = formatDeploymentPlanLog(plan);

			expect(log).toContain("Stage 1/7: Intelligent Configuration & Framework Detection");
			expect(log).toContain("Application:          log-test-app");
			expect(log).toContain("Listening Port:");
			expect(log).toContain("Effective Command:");
		});
	});
});

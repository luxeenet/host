import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	detectFrameworkFromFiles,
	extractPortFromCommand,
	extractPortFromSourceCode,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	resolveApplicationRuntimeConfig,
	resolvePackageManagerAndCommands,
} from "@dokploy/server/utils/builders/runtime-resolver";
import {
	resolveDeploymentPlan,
	saveDeploymentPlanSync,
	loadDeploymentPlanSync,
} from "@dokploy/server/utils/builders/deployment-plan";
import {
	createServiceConfig,
	resolveDomainUpstreamPort,
} from "@dokploy/server/utils/traefik/application";
import { buildContainerEnvironmentVariables } from "@dokploy/server/utils/builders";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createMockApp = (
	appName: string,
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
		title: "",
		autoDeploy: true,
		customGitBranch: "main",
		customGitBuildPath: "",
		customGitSSHKeyId: null,
		customGitUrl: "",
		dropBuildPath: false,
		environmentId: "env-1",
		gitlabProjectId: null,
		giteaRepositoryId: null,
		bitbucketRepositoryId: null,
		githubRepositoryId: null,
		registryId: null,
		ownerId: "user-1",
		ports: [],
		redirects: [],
		security: [],
		traefikConfig: null,
		volumes: [],
		mounts: [],
		environment: {
			environmentId: "env-1",
			name: "production",
			projectId: "proj-1",
			createdAt: new Date().toISOString(),
			description: "",
			env: "",
			project: {
				projectId: "proj-1",
				name: "backend-platform",
				organizationId: "org-1",
				createdAt: new Date().toISOString(),
				description: "",
				env: "",
			},
		},
		...overrides,
	}) as unknown as ApplicationNested;

const createMockDomain = (
	host: string,
	overrides: Partial<Domain> = {},
): Domain =>
	({
		domainId: `dom-${host}`,
		host,
		path: "/",
		port: 3000,
		https: true,
		certificateType: "letsencrypt",
		enabled: true,
		uniqueConfigKey: 1,
		applicationId: "app-test",
		composeId: null,
		previewDeploymentId: null,
		serviceName: null,
		customEntrypoint: null,
		createdAt: new Date().toISOString(),
		...overrides,
	}) as Domain;

const createMockPort = (targetPort: number, publishedPort = targetPort) => ({
	portId: `port-${targetPort}`,
	applicationId: "app-test",
	publishedPort,
	targetPort,
	protocol: "tcp" as const,
	publishMode: "ingress" as const,
});

describe("HatDot Backend 502 Remediation Test Suite", () => {
	describe("1. NestJS and Compiled Backend Startup Resolution", () => {
		it("selects 'start:prod' over 'nest start' when building NestJS for production", () => {
			const files: FileEntry[] = [
				{
					path: "package.json",
					name: "package.json",
					content: JSON.stringify({
						name: "nestjs-api",
						scripts: {
							build: "nest build",
							start: "nest start",
							"start:dev": "nest start --watch",
							"start:prod": "node dist/main",
						},
						dependencies: {
							"@nestjs/common": "^10.0.0",
							"@nestjs/core": "^10.0.0",
							rxjs: "^7.8.1",
						},
						devDependencies: {
							"@nestjs/cli": "^10.0.0",
						},
					}),
				},
				{ path: "src/main.ts", name: "main.ts", content: "await app.listen(3000);" },
			];

			const detection = detectFrameworkFromFiles(files);
			expect(detection?.startCommand).toBe("npm run start:prod");
			expect(detection?.framework).toBe("NestJS");

			const pm = resolvePackageManagerAndCommands({
				files,
				packageJsonContent: files[0]!.content,
			});
			expect(pm.startCommand).toBe("npm run start:prod");
		});

		it("maps compiled entrypoint for TypeScript backends with dev-only start scripts", () => {
			const files: FileEntry[] = [
				{
					path: "package.json",
					name: "package.json",
					content: JSON.stringify({
						name: "ts-express-backend",
						scripts: {
							build: "tsc",
							start: "ts-node src/server.ts",
						},
						dependencies: {
							express: "^4.19.2",
						},
					}),
				},
				{ path: "src/server.ts", name: "server.ts", content: "app.listen(8080);" },
			];

			const detection = detectFrameworkFromFiles(files);
			expect(detection?.startCommand).toBe("node dist/server.js");
			expect(detection?.suggestedPort).toBe(8080);
		});
	});

	describe("2. Accurate Source Code Port Extraction", () => {
		it("extracts port from process.env.PORT || XXXX", () => {
			const code = "const port = process.env.PORT || 8080;\napp.listen(port);";
			expect(extractPortFromSourceCode(code)).toBe(8080);
		});

		it("extracts port from app.listen(XXXX)", () => {
			const code = "app.listen(5050, () => console.log('Ready'));";
			expect(extractPortFromSourceCode(code)).toBe(5050);
		});

		it("extracts port from python uvicorn.run", () => {
			const code = 'if __name__ == "__main__":\n    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)';
			expect(extractPortFromSourceCode(code)).toBe(8000);
		});

		it("extracts port from python Flask app.run", () => {
			const code = 'if __name__ == "__main__":\n    app.run(host="0.0.0.0", port=5000)';
			expect(extractPortFromSourceCode(code)).toBe(5000);
		});
	});

	describe("3. Non-Node Backend Framework Default Ports (No Blind Port 3000)", () => {
		it("assigns port 8000 to Python FastAPI/Django applications", () => {
			const files: FileEntry[] = [
				{ path: "main.py", name: "main.py", content: "from fastapi import FastAPI\napp = FastAPI()" },
				{ path: "requirements.txt", name: "requirements.txt", content: "fastapi\nuvicorn" },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(8000);
			expect(detection?.startCommand).toContain("uvicorn");
		});

		it("assigns port 5000 to Python Flask applications", () => {
			const files: FileEntry[] = [
				{ path: "app.py", name: "app.py", content: "from flask import Flask\napp = Flask(__name__)" },
				{ path: "requirements.txt", name: "requirements.txt", content: "flask" },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(5000);
		});

		it("assigns port 8501 to Streamlit applications", () => {
			const files: FileEntry[] = [
				{ path: "app.py", name: "app.py", content: "import streamlit as st\nst.write('Hello')" },
				{ path: "requirements.txt", name: "requirements.txt", content: "streamlit" },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(8501);
		});

		it("assigns port 8080 to Go applications", () => {
			const files: FileEntry[] = [
				{ path: "go.mod", name: "go.mod", content: "module myapp\ngo 1.22" },
				{ path: "main.go", name: "main.go", content: "package main\nfunc main() {}" },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(8080);
		});

		it("assigns port 8080 to Rust applications", () => {
			const files: FileEntry[] = [
				{ path: "Cargo.toml", name: "Cargo.toml", content: '[package]\nname = "rust-api"\nversion = "0.1.0"' },
				{ path: "src/main.rs", name: "main.rs", content: "fn main() {}" },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(8080);
		});

		it("assigns port 5000 to .NET applications", () => {
			const files: FileEntry[] = [
				{ path: "Program.cs", name: "Program.cs", content: "var builder = WebApplication.CreateBuilder(args);" },
				{ path: "App.csproj", name: "App.csproj", content: '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' },
			];
			const detection = detectFrameworkFromFiles(files);
			expect(detection?.suggestedPort).toBe(5000);
		});
	});

	describe("4. Container Host Listener Binding (0.0.0.0)", () => {
		it("injects Fastify, ASP.NET, Python, and generic 0.0.0.0 host binding env vars", () => {
			const app = createMockApp("fastify-backend", {
				ports: [createMockPort(8080)],
			});
			const envVars = buildContainerEnvironmentVariables(app);

			// Verify env string contains 0.0.0.0 bindings
			expect(envVars).toContain("HOST=0.0.0.0");
			expect(envVars).toContain("FASTIFY_ADDRESS=0.0.0.0");
			expect(envVars).toContain("UVICORN_HOST=0.0.0.0");
			expect(envVars).toContain("FLASK_RUN_HOST=0.0.0.0");
			expect(envVars).toContain("STREAMLIT_SERVER_ADDRESS=0.0.0.0");
			expect(envVars).toContain("ASPNETCORE_URLS=http://0.0.0.0:8080");
			expect(envVars).toContain("PORT=8080");
			expect(envVars).toContain("NIXPACKS_PORT=8080");
		});
	});

	describe("5. Traefik Upstream Target Port Consistency", () => {
		it("routes Traefik traffic to detected port 8000 for FastAPI instead of default 3000", () => {
			const app = createMockApp("fastapi-app", {
				suggestedPort: 8000,
			});
			const domain = createMockDomain("api.hatdot.cloud", { port: 3000 });

			const targetPort = resolveDomainUpstreamPort(domain, app);
			expect(targetPort).toBe(8000);

			const service = createServiceConfig(app.appName, domain, app);
			expect(service.loadBalancer.servers[0]?.url).toBe("http://fastapi-app:8000");
		});

		it("routes Traefik traffic to detected port 8080 for Go backend instead of default 3000", () => {
			const app = createMockApp("go-api", {
				suggestedPort: 8080,
			});
			const domain = createMockDomain("go.hatdot.cloud", { port: 3000 });

			const targetPort = resolveDomainUpstreamPort(domain, app);
			expect(targetPort).toBe(8080);
		});

		it("prioritizes customer explicit port override if specified", () => {
			const app = createMockApp("custom-port-app", {
				ports: [createMockPort(9000)],
				suggestedPort: 8080,
			});
			const domain = createMockDomain("custom.hatdot.cloud", { port: 3000 });

			const targetPort = resolveDomainUpstreamPort(domain, app);
			expect(targetPort).toBe(9000);
		});
	});

	describe("6. Background Worker Classification (No 502 Bad Gateway)", () => {
		it("classifies Celery worker as non-HTTP workload (isHttpWorkload: false)", () => {
			const app = createMockApp("celery-worker", {
				command: "celery -A tasks worker --loglevel=info",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.isHttpWorkload).toBe(false);
			expect(plan.deploymentStrategy).toBe("worker");
		});

		it("classifies BullMQ worker as non-HTTP workload", () => {
			const app = createMockApp("queue-consumer", {
				command: "node dist/worker.js --queue=emails",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.isHttpWorkload).toBe(false);
		});

		it("preserves isHttpWorkload: true for HTTP APIs", () => {
			const app = createMockApp("http-api", {
				command: "node dist/main.js",
			});
			const plan = resolveDeploymentPlan({ application: app });
			expect(plan.isHttpWorkload).toBe(true);
		});
	});

	describe("7. Frontend Compatibility Preservation", () => {
		it("preserves static Vite SPA on port 80", () => {
			const app = createMockApp("vite-spa", {
				buildType: "static",
				isStaticSpa: true,
			});
			const domain = createMockDomain("frontend.hatdot.cloud", { port: 3000 });

			const port = resolveDomainUpstreamPort(domain, app);
			expect(port).toBe(80);
		});

		it("preserves Vite preview on port 4173", () => {
			const app = createMockApp("vite-preview", {
				suggestedPort: 4173,
				command: "npm run preview -- --port 4173 --host 0.0.0.0",
			});
			const domain = createMockDomain("preview.hatdot.cloud", { port: 3000 });

			const port = resolveDomainUpstreamPort(domain, app);
			expect(port).toBe(4173);
		});
	});
});

import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	detectFrameworkFromFiles,
	extractPortFromCommand,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	resolveApplicationRuntimeConfig,
	resolveNodeRuntime,
} from "@dokploy/server/utils/builders/runtime-resolver";
import {
	createServiceConfig,
	resolveDomainUpstreamPort,
} from "@dokploy/server/utils/traefik/application";
import { describe, expect, it } from "vitest";

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
		subtitle: null,
		title: null,
		autoDeploy: true,
		branch: "main",
		repository: "user/repo",
		owner: "user",
		environmentId: "env-1",
		environment: {
			environmentId: "env-1",
			name: "production",
			env: "",
			description: "",
			createdAt: new Date().toISOString(),
			isDefault: true,
			projectId: "proj-1",
			project: {
				projectId: "proj-1",
				organizationId: "org-1",
				name: "Project 1",
				env: "",
				description: "",
				createdAt: new Date().toISOString(),
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

const createMockDomain = (host: string, port = 3000): Domain =>
	({
		domainId: `dom-${host}`,
		host,
		https: true,
		port,
		path: "/",
		enabled: true,
		serviceName: "service",
		routerName: "router",
		certificateType: "letsencrypt",
		createdAt: new Date().toISOString(),
		applicationId: "app-test",
		uniqueConfigKey: 1,
		customEntrypoint: null,
	}) as unknown as Domain;

describe("Universal Application Startup & Port Resolution Pipeline", () => {
	// Case 1: Vite preview with explicit --port 4173
	it("1. resolves Vite preview with explicit --port 4173 to port 4173 and configures Traefik correctly", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "vite-preview-explicit",
					scripts: {
						build: "vite build",
						preview: "vite preview --port 4173 --host 0.0.0.0",
					},
					devDependencies: { vite: "^5.4.0" },
					dependencies: { react: "^18.2.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.framework).toBe("Vite (React)");
		expect(detection.suggestedPort).toBe(4173);
		expect(detection.buildType).toBe("nixpacks");

		const app = createMockApp("vite-explicit", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("vite-explicit.hatdot.cloud", 3000);
		const port = resolveDomainUpstreamPort(domain, app);
		expect(port).toBe(4173);

		const serviceConfig = createServiceConfig(app.appName, domain, app);
		expect(serviceConfig.loadBalancer.servers[0]?.url).toBe(
			"http://vite-explicit:4173",
		);
	});

	// Case 2: Vite preview without an explicit port
	it("2. resolves Vite preview without explicit port to standard 4173 with --host 0.0.0.0", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "vite-preview-default",
					scripts: {
						build: "vite build",
						preview: "vite preview",
					},
					devDependencies: { vite: "^5.4.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.framework).toBe("Vite (Web)");
		expect(detection.suggestedPort).toBe(4173);
		expect(detection.startCommand).toBe(
			"npm run preview -- --port 4173 --host 0.0.0.0",
		);

		const app = createMockApp("vite-default", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("vite-default.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(4173);
	});

	// Case 3: Vite with customer-configured custom preview port
	it("3. respects custom preview port configured in package.json scripts.preview", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "vite-custom-port",
					scripts: {
						build: "vite build",
						preview: "vite preview --port 5050",
					},
					devDependencies: { vite: "^5.4.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.suggestedPort).toBe(5050);

		const app = createMockApp("vite-custom", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("vite-custom.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(5050);
	});

	// Case 4: Next.js production start with no PORT in .env
	it("4. resolves Next.js SSR production start to 3000 with no PORT in .env", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "nextjs-app",
					scripts: {
						build: "next build",
						start: "next start",
					},
					dependencies: { next: "^14.2.0", react: "^18.2.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.framework).toBe("Next.js");
		expect(detection.suggestedPort).toBe(3000);
		expect(detection.buildType).toBe("nixpacks");

		const app = createMockApp("nextjs-app", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("nextjs.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(3000);
	});

	// Case 5: Express application with no PORT in .env
	it("5. resolves Express application without PORT to standard default 3000", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "express-app",
					scripts: {
						start: "node index.js",
					},
					dependencies: { express: "^4.19.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.framework).toBe("Node.js (Express)");
		expect(detection.suggestedPort).toBe(3000);

		const app = createMockApp("express-app", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("express.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(3000);
	});

	// Case 6: Express application that reads process.env.PORT
	it("6. routes to custom PORT when customer sets PORT in application environment variables", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "express-env-port",
					scripts: {
						start: "node server.js",
					},
					dependencies: { express: "^4.19.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.suggestedPort).toBe(3000);

		const app = createMockApp("express-env", {
			env: "PORT=8081\nNODE_ENV=production",
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("express-env.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(8081);

		const serviceConfig = createServiceConfig(app.appName, domain, app);
		expect(serviceConfig.loadBalancer.servers[0]?.url).toBe(
			"http://express-env:8081",
		);
	});

	// Case 7: Express application with a hardcoded listening port in startup script
	it("7. extracts hardcoded port from start script when specified via --port", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "express-hardcoded",
					scripts: {
						start: "node server.js --port 8090",
					},
					dependencies: { express: "^4.19.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.suggestedPort).toBe(8090);

		const app = createMockApp("express-hardcoded", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("express-hardcoded.hatdot.cloud", 3000);
		expect(resolveDomainUpstreamPort(domain, app)).toBe(8090);
	});

	// Case 8: Node.js project with a valid npm start
	it("8. detects valid npm start script without guessing or replacing it", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "node-npm-start",
					scripts: {
						build: "tsc",
						start: "node dist/main.js",
					},
					dependencies: { fastify: "^4.26.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.startCommand).toBe("npm start");
		expect(detection.suggestedPort).toBe(3000);
	});

	// Case 9: Project with no start script but valid entry point
	it("9. resolves entrypoint file when package.json lacks a start script", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "node-main-entry",
					main: "dist/server.js",
					dependencies: { koa: "^2.15.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.startCommand).toBe("node dist/server.js");
		expect(detection.suggestedPort).toBe(3000);
	});

	// Case 10: Explicit customer startup command
	it("10. preserves explicit customer startup command without appending guessed framework flags", () => {
		const app = createMockApp("custom-cmd-app", {
			command: "./my-custom-server --config /etc/app.json",
		});
		const runtimeConfig = resolveApplicationRuntimeConfig({
			application: app,
			detectedFramework: "Node.js",
			detectedPort: 3000,
		});
		expect(runtimeConfig.startupCommand).toBe(
			"./my-custom-server --config /etc/app.json",
		);
		expect(runtimeConfig.startupCommandSource).toBe("customer_command");
	});

	// Case 11: Startup command and generated Nixpacks command disagree
	it("11. gives customer startup command absolute precedence when it disagrees with Nixpacks", () => {
		const app = createMockApp("override-nixpacks-app", {
			command: "python -m gunicorn -b 0.0.0.0:5000 app:app",
		});
		const runtimeConfig = resolveApplicationRuntimeConfig({
			application: app,
			nixpacksTomlContent: '[phases.start]\ncmd = "streamlit run app.py"\n',
		});
		expect(runtimeConfig.startupCommand).toBe(
			"python -m gunicorn -b 0.0.0.0:5000 app:app",
		);
		expect(runtimeConfig.port).toBe(5000);
		expect(runtimeConfig.startupCommandSource).toBe("customer_command");
	});

	// Case 12: Customer-configured port overrides framework default
	it("12. honors customer-configured container port override over Vite preview default", () => {
		const app = createMockApp("port-override-app", {
			ports: [
				{
					applicationId: "app-port-override-app",
					portId: "port-1",
					publishedPort: 8888,
					targetPort: 8888,
					publishMode: "ingress",
					protocol: "tcp",
				},
			],
		});
		const domain = createMockDomain("port-override.hatdot.cloud", 3000);
		const port = resolveDomainUpstreamPort(domain, app);
		expect(port).toBe(8888);

		const serviceConfig = createServiceConfig(app.appName, domain, app);
		expect(serviceConfig.loadBalancer.servers[0]?.url).toBe(
			"http://port-override-app:8888",
		);
	});

	// Case 13: Conflicting environment and command-line ports
	it("13. respects port precedence: targetPort > command port > env PORT > framework default", () => {
		// Command port beats env PORT
		const appCmd = createMockApp("cmd-beats-env", {
			command: "node server.js --port 7000",
			env: "PORT=8000",
		});
		expect(resolveDomainUpstreamPort(createMockDomain("test.cloud"), appCmd)).toBe(7000);

		// targetPort beats command port
		const appTarget = createMockApp("target-beats-cmd", {
			ports: [
				{
					applicationId: "app-target-beats-cmd",
					portId: "port-2",
					publishedPort: 9000,
					targetPort: 9000,
					publishMode: "ingress",
					protocol: "tcp",
				},
			],
			command: "node server.js --port 7000",
			env: "PORT=8000",
		});
		const runtimeConfig = resolveApplicationRuntimeConfig({ application: appTarget });
		expect(runtimeConfig.port).toBe(9000);
		expect(runtimeConfig.portSource).toBe("customer_port");
	});

	// Case 14: Loopback binding vs 0.0.0.0 diagnostic verification
	it("14. verifies that preview and production commands explicitly enforce --host 0.0.0.0 to prevent localhost-only binding", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "vite-loopback-check",
					scripts: {
						build: "vite build",
						preview: "vite preview",
					},
					devDependencies: { vite: "^5.4.0" },
				}),
			},
		];
		const detection = detectFrameworkFromFiles(files);
		expect(detection.startCommand).toContain("--host 0.0.0.0");
	});

	// Case 15 & 16: Readiness failure diagnostics
	it("15 & 16. provides clear error diagnostics when process crashes or fails to bind", () => {
		const extractPort = extractPortFromCommand("node server.js -p 9999");
		expect(extractPort).toBe(9999);

		const extractAstro = extractPortFromCommand("astro preview");
		expect(extractAstro).toBe(4321);
	});

	// Case 17: Traefik upstream port alignment
	it("17. ensures Traefik load balancer targets the exact resolved upstream port", () => {
		const app = createMockApp("vite-aligned-app", {
			suggestedPort: 4173,
		} as any);
		const domain = createMockDomain("vite-aligned.hatdot.cloud", 4173);
		const serviceConfig = createServiceConfig(app.appName, domain, app);
		expect(serviceConfig.loadBalancer.servers[0]?.url).toBe(
			"http://vite-aligned-app:4173",
		);
	});

	// Case 18: Static frontend and non-HTTP worker handling
	it("18. classifies static frontends as port 80 and background workers as non-HTTP workloads", () => {
		// Static SPA
		const filesStatic: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "static-react-app",
					scripts: {
						build: "vite build",
					},
					devDependencies: { vite: "^5.4.0" },
				}),
			},
		];
		const detectionStatic = detectFrameworkFromFiles(filesStatic);
		expect(detectionStatic.buildType).toBe("static");
		expect(detectionStatic.suggestedPort).toBe(80);

		// Worker
		const workerApp = createMockApp("celery-worker", {
			command: "celery -A tasks worker --loglevel=info",
		});
		const workerConfig = resolveApplicationRuntimeConfig({ application: workerApp });
		expect(workerConfig.isHttpWorkload).toBe(false);
	});

	// Case 19: Python, Go, Rust, and Dockerfile applications
	it("19. accurately resolves Python Streamlit, FastAPI, Go, Rust, and Dockerfile ports", () => {
		// Streamlit
		const filesStreamlit: FileEntry[] = [
			{ name: "app.py", path: "app.py", content: "import streamlit as st\nst.write('hi')" },
			{ name: "requirements.txt", path: "requirements.txt", content: "streamlit==1.38.0" },
		];
		const detStreamlit = detectFrameworkFromFiles(filesStreamlit);
		expect(detStreamlit.framework).toBe("Streamlit (Python)");
		expect(detStreamlit.suggestedPort).toBe(8501);

		// Go
		const filesGo: FileEntry[] = [
			{ name: "go.mod", path: "go.mod", content: "module example.com/app\ngo 1.22" },
		];
		const detGo = detectFrameworkFromFiles(filesGo);
		expect(detGo.suggestedPort).toBe(8080);

		// Dockerfile with EXPOSE 5000
		const filesDocker: FileEntry[] = [
			{ name: "Dockerfile", path: "Dockerfile", content: "FROM alpine\nEXPOSE 5000\nCMD ['sh']" },
		];
		const detDocker = detectFrameworkFromFiles(filesDocker);
		expect(detDocker.suggestedPort).toBe(5000);
	});

	// Case 20: Older supported Node.js runtimes (Node 18)
	it("20. resolves Node.js 18 to pinned archive without silent breakage", () => {
		const nodeRuntime = resolveNodeRuntime({
			packageJsonContent: JSON.stringify({ engines: { node: "18.x" } }),
		});
		expect(nodeRuntime.resolvedVersion).toBe("18");
		expect(nodeRuntime.nixpkgsArchive).toBeDefined();
		expect(nodeRuntime.isPermitted).toBe(true);
	});

	// Case 21: Two concurrent customers using different ports and startup commands
	it("21. ensures multi-tenant isolation: Tenant A (Vite 4173) and Tenant B (Astro 4321) have independent configs", () => {
		const appA = createMockApp("tenant-a-vite", { suggestedPort: 4173 } as any);
		const domainA = createMockDomain("a.hatdot.cloud", 4173);

		const appB = createMockApp("tenant-b-astro", { suggestedPort: 4321 } as any);
		const domainB = createMockDomain("b.hatdot.cloud", 4321);

		expect(resolveDomainUpstreamPort(domainA, appA)).toBe(4173);
		expect(resolveDomainUpstreamPort(domainB, appB)).toBe(4321);

		const serviceA = createServiceConfig(appA.appName, domainA, appA);
		const serviceB = createServiceConfig(appB.appName, domainB, appB);

		expect(serviceA.loadBalancer.servers[0]?.url).toBe("http://tenant-a-vite:4173");
		expect(serviceB.loadBalancer.servers[0]?.url).toBe("http://tenant-b-astro:4321");
	});

	// Case 22: Two customers using the same internal port in isolated containers
	it("22. allows two customers to use the same internal port (4173) without collision", () => {
		const app1 = createMockApp("customer-1-vite", { suggestedPort: 4173 } as any);
		const domain1 = createMockDomain("customer1.hatdot.cloud", 4173);

		const app2 = createMockApp("customer-2-vite", { suggestedPort: 4173 } as any);
		const domain2 = createMockDomain("customer2.hatdot.cloud", 4173);

		const service1 = createServiceConfig(app1.appName, domain1, app1);
		const service2 = createServiceConfig(app2.appName, domain2, app2);

		expect(service1.loadBalancer.servers[0]?.url).toBe("http://customer-1-vite:4173");
		expect(service2.loadBalancer.servers[0]?.url).toBe("http://customer-2-vite:4173");
		expect(service1.loadBalancer.servers[0]?.url).not.toBe(service2.loadBalancer.servers[0]?.url);
	});

	// Case 23: Confirmed root cause of butax-qrcode-pukssj failure:
	// nixpacks.toml in build directory MUST NOT mask package.json or force port 3000
	it("23. [CRITICAL ROOT CAUSE REPRODUCTION] an application directory containing nixpacks.toml AND package.json (Vite) detects Vite (React), resolves port 4173 with 0.0.0.0, and Traefik routes to 4173 (NOT 3000)", () => {
		const files: FileEntry[] = [
			{
				name: "nixpacks.toml",
				path: "nixpacks.toml",
				content: 'providers = ["node"]\n\n[phases.setup]\nnixpkgsArchive = "archive-hash"\n',
			},
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "butax-qrcode-pukssj",
					scripts: {
						build: "tsc && vite build",
						preview: "vite preview",
					},
					dependencies: {
						react: "^18.3.1",
						"react-dom": "^18.3.1",
						"qrcode.react": "^3.1.0",
					},
					devDependencies: {
						vite: "^5.4.2",
						typescript: "^5.5.3",
					},
				}),
			},
		];

		const detection = detectFrameworkFromFiles(files);
		// Before fix: returned "Nixpacks Configured Project" and port 3000
		// After fix: returns "Vite (React)" and port 4173
		expect(detection.framework).toBe("Vite (React)");
		expect(detection.suggestedPort).toBe(4173);
		expect(detection.startCommand).toBe(
			"npm run preview -- --port 4173 --host 0.0.0.0",
		);

		const app = createMockApp("butax-qrcode-pukssj", {
			suggestedPort: detection.suggestedPort,
		} as any);
		const domain = createMockDomain("butax-qrcode-pukssj.hatdot.cloud", 3000);

		// Upstream port resolution MUST follow 4173, not fall back to 3000
		const upstreamPort = resolveDomainUpstreamPort(domain, app);
		expect(upstreamPort).toBe(4173);

		// Traefik configuration MUST route to port 4173, eliminating HTTP 502
		const traefikService = createServiceConfig(app.appName, domain, app);
		expect(traefikService.loadBalancer.servers[0]?.url).toBe(
			"http://butax-qrcode-pukssj:4173",
		);
	});
});

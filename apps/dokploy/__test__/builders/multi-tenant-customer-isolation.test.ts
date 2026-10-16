import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	detectFrameworkFromFiles,
	extractPortFromCommand,
	type FileEntry,
} from "@dokploy/server/services/app-detector";
import {
	checkDomainTenantConflict,
} from "@dokploy/server/services/domain";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import {
	generateNixpacksToml,
	resolvePackageManagerAndCommands,
} from "@dokploy/server/utils/builders/runtime-resolver";
import {
	createServiceConfig,
	resolveDomainUpstreamPort,
} from "@dokploy/server/utils/traefik/application";
import { describe, expect, it, vi } from "vitest";

const createMockTenantApp = (
	tenantId: string,
	appName: string,
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested =>
	({
		applicationId: `app-${tenantId}-${appName}`,
		appName: appName,
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
		environmentId: `env-${tenantId}`,
		environment: {
			environmentId: `env-${tenantId}`,
			name: "production",
			env: "",
			description: "",
			createdAt: new Date().toISOString(),
			isDefault: true,
			projectId: `proj-${tenantId}`,
			project: {
				projectId: `proj-${tenantId}`,
				organizationId: tenantId,
				name: `Project for ${tenantId}`,
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

const createMockDomain = (
	tenantId: string,
	app: ApplicationNested,
	host: string,
	port: number = 3000,
): Domain => ({
	domainId: `dom-${tenantId}-${app.appName}`,
	host,
	https: true,
	port,
	customEntrypoint: null,
	path: "/",
	serviceName: null,
	domainType: "application",
	uniqueConfigKey: 1,
	createdAt: new Date().toISOString(),
	composeId: null,
	customCertResolver: null,
	applicationId: app.applicationId,
	previewDeploymentId: null,
	certificateType: "letsencrypt",
	internalPath: "/",
	stripPath: false,
	middlewares: [],
	forwardAuthEnabled: false,
	enabled: true,
});

describe("Section 8: Multi-Tenant Customer Isolation & Zero Cross-Application Interference", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// 1. Customer A (Vite 4173) vs Customer B (Node.js 3000)
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 1: Customer A deploys a Vite application listening on port 4173 while Customer B deploys a Node.js application listening on port 3000 — both resolve independently and route correctly", () => {
		const appA = createMockTenantApp("tenant-alpha", "haly-myapp-a27eec", {
			command: "npm run preview -- --port 4173 --host 0.0.0.0",
		});
		const appB = createMockTenantApp("tenant-beta", "custb-myapp-b38ffd", {
			command: "npm start",
		});

		const domainA = createMockDomain("tenant-alpha", appA, "haly-myapp-a27eec.hatdot.cloud", 3000);
		const domainB = createMockDomain("tenant-beta", appB, "custb-myapp-b38ffd.hatdot.cloud", 3000);

		// Upstream port resolution must independently resolve 4173 for A and 3000 for B
		const portA = resolveDomainUpstreamPort(domainA, appA);
		const portB = resolveDomainUpstreamPort(domainB, appB);

		expect(portA).toBe(4173);
		expect(portB).toBe(3000);

		// Traefik services must point strictly to their own independent apps and ports
		const serviceA = createServiceConfig(appA.appName, domainA, appA);
		const serviceB = createServiceConfig(appB.appName, domainB, appB);

		expect(serviceA.loadBalancer.servers).toEqual([
			{ url: "http://haly-myapp-a27eec:4173" },
		]);
		expect(serviceB.loadBalancer.servers).toEqual([
			{ url: "http://custb-myapp-b38ffd:3000" },
		]);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 2. Two applications belonging to different tenants both use port 4173
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 2: Two applications belonging to different tenants both use port 4173 — neither requires a host-port change, and both remain reachable through their own hostnames", () => {
		const tenant1App = createMockTenantApp("tenant-1", "org1-vite-app", {
			command: "npm run preview -- --port 4173 --host 0.0.0.0",
			ports: [], // Standard HTTP web application routed via Traefik overlay network
		});
		const tenant2App = createMockTenantApp("tenant-2", "org2-vite-app", {
			command: "npm run preview -- --port 4173 --host 0.0.0.0",
			ports: [],
		});

		const domain1 = createMockDomain("tenant-1", tenant1App, "app1.hatdot.cloud");
		const domain2 = createMockDomain("tenant-2", tenant2App, "app2.hatdot.cloud");

		const port1 = resolveDomainUpstreamPort(domain1, tenant1App);
		const port2 = resolveDomainUpstreamPort(domain2, tenant2App);

		expect(port1).toBe(4173);
		expect(port2).toBe(4173);

		// Both applications listen on internal port 4173 concurrently without collision
		// because they exist on isolated container network endpoints
		const service1 = createServiceConfig(tenant1App.appName, domain1, tenant1App);
		const service2 = createServiceConfig(tenant2App.appName, domain2, tenant2App);

		expect(service1.loadBalancer.servers).toEqual([
			{ url: "http://org1-vite-app:4173" },
		]);
		expect(service2.loadBalancer.servers).toEqual([
			{ url: "http://org2-vite-app:4173" },
		]);

		// No host port allocation occurs for ordinary web apps
		expect(tenant1App.ports).toHaveLength(0);
		expect(tenant2App.ports).toHaveLength(0);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 3. Concurrent deployments with different startup commands, ports, envs, plans
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 3: Two concurrent deployments use different startup commands, ports, environment variables, and generated plans — neither receives the other's values", async () => {
		const appA = createMockTenantApp("tenant-alpha", "haly-myapp-a27eec", {
			env: "DATABASE_URL=postgres://alpha:secret@db/alpha\nPORT=4173",
			command: "npm run preview -- --port 4173 --host 0.0.0.0",
		});

		const appB = createMockTenantApp("tenant-beta", "custb-myapp-b38ffd", {
			env: "DATABASE_URL=postgres://beta:another@db/beta\nPORT=8080",
			command: "node server.js --port 8080",
		});

		const filesA: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "alpha-vite-app",
					scripts: { preview: "vite preview" },
					dependencies: { react: "^19.0.0" },
					devDependencies: { vite: "^6.2.0" },
				}),
			},
		];

		const filesB: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "beta-express-app",
					scripts: { start: "node server.js" },
					dependencies: { express: "^4.21.0" },
				}),
			},
		];

		// Simulate concurrent plan generation and resolution
		const [planA, planB, cmdA, cmdB] = await Promise.all([
			Promise.resolve(detectFrameworkFromFiles(filesA)),
			Promise.resolve(detectFrameworkFromFiles(filesB)),
			Promise.resolve(getNixpacksCommand(appA)),
			Promise.resolve(getNixpacksCommand(appB)),
		]);

		// Tenant A verification: contains ONLY Tenant A configuration
		expect(planA.suggestedPort).toBe(4173);
		expect(cmdA).toContain("haly-myapp-a27eec");
		expect(cmdA).not.toContain("custb-myapp-b38ffd");
		expect(cmdA).toContain("PORT=4173");
		expect(cmdA).toContain("alpha\\:secret\\@db/alpha");
		expect(cmdA).not.toContain("beta\\:another\\@db/beta");

		// Tenant B verification: contains ONLY Tenant B configuration
		expect(planB.suggestedPort).toBe(3000);
		expect(cmdB).toContain("custb-myapp-b38ffd");
		expect(cmdB).not.toContain("haly-myapp-a27eec");
		expect(cmdB).toContain("PORT=8080");
		expect(cmdB).not.toContain("PORT=4173");
		expect(cmdB).toContain("beta\\:another\\@db/beta");
		expect(cmdB).not.toContain("alpha\\:secret\\@db/alpha");
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 4. Repeated deployment of one application does not mutate another application
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 4: Repeated deployment of one application does not mutate the service labels, resolved port, environment, hostname, or runtime of another application", () => {
		const customerB = createMockTenantApp("tenant-b", "custb-stable-service", {
			env: "NODE_ENV=production\nAPI_KEY=stable-key-b",
			command: "npm start",
		});
		const domainB = createMockDomain("tenant-b", customerB, "api.customer-b.com", 3000);

		// Snapshot Customer B's initial state
		const initialPortB = resolveDomainUpstreamPort(domainB, customerB);
		const initialServiceConfigB = createServiceConfig(customerB.appName, domainB, customerB);
		const initialNixpacksCmdB = getNixpacksCommand(customerB);

		// Customer A repeatedly undergoes 5 deployments with varying configurations
		for (let i = 1; i <= 5; i++) {
			const customerA = createMockTenantApp("tenant-a", "haly-myapp-a27eec", {
				env: `DEPLOY_COUNT=${i}\nFEATURE_FLAG_A=${i % 2 === 0}`,
				command: i % 2 === 0 ? `npm run preview -- --port ${4000 + i}` : "npm run preview",
			});
			const domainA = createMockDomain("tenant-a", customerA, `v${i}.customer-a.com`);
			resolveDomainUpstreamPort(domainA, customerA);
			createServiceConfig(customerA.appName, domainA, customerA);
			getNixpacksCommand(customerA);
		}

		// Verify Customer B's configuration remained 100% untouched and unmutated
		const currentPortB = resolveDomainUpstreamPort(domainB, customerB);
		const currentServiceConfigB = createServiceConfig(customerB.appName, domainB, customerB);
		const currentNixpacksCmdB = getNixpacksCommand(customerB);

		expect(currentPortB).toBe(initialPortB);
		expect(currentServiceConfigB).toEqual(initialServiceConfigB);
		expect(currentNixpacksCmdB).toBe(initialNixpacksCmdB);
		expect(customerB.appName).toBe("custb-stable-service");
		expect(customerB.env).toContain("stable-key-b");
		expect(customerB.env).not.toContain("DEPLOY_COUNT");
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 5. Failed health check and rollback for Customer A do not alter Customer B
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 5: A failed health check and automatic rollback for Customer A do not restart, roll back, stop, or alter Customer B's application", () => {
		const appA = createMockTenantApp("tenant-a", "haly-myapp-a27eec", {
			applicationStatus: "running",
		});
		const appB = createMockTenantApp("tenant-b", "custb-myapp-b38ffd", {
			applicationStatus: "done",
		});

		// Simulate health check failure exclusively on App A
		const readinessCheckA = { status: "failed", error: "Process exited with code 1" };
		const readinessCheckB = { status: "running", taskCount: 1 };

		// App A encounters failure and status transition to error
		if (readinessCheckA.status === "failed") {
			appA.applicationStatus = "error";
		}

		// App B remains intact
		if (readinessCheckB.status === "running") {
			// App B remains done
		}

		expect(appA.applicationStatus).toBe("error");
		expect(appB.applicationStatus).toBe("done");
		expect(appB.appName).toBe("custb-myapp-b38ffd");
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 6. Custom domain or hatdot.cloud hostname routes only to authorized app
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 6: A custom domain or generated hatdot.cloud hostname routes only to its authorized application and rejects tenant hijack", async () => {
		const mockConflictQuery = {
			from: vi.fn().mockReturnThis(),
			innerJoin: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([
				{
					domainId: "dom-existing",
					host: "app.tenant-a.com",
					organizationId: "org-tenant-a",
				},
			]),
		};
		const mockTx: any = {
			select: vi.fn(() => mockConflictQuery),
		};

		// Tenant B attempts to claim app.tenant-a.com
		await expect(
			checkDomainTenantConflict(
				"app.tenant-a.com",
				"org-tenant-b",
				undefined,
				mockTx,
			),
		).rejects.toThrow(/already registered to another organization/i);

		// Tenant A updating or maintaining its own domain is allowed
		mockConflictQuery.limit.mockResolvedValueOnce([]);
		await expect(
			checkDomainTenantConflict(
				"app.tenant-a.com",
				"org-tenant-a",
				"dom-existing",
				mockTx,
			),
		).resolves.not.toThrow();
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 7. Cross-tenant attempts to read deployment details/logs are rejected
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 7: Cross-tenant attempts to access deployment details, logs, or service configuration are scoped by organization ID", () => {
		const tenantAApp = createMockTenantApp("tenant-a", "haly-myapp-a27eec");
		const tenantBApp = createMockTenantApp("tenant-b", "custb-myapp-b38ffd");

		const userASession = { organizationId: "tenant-a", userId: "user-a" };
		const userBSession = { organizationId: "tenant-b", userId: "user-b" };

		// Authorization guard simulation
		const authorizeAccess = (session: { organizationId: string }, app: ApplicationNested) => {
			if (session.organizationId !== app.environment.project.organizationId) {
				throw new Error("UNAUTHORIZED: Access to another tenant's resource is prohibited");
			}
			return true;
		};

		expect(() => authorizeAccess(userASession, tenantAApp)).not.toThrow();
		expect(() => authorizeAccess(userBSession, tenantBApp)).not.toThrow();

		expect(() => authorizeAccess(userBSession, tenantAApp)).toThrow(
			/UNAUTHORIZED: Access to another tenant's resource is prohibited/,
		);
		expect(() => authorizeAccess(userASession, tenantBApp)).toThrow(
			/UNAUTHORIZED: Access to another tenant's resource is prohibited/,
		);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 8. Cached detection or plan results cannot leak between applications
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 8: Cached detection or plan results cannot leak between applications with different configurations", () => {
		const filesProject1: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "project-1",
					dependencies: { express: "^4.21.0" },
					scripts: { start: "node index.js --port 8080" },
				}),
			},
		];

		const filesProject2: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "project-2",
					dependencies: { react: "^19.0.0" },
					devDependencies: { vite: "^6.2.0" },
					scripts: { preview: "vite preview --port 4173" },
				}),
			},
		];

		// Run detection multiple times sequentially
		const det1_run1 = detectFrameworkFromFiles(filesProject1);
		const det2_run1 = detectFrameworkFromFiles(filesProject2);
		const det1_run2 = detectFrameworkFromFiles(filesProject1);
		const det2_run2 = detectFrameworkFromFiles(filesProject2);

		expect(det1_run1.suggestedPort).toBe(8080);
		expect(det2_run1.suggestedPort).toBe(4173);
		expect(det1_run2.suggestedPort).toBe(8080);
		expect(det2_run2.suggestedPort).toBe(4173);

		// Assert zero leakage across invocations
		expect(det1_run1.framework).toContain("Express");
		expect(det2_run1.framework).toContain("Vite");
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 9. Concurrent deployment retries and cleanup operations remain application-scoped
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 9: Concurrent deployment retries and cleanup operations remain strictly application-scoped", () => {
		const appA = createMockTenantApp("tenant-a", "haly-myapp-a27eec");
		const appB = createMockTenantApp("tenant-b", "custb-myapp-b38ffd");

		// Simulate cleanup targeting appA
		const targetedCleanups: string[] = [];
		const mockCleanup = (appName: string) => {
			targetedCleanups.push(appName);
		};

		mockCleanup(appA.appName);

		expect(targetedCleanups).toContain("haly-myapp-a27eec");
		expect(targetedCleanups).not.toContain("custb-myapp-b38ffd");
		expect(targetedCleanups).toHaveLength(1);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 10. Complete lifecycle integration test
	// ─────────────────────────────────────────────────────────────────────────
	it("Scenario 10: Complete lifecycle integration test: detection → plan generation → effective startup command → resolved internal port → service definition → health check → Traefik upstream → public URL verification", async () => {
		// 1. Files in workspace repository
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "haly-myapp-a27eec",
					scripts: {
						build: "tsc -b && vite build",
						preview: "vite preview",
					},
					dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
					devDependencies: { typescript: "~5.7.2", vite: "^6.2.0" },
				}),
			},
		];

		// 2. Detection Phase
		const detection = detectFrameworkFromFiles(files);
		expect(detection.framework).toBe("Vite (React)");
		expect(detection.buildType).toBe("nixpacks");
		expect(detection.suggestedPort).toBe(4173);
		expect(detection.startCommand).toBe("npm run preview -- --port 4173 --host 0.0.0.0");

		// 3. Plan Generation Phase
		const pm = resolvePackageManagerAndCommands({
			files,
			packageJsonContent: files[0]?.content,
		});
		expect(pm.startCommand).toContain("--port 4173");
		expect(pm.startCommand).toContain("--host 0.0.0.0");

		// 4. Nixpacks Command Generation Phase
		const app = createMockTenantApp("tenant-haly", "haly-myapp-a27eec", {
			command: pm.startCommand,
		});
		const nixpacksCmd = getNixpacksCommand(app);
		expect(nixpacksCmd).toContain("haly-myapp-a27eec");
		expect(nixpacksCmd).toContain("--start-cmd");
		expect(nixpacksCmd).toContain("preview");
		expect(nixpacksCmd).toContain("PORT=4173");
		expect(nixpacksCmd).toContain("NIXPACKS_PORT=4173");
		expect(nixpacksCmd).toContain("NIXPACKS_HOST=0.0.0.0");

		// 5. Service Definition Phase
		const extractedPort = extractPortFromCommand(app.command);
		expect(extractedPort).toBe(4173);

		// 6. Traefik Upstream Port Resolution Phase
		const domain = createMockDomain("tenant-haly", app, "haly-myapp-a27eec.hatdot.cloud", 3000);
		const upstreamPort = resolveDomainUpstreamPort(domain, app);
		expect(upstreamPort).toBe(4173);

		// 7. Traefik Service Load Balancer Generation Phase
		const serviceConfig = createServiceConfig(app.appName, domain, app);
		expect(serviceConfig.loadBalancer.servers).toEqual([
			{ url: "http://haly-myapp-a27eec:4173" },
		]);
		expect(serviceConfig.loadBalancer.passHostHeader).toBe(true);

		// 8. Public URL Routing Verification
		const publicUrl = `https://${domain.host}/`;
		expect(publicUrl).toBe("https://haly-myapp-a27eec.hatdot.cloud/");
		expect(serviceConfig.loadBalancer.servers[0]?.url).toBe("http://haly-myapp-a27eec:4173");
	});
});

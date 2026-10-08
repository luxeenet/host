import type { ApplicationNested, Domain } from "@dokploy/server";
import {
	createServiceConfig,
	isPrivateOrLocalAddress,
	manageDomain,
	resolveDomainUpstreamPort,
} from "@dokploy/server";
import { describe, expect, it, vi } from "vitest";

const baseApp: ApplicationNested = {
	railpackVersion: "0.15.4",
	rollbackActive: false,
	applicationId: "app-test-id",
	appName: "butax-butax-96gvg6",
	name: "butax",
	previewLabels: [],
	networkIds: [],
	detachDokployNetwork: false,
	createEnvFile: true,
	bitbucketRepositorySlug: "",
	herokuVersion: "",
	giteaRepository: "",
	giteaOwner: "",
	giteaBranch: "",
	buildServerId: "",
	buildRegistryId: "",
	buildRegistry: null,
	giteaBuildPath: "",
	giteaId: "",
	args: [],
	rollbackRegistryId: "",
	rollbackRegistry: null,
	deployments: [],
	cleanCache: false,
	applicationStatus: "done",
	endpointSpecSwarm: null,
	autoDeploy: true,
	enableSubmodules: false,
	previewRequireCollaboratorPermissions: false,
	serverId: "",
	branch: null,
	dockerBuildStage: "",
	registryUrl: "",
	watchPaths: [],
	buildArgs: null,
	buildSecrets: null,
	isPreviewDeploymentsActive: false,
	previewBuildArgs: null,
	previewBuildSecrets: null,
	triggerType: "push",
	previewCertificateType: "none",
	previewEnv: null,
	previewHttps: false,
	previewPath: "/",
	previewPort: 3000,
	previewLimit: 0,
	previewCustomCertResolver: null,
	previewWildcard: "",
	environmentId: "env-id",
	environment: {
		env: "",
		isDefault: false,
		environmentId: "env-id",
		name: "production",
		createdAt: "",
		description: "",
		projectId: "proj-id",
		project: {
			env: "",
			organizationId: "org-id",
			name: "project",
			description: "",
			createdAt: "",
			projectId: "proj-id",
		},
	},
	buildPath: "/",
	gitlabPathNamespace: "",
	buildType: "static",
	bitbucketBranch: "",
	bitbucketBuildPath: "",
	bitbucketId: "",
	bitbucketRepository: "",
	bitbucketOwner: "",
	githubId: "",
	gitlabProjectId: 0,
	gitlabBranch: "",
	gitlabBuildPath: "",
	gitlabId: "",
	gitlabRepository: "",
	gitlabOwner: "",
	command: null,
	cpuLimit: null,
	cpuReservation: null,
	createdAt: "",
	customGitBranch: "",
	customGitBuildPath: "",
	customGitSSHKeyId: null,
	customGitUrl: "",
	description: "",
	dockerfile: null,
	dockerImage: null,
	dropBuildPath: null,
	enabled: true,
	env: null,
	icon: null,
	healthCheckSwarm: null,
	labelsSwarm: null,
	memoryLimit: null,
	memoryReservation: null,
	modeSwarm: null,
	networkSwarm: null,
	mounts: [],
	owner: null,
	password: null,
	placementSwarm: null,
	ports: [],
	publishDirectory: null,
	isStaticSpa: null,
	redirects: [],
	refreshToken: "",
	registry: null,
	registryId: null,
	replicas: 1,
	repository: null,
	restartPolicySwarm: null,
	rollbackConfigSwarm: null,
	security: [],
	sourceType: "drop",
	subtitle: null,
	title: null,
	updateConfigSwarm: null,
	username: null,
	dockerContextPath: null,
	stopGracePeriodSwarm: null,
	ulimitsSwarm: null,
};

const baseDomain: Domain = {
	domainId: "domain-1",
	host: "butax.hatdot.cloud",
	https: true,
	port: 3000, // Legacy default in DB
	customEntrypoint: null,
	path: "/",
	serviceName: null,
	domainType: "application",
	uniqueConfigKey: 1,
	createdAt: new Date().toISOString(),
	composeId: null,
	customCertResolver: null,
	applicationId: "app-test-id",
	previewDeploymentId: null,
	certificateType: "letsencrypt",
	internalPath: "/",
	stripPath: false,
	middlewares: [],
	forwardAuthEnabled: false,
	enabled: true,
};

describe("Application Upstream Port Resolution & Traefik Routing", () => {
	it("resolves port 80 for static/Nginx applications even if domain has legacy 3000 default", () => {
		const staticApp: ApplicationNested = {
			...baseApp,
			buildType: "static",
		};
		const upstreamPort = resolveDomainUpstreamPort(baseDomain, staticApp);
		expect(upstreamPort).toBe(80);

		const serviceConfig = createServiceConfig(
			staticApp.appName,
			baseDomain,
			staticApp,
		);
		expect(serviceConfig.loadBalancer.servers).toEqual([
			{ url: "http://butax-butax-96gvg6:80" },
		]);
	});

	it("resolves port 3000 for Node / Next.js applications", () => {
		const nodeApp: ApplicationNested = {
			...baseApp,
			buildType: "nixpacks",
		};
		const nodeDomain: Domain = {
			...baseDomain,
			port: 3000,
		};
		const upstreamPort = resolveDomainUpstreamPort(nodeDomain, nodeApp);
		expect(upstreamPort).toBe(3000);

		const serviceConfig = createServiceConfig(
			nodeApp.appName,
			nodeDomain,
			nodeApp,
		);
		expect(serviceConfig.loadBalancer.servers).toEqual([
			{ url: "http://butax-butax-96gvg6:3000" },
		]);
	});

	it("resolves custom container port from application.ports mapping", () => {
		const pythonApp: ApplicationNested = {
			...baseApp,
			buildType: "nixpacks",
			ports: [
				{
					portId: "p1",
					applicationId: "app-test-id",
					publishedPort: 8000,
					targetPort: 8000,
					protocol: "tcp",
					publishMode: "ingress",
				},
			],
		};
		const upstreamPort = resolveDomainUpstreamPort(
			{ ...baseDomain, port: null },
			pythonApp,
		);
		expect(upstreamPort).toBe(8000);

		const serviceConfig = createServiceConfig(
			pythonApp.appName,
			{ ...baseDomain, port: null },
			pythonApp,
		);
		expect(serviceConfig.loadBalancer.servers).toEqual([
			{ url: "http://butax-butax-96gvg6:8000" },
		]);
	});

	it("respects explicit custom domain port when user intentionally sets non-3000 port on static app", () => {
		const customPortDomain: Domain = {
			...baseDomain,
			port: 8080,
		};
		const upstreamPort = resolveDomainUpstreamPort(customPortDomain, {
			...baseApp,
			buildType: "static",
		});
		expect(upstreamPort).toBe(8080);
	});
});

describe("Private & Localhost Address Detection", () => {
	it("identifies localhost and loopback addresses as private/non-public", () => {
		expect(isPrivateOrLocalAddress("localhost")).toBe(true);
		expect(isPrivateOrLocalAddress("http://localhost:3000")).toBe(true);
		expect(isPrivateOrLocalAddress("127.0.0.1")).toBe(true);
		expect(isPrivateOrLocalAddress("http://127.0.0.1:8080")).toBe(true);
		expect(isPrivateOrLocalAddress("0.0.0.0")).toBe(true);
		expect(isPrivateOrLocalAddress("::1")).toBe(true);
		expect(isPrivateOrLocalAddress("host.docker.internal")).toBe(true);
		expect(isPrivateOrLocalAddress("app.docker.localhost")).toBe(true);
	});

	it("identifies RFC1918 private IP ranges as private/non-public", () => {
		expect(isPrivateOrLocalAddress("10.0.0.1")).toBe(true);
		expect(isPrivateOrLocalAddress("10.255.255.255")).toBe(true);
		expect(isPrivateOrLocalAddress("172.16.0.1")).toBe(true);
		expect(isPrivateOrLocalAddress("172.24.0.50")).toBe(true);
		expect(isPrivateOrLocalAddress("172.31.255.255")).toBe(true);
		expect(isPrivateOrLocalAddress("192.168.1.1")).toBe(true);
		expect(isPrivateOrLocalAddress("192.168.100.50")).toBe(true);
		expect(isPrivateOrLocalAddress("169.254.1.1")).toBe(true); // Link-local
	});

	it("identifies private sslip.io hostnames as private", () => {
		expect(isPrivateOrLocalAddress("app-abc-127-0-0-1.sslip.io")).toBe(true);
		expect(isPrivateOrLocalAddress("app-abc-10-0-0-1.sslip.io")).toBe(true);
		expect(isPrivateOrLocalAddress("app-abc-192-168-1-1.sslip.io")).toBe(true);
		expect(isPrivateOrLocalAddress("app-abc-172-20-0-1.sslip.io")).toBe(true);
	});

	it("accepts valid public domain names and public IPs", () => {
		expect(isPrivateOrLocalAddress("butax.hatdot.cloud")).toBe(false);
		expect(isPrivateOrLocalAddress("https://butax.hatdot.cloud")).toBe(false);
		expect(isPrivateOrLocalAddress("panel.hatdot.cloud")).toBe(false);
		expect(isPrivateOrLocalAddress("butax.co.tz")).toBe(false);
		expect(isPrivateOrLocalAddress("app-abc-51-158-100-20.sslip.io")).toBe(
			false,
		);
		expect(isPrivateOrLocalAddress("1.1.1.1")).toBe(false);
		expect(isPrivateOrLocalAddress("8.8.8.8")).toBe(false);
	});
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
	validateSafeComposeSpecification,
	validateSafeComposeYaml,
} from "@dokploy/server/services/compose-security";

vi.mock("@dokploy/server/db", () => {
	return {
		db: {
			query: {
				projects: {
					findFirst: vi.fn(),
				},
				environments: {
					findFirst: vi.fn(),
				},
				member: {
					findFirst: vi.fn(),
				},
			},
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve()),
				})),
			})),
		},
	};
});

vi.mock("@dokploy/server/db/schema", () => ({
	projects: { projectId: "projectId", organizationId: "organizationId" },
	environments: { environmentId: "environmentId", projectId: "projectId" },
	member: { id: "id", organizationId: "organizationId", userId: "userId" },
	organizationRole: {},
}));

vi.mock("@dokploy/server/services/proprietary/license-key", () => ({
	hasValidLicense: vi.fn().mockResolvedValue(true),
}));

vi.mock("@dokploy/server/services/service-lookup", () => ({
	findServiceById: vi.fn(),
}));

import { db } from "@dokploy/server/db";
import { findServiceById } from "@dokploy/server/services/service-lookup";
import {
	checkEnvironmentAccess,
	checkEnvironmentCreationPermission,
	checkEnvironmentDeletionPermission,
	checkProjectAccess,
	checkServiceAccess,
	checkServicePermissionAndAccess,
} from "@dokploy/server/services/permission";

describe("Multi-Tenant Isolation & Security across Customer Tabs", () => {
	const customerCtx = {
		user: { id: "user-tenant-a", role: "owner" },
		session: { activeOrganizationId: "org-a" },
	};

	const setupMemberMock = (role: string = "owner") => {
		vi.mocked(db.query.member.findFirst).mockResolvedValue({
			id: "mem-1",
			userId: "user-tenant-a",
			organizationId: "org-a",
			role,
			accessedServices: [],
			accessedProjects: [],
			accessedEnvironments: [],
			user: {
				id: "user-tenant-a",
				role,
			},
		} as any);
	};

	beforeEach(() => {
		vi.clearAllMocks();
		setupMemberMock();
	});

	describe("checkServicePermissionAndAccess", () => {
		it("blocks customer from accessing a service owned by another organization", async () => {
			vi.mocked(findServiceById).mockResolvedValueOnce({
				serviceId: "svc-victim",
				serviceType: "application",
				organizationId: "org-victim-b",
				projectId: "proj-b",
				environmentId: "env-b",
				name: "Victim App",
				appName: "victim-app",
				memoryLimit: null,
				memoryReservation: null,
				cpuLimit: null,
				cpuReservation: null,
			});

			await expect(
				checkServicePermissionAndAccess(customerCtx as any, "svc-victim", {
					service: ["create"],
				}),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this service.",
				}),
			);
		});

		it("allows customer to access a service owned by their own active organization", async () => {
			vi.mocked(findServiceById).mockResolvedValueOnce({
				serviceId: "svc-own",
				serviceType: "application",
				organizationId: "org-a",
				projectId: "proj-a",
				environmentId: "env-a",
				name: "My App",
				appName: "my-app",
				memoryLimit: null,
				memoryReservation: null,
				cpuLimit: null,
				cpuReservation: null,
			});

			await expect(
				checkServicePermissionAndAccess(customerCtx as any, "svc-own", {
					service: ["create"],
				}),
			).resolves.toBeUndefined();
		});

		it("allows platform administrators to access cross-tenant services for operational support", async () => {
			const platformAdminCtx = {
				user: { id: "user-tenant-a", role: "owner", isPlatformAdmin: true },
				session: { activeOrganizationId: "org-a" },
			};

			await expect(
				checkServicePermissionAndAccess(platformAdminCtx as any, "svc-victim", {
					service: ["create"],
				}),
			).resolves.toBeUndefined();
		});
	});

	describe("checkServiceAccess", () => {
		it("blocks read/delete on another tenant's service", async () => {
			vi.mocked(findServiceById).mockResolvedValueOnce({
				serviceId: "svc-victim",
				serviceType: "postgres",
				organizationId: "org-victim-b",
				projectId: "proj-b",
				environmentId: "env-b",
				name: "Victim DB",
				appName: "victim-db",
				memoryLimit: null,
				memoryReservation: null,
				cpuLimit: null,
				cpuReservation: null,
			});

			await expect(
				checkServiceAccess(customerCtx as any, "svc-victim", "delete"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this service.",
				}),
			);
		});

		it("blocks create on another tenant's project", async () => {
			vi.mocked(db.query.projects.findFirst).mockResolvedValueOnce({
				projectId: "proj-victim-b",
				organizationId: "org-victim-b",
			} as any);

			await expect(
				checkServiceAccess(customerCtx as any, "proj-victim-b", "create"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this project.",
				}),
			);
		});
	});

	describe("checkProjectAccess", () => {
		it("blocks customer from deleting another tenant's project", async () => {
			vi.mocked(db.query.projects.findFirst).mockResolvedValueOnce({
				projectId: "proj-victim-b",
				organizationId: "org-victim-b",
			} as any);

			await expect(
				checkProjectAccess(customerCtx as any, "delete", "proj-victim-b"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this project.",
				}),
			);
		});
	});

	describe("checkEnvironmentAccess", () => {
		it("blocks customer from accessing another tenant's environment", async () => {
			vi.mocked(db.query.environments.findFirst).mockResolvedValueOnce({
				environmentId: "env-victim-b",
				project: {
					organizationId: "org-victim-b",
				},
			} as any);

			await expect(
				checkEnvironmentAccess(customerCtx as any, "env-victim-b", "read"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this environment.",
				}),
			);
		});
	});

	describe("checkEnvironmentCreationPermission & checkEnvironmentDeletionPermission", () => {
		it("blocks creating environment in another tenant's project", async () => {
			vi.mocked(db.query.projects.findFirst).mockResolvedValueOnce({
				projectId: "proj-victim-b",
				organizationId: "org-victim-b",
			} as any);

			await expect(
				checkEnvironmentCreationPermission(customerCtx as any, "proj-victim-b"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this project.",
				}),
			);
		});

		it("blocks deleting environment in another tenant's project", async () => {
			vi.mocked(db.query.projects.findFirst).mockResolvedValueOnce({
				projectId: "proj-victim-b",
				organizationId: "org-victim-b",
			} as any);

			await expect(
				checkEnvironmentDeletionPermission(customerCtx as any, "proj-victim-b"),
			).rejects.toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "You are not authorized to access this project.",
				}),
			);
		});
	});

	describe("Port Security Guards", () => {
		const RESERVED_PORTS = new Set([
			20, 21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995,
			2222, 2375, 2376, 2377, 3000, 4000, 4500, 4789, 5432, 6379, 7946, 8080,
		]);

		const validatePortSecurity = (
			publishedPort: number | undefined,
			publishMode: string | undefined,
			isPlatformAdmin: boolean,
		) => {
			if (!isPlatformAdmin) {
				if (publishedPort !== undefined) {
					if (publishedPort < 1024) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message:
								"Privileged ports (< 1024) cannot be published directly. Please route your web service through a domain or publish on a port >= 1024.",
						});
					}
					if (RESERVED_PORTS.has(publishedPort)) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Port ${publishedPort} is reserved for platform infrastructure and cannot be published.`,
						});
					}
				}
				if (publishMode === "host") {
					throw new TRPCError({
						code: "FORBIDDEN",
						message:
							"Host publish mode is restricted to platform administrators. Please use ingress mode.",
					});
				}
			}
		};

		it("blocks customer from publishing privileged ports < 1024", () => {
			expect(() => validatePortSecurity(80, "ingress", false)).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message:
						"Privileged ports (< 1024) cannot be published directly. Please route your web service through a domain or publish on a port >= 1024.",
				}),
			);
			expect(() => validatePortSecurity(443, "ingress", false)).toThrowError(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
			expect(() => validatePortSecurity(22, "ingress", false)).toThrowError(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
		});

		it("blocks customer from publishing reserved platform ports", () => {
			expect(() => validatePortSecurity(3000, "ingress", false)).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Port 3000 is reserved for platform infrastructure and cannot be published.",
				}),
			);
			expect(() => validatePortSecurity(5432, "ingress", false)).toThrowError(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
			expect(() => validatePortSecurity(2377, "ingress", false)).toThrowError(
				expect.objectContaining({ code: "FORBIDDEN" }),
			);
		});

		it("blocks customer from using host publishMode", () => {
			expect(() => validatePortSecurity(8088, "host", false)).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message:
						"Host publish mode is restricted to platform administrators. Please use ingress mode.",
				}),
			);
		});

		it("allows customer to publish valid unprivileged ports in ingress mode", () => {
			expect(() => validatePortSecurity(8088, "ingress", false)).not.toThrow();
			expect(() => validatePortSecurity(9000, "ingress", false)).not.toThrow();
		});

		it("allows platform admin to publish any port or mode", () => {
			expect(() => validatePortSecurity(80, "host", true)).not.toThrow();
			expect(() => validatePortSecurity(443, "ingress", true)).not.toThrow();
			expect(() => validatePortSecurity(3000, "host", true)).not.toThrow();
		});
	});

	describe("Backup & Volume Destination Cross-Tenant Validation", () => {
		const validateDestinationOwnership = (
			destinationOrgId: string | null | undefined,
			activeOrgId: string,
			isPlatformAdmin: boolean,
		) => {
			if (destinationOrgId && activeOrgId && !isPlatformAdmin) {
				if (destinationOrgId !== activeOrgId) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "Unauthorized access to destination",
					});
				}
			}
		};

		it("blocks non-platform admin from using another tenant's backup destination", () => {
			expect(() =>
				validateDestinationOwnership("org-victim-b", "org-attacker-a", false),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: "Unauthorized access to destination",
				}),
			);
		});

		it("allows using own tenant destination", () => {
			expect(() =>
				validateDestinationOwnership("org-a", "org-a", false),
			).not.toThrow();
		});

		it("allows platform admin to use any destination", () => {
			expect(() =>
				validateDestinationOwnership("org-victim-b", "org-admin", true),
			).not.toThrow();
		});
	});

	describe("System Reserved Domains & Infrastructure Protection", () => {
		const reservedPrefixes = [
			"panel",
			"panel2021",
			"admin",
			"dashboard",
			"app",
			"api",
			"db",
			"auth",
			"status",
			"traefik",
			"cloud",
			"platform",
		];

		const checkDomainReserved = (host: string, platformDomain = "hatdot.cloud") => {
			const cleanHost = host.trim().toLowerCase();
			if (cleanHost === "localhost" || cleanHost.endsWith(".localhost") || cleanHost === "127.0.0.1") {
				return true;
			}
			if (cleanHost === platformDomain) {
				return true;
			}
			if (cleanHost.endsWith(`.${platformDomain}`)) {
				const prefix = cleanHost.slice(0, -(platformDomain.length + 1)).toLowerCase();
				const parts = prefix.split(".");
				if (parts.some((p) => reservedPrefixes.includes(p))) {
					return true;
				}
			}
			return false;
		};

		it("blocks claiming platform apex domain", () => {
			expect(checkDomainReserved("hatdot.cloud")).toBe(true);
		});

		it("blocks claiming admin and platform infrastructure subdomains", () => {
			expect(checkDomainReserved("panel.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("panel2021.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("admin.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("db.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("auth.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("api.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("traefik.hatdot.cloud")).toBe(true);
			expect(checkDomainReserved("status.hatdot.cloud")).toBe(true);
		});

		it("blocks localhost and local IPs", () => {
			expect(checkDomainReserved("localhost")).toBe(true);
			expect(checkDomainReserved("sub.localhost")).toBe(true);
			expect(checkDomainReserved("127.0.0.1")).toBe(true);
		});

		it("allows valid customer applications on the platform subdomain", () => {
			expect(checkDomainReserved("qrcode-3d-p7aloo.hatdot.cloud")).toBe(false);
			expect(checkDomainReserved("alltube-76394f.hatdot.cloud")).toBe(false);
			expect(checkDomainReserved("my-super-store.hatdot.cloud")).toBe(false);
		});

		it("allows custom domains", () => {
			expect(checkDomainReserved("example.com")).toBe(false);
			expect(checkDomainReserved("app.mycompany.io")).toBe(false);
		});
	});

	describe("Docker Compose Multi-Tenant Container Safety & Isolation", () => {
		it("blocks non-platform admin from deploying privileged containers", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "alpine",
								privileged: true,
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Privileged container mode is restricted"),
				}),
			);
		});

		it("blocks non-platform admin from using network_mode: host", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "nginx",
								network_mode: "host",
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Host networking mode is restricted"),
				}),
			);
		});

		it("blocks non-platform admin from mounting docker.sock", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "docker:cli",
								volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Mounting sensitive host path '/var/run/docker.sock'"),
				}),
			);
		});

		it("blocks non-platform admin from mounting host root or system directories", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "alpine",
								volumes: ["/:/host"],
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Mounting sensitive host path '/'"),
				}),
			);

			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "alpine",
								volumes: ["/etc:/etc:ro"],
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Mounting sensitive host path '/etc'"),
				}),
			);
		});

		it("blocks non-platform admin from adding dangerous capabilities", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "alpine",
								cap_add: ["ALL"],
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("Elevated Linux capability 'ALL'"),
				}),
			);
		});

		it("blocks non-platform admin from binding reserved host ports in compose", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "nginx",
								ports: ["80:80"],
							},
						},
					} as any,
					false,
				),
			).toThrowError(
				expect.objectContaining({
					code: "FORBIDDEN",
					message: expect.stringContaining("privileged port 80"),
				}),
			);
		});

		it("allows standard unprivileged compose services for customers", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							web: {
								image: "nginx:alpine",
								ports: ["8088:80"],
								volumes: ["./app:/usr/share/nginx/html", "named_vol:/data"],
								environment: {
									NODE_ENV: "production",
								},
							},
						},
					} as any,
					false,
				),
			).not.toThrow();
		});

		it("allows platform administrators to use advanced compose specifications", () => {
			expect(() =>
				validateSafeComposeSpecification(
					{
						services: {
							adminService: {
								image: "admin-tool",
								privileged: true,
								network_mode: "host",
								volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
								ports: ["80:80"],
							},
						},
					} as any,
					true,
				),
			).not.toThrow();
		});
	});
});

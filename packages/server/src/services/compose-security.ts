/**
 * Compose Security Service
 *
 * Enforces strict multi-tenant container isolation and safety policies on Docker Compose specifications.
 * Prevents non-platform-admin tenants from executing privileged containers, mounting the host Docker daemon,
 * accessing host namespaces, binding reserved system ports, or mounting sensitive host filesystem paths.
 */

import { TRPCError } from "@trpc/server";
import { parse } from "yaml";
import type { ComposeSpecification } from "../utils/docker/types";

export const DANGEROUS_HOST_PATHS = [
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/etc/dokploy",
	"/root/.dokploy",
	"/var/lib/docker",
	"/etc/shadow",
	"/etc/passwd",
	"/etc/sudoers",
	"/root",
	"/home",
	"/proc",
	"/sys",
	"/dev",
	"/boot",
	"/etc",
	"/usr",
	"/bin",
	"/sbin",
	"/lib",
	"/lib64",
	"/",
];

export const DANGEROUS_CAPABILITIES = new Set([
	"ALL",
	"SYS_ADMIN",
	"SYS_PTRACE",
	"SYS_RAWIO",
	"DAC_READ_SEARCH",
	"DAC_OVERRIDE",
	"NET_ADMIN",
	"SYS_MODULE",
	"SYS_BOOT",
]);

export const RESERVED_PORTS = new Set([
	20, 21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 2222, 2375,
	2376, 2377, 3000, 4000, 4500, 4789, 5432, 6379, 7946, 8080,
]);

function isPathDangerous(hostPath: string): boolean {
	const normalized = hostPath.trim().replace(/\\/g, "/").toLowerCase();
	if (!normalized.startsWith("/")) return false;

	const clean = normalized.replace(/\/+$/, "") || "/";

	for (const dangerous of DANGEROUS_HOST_PATHS) {
		const target = dangerous.toLowerCase().replace(/\/+$/, "") || "/";
		if (target === "/") {
			if (clean === "/") return true;
		} else if (clean === target || clean.startsWith(`${target}/`)) {
			return true;
		}
	}
	return false;
}

export function validateSafeComposeSpecification(
	composeSpec: ComposeSpecification,
	isPlatformAdmin = false,
): void {
	if (isPlatformAdmin) return;
	if (!composeSpec || typeof composeSpec !== "object") return;

	const services = composeSpec.services;
	if (!services || typeof services !== "object") return;

	for (const [serviceName, service] of Object.entries(services)) {
		if (!service || typeof service !== "object") continue;

		// 1. Privileged container mode
		if (service.privileged === true || (service as any).build?.privileged === true) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Privileged container mode is restricted to platform administrators.`,
			});
		}

		// 2. Host networking mode
		if (
			service.network_mode &&
			typeof service.network_mode === "string" &&
			service.network_mode.trim().toLowerCase() === "host"
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Host networking mode is restricted to platform administrators. Please use bridge or isolated networks.`,
			});
		}

		// 3. Host namespace sharing (pid, ipc, userns_mode)
		if (service.pid && typeof service.pid === "string" && service.pid.trim().toLowerCase() === "host") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Host PID namespace sharing is restricted to platform administrators.`,
			});
		}
		if (service.ipc && typeof service.ipc === "string" && service.ipc.trim().toLowerCase() === "host") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Host IPC namespace sharing is restricted to platform administrators.`,
			});
		}
		if (
			(service as any).userns_mode &&
			typeof (service as any).userns_mode === "string" &&
			(service as any).userns_mode.trim().toLowerCase() === "host"
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Host user namespace sharing is restricted to platform administrators.`,
			});
		}

		// 4. Elevated Linux capabilities
		const capAdd = (service as any).cap_add;
		if (Array.isArray(capAdd)) {
			for (const cap of capAdd) {
				const capUpper = String(cap).trim().toUpperCase();
				if (DANGEROUS_CAPABILITIES.has(capUpper)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Service '${serviceName}': Elevated Linux capability '${capUpper}' is restricted to platform administrators.`,
					});
				}
			}
		}

		// 5. Direct host device mapping
		if (service.devices && Array.isArray(service.devices) && service.devices.length > 0) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Service '${serviceName}': Direct host device access is restricted to platform administrators.`,
			});
		}

		// 6. Dangerous host volumes / bind mounts
		const volumes = service.volumes;
		if (Array.isArray(volumes)) {
			for (const vol of volumes) {
				if (typeof vol === "string") {
					const parts = vol.split(":");
					const hostPart = parts[0]?.trim();
					if (hostPart && isPathDangerous(hostPart)) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Service '${serviceName}': Mounting sensitive host path '${hostPart}' is restricted to platform administrators.`,
						});
					}
				} else if (vol && typeof vol === "object") {
					const bindType = (vol as any).type;
					const source = (vol as any).source;
					if (bindType === "bind" && typeof source === "string" && isPathDangerous(source)) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Service '${serviceName}': Mounting sensitive host path '${source}' is restricted to platform administrators.`,
						});
					}
				}
			}
		}

		// 7. Port security: block privileged ports (< 1024) and platform reserved ports
		const ports = service.ports;
		if (Array.isArray(ports)) {
			for (const portEntry of ports) {
				let publishedPort: number | null = null;
				let isHostMode = false;

				if (typeof portEntry === "number") {
					publishedPort = portEntry;
				} else if (typeof portEntry === "string") {
					const trimmed = portEntry.trim();
					// Formats: "hostPort:containerPort", "ip:hostPort:containerPort", "hostPort:containerPort/tcp"
					const colonParts = trimmed.split(":");
					if (colonParts.length === 2) {
						publishedPort = Number.parseInt(colonParts[0]?.split("/")[0] || "", 10);
					} else if (colonParts.length === 3) {
						publishedPort = Number.parseInt(colonParts[1]?.split("/")[0] || "", 10);
					}
				} else if (typeof portEntry === "object" && portEntry !== null) {
					publishedPort = typeof (portEntry as any).published === "number" ? (portEntry as any).published : Number.parseInt((portEntry as any).published || "", 10);
					isHostMode = (portEntry as any).mode === "host";
				}

				if (isHostMode) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Service '${serviceName}': Host port publish mode is restricted to platform administrators.`,
					});
				}

				if (publishedPort !== null && !Number.isNaN(publishedPort)) {
					if (publishedPort < 1024) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Service '${serviceName}': Publishing privileged port ${publishedPort} (< 1024) is restricted to platform administrators.`,
						});
					}
					if (RESERVED_PORTS.has(publishedPort)) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: `Service '${serviceName}': Port ${publishedPort} is reserved for platform infrastructure.`,
						});
					}
				}
			}
		}
	}
}

/**
 * Validates a raw YAML docker-compose string against security policies.
 */
export function validateSafeComposeYaml(
	yamlString: string,
	isPlatformAdmin = false,
): void {
	if (isPlatformAdmin) return;
	if (!yamlString || !yamlString.trim()) return;

	try {
		const parsed = parse(yamlString, { maxAliasCount: 10000 }) as ComposeSpecification;
		if (parsed && typeof parsed === "object") {
			validateSafeComposeSpecification(parsed, isPlatformAdmin);
		}
	} catch (error) {
		if (error instanceof TRPCError) {
			throw error;
		}
		// If parsing fails, allow Docker CLI to report standard syntax errors
	}
}


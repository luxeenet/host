import { execAsync, execAsyncRemote } from "@dokploy/server";

export interface ContainerSecurityCheckResult {
	allowed: boolean;
	reason?: string;
	configuredUser?: string;
	appNameMatches: boolean;
}

const SENSITIVE_HOST_MOUNTS = [
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/etc",
	"/root",
	"/sys",
	"/proc",
	"/var/lib/docker",
	"/boot",
];

const activeOrgSessions = new Map<string, number>();

export const trackSessionStart = (orgId: string): number => {
	const current = activeOrgSessions.get(orgId) || 0;
	activeOrgSessions.set(orgId, current + 1);
	return current + 1;
};

export const trackSessionEnd = (orgId: string): number => {
	const current = activeOrgSessions.get(orgId) || 0;
	const next = Math.max(0, current - 1);
	if (next === 0) {
		activeOrgSessions.delete(orgId);
	} else {
		activeOrgSessions.set(orgId, next);
	}
	return next;
};

export const getActiveOrgSessions = (orgId: string): number => {
	return activeOrgSessions.get(orgId) || 0;
};

export const resetActiveSessionsForTest = () => {
	activeOrgSessions.clear();
};

/**
 * Validates that the container is safe for customer terminal access.
 * Checks for:
 * 1. Matching application identity (prevents cross-application / cross-tenant IDOR)
 * 2. Privileged container mode rejection
 * 3. Docker socket mount rejection
 * 4. Sensitive host filesystem mount rejection
 * 5. Host networking rejection (multi-tenant protection)
 */
export const validateContainerSecurity = async (
	containerId: string,
	expectedAppName?: string | null,
	serverId?: string | null,
	isPlatformAdmin = false,
): Promise<ContainerSecurityCheckResult> => {
	try {
		const inspectFormat =
			'{"Privileged":{{.HostConfig.Privileged}},"Binds":{{json .HostConfig.Binds}},"NetworkMode":"{{.HostConfig.NetworkMode}}","User":"{{.Config.User}}","Labels":{{json .Config.Labels}},"Name":"{{.Name}}"}';
		const inspectCmd = `docker inspect ${containerId} --format '${inspectFormat}'`;

		let inspectOutput = "";
		if (serverId && serverId !== "local") {
			const { stdout } = await execAsyncRemote(serverId, inspectCmd);
			inspectOutput = stdout.trim();
		} else {
			const { stdout } = await execAsync(inspectCmd);
			inspectOutput = stdout.trim();
		}

		if (!inspectOutput) {
			return {
				allowed: false,
				reason: "Could not inspect application container details.",
				appNameMatches: false,
			};
		}

		const data = JSON.parse(inspectOutput);

		// 1. Identity validation: verify container belongs to expected appName
		let appNameMatches = true;
		if (expectedAppName) {
			const labels = data.Labels || {};
			const swarmService = labels["com.docker.swarm.service.name"] || "";
			const composeProject = labels["com.docker.compose.project"] || "";
			const containerName = data.Name || "";

			const matchesSwarm = swarmService.startsWith(expectedAppName);
			const matchesCompose = composeProject === expectedAppName;
			const matchesName = containerName.includes(expectedAppName);

			appNameMatches = matchesSwarm || matchesCompose || matchesName;

			if (!appNameMatches && !isPlatformAdmin) {
				return {
					allowed: false,
					reason:
						"Access denied: Selected container does not belong to your authorized application.",
					appNameMatches: false,
				};
			}
		}

		// Platform admins bypass container runtime security checks for infrastructure maintenance
		if (isPlatformAdmin) {
			return {
				allowed: true,
				configuredUser: data.User || undefined,
				appNameMatches: true,
			};
		}

		// 2. Reject privileged containers
		if (data.Privileged === true) {
			return {
				allowed: false,
				reason:
					"Terminal access denied: This application is running in privileged mode.",
				appNameMatches,
			};
		}

		// 3. Reject Docker socket & sensitive host directory mounts
		const binds: string[] = Array.isArray(data.Binds) ? data.Binds : [];
		for (const bind of binds) {
			const hostPart = bind.split(":")[0]?.trim();
			if (!hostPart) continue;

			if (
				hostPart === "/var/run/docker.sock" ||
				hostPart === "/run/docker.sock" ||
				hostPart.includes("docker.sock")
			) {
				return {
					allowed: false,
					reason:
						"Terminal access denied: Docker socket is mounted in this application runtime.",
					appNameMatches,
				};
			}

			for (const sensitive of SENSITIVE_HOST_MOUNTS) {
				if (
					hostPart === sensitive ||
					(hostPart.startsWith(`${sensitive}/`) && sensitive !== "/")
				) {
					return {
						allowed: false,
						reason: `Terminal access denied: Sensitive host directory (${sensitive}) is mounted in this application runtime.`,
						appNameMatches,
					};
				}
			}
		}

		// 4. Reject host networking for customer accounts
		if (data.NetworkMode === "host") {
			return {
				allowed: false,
				reason:
					"Terminal access denied: Applications with host networking cannot be accessed via customer terminal.",
				appNameMatches,
			};
		}

		return {
			allowed: true,
			configuredUser: data.User || undefined,
			appNameMatches,
		};
	} catch (error: any) {
		return {
			allowed: false,
			reason: `Security inspection failed: ${error?.message || "Unknown inspection error"}`,
			appNameMatches: false,
		};
	}
};


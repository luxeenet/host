import type http from "node:http";
import {
	docker,
	execAsync,
	getHostSystemStats,
	getLastAdvancedStatsFile,
	IS_CLOUD,
	recordAdvancedStats,
	validateRequest,
} from "@dokploy/server";
import { quote } from "shell-quote";
import { WebSocketServer } from "ws";
import { canAccessDockerOverWss } from "./authorize";

type AppType = "application" | "stack" | "docker-compose";

// Swarm task names are "<service>.<slot>.<taskId>"; the manager's local
// `docker ps` only sees containers scheduled on this host, so a task running
// on another node looks identical to a stopped one. `docker service ps` is
// swarm-aggregated and answers from the manager regardless of which node the
// task landed on, so we use it here to tell the two cases apart.
const findRemoteSwarmNode = async (
	appName: string,
	appType: AppType,
): Promise<string | null> => {
	if (appType === "docker-compose") {
		return null;
	}

	// `docker service ps --format {{.Name}}` only prints "<service>.<slot>",
	// never the taskId, so we match on the task ID instead — the last segment
	// of the stack task name — rather than trying to reconstruct the full name.
	const [serviceName, taskId] =
		appType === "stack"
			? [appName.split(".").slice(0, -2).join("."), appName.split(".").pop()]
			: [appName, null];

	if (!serviceName) {
		return null;
	}

	try {
		const { stdout } = await execAsync(
			`docker service ps ${quote([serviceName])} --filter "desired-state=running" --no-trunc --format '{"ID":"{{.ID}}","Node":"{{.Node}}","CurrentState":"{{.CurrentState}}"}'`,
		);

		for (const line of stdout.trim().split("\n")) {
			if (!line) continue;
			const task = JSON.parse(line);
			const isMatch = taskId ? task.ID === taskId : true;
			if (isMatch && task.CurrentState?.startsWith("Running")) {
				return task.Node;
			}
		}
	} catch {
		// Not a swarm service (or the swarm CLI isn't available) — fall back to "not running".
	}

	return null;
};

export const setupDockerStatsMonitoringSocketServer = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
) => {
	const wssTerm = new WebSocketServer({
		noServer: true,
		path: "/listen-docker-stats-monitoring",
	});

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url || "", `http://${req.headers.host}`);

		if (pathname === "/_next/webpack-hmr") {
			return;
		}
		if (pathname === "/listen-docker-stats-monitoring") {
			wssTerm.handleUpgrade(req, socket, head, function done(ws) {
				wssTerm.emit("connection", ws, req);
			});
		}
	});

	wssTerm.on("connection", async (ws, req) => {
		const url = new URL(req.url || "", `http://${req.headers.host}`);

		if (IS_CLOUD) {
			ws.send("This feature is not available in the cloud version.");
			ws.close();
			return;
		}
		const appName = url.searchParams.get("appName");
		const appType = (url.searchParams.get("appType") || "application") as
			| "application"
			| "stack"
			| "docker-compose";
		const serviceId = url.searchParams.get("serviceId");
		const { user, session } = await validateRequest(req);

		if (!appName) {
			ws.close(4000, "appName no provided");
			return;
		}

		if (!user || !session) {
			ws.close(4001, "Unauthorized");
			return;
		}

		const isPlatformAdmin = Boolean((user as any)?.isPlatformAdmin);

		let serviceRecord: any = null;
		if (appName === "dokploy") {
			if (!isPlatformAdmin) {
				ws.close(
					4003,
					"System monitoring requires platform administrator privileges.",
				);
				return;
			}
		} else {
			const { findServiceByAppName } = await import("@dokploy/server");
			serviceRecord = await findServiceByAppName(appName);
			if (!serviceRecord) {
				ws.close(4004, "Service not found");
				return;
			}

			if (
				serviceRecord.organizationId !== session.activeOrganizationId &&
				!isPlatformAdmin
			) {
				ws.close(4003, "Not authorized to access this service's metrics");
				return;
			}

			try {
				const { checkServiceAccess } = await import(
					"@dokploy/server/services/permission"
				);
				await checkServiceAccess(
					{
						user: { id: user.id },
						session: {
							activeOrganizationId: session.activeOrganizationId ?? "",
						},
					},
					serviceRecord.serviceId,
					"read",
				);
			} catch {
				ws.close(4003, "Access denied to service");
				return;
			}
		}

		if (!(await canAccessDockerOverWss(user, session, null, serviceRecord?.serviceId ?? serviceId))) {
			ws.close(4003, "Not authorized");
			return;
		}
		const intervalId = setInterval(async () => {
			try {
				// Special case: when monitoring "dokploy", get host system stats instead of container stats
				if (appName === "dokploy") {
					if (!isPlatformAdmin) {
						ws.close(4003, "System monitoring requires platform administrator privileges.");
						clearInterval(intervalId);
						return;
					}
					const stat = await getHostSystemStats();

					await recordAdvancedStats(stat, appName);
					const data = await getLastAdvancedStatsFile(appName);

					ws.send(
						JSON.stringify({
							data,
						}),
					);
					return;
				}

				const filter = {
					status: ["running"],
					...(appType === "application" && {
						label: [`com.docker.swarm.service.name=${appName}`],
					}),
					...(appType === "stack" && {
						label: [`com.docker.swarm.task.name=${appName}`],
					}),
					...(appType === "docker-compose" && {
						name: [appName],
					}),
				};

				const containers = await docker.listContainers({
					filters: JSON.stringify(filter),
				});

				const container = containers[0];
				if (!container || container?.State !== "running") {
					const remoteNode = await findRemoteSwarmNode(appName, appType);
					ws.close(
						4000,
						remoteNode
							? `Container running on remote node "${remoteNode}"`.slice(0, 123)
							: "Container not running",
					);
					return;
				}
				const { stdout, stderr } = await execAsync(
					`docker stats ${container.Id} --no-stream --format \'{"BlockIO":"{{.BlockIO}}","CPUPerc":"{{.CPUPerc}}","Container":"{{.Container}}","ID":"{{.ID}}","MemPerc":"{{.MemPerc}}","MemUsage":"{{.MemUsage}}","Name":"{{.Name}}","NetIO":"{{.NetIO}}"}\'`,
				);
				if (stderr) {
					console.error("Docker stats error:", stderr);
					return;
				}
				const stat = JSON.parse(stdout);

				const { PlanEntitlementService, formatBytes } = await import(
					"@dokploy/server"
				);
				const entitlements =
					await PlanEntitlementService.getMonitoringEntitlements(
						session.activeOrganizationId ?? "",
						isPlatformAdmin,
					);

				await recordAdvancedStats(stat, appName, serviceRecord?.memoryLimit);
				const data = await getLastAdvancedStatsFile(appName);

				if (appName !== "dokploy") {
					const memoryLimitFormatted = serviceRecord?.memoryLimit
						? formatBytes(Number(serviceRecord.memoryLimit))
						: null;
					if (data.memory?.value) {
						data.memory.value.total = memoryLimitFormatted;
					}
					if (!entitlements.hasAdvancedIoMetrics) {
						data.block = null;
						data.network = null;
					}
				}

				ws.send(
					JSON.stringify({
						data,
					}),
				);
			} catch (error) {
				// @ts-ignore
				ws.close(4000, `Error: ${error.message}`);
			}
		}, 1300);

		ws.on("close", () => {
			clearInterval(intervalId);
		});
	});
};

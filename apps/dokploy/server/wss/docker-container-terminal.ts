import type http from "node:http";
import {
	findApplicationById,
	findServerById,
	IS_CLOUD,
	validateRequest,
} from "@dokploy/server";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import { spawn } from "node-pty";
import { Client } from "ssh2";
import { WebSocketServer } from "ws";
import { audit } from "@/server/api/utils/audit";
import { canAccessDockerOverWss } from "./authorize";
import {
	getActiveOrgSessions,
	trackSessionEnd,
	trackSessionStart,
	validateContainerSecurity,
} from "./terminal-security";
import {
	isValidContainerId,
	isValidShell,
	parseResizeMessage,
	parseTerminalSize,
} from "./utils";

export const setupDockerContainerTerminalWebSocketServer = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
) => {
	const wssTerm = new WebSocketServer({
		noServer: true,
		path: "/docker-container-terminal",
	});

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url || "", `http://${req.headers.host}`);

		if (pathname === "/_next/webpack-hmr") {
			return;
		}
		if (pathname === "/docker-container-terminal") {
			wssTerm.handleUpgrade(req, socket, head, function done(ws) {
				wssTerm.emit("connection", ws, req);
			});
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	wssTerm.on("connection", async (ws, req) => {
		const url = new URL(req.url || "", `http://${req.headers.host}`);
		const containerId = url.searchParams.get("containerId");
		const activeWay = url.searchParams.get("activeWay");
		const serverId = url.searchParams.get("serverId");
		const serviceId = url.searchParams.get("serviceId");
		const { cols, rows } = parseTerminalSize(
			url.searchParams.get("cols"),
			url.searchParams.get("rows"),
		);
		const { user, session } = await validateRequest(req);

		if (!containerId) {
			ws.close(4000, "containerId not provided");
			return;
		}

		// Security: Validate containerId to prevent command injection
		if (!isValidContainerId(containerId)) {
			ws.close(4000, "Invalid container ID format");
			return;
		}

		// Security: Validate shell to prevent command injection
		if (activeWay && !isValidShell(activeWay)) {
			ws.close(4000, "Invalid shell specified");
			return;
		}

		// Default to 'sh' if no shell specified
		const shell = activeWay || "sh";

		if (!user || !session) {
			ws.close(4001, "Authentication required");
			return;
		}

		const isPlatformAdmin = Boolean((user as any)?.isPlatformAdmin);

		// Non-admin customers must provide a serviceId to access terminal
		if (!isPlatformAdmin && !serviceId) {
			ws.send(
				"\r\n\x1b[31mAccess denied: Service identity is required to open an application terminal.\x1b[0m\r\n",
			);
			ws.close(4003, "Service identity required");
			return;
		}

		if (!(await canAccessDockerOverWss(user, session, serverId, serviceId))) {
			ws.close(4003, "Not authorized");
			return;
		}

		// Resolve application details for identity matching & audit logging
		let appName = "app";
		if (serviceId) {
			try {
				const app = await findApplicationById(serviceId);
				if (app) {
					appName = app.appName;
				}
			} catch {
				// Compose or other service types
				appName = url.searchParams.get("appName") || "app";
			}
		}

		// Subscription entitlement check for non-platform admins
		if (!isPlatformAdmin && session.activeOrganizationId) {
			const termEntitlement = await PlanEntitlementService.checkCanUseTerminal(
				session.activeOrganizationId,
			);
			if (!termEntitlement.allowed) {
				ws.send(
					`\r\n\x1b[31mTerminal access denied: ${termEntitlement.reason || "Terminal access is not included in your current plan."}\x1b[0m\r\n`,
				);
				ws.close(4003, "Plan terminal entitlement required");
				return;
			}

			// Concurrency session check (max 3 concurrent terminal sessions per org)
			const MAX_CONCURRENT = 3;
			const currentSessions = getActiveOrgSessions(session.activeOrganizationId);
			if (currentSessions >= MAX_CONCURRENT) {
				ws.send(
					`\r\n\x1b[31mTerminal limit reached: You have reached the maximum (${MAX_CONCURRENT}) concurrent terminal sessions allowed for your account.\x1b[0m\r\n`,
				);
				ws.close(4029, "Too many concurrent sessions");
				return;
			}
		}

		// Container Security Validation (docker.sock mount, privileged mode, sensitive mounts, appName match)
		const securityCheck = await validateContainerSecurity(
			containerId,
			serviceId ? appName : null,
			serverId,
			isPlatformAdmin,
		);

		if (!securityCheck.allowed) {
			ws.send(
				`\r\n\x1b[31m${securityCheck.reason || "Terminal access denied by security policy."}\x1b[0m\r\n`,
			);
			ws.close(4003, "Security check failed");
			return;
		}

		// Track session start
		if (session.activeOrganizationId) {
			trackSessionStart(session.activeOrganizationId);
		}

		const startTime = Date.now();
		const MAX_SESSION_DURATION_MS = 30 * 60 * 1000; // 30-minute timeout
		let sessionCleanedUp = false;

		const cleanupSession = () => {
			if (sessionCleanedUp) return;
			sessionCleanedUp = true;
			clearTimeout(sessionTimeout);

			if (session.activeOrganizationId) {
				trackSessionEnd(session.activeOrganizationId);
			}

			const durationSeconds = Math.round((Date.now() - startTime) / 1000);
			if (serviceId) {
				audit(
					{
						user: {
							id: user.id,
							email: user.email,
							role: (user as any).role || "member",
						},
						session: {
							activeOrganizationId: session.activeOrganizationId || "",
						},
					},
					{
						action: "stop",
						resourceType: "service",
						resourceId: serviceId,
						resourceName: appName,
						metadata: {
							type: "application_terminal",
							durationSeconds,
						},
					},
				).catch(() => {});
			}
		};

		const sessionTimeout = setTimeout(() => {
			ws.send(
				"\r\n\x1b[33mTerminal session expired (30-minute limit). Disconnecting...\x1b[0m\r\n",
			);
			ws.close(4000, "Session timeout");
			cleanupSession();
		}, MAX_SESSION_DURATION_MS);

		// Send application-oriented welcome banner
		ws.send(
			`\r\n\x1b[36mConnected to Application Terminal: ${appName}\x1b[0m\r\n\x1b[90mIsolated application runtime. Host access is strictly disabled.\x1b[0m\r\n\r\n`,
		);

		// Record session start audit log
		if (serviceId) {
			audit(
				{
					user: {
						id: user.id,
						email: user.email,
						role: (user as any).role || "member",
					},
					session: {
						activeOrganizationId: session.activeOrganizationId || "",
					},
				},
				{
					action: "run",
					resourceType: "service",
					resourceId: serviceId,
					resourceName: appName,
					metadata: {
						type: "application_terminal",
						containerId: isPlatformAdmin
							? containerId
							: containerId.slice(0, 12),
					},
				},
			).catch(() => {});
		}

		try {
			if (serverId) {
				const server = await findServerById(serverId);

				if (server.organizationId !== session.activeOrganizationId) {
					cleanupSession();
					ws.close();
					return;
				}

				if (!server.sshKeyId)
					throw new Error("No SSH key available for this server");

				const conn = new Client();
				let _stdout = "";
				let _stderr = "";
				conn
					.once("ready", () => {
						// Set prompt to clean application name instead of container hash
						const dockerCommand = [
							"docker",
							"exec",
							"-it",
							"-e",
							`PS1="app@${appName}:\\w\\$ "`,
							"-e",
							`HOSTNAME="${appName}"`,
							"-w",
							"/",
							containerId,
							shell,
						].join(" ");
						conn.exec(dockerCommand, { pty: { cols, rows } }, (err, stream) => {
							if (err) {
								console.error("SSH exec error:", err);
								cleanupSession();
								ws.close();
								conn.end();
								return;
							}

							stream
								.on("close", (code: number, _signal: string) => {
									ws.send(`\nApplication session closed with code: ${code}\n`);
									cleanupSession();
									conn.end();
								})
								.on("data", (data: string) => {
									_stdout += data.toString();
									ws.send(data.toString());
								})
								.stderr.on("data", (data) => {
									_stderr += data.toString();
									ws.send(data.toString());
									console.error("Error: ", data.toString());
								});

							ws.on("message", (message) => {
								try {
									let command: string | Buffer[] | Buffer | ArrayBuffer;
									if (Buffer.isBuffer(message)) {
										command = message.toString("utf8");
									} else {
										command = message;
									}
									const text = command.toString();
									const resize = parseResizeMessage(text);
									if (resize) {
										stream.setWindow(resize.rows, resize.cols, 0, 0);
										return;
									}
									stream.write(text);
								} catch (error) {
									// @ts-ignore
									const errorMessage = error?.message as unknown as string;
									ws.send(errorMessage);
								}
							});

							ws.on("close", () => {
								cleanupSession();
								stream.end();
								conn.end();
							});
						});
					})
					.on("error", (err) => {
						console.error("SSH connection error:", err);
						cleanupSession();
						if (ws.readyState === ws.OPEN) {
							ws.send(`SSH error: ${err.message}`);
							ws.close();
						}
						conn.end();
					})
					.connect({
						host: server.ipAddress,
						port: server.port,
						username: server.username,
						privateKey: server.sshKey?.privateKey,
					});
			} else {
				const ptyProcess = spawn(
					"docker",
					[
						"exec",
						"-it",
						"-e",
						`PS1="app@${appName}:\\w\\$ "`,
						"-e",
						`HOSTNAME="${appName}"`,
						"-w",
						"/",
						containerId,
						shell,
					],
					{ cols, rows },
				);

				ptyProcess.onData((data) => {
					ws.send(data);
				});
				ptyProcess.onExit(({ exitCode }) => {
					ws.send(`\nApplication session closed with code: ${exitCode}\n`);
					cleanupSession();
					ws.close();
				});
				ws.on("close", () => {
					cleanupSession();
					ptyProcess.kill();
				});
				ws.on("message", (message) => {
					try {
						let command: string | Buffer[] | Buffer | ArrayBuffer;
						if (Buffer.isBuffer(message)) {
							command = message.toString("utf8");
						} else {
							command = message;
						}
						const text = command.toString();
						const resize = parseResizeMessage(text);
						if (resize) {
							ptyProcess.resize(resize.cols, resize.rows);
							return;
						}
						ptyProcess.write(text);
					} catch (error) {
						// @ts-ignore
						const errorMessage = error?.message as unknown as string;
						ws.send(errorMessage);
					}
				});
			}
		} catch (error) {
			cleanupSession();
			// @ts-ignore
			const errorMessage = error?.message as unknown as string;
			ws.send(errorMessage);
		}
	});
};

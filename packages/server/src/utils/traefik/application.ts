import fs, { createReadStream, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { paths } from "@dokploy/server/constants";
import type { Domain } from "@dokploy/server/services/domain";
import { quote } from "shell-quote";
import { parse, stringify } from "yaml";
import {
	execAsync,
	execAsyncRemote,
	writeFileRemote,
} from "../process/execAsync";
import type { FileConfig, HttpLoadBalancerService } from "./file-types";
import { extractPortFromCommand } from "../builders/runtime-resolver";

export const createTraefikConfig = (appName: string, port?: number) => {
	const defaultPort = port && port > 0 ? port : 80;
	const serviceURLDefault = `http://${appName}:${defaultPort}`;
	const domainDefault = `Host(\`${appName}.docker.localhost\`)`;
	const config: FileConfig = {
		http: {
			routers: {
				...(process.env.NODE_ENV === "production"
					? {}
					: {
							[`${appName}-router-1`]: {
								rule: domainDefault,
								service: `${appName}-service-1`,
								entryPoints: ["web"],
							},
						}),
			},

			services: {
				...(process.env.NODE_ENV === "production"
					? {}
					: {
							[`${appName}-service-1`]: {
								loadBalancer: {
									servers: [{ url: serviceURLDefault }],
									passHostHeader: true,
								},
							},
						}),
			},
		},
	};
	const yamlStr = stringify(config);
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	fs.mkdirSync(DYNAMIC_TRAEFIK_PATH, { recursive: true });
	writeFileSync(
		path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`),
		yamlStr,
		"utf8",
	);
};

export const removeTraefikConfig = async (
	appName: string,
	serverId?: string | null,
) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths(!!serverId);
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);

		if (serverId) {
			const command = `rm -f ${quote([configPath])}`;
			await execAsyncRemote(serverId, command);
		} else {
			if (fs.existsSync(configPath)) {
				fs.unlinkSync(configPath);
			}
		}
	} catch (error) {
		console.error(`Error removing traefik config for ${appName}:`, error);
	}
};

export const removeTraefikConfigRemote = async (
	appName: string,
	serverId: string,
) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths(true);
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
		await execAsyncRemote(serverId, `rm -f ${quote([configPath])}`);
	} catch (error) {
		console.error(
			`Error removing remote traefik config for ${appName}:`,
			error,
		);
	}
};

export const loadOrCreateConfig = (appName: string): FileConfig => {
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
	if (fs.existsSync(configPath)) {
		const yamlStr = fs.readFileSync(configPath, "utf8");
		const parsedConfig = (parse(yamlStr) as FileConfig) || {
			http: { routers: {}, services: {} },
		};
		return parsedConfig;
	}
	return { http: { routers: {}, services: {} } };
};

export const loadOrCreateConfigRemote = async (
	serverId: string,
	appName: string,
) => {
	const { DYNAMIC_TRAEFIK_PATH } = paths(true);
	const fileConfig: FileConfig = { http: { routers: {}, services: {} } };
	const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
	try {
		const { stdout } = await execAsyncRemote(
			serverId,
			`cat ${quote([configPath])}`,
		);

		if (!stdout) return fileConfig;

		const parsedConfig = (parse(stdout) as FileConfig) || {
			http: { routers: {}, services: {} },
		};
		return parsedConfig;
	} catch {
		return fileConfig;
	}
};

export const readConfig = (appName: string) => {
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
	if (fs.existsSync(configPath)) {
		const yamlStr = fs.readFileSync(configPath, "utf8");
		return yamlStr;
	}
	return null;
};

export const readRemoteConfig = async (serverId: string, appName: string) => {
	const { DYNAMIC_TRAEFIK_PATH } = paths(true);
	const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
	try {
		const { stdout } = await execAsyncRemote(
			serverId,
			`cat ${quote([configPath])}`,
		);
		if (!stdout) return null;
		return stdout;
	} catch {
		return null;
	}
};

export const readMonitoringConfig = async (readAll = false) => {
	const { DYNAMIC_TRAEFIK_PATH } = paths();
	const configPath = path.join(DYNAMIC_TRAEFIK_PATH, "access.log");
	if (fs.existsSync(configPath)) {
		if (!readAll) {
			// Read first 500 lines using streams
			let content = "";
			let validCount = 0;

			const fileStream = createReadStream(configPath, { encoding: "utf8" });
			const readline = createInterface({
				input: fileStream,
				crlfDelay: Number.POSITIVE_INFINITY,
			});

			for await (const line of readline) {
				try {
					const trimmed = line.trim();
					if (
						trimmed !== "" &&
						trimmed.startsWith("{") &&
						trimmed.endsWith("}")
					) {
						const log = JSON.parse(trimmed);
						// Exclude Dokploy service app and Dashboard requests
						if (log.ServiceName !== "dokploy-service-app@file") {
							content += `${line}\n`;
							validCount++;
							if (validCount >= 500) {
								break;
							}
						}
					}
				} catch {
					// Ignore invalid JSON
				}
			}
			return content;
		}
		return fs.readFileSync(configPath, "utf8");
	}
	return null;
};

export const readConfigInPath = async (pathFile: string, serverId?: string) => {
	const configPath = path.join(pathFile);

	if (serverId) {
		const { stdout } = await execAsyncRemote(
			serverId,
			`cat ${quote([configPath])}`,
		);
		if (!stdout) return null;
		return stdout;
	}
	if (fs.existsSync(configPath)) {
		const yamlStr = fs.readFileSync(configPath, "utf8");
		return yamlStr;
	}
	return null;
};

export const writeConfig = (appName: string, traefikConfig: string) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths();
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
		fs.writeFileSync(configPath, traefikConfig, "utf8");
	} catch (e) {
		console.error("Error saving the YAML config file:", e);
	}
};

export const writeConfigRemote = async (
	serverId: string,
	appName: string,
	traefikConfig: string,
) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths(true);
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
		await writeFileRemote(serverId, configPath, traefikConfig);
	} catch (e) {
		console.error("Error saving the YAML config file:", e);
	}
};

export const writeTraefikConfigInPath = async (
	pathFile: string,
	traefikConfig: string,
	serverId?: string,
) => {
	try {
		const configPath = path.join(pathFile);
		if (serverId) {
			await writeFileRemote(serverId, configPath, traefikConfig);
		} else {
			fs.writeFileSync(configPath, traefikConfig, "utf8");
		}
	} catch (e) {
		console.error("Error saving the YAML config file:", e);
	}
};

export const writeTraefikConfig = (
	traefikConfig: FileConfig,
	appName: string,
) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths();
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
		const yamlStr = stringify(traefikConfig);
		fs.writeFileSync(configPath, yamlStr, "utf8");
	} catch (e) {
		console.error("Error saving the YAML config file:", e);
	}
};

export const writeTraefikConfigRemote = async (
	traefikConfig: FileConfig,
	appName: string,
	serverId: string,
) => {
	try {
		const { DYNAMIC_TRAEFIK_PATH } = paths(true);
		const configPath = path.join(DYNAMIC_TRAEFIK_PATH, `${appName}.yml`);
		const yamlStr = stringify(traefikConfig);
		await writeFileRemote(serverId, configPath, yamlStr);
	} catch (e) {
		console.error("Error saving the YAML config file:", e);
	}
};

const isEmptyHttpRoutersAndServices = (traefikConfig: FileConfig) =>
	Object.keys(traefikConfig.http?.routers || {}).length === 0 &&
	Object.keys(traefikConfig.http?.services || {}).length === 0;

export const writeAppTraefikConfig = async (
	traefikConfig: FileConfig,
	appName: string,
	serverId?: string | null,
) => {
	if (isEmptyHttpRoutersAndServices(traefikConfig)) {
		await removeTraefikConfig(appName, serverId);
		return;
	}
	if (serverId) {
		await writeTraefikConfigRemote(traefikConfig, appName, serverId);
	} else {
		writeTraefikConfig(traefikConfig, appName);
	}
};

export const resolveDomainUpstreamPort = (
	domain: Domain,
	app?: {
		buildType?: string | null;
		command?: string | null;
		ports?: Array<{ targetPort?: number | null }> | null;
		env?: string | null;
		environment?: {
			env?: string | null;
			project?: { env?: string | null } | null;
		} | null;
		suggestedPort?: number | null;
		appName?: string | null;
	} | null,
): number => {
	// 1. If application is static (e.g. Nginx container), container listens on port 80
	if (app?.buildType === "static") {
		if (domain.port && domain.port !== 3000) {
			return domain.port;
		}
		return 80;
	}

	// 2. Explicit HatDot application container target port configuration
	if (
		app &&
		"ports" in app &&
		Array.isArray(app.ports) &&
		app.ports.length > 0 &&
		app.ports[0]?.targetPort &&
		app.ports[0].targetPort > 0
	) {
		return app.ports[0].targetPort;
	}

	// 3. Explicit port in customer-configured startup command (e.g. --port 4173, --server.port=8501)
	const cmdPort = extractPortFromCommand(app?.command);
	if (cmdPort) {
		return cmdPort;
	}

	// 4. Explicit PORT in application environment variables
	const allEnvs = [
		app?.env,
		app?.environment?.env,
		app?.environment?.project?.env,
	];
	for (const envStr of allEnvs) {
		if (envStr) {
			const envMatch = envStr.match(/^\s*PORT\s*=\s*["']?(\d+)["']?/m);
			if (envMatch && envMatch[1]) {
				const portNum = Number(envMatch[1]);
				if (!Number.isNaN(portNum) && portNum > 0) {
					return portNum;
				}
			}
		}
	}

	// 5. App has suggestedPort from framework detection (e.g. 4173 for Vite preview)
	if (
		app?.suggestedPort &&
		app.suggestedPort > 0 &&
		(app.buildType !== "nixpacks" || app.suggestedPort !== 80)
	) {
		return app.suggestedPort;
	}

	// 6. Inspect saved deployment plan or application build directory
	if (!app?.suggestedPort && app?.appName) {
		try {
			let loadDeploymentPlanSync: any;
			try {
				loadDeploymentPlanSync = require("../builders/deployment-plan").loadDeploymentPlanSync;
			} catch {
				try {
					loadDeploymentPlanSync = require("@dokploy/server/utils/builders/deployment-plan").loadDeploymentPlanSync;
				} catch {}
			}
			if (loadDeploymentPlanSync) {
				const plan = loadDeploymentPlanSync(app.appName);
				if (plan?.port?.value && (app.buildType !== "nixpacks" || plan.port.value !== 80)) {
					return plan.port.value;
				}
			}
		} catch {}

		try {
			const { APPLICATIONS_PATH } = paths();
			const codeDir = path.join(APPLICATIONS_PATH, app.appName, "code");
			if (fs.existsSync(codeDir)) {
				let detectFrameworkFromDirectorySync: any;
				try {
					detectFrameworkFromDirectorySync = require("../../services/app-detector").detectFrameworkFromDirectorySync;
				} catch {
					try {
						detectFrameworkFromDirectorySync = require("@dokploy/server/services/app-detector").detectFrameworkFromDirectorySync;
					} catch {}
				}
				if (detectFrameworkFromDirectorySync) {
					const det = detectFrameworkFromDirectorySync(codeDir);
					if (
						det?.suggestedPort &&
						(app.buildType !== "nixpacks" || det.suggestedPort !== 80)
					) {
						return det.suggestedPort;
					}
				}
			}
		} catch {}
	}

	// 7. If domain has an explicit customer-configured port that is not default 3000
	if (domain.port && domain.port > 0 && domain.port !== 3000) {
		return domain.port;
	}

	// 7. Default port: 3000 (standard for Node.js, Next.js, Rails)
	return domain.port && domain.port > 0 ? domain.port : 3000;
};

export const createServiceConfig = (
	appName: string,
	domain: Domain,
	app?: Parameters<typeof resolveDomainUpstreamPort>[1],
): {
	loadBalancer: HttpLoadBalancerService;
} => {
	const upstreamPort = resolveDomainUpstreamPort(domain, app);
	return {
		loadBalancer: {
			servers: [{ url: `http://${appName}:${upstreamPort}` }],
			passHostHeader: true,
		},
	};
};

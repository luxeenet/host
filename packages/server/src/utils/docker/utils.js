import fs from "node:fs";
import path from "node:path";
import { docker, paths } from "@dokploy/server/constants";
import { parse } from "dotenv";
import { quote } from "shell-quote";
import { execAsync, execAsyncRemote } from "../process/execAsync";
import { spawnAsync } from "../process/spawnAsync";
import { getRemoteDocker } from "../servers/remote-docker";
export const pullImage = async (dockerImage, onData, authConfig) => {
    try {
        if (!dockerImage) {
            throw new Error("Docker image not found");
        }
        if (authConfig?.username && authConfig?.password) {
            await spawnAsync("docker", [
                "login",
                authConfig.registryUrl || "",
                "-u",
                authConfig.username,
                "-p",
                authConfig.password,
            ], onData);
        }
        await spawnAsync("docker", ["pull", dockerImage], onData);
    }
    catch (error) {
        throw error;
    }
};
export const pullRemoteImage = async (dockerImage, serverId, onData, authConfig) => {
    try {
        if (!dockerImage) {
            throw new Error("Docker image not found");
        }
        const remoteDocker = await getRemoteDocker(serverId);
        await new Promise((resolve, reject) => {
            remoteDocker.pull(dockerImage, { authconfig: authConfig }, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                remoteDocker.modem.followProgress(stream, (err, res) => {
                    if (!err) {
                        resolve(res);
                    }
                    if (err) {
                        reject(err);
                    }
                }, (event) => {
                    onData?.(event);
                });
            });
        });
    }
    catch (error) {
        throw error;
    }
};
export const containerExists = async (containerName) => {
    const container = docker.getContainer(containerName);
    try {
        await container.inspect();
        return true;
    }
    catch {
        return false;
    }
};
export const stopService = async (appName) => {
    try {
        await execAsync(`docker service scale ${appName}=0 `);
    }
    catch (error) {
        console.error(error);
        return error;
    }
};
export const stopServiceRemote = async (serverId, appName) => {
    try {
        await execAsyncRemote(serverId, `docker service scale ${appName}=0 `);
    }
    catch (error) {
        console.error(error);
        return error;
    }
};
export const getContainerByName = (name) => {
    const opts = {
        limit: 1,
        filters: {
            name: [name],
        },
    };
    return new Promise((resolve, reject) => {
        docker.listContainers(opts, (err, containers) => {
            if (err) {
                reject(err);
            }
            else if (containers?.length === 0) {
                reject(new Error(`No container found with name: ${name}`));
            }
            else if (containers && containers?.length > 0 && containers[0]) {
                resolve(containers[0]);
            }
        });
    });
};
/**
 * Docker commands sent using this method are held in a hold when Docker is busy.
 *
 * https://github.com/Dokploy/dokploy/pull/3064
 */
export const dockerSafeExec = (exec) => `
CHECK_INTERVAL=10
MAX_WAIT=300
WAITED=0

echo "Preparing for execution..."

while true; do
    PROCESSES=$(ps -eo args | awk '$1 ~ /(^|\\/)docker$/')

    if [ -z "$PROCESSES" ]; then
        echo "Docker is idle. Starting execution..."
        break
    fi

    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        echo "Docker still busy after \${MAX_WAIT}s, proceeding anyway." >&2
        break
    fi

    echo "Docker is busy. Will check again in $CHECK_INTERVAL seconds..."
    sleep $CHECK_INTERVAL
    WAITED=$((WAITED + CHECK_INTERVAL))
done

${exec}

echo "Execution completed."
`;
const cleanupCommands = {
    containers: "docker container prune --force",
    images: "docker image prune --all --force",
    volumes: "docker volume prune --all --force",
    builders: "docker builder prune --all --force",
    system: "docker system prune --all --force",
};
export const cleanupContainers = async (serverId) => {
    try {
        const command = cleanupCommands.containers;
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else {
            await execAsync(dockerSafeExec(command));
        }
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const cleanupImages = async (serverId) => {
    try {
        const command = cleanupCommands.images;
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else
            await execAsync(dockerSafeExec(command));
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const cleanupVolumes = async (serverId) => {
    try {
        const command = cleanupCommands.volumes;
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else {
            await execAsync(dockerSafeExec(command));
        }
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const cleanupBuilders = async (serverId) => {
    try {
        const command = cleanupCommands.builders;
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else {
            await execAsync(dockerSafeExec(command));
        }
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const cleanupSystem = async (serverId) => {
    try {
        const command = cleanupCommands.system;
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else {
            await execAsync(dockerSafeExec(command));
        }
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
const parseSizeToBytes = (size) => {
    const match = size.match(/^([\d.]+)\s*([KMGT]?B)$/i);
    if (!match)
        return 0;
    const value = Number.parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers = {
        B: 1,
        KB: 1024,
        MB: 1024 ** 2,
        GB: 1024 ** 3,
        TB: 1024 ** 4,
    };
    return value * (multipliers[unit] || 0);
};
export const getDockerDiskUsage = async (serverId) => {
    const command = "docker system df --format '{{json .}}'";
    const { stdout } = serverId
        ? await execAsyncRemote(serverId, command)
        : await execAsync(command);
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
        const data = JSON.parse(line);
        return {
            type: data.Type,
            totalCount: Number.parseInt(data.TotalCount, 10) || 0,
            active: Number.parseInt(data.Active, 10) || 0,
            size: data.Size,
            reclaimable: data.Reclaimable,
            sizeBytes: parseSizeToBytes(data.Size),
        };
    });
};
export const getBuildCache = async (serverId) => {
    try {
        const command = "docker system df -v --format '{{json .}}'";
        const { stdout } = serverId
            ? await execAsyncRemote(serverId, command)
            : await execAsync(command);
        const diskUsage = JSON.parse(stdout.trim());
        return (diskUsage?.BuildCache ?? []).map((entry) => ({
            id: entry.ID ?? "",
            type: entry.CacheType ?? "",
            description: entry.Description ?? "",
            size: entry.Size ?? "",
            sizeBytes: parseSizeToBytes(entry.Size ?? ""),
            createdSince: entry.CreatedSince ?? "",
            lastUsedSince: entry.LastUsedSince ?? "",
            usageCount: Number.parseInt(entry.UsageCount ?? "0", 10) || 0,
            shared: entry.Shared === "true",
            inUse: entry.InUse === "true",
        }));
    }
    catch (error) {
        console.error(error);
        return [];
    }
};
/**
 * Volume cleanup should always be performed manually by the user. The reason is that during automatic cleanup, a volume may be deleted due to a stopped container, which is a dangerous situation.
 *
 * https://github.com/Dokploy/dokploy/pull/3267
 */
const excludedCleanupAllCommands = [
    "volumes",
];
export const cleanupAll = async (serverId) => {
    for (const [key, command] of Object.entries(cleanupCommands)) {
        if (excludedCleanupAllCommands.includes(key))
            continue;
        try {
            if (serverId) {
                await execAsyncRemote(serverId, dockerSafeExec(command));
            }
            else {
                await execAsync(dockerSafeExec(command));
            }
        }
        catch (error) {
            console.error(`Docker cleanup: "${key}" failed${serverId ? ` on server ${serverId}` : ""}`, error);
        }
    }
};
export const cleanupAllBackground = async (serverId) => {
    Promise.allSettled(Object.entries(cleanupCommands)
        .filter(([key]) => !excludedCleanupAllCommands.includes(key))
        .map(async ([, command]) => {
        if (serverId) {
            await execAsyncRemote(serverId, dockerSafeExec(command));
        }
        else {
            await execAsync(dockerSafeExec(command));
        }
    }))
        .then((results) => {
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
            console.error(`Docker cleanup: ${failed.length} operations failed`);
        }
        else {
            console.log("Docker cleanup completed successfully");
        }
    })
        .catch((error) => console.error("Error in cleanup:", error));
    return {
        status: "scheduled",
        message: "Docker cleanup has been initiated in the background",
    };
};
export const startService = async (appName) => {
    try {
        await execAsync(`docker service scale ${appName}=1 `);
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const startServiceRemote = async (serverId, appName) => {
    try {
        await execAsyncRemote(serverId, `docker service scale ${appName}=1 `);
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
export const removeService = async (appName, serverId, _deleteVolumes = false) => {
    try {
        const command = `docker service rm ${appName}`;
        if (serverId) {
            await execAsyncRemote(serverId, command);
        }
        else {
            await execAsync(command);
        }
    }
    catch (error) {
        return error;
    }
};
export const prepareEnvironmentVariables = (serviceEnv, projectEnv, environmentEnv) => {
    for (const source of [serviceEnv, projectEnv, environmentEnv]) {
        if (source?.includes("${{vault.")) {
            throw new Error("Unresolved vault reference: call withResolvedVaultRefs() on the entity before preparing environment variables");
        }
    }
    const projectVars = parse(projectEnv ?? "");
    const environmentVars = parse(environmentEnv ?? "");
    const serviceVars = parse(serviceEnv ?? "");
    const resolvedVars = Object.entries(serviceVars).map(([key, value]) => {
        let resolvedValue = value;
        // Replace project variables
        if (projectVars) {
            resolvedValue = resolvedValue.replace(/\$\{\{project\.(.*?)\}\}/g, (_, ref) => {
                if (projectVars[ref] !== undefined) {
                    return projectVars[ref];
                }
                throw new Error(`Invalid project environment variable: project.${ref}`);
            });
        }
        // Replace environment variables
        if (environmentVars) {
            resolvedValue = resolvedValue.replace(/\$\{\{environment\.(.*?)\}\}/g, (_, ref) => {
                if (environmentVars[ref] !== undefined) {
                    return environmentVars[ref];
                }
                throw new Error(`Invalid environment variable: environment.${ref}`);
            });
        }
        // Replace self-references (service variables)
        resolvedValue = resolvedValue.replace(/\$\{\{(.*?)\}\}/g, (_, ref) => {
            if (serviceVars[ref] !== undefined) {
                return serviceVars[ref];
            }
            throw new Error(`Invalid service environment variable: ${ref}`);
        });
        return `${key}=${resolvedValue}`;
    });
    return resolvedVars;
};
export const prepareEnvironmentVariablesForShell = (serviceEnv, projectEnv, environmentEnv) => {
    const envVars = prepareEnvironmentVariables(serviceEnv, projectEnv, environmentEnv);
    // Using shell-quote library to properly escape shell arguments
    // This is the standard way to handle special characters in shell commands
    return envVars.map((env) => quote([env]));
};
export const prepareEnvironmentVariablesForFile = (serviceEnv, projectEnv, environmentEnv) => {
    const envVars = prepareEnvironmentVariables(serviceEnv, projectEnv, environmentEnv);
    return envVars.map((pair) => {
        const [key, value] = parseEnvironmentKeyValuePair(pair);
        const escapedValue = value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\$(?!\{[A-Za-z_][A-Za-z0-9_]*(?::?[-+?][^{}]*)?\})/g, "\\$");
        return `${key}="${escapedValue}"`;
    });
};
export const parseEnvironmentKeyValuePair = (pair) => {
    const [key, ...valueParts] = pair.split("=");
    if (!key || !valueParts.length) {
        throw new Error(`Invalid environment variable pair: ${pair}`);
    }
    return [key, valueParts.join("=")];
};
export const getEnvironmentVariablesObject = (input, projectEnv, environmentEnv) => {
    const envs = prepareEnvironmentVariables(input, projectEnv, environmentEnv);
    const jsonObject = {};
    for (const pair of envs) {
        const [key, value] = parseEnvironmentKeyValuePair(pair);
        if (key && value) {
            jsonObject[key] = value;
        }
    }
    return jsonObject;
};
export const generateVolumeMounts = (mounts) => {
    if (!mounts || mounts.length === 0) {
        return [];
    }
    return mounts
        .filter((mount) => mount.type === "volume")
        .map((mount) => ({
        Type: "volume",
        Source: mount.volumeName || "",
        Target: mount.mountPath,
    }));
};
export const calculateResources = ({ memoryLimit, memoryReservation, cpuLimit, cpuReservation, }) => {
    return {
        Limits: {
            MemoryBytes: memoryLimit ? Number.parseInt(memoryLimit) : undefined,
            NanoCPUs: cpuLimit ? Number.parseInt(cpuLimit) : undefined,
        },
        Reservations: {
            MemoryBytes: memoryReservation
                ? Number.parseInt(memoryReservation)
                : undefined,
            NanoCPUs: cpuReservation ? Number.parseInt(cpuReservation) : undefined,
        },
    };
};
export const generateConfigContainer = (application) => {
    const { healthCheckSwarm, restartPolicySwarm, placementSwarm, updateConfigSwarm, rollbackConfigSwarm, modeSwarm, labelsSwarm, replicas, mounts, stopGracePeriodSwarm, endpointSpecSwarm, ulimitsSwarm, } = application;
    const haveMounts = mounts && mounts.length > 0;
    return {
        ...(healthCheckSwarm && {
            HealthCheck: healthCheckSwarm,
        }),
        ...(restartPolicySwarm && {
            RestartPolicy: restartPolicySwarm,
        }),
        ...(placementSwarm
            ? {
                Placement: placementSwarm,
            }
            : {
                // if app have mounts keep manager as constraint
                Placement: {
                    Constraints: haveMounts ? ["node.role==manager"] : [],
                },
            }),
        ...(labelsSwarm && {
            Labels: labelsSwarm,
        }),
        ...(modeSwarm
            ? {
                Mode: modeSwarm,
            }
            : {
                // use replicas value if no modeSwarm provided
                Mode: {
                    Replicated: {
                        Replicas: replicas,
                    },
                },
            }),
        ...(rollbackConfigSwarm
            ? { RollbackConfig: rollbackConfigSwarm }
            : {
                // default rollback config to match update config
                RollbackConfig: {
                    Parallelism: 1,
                    Order: "start-first",
                },
            }),
        ...(updateConfigSwarm
            ? { UpdateConfig: updateConfigSwarm }
            : {
                // default config if no updateConfigSwarm provided
                UpdateConfig: {
                    Parallelism: 1,
                    Order: "start-first",
                    FailureAction: "rollback",
                },
            }),
        ...(stopGracePeriodSwarm !== null &&
            stopGracePeriodSwarm !== undefined && {
            StopGracePeriod: stopGracePeriodSwarm,
        }),
        ...(endpointSpecSwarm && {
            EndpointSpec: {
                ...(endpointSpecSwarm.Mode && { Mode: endpointSpecSwarm.Mode }),
                Ports: endpointSpecSwarm.Ports?.map((port) => ({
                    Protocol: (port.Protocol || "tcp"),
                    TargetPort: port.TargetPort || 0,
                    PublishedPort: port.PublishedPort || 0,
                    PublishMode: (port.PublishMode || "host"),
                })) || [],
            },
        }),
        ...(ulimitsSwarm &&
            ulimitsSwarm.length > 0 && {
            Ulimits: ulimitsSwarm,
        }),
    };
};
export const generateBindMounts = (mounts) => {
    if (!mounts || mounts.length === 0) {
        return [];
    }
    return mounts
        .filter((mount) => mount.type === "bind")
        .map((mount) => ({
        Type: "bind",
        Source: mount.hostPath || "",
        Target: mount.mountPath,
    }));
};
export const generateFileMounts = (appName, service) => {
    const { mounts } = service;
    const { APPLICATIONS_PATH } = paths(!!service.serverId);
    if (!mounts || mounts.length === 0) {
        return [];
    }
    return mounts
        .filter((mount) => mount.type === "file")
        .map((mount) => {
        const fileName = mount.filePath;
        const absoluteBasePath = path.resolve(APPLICATIONS_PATH);
        const directory = path.join(absoluteBasePath, appName, "files");
        const sourcePath = path.join(directory, fileName || "");
        return {
            Type: "bind",
            Source: sourcePath,
            Target: mount.mountPath,
        };
    });
};
export const createFile = async (outputPath, filePath, content) => {
    try {
        const fullPath = path.join(outputPath, filePath);
        if (fullPath.endsWith(path.sep) || filePath.endsWith("/")) {
            fs.mkdirSync(fullPath, { recursive: true });
            return;
        }
        const directory = path.dirname(fullPath);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(fullPath, content || "");
    }
    catch (error) {
        throw error;
    }
};
export const encodeBase64 = (content) => Buffer.from(content, "utf-8").toString("base64");
export const getCreateFileCommand = (outputPath, filePath, content) => {
    const fullPath = path.join(outputPath, filePath);
    if (fullPath.endsWith(path.sep) || filePath.endsWith("/")) {
        return `mkdir -p ${quote([fullPath])};`;
    }
    const directory = path.dirname(fullPath);
    const encodedContent = encodeBase64(content);
    return `
		mkdir -p ${quote([directory])};
		echo "${encodedContent}" | base64 -d > ${quote([fullPath])};
	`;
};
export const getServiceContainer = async (appName, serverId) => {
    try {
        const filter = {
            status: ["running"],
            label: [`com.docker.swarm.service.name=${appName}`],
        };
        const remoteDocker = await getRemoteDocker(serverId);
        const containers = await remoteDocker.listContainers({
            filters: JSON.stringify(filter),
        });
        if (containers.length === 0 || !containers[0]) {
            return null;
        }
        const container = containers[0];
        return container;
    }
    catch (error) {
        throw error;
    }
};
export const getComposeContainer = async (compose, serviceName) => {
    try {
        const { appName, composeType, serverId } = compose;
        // 1. Determine the correct labels based on composeType
        const labels = [];
        if (composeType === "stack") {
            // Labels for Docker Swarm stack services
            labels.push(`com.docker.stack.namespace=${appName}`);
            labels.push(`com.docker.swarm.service.name=${appName}_${serviceName}`);
        }
        else {
            // Labels for Docker Compose projects (default)
            labels.push(`com.docker.compose.project=${appName}`);
            labels.push(`com.docker.compose.service=${serviceName}`);
        }
        const filter = {
            status: ["running"],
            label: labels,
        };
        const remoteDocker = await getRemoteDocker(serverId);
        const containers = await remoteDocker.listContainers({
            filters: JSON.stringify(filter),
            limit: 1,
        });
        if (containers.length === 0 || !containers[0]) {
            return null;
        }
        const container = containers[0];
        return container;
    }
    catch (error) {
        throw error;
    }
};
const checkSwarmServiceRunning = async (serviceName) => {
    try {
        const service = docker.getService(serviceName);
        const info = await service.inspect();
        const replicas = info.Spec?.Mode?.Replicated?.Replicas ?? 0;
        if (replicas === 0) {
            return {
                status: "unhealthy",
                message: "Service has 0 replicas configured",
            };
        }
        // Check that at least one task is actually running
        const tasks = await docker.listTasks({
            filters: JSON.stringify({
                service: [serviceName],
                "desired-state": ["running"],
            }),
        });
        const runningTask = tasks.find((t) => t.Status?.State === "running");
        if (!runningTask) {
            const latestTask = tasks[0];
            const taskState = latestTask?.Status?.State ?? "unknown";
            return {
                status: "unhealthy",
                message: `No running tasks (current state: ${taskState})`,
            };
        }
        return { status: "healthy" };
    }
    catch (error) {
        return {
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Service not found",
        };
    }
};
const getSwarmServiceContainerId = async (serviceName) => {
    try {
        const tasks = await docker.listTasks({
            filters: JSON.stringify({
                service: [serviceName],
                "desired-state": ["running"],
            }),
        });
        const runningTask = tasks.find((t) => t.Status?.State === "running");
        return runningTask?.Status?.ContainerStatus?.ContainerID ?? null;
    }
    catch {
        return null;
    }
};
export class ServiceConvergenceError extends Error {
}
export const waitForSwarmServiceConvergence = async (appName, serverId, options) => {
    const timeoutMs = options?.timeoutMs ?? 45_000;
    const intervalMs = options?.intervalMs ?? 2_000;
    const remoteDocker = await getRemoteDocker(serverId);
    const service = remoteDocker.getService(appName);
    const deadline = Date.now() + timeoutMs;
    let lastState = "unknown";
    while (true) {
        const info = await service.inspect();
        const desiredTasksCount = info.Spec?.Mode?.Replicated?.Replicas ?? 1;
        const tasks = await remoteDocker.listTasks({
            filters: JSON.stringify({ service: [appName] }),
        });
        const currentTasks = tasks.filter((task) => task.DesiredState === "running");
        const runningTasksCount = currentTasks.filter((task) => task.Status?.State === "running").length;
        if (runningTasksCount >= desiredTasksCount) {
            return;
        }
        const failedTask = currentTasks.find((task) => ["failed", "rejected"].includes(task.Status?.State ?? ""));
        lastState =
            failedTask?.Status?.Err ??
                failedTask?.Status?.State ??
                currentTasks[0]?.Status?.State ??
                lastState;
        if (Date.now() >= deadline) {
            throw new ServiceConvergenceError(`Service ${appName} did not converge within ${timeoutMs}ms: ${runningTasksCount}/${desiredTasksCount} tasks running (last state: ${lastState})`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
};
export const checkPostgresHealth = async () => {
    const serviceCheck = await checkSwarmServiceRunning("dokploy-postgres");
    if (serviceCheck.status === "unhealthy") {
        return serviceCheck;
    }
    // Verify PostgreSQL actually accepts connections
    const containerId = await getSwarmServiceContainerId("dokploy-postgres");
    if (!containerId) {
        return { status: "unhealthy", message: "Could not find running container" };
    }
    try {
        const exec = await docker.getContainer(containerId).exec({
            Cmd: ["pg_isready", "-U", "dokploy"],
            AttachStdout: true,
            AttachStderr: true,
        });
        const stream = await exec.start({});
        const output = await new Promise((resolve) => {
            let data = "";
            stream.on("data", (chunk) => {
                data += chunk.toString();
            });
            stream.on("end", () => resolve(data));
        });
        const inspectResult = await exec.inspect();
        if (inspectResult.ExitCode !== 0) {
            return {
                status: "unhealthy",
                message: `PostgreSQL not ready: ${output.trim()}`,
            };
        }
        return { status: "healthy" };
    }
    catch (error) {
        return {
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Failed to check PostgreSQL",
        };
    }
};
export const checkTraefikHealth = async () => {
    // Traefik can run as a standalone container or a swarm service
    try {
        const container = docker.getContainer("dokploy-traefik");
        const info = await container.inspect();
        if (!info.State.Running) {
            return {
                status: "unhealthy",
                message: "Container is not running",
            };
        }
        return { status: "healthy" };
    }
    catch {
        // Not a standalone container, check as swarm service
        return checkSwarmServiceRunning("dokploy-traefik");
    }
};

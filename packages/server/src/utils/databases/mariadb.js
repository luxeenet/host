import { resolveServiceNetworks } from "../../services/network";
import { calculateResources, generateBindMounts, generateConfigContainer, generateFileMounts, generateVolumeMounts, prepareEnvironmentVariables, } from "../docker/utils";
import { getRemoteDocker } from "../servers/remote-docker";
import { withResolvedVaultRefs } from "../vault";
export const buildMariadb = async (rawMariadb) => {
    const mariadb = await withResolvedVaultRefs(rawMariadb);
    const { appName, env, externalPort, dockerImage, memoryLimit, memoryReservation, databaseName, databaseUser, databasePassword, databaseRootPassword, cpuLimit, cpuReservation, command, args, mounts, } = mariadb;
    const defaultMariadbEnv = `MARIADB_DATABASE="${databaseName}"\nMARIADB_USER="${databaseUser}"\nMARIADB_PASSWORD="${databasePassword}"\nMARIADB_ROOT_PASSWORD="${databaseRootPassword}"${env ? `\n${env}` : ""}`;
    const resolvedNetworks = await resolveServiceNetworks(mariadb);
    const { HealthCheck, RestartPolicy, Placement, Labels, Mode, RollbackConfig, UpdateConfig, StopGracePeriod, EndpointSpec, Ulimits, } = generateConfigContainer(mariadb);
    const resources = calculateResources({
        memoryLimit,
        memoryReservation,
        cpuLimit,
        cpuReservation,
    });
    const envVariables = prepareEnvironmentVariables(defaultMariadbEnv, mariadb.environment.project.env, mariadb.environment.env);
    const volumesMount = generateVolumeMounts(mounts);
    const bindsMount = generateBindMounts(mounts);
    const filesMount = generateFileMounts(appName, mariadb);
    const docker = await getRemoteDocker(mariadb.serverId);
    const settings = {
        Name: appName,
        TaskTemplate: {
            ContainerSpec: {
                HealthCheck,
                Image: dockerImage,
                Env: envVariables,
                Mounts: [...volumesMount, ...bindsMount, ...filesMount],
                ...(StopGracePeriod !== null &&
                    StopGracePeriod !== undefined && { StopGracePeriod }),
                ...(command && {
                    Command: command.split(" "),
                }),
                ...(args &&
                    args.length > 0 && {
                    Args: args,
                }),
                ...(Ulimits && { Ulimits }),
                Labels,
            },
            Networks: resolvedNetworks,
            RestartPolicy,
            Placement,
            Resources: {
                ...resources,
            },
        },
        Mode,
        RollbackConfig,
        EndpointSpec: EndpointSpec
            ? EndpointSpec
            : {
                Mode: "dnsrr",
                Ports: externalPort
                    ? [
                        {
                            Protocol: "tcp",
                            TargetPort: 3306,
                            PublishedPort: externalPort,
                            PublishMode: "host",
                        },
                    ]
                    : [],
            },
        UpdateConfig: mariadb.updateConfigSwarm ?? {
            Parallelism: 1,
            Order: "stop-first",
            FailureAction: "rollback",
        },
    };
    try {
        const service = docker.getService(appName);
        const inspect = await service.inspect();
        await service.update({
            version: Number.parseInt(inspect.Version.Index),
            ...settings,
            TaskTemplate: {
                ...settings.TaskTemplate,
                ForceUpdate: inspect.Spec.TaskTemplate.ForceUpdate + 1,
            },
        });
    }
    catch {
        await docker.createService(settings);
    }
};

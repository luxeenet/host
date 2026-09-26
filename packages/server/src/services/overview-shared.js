// No db/schema imports here — client components import this file directly, and dockerode/ssh2 (child_process) would break the browser bundle.
export const sortOverviewServices = (services, sortBy) => {
    const [field, direction] = sortBy.split("-");
    return [...services].sort((a, b) => {
        if (field === "name") {
            const cmp = a.name.localeCompare(b.name);
            return direction === "asc" ? cmp : -cmp;
        }
        if (field === "type") {
            const cmp = a.type.localeCompare(b.type);
            return direction === "asc" ? cmp : -cmp;
        }
        if (field === "createdAt") {
            const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return direction === "asc" ? cmp : -cmp;
        }
        // lastDeploy: services without a deploy always sort to the end.
        const aDate = a.lastDeployAt ? new Date(a.lastDeployAt).getTime() : null;
        const bDate = b.lastDeployAt ? new Date(b.lastDeployAt).getTime() : null;
        if (aDate === null && bDate === null)
            return 0;
        if (aDate === null)
            return 1;
        if (bDate === null)
            return -1;
        return direction === "desc" ? bDate - aDate : aDate - bDate;
    });
};
export const DB_ENGINE_ICON_TYPES = new Set([
    "postgres",
    "mariadb",
    "mysql",
    "mongo",
    "redis",
    "libsql",
]);
export const getServiceOverviewIcon = (service) => {
    if (DB_ENGINE_ICON_TYPES.has(service.type)) {
        return { kind: "db", engine: service.type };
    }
    if (service.icon) {
        return { kind: "custom", url: service.icon };
    }
    return { kind: "generic", type: service.type };
};
export const sortOverviewDomains = (domains, sortBy) => {
    const [field, direction] = sortBy.split("-");
    return [...domains].sort((a, b) => {
        if (field === "port") {
            // Domains without a port sort to the end regardless of direction.
            const aPort = a.port;
            const bPort = b.port;
            if (aPort === null && bPort === null)
                return 0;
            if (aPort === null)
                return 1;
            if (bPort === null)
                return -1;
            return direction === "asc" ? aPort - bPort : bPort - aPort;
        }
        const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return direction === "asc" ? cmp : -cmp;
    });
};
export const getBackupOverviewIcon = (row) => {
    const engine = row.databaseType ?? row.serviceType;
    if (engine === "web-server") {
        return { kind: "webServer" };
    }
    if (engine && DB_ENGINE_ICON_TYPES.has(engine)) {
        return { kind: "db", engine };
    }
    if (row.serviceOwnerType === "compose") {
        return { kind: "generic", type: "compose" };
    }
    return { kind: "generic", type: "application" };
};

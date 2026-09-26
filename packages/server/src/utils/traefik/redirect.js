import { loadOrCreateConfig, loadOrCreateConfigRemote, writeAppTraefikConfig, writeTraefikConfigRemote, } from "./application";
import { addMiddleware, deleteMiddleware, loadMiddlewares, loadRemoteMiddlewares, writeMiddleware, } from "./middleware";
export const updateRedirectMiddleware = async (application, data) => {
    const { appName, serverId } = application;
    let config;
    if (serverId) {
        config = await loadRemoteMiddlewares(serverId);
    }
    else {
        config = loadMiddlewares();
    }
    const middlewareName = `redirect-${appName}-${data.uniqueConfigKey}`;
    if (config?.http?.middlewares?.[middlewareName]) {
        config.http.middlewares[middlewareName] = {
            redirectRegex: {
                regex: data.regex,
                replacement: data.replacement,
                permanent: data.permanent,
            },
        };
    }
    if (serverId) {
        await writeTraefikConfigRemote(config, "middlewares", serverId);
    }
    else {
        writeMiddleware(config);
    }
};
export const createRedirectMiddleware = async (application, data) => {
    const { appName, serverId } = application;
    let config;
    if (serverId) {
        config = await loadRemoteMiddlewares(serverId);
    }
    else {
        config = loadMiddlewares();
    }
    const middlewareName = `redirect-${appName}-${data.uniqueConfigKey}`;
    const newMiddleware = {
        [middlewareName]: {
            redirectRegex: {
                regex: data.regex,
                replacement: data.replacement,
                permanent: data.permanent,
            },
        },
    };
    if (config?.http) {
        config.http.middlewares = {
            ...config.http.middlewares,
            ...newMiddleware,
        };
    }
    let appConfig;
    if (serverId) {
        appConfig = await loadOrCreateConfigRemote(serverId, appName);
    }
    else {
        appConfig = loadOrCreateConfig(appName);
    }
    addMiddleware(appConfig, middlewareName);
    if (serverId) {
        await writeTraefikConfigRemote(config, "middlewares", serverId);
    }
    else {
        writeMiddleware(config);
    }
    await writeAppTraefikConfig(appConfig, appName, serverId);
};
export const removeRedirectMiddleware = async (application, data) => {
    const { appName, serverId } = application;
    let config;
    if (serverId) {
        config = await loadRemoteMiddlewares(serverId);
    }
    else {
        config = loadMiddlewares();
    }
    const middlewareName = `redirect-${appName}-${data.uniqueConfigKey}`;
    if (config?.http?.middlewares?.[middlewareName]) {
        delete config.http.middlewares[middlewareName];
    }
    let appConfig;
    if (serverId) {
        appConfig = await loadOrCreateConfigRemote(serverId, appName);
    }
    else {
        appConfig = loadOrCreateConfig(appName);
    }
    deleteMiddleware(appConfig, middlewareName);
    if (serverId) {
        await writeTraefikConfigRemote(config, "middlewares", serverId);
    }
    else {
        writeMiddleware(config);
    }
    await writeAppTraefikConfig(appConfig, appName, serverId);
};

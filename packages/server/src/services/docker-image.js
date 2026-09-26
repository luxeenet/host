import { execAsync, execAsyncRemote, } from "@dokploy/server/utils/process/execAsync";
import { quote } from "shell-quote";
export const getImages = async (serverId) => {
    try {
        const command = "docker images --format '{{json .}}'";
        const { stdout } = serverId
            ? await execAsyncRemote(serverId, command)
            : await execAsync(command);
        return stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    catch (error) {
        console.error(error);
        return [];
    }
};
export const getImageConfig = async (imageRef, serverId) => {
    const command = `docker image inspect ${quote([String(imageRef ?? "")])}`;
    const { stdout } = serverId
        ? await execAsyncRemote(serverId, command)
        : await execAsync(command);
    return JSON.parse(stdout.trim())[0];
};
export const removeImage = async ({ repository, tag, id, force }, serverId) => {
    const hasTaggedReference = repository && tag && repository !== "<none>" && tag !== "<none>";
    const reference = hasTaggedReference ? `${repository}:${tag}` : id;
    const command = `docker rmi ${force ? "-f " : ""}${quote([String(reference ?? "")])}`;
    if (serverId) {
        await execAsyncRemote(serverId, command);
    }
    else {
        await execAsync(command);
    }
};

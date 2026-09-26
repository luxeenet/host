import { spawn } from "node:child_process";
import { findServerById } from "@dokploy/server/services/server";
import { Client } from "ssh2";
export const openProcessStream = async (serverId, command) => {
    if (!serverId) {
        const child = spawn("sh", ["-c", command]);
        const exit = new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) => resolve(code ?? 1));
        });
        return {
            stdin: child.stdin,
            stdout: child.stdout,
            stderr: child.stderr,
            exit,
            close: () => child.kill(),
        };
    }
    const server = await findServerById(serverId);
    if (!server.sshKeyId)
        throw new Error("No SSH key available for this server");
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn
            .once("ready", () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    reject(err);
                    return;
                }
                let exitCode = 1;
                stream.once("exit", (code) => {
                    exitCode = code ?? 1;
                });
                const exit = new Promise((resolveExit) => {
                    stream.once("close", () => {
                        conn.end();
                        resolveExit(exitCode);
                    });
                });
                resolve({
                    stdin: stream,
                    stdout: stream,
                    stderr: stream.stderr,
                    exit,
                    close: () => {
                        stream.close();
                        conn.end();
                    },
                });
            });
        })
            .once("error", (err) => {
            conn.end();
            reject(err);
        })
            .connect({
            host: server.ipAddress,
            port: server.port,
            username: server.username,
            privateKey: server.sshKey?.privateKey,
            readyTimeout: 30_000,
            keepaliveInterval: 15_000,
        });
    });
};
const collectOutput = (stream) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk.toString()));
    return () => chunks.join("").trim();
};
export const pipeBetweenServers = async ({ source, target, onProgress, }) => {
    const to = await openProcessStream(target.serverId, target.command);
    const targetError = collectOutput(to.stderr);
    to.stdout.resume();
    to.stdin.on("error", () => { });
    const from = await openProcessStream(source.serverId, source.command);
    const sourceError = collectOutput(from.stderr);
    let bytes = 0;
    from.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        onProgress?.(bytes);
    });
    from.stdout.pipe(to.stdin);
    const targetExit = to.exit.then((code) => {
        if (code !== 0)
            from.close();
        return code;
    });
    const [sourceCode, targetCode] = await Promise.all([from.exit, targetExit]);
    const failures = [
        sourceCode !== 0 &&
            `source exited with code ${sourceCode}: ${sourceError()}`,
        targetCode !== 0 &&
            `target exited with code ${targetCode}: ${targetError()}`,
    ].filter(Boolean);
    if (failures.length > 0) {
        throw new Error(failures.join("\n"));
    }
    return bytes;
};

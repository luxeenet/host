import { exec, execFile } from "node:child_process";
import util from "node:util";
import { findServerById } from "@dokploy/server/services/server";
import { Client } from "ssh2";
import { ExecError } from "./ExecError";
export class WriteFileRemoteError extends Error {
    context;
    constructor(message, context) {
        super(message);
        this.context = context;
        this.name = "WriteFileRemoteError";
    }
}
// Re-export ExecError for easier imports
export { ExecError } from "./ExecError";
const execAsyncBase = util.promisify(exec);
export const execAsync = async (command, options) => {
    try {
        const result = await execAsyncBase(command, options);
        return {
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
        };
    }
    catch (error) {
        if (error instanceof Error) {
            // @ts-expect-error - exec error has these properties
            const exitCode = error.code;
            // @ts-expect-error
            const stdout = error.stdout?.toString() || "";
            // @ts-expect-error
            const stderr = error.stderr?.toString() || "";
            throw new ExecError(`Command execution failed: ${error.message}`, {
                command,
                stdout,
                stderr,
                exitCode,
                originalError: error,
            });
        }
        throw error;
    }
};
export const execAsyncStream = (command, onData, options = {}) => {
    return new Promise((resolve, reject) => {
        let stdoutComplete = "";
        let stderrComplete = "";
        const childProcess = exec(command, options, (error) => {
            if (error) {
                reject(new ExecError(`Command execution failed: ${error.message}`, {
                    command,
                    stdout: stdoutComplete,
                    stderr: stderrComplete,
                    exitCode: error.code,
                    originalError: error,
                }));
                return;
            }
            resolve({ stdout: stdoutComplete, stderr: stderrComplete });
        });
        childProcess.stdout?.on("data", (data) => {
            const stringData = data.toString();
            stdoutComplete += stringData;
            if (onData) {
                onData(stringData);
            }
        });
        childProcess.stderr?.on("data", (data) => {
            const stringData = data.toString();
            stderrComplete += stringData;
            if (onData) {
                onData(stringData);
            }
        });
        childProcess.on("error", (error) => {
            console.log(error);
            reject(new ExecError(`Command execution error: ${error.message}`, {
                command,
                stdout: stdoutComplete,
                stderr: stderrComplete,
                originalError: error,
            }));
        });
    });
};
export const execFileAsync = async (command, args, options = {}) => {
    const child = execFile(command, args);
    if (options.input && child.stdin) {
        child.stdin.write(options.input);
        child.stdin.end();
    }
    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr?.on("data", (data) => {
            stderr += data.toString();
        });
        child.on("close", (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            }
            else {
                reject(new Error(`Command failed with code ${code}. Stderr: ${stderr}`));
            }
        });
        child.on("error", reject);
    });
};
export const execAsyncRemote = async (serverId, command, onData) => {
    if (!serverId)
        return { stdout: "", stderr: "" };
    const server = await findServerById(serverId);
    if (!server.sshKeyId)
        throw new Error("No SSH key available for this server");
    let stdout = "";
    let stderr = "";
    return new Promise((resolve, reject) => {
        const conn = new Client();
        sleep(1000);
        conn
            .once("ready", () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    onData?.(err.message);
                    reject(new ExecError(`Remote command execution failed: ${err.message}`, {
                        command,
                        serverId,
                        originalError: err,
                    }));
                    return;
                }
                stream
                    .on("close", (code, _signal) => {
                    conn.end();
                    if (code === 0) {
                        resolve({ stdout, stderr });
                    }
                    else {
                        reject(new ExecError(`Remote command failed with exit code ${code}`, {
                            command,
                            stdout,
                            stderr,
                            exitCode: code,
                            serverId,
                        }));
                    }
                })
                    .on("data", (data) => {
                    stdout += data.toString();
                    onData?.(data.toString());
                })
                    .stderr.on("data", (data) => {
                    stderr += data.toString();
                    onData?.(data.toString());
                });
            });
        })
            .on("error", (err) => {
            conn.end();
            if (err.level === "client-authentication") {
                const technicalDetail = `Error: ${err.message} ${err.level}`;
                const friendlyMessage = [
                    "",
                    "❌ Couldn't connect to your server — the SSH key was not accepted.",
                    "",
                    "This usually means the key doesn't match what's on the server, or the key format is invalid.",
                    "",
                    `Technical details: ${technicalDetail}`,
                    "",
                    "💡 Hints:",
                    "  • Check that the SSH key you added in Dokploy is the same one installed on the server (e.g. in ~/.ssh/authorized_keys).",
                    "  • Try generating a new SSH key in Dokploy and add only the public key to the server, then try again.",
                    "  • Make sure to follow the instructions on the Setup Server Button on the SSH Keys tab and then click on deployments tab and check the logs for more details.",
                ].join("\n");
                const errorMsg = `Authentication failed: Invalid SSH private key. ❌ Error: ${err.message} ${err.level}`;
                onData?.(friendlyMessage);
                reject(new ExecError(`Authentication failed: Invalid SSH private key. ${friendlyMessage}`, {
                    command,
                    serverId,
                    originalError: err,
                }));
            }
            else {
                const errorMsg = `SSH connection error: ${err.message}`;
                onData?.(errorMsg);
                reject(new ExecError(errorMsg, {
                    command,
                    serverId,
                    originalError: err,
                }));
            }
        })
            .connect({
            host: server.ipAddress,
            port: server.port,
            username: server.username,
            privateKey: server.sshKey?.privateKey,
            timeout: 99999,
        });
    });
};
export const writeFileRemote = async (serverId, remotePath, content) => {
    const server = await findServerById(serverId);
    if (!server.sshKeyId)
        throw new Error("No SSH key available for this server");
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn
            .once("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    reject(new WriteFileRemoteError(`SFTP session failed: ${err.message}`, {
                        remotePath,
                        serverId,
                        originalError: err,
                    }));
                    return;
                }
                sftp.writeFile(remotePath, content, (writeErr) => {
                    conn.end();
                    if (writeErr) {
                        reject(new WriteFileRemoteError(`Failed to write remote file ${remotePath}: ${writeErr.message}`, { remotePath, serverId, originalError: writeErr }));
                        return;
                    }
                    resolve();
                });
            });
        })
            .on("error", (err) => {
            conn.end();
            reject(new WriteFileRemoteError(`SSH connection error: ${err.message}`, {
                remotePath,
                serverId,
                originalError: err,
            }));
        })
            .connect({
            host: server.ipAddress,
            port: server.port,
            username: server.username,
            privateKey: server.sshKey?.privateKey,
            timeout: 99999,
        });
    });
};
export const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

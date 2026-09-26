import { dirname, join } from "node:path";
import { encodeBase64, prepareEnvironmentVariables } from "../docker/utils";
export const createEnvFileCommand = (directory, env, projectEnv, environmentEnv) => {
    const envFileContent = prepareEnvironmentVariables(env, projectEnv, environmentEnv).join("\n");
    const encodedContent = encodeBase64(envFileContent || "");
    const envFilePath = join(dirname(directory), ".env");
    return `echo "${encodedContent}" | base64 -d > "${envFilePath}";`;
};

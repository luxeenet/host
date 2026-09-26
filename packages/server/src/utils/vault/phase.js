import { vaultFetch } from "./types";
const baseUrl = (config) => config.apiUrl.replace(/\/+$/, "");
const authHeaders = (config) => ({
    Authorization: `Bearer ServiceAccount ${config.token}`,
    Accept: "application/json",
});
const parseErrorDetail = async (response) => {
    try {
        const body = (await response.json());
        return body.error ?? body.message ?? "";
    }
    catch {
        return "";
    }
};
const request = async (config, path, params) => {
    const url = new URL(`${baseUrl(config)}${path}`);
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
    }
    const response = await vaultFetch(url.toString(), {
        headers: authHeaders(config),
    });
    if (response.ok) {
        return response;
    }
    const detail = await parseErrorDetail(response);
    const reason = response.status === 401 || response.status === 403
        ? "authentication failed"
        : "request failed";
    throw new Error(`Phase: ${reason} (status ${response.status}${detail ? `: ${detail}` : ""})`);
};
const fetchSecrets = async (config) => {
    const response = await request(config, "/v1/secrets/", {
        app_id: config.appId,
        env: config.env,
        path: config.path || "/",
    });
    const body = (await response.json());
    const secrets = {};
    for (const secret of body ?? []) {
        secrets[secret.key] = secret.value;
    }
    return secrets;
};
export const phaseClient = {
    async getSecrets(config, refs) {
        const secrets = await fetchSecrets(config);
        const result = {};
        for (const ref of refs) {
            if (secrets[ref] === undefined) {
                throw new Error(`Phase: secret "${ref}" not found in environment "${config.env}"`);
            }
            result[ref] = secrets[ref];
        }
        return result;
    },
    async testConnection(config) {
        const appResponse = await request(config, `/v1/apps/${config.appId}/`);
        const app = (await appResponse.json());
        if (app.sseEnabled === false) {
            throw new Error("Phase: enable Server-side Encryption (SSE) on this Phase App to use the REST secrets API");
        }
        await fetchSecrets(config);
    },
    async listSecretNames(config) {
        const secrets = await fetchSecrets(config);
        return Object.keys(secrets);
    },
};

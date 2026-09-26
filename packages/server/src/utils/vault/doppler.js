import { vaultFetch } from "./types";
const downloadUrl = (config) => {
    const params = new URLSearchParams({ format: "json" });
    if (config.project) {
        params.set("project", config.project);
    }
    if (config.config) {
        params.set("config", config.config);
    }
    return `https://api.doppler.com/v3/configs/config/secrets/download?${params.toString()}`;
};
const downloadSecrets = async (config) => {
    const response = await vaultFetch(downloadUrl(config), {
        headers: {
            Authorization: `Bearer ${config.serviceToken}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        let detail = "";
        try {
            const body = (await response.json());
            detail = (body.messages ?? []).join(", ");
        }
        catch { }
        throw new Error(`Doppler: failed to fetch secrets (status ${response.status}${detail ? `: ${detail}` : ""})`);
    }
    return (await response.json());
};
export const dopplerClient = {
    async getSecrets(config, refs) {
        const secrets = await downloadSecrets(config);
        const result = {};
        for (const ref of refs) {
            if (secrets[ref] === undefined) {
                throw new Error(`Doppler: secret "${ref}" not found in this config`);
            }
            result[ref] = secrets[ref];
        }
        return result;
    },
    async testConnection(config) {
        await downloadSecrets(config);
    },
    async listSecretNames(config) {
        const secrets = await downloadSecrets(config);
        return Object.keys(secrets);
    },
};

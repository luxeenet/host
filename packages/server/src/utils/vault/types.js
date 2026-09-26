export const VAULT_REQUEST_TIMEOUT_MS = 15_000;
export const vaultFetch = async (url, init = {}) => {
    return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(VAULT_REQUEST_TIMEOUT_MS),
    });
};

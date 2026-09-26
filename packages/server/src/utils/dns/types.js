export const DNS_REQUEST_TIMEOUT_MS = 15_000;
export const dnsFetch = async (url, init = {}) => {
    return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(DNS_REQUEST_TIMEOUT_MS),
    });
};

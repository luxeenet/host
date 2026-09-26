import { dnsFetch } from "./types";
const PORKBUN_API = "https://api.porkbun.com/api/json/v3";
const pbFetch = async (config, path, body = {}) => {
    const response = await dnsFetch(`${PORKBUN_API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            apikey: config.apiKey,
            secretapikey: config.secretApiKey,
            ...body,
        }),
    });
    const result = (await response.json());
    if (!response.ok || result.status !== "SUCCESS") {
        throw new Error(`Porkbun: request to ${path} failed${result.message ? `: ${result.message}` : ` (status ${response.status})`}`);
    }
    return result;
};
// Porkbun's "name" only accepts the subdomain portion, without the zone (domain) itself.
const toSubdomain = (name, domain) => {
    if (name === domain) {
        return "";
    }
    const suffix = `.${domain}`;
    return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
};
const inlinePriority = (record) => (record.type === "MX" || record.type === "SRV") && record.prio != null
    ? `${record.prio} ${record.content}`
    : record.content;
const buildValue = (record) => {
    const value = record.content.trim();
    if (record.type === "MX" || record.type === "SRV") {
        const match = /^(\d+)\s+(\S.*)$/.exec(value);
        if (match) {
            return { content: match[2], prio: match[1] };
        }
    }
    return { content: value };
};
export const porkbunClient = {
    async listZones(config) {
        const result = await pbFetch(config, "/domain/listAll");
        return result.domains.map((domain) => ({
            id: domain.domain,
            name: domain.domain,
        }));
    },
    async listRecords(config, zoneId) {
        const result = await pbFetch(config, `/dns/retrieve/${zoneId}`);
        return result.records.map((record) => ({
            id: record.id,
            type: record.type,
            name: record.name,
            content: inlinePriority(record),
            ttl: Number(record.ttl),
        }));
    },
    async upsertRecord(config, record) {
        const subdomain = toSubdomain(record.name, record.zoneId);
        const existing = await pbFetch(config, `/dns/retrieveByNameType/${record.zoneId}/${record.type}/${subdomain}`);
        const built = buildValue(record);
        const payload = {
            name: subdomain,
            type: record.type,
            content: built.content,
            ...(built.prio ? { prio: built.prio } : {}),
            ttl: record.ttl ?? 600,
        };
        const expectedContent = inlinePriority({
            type: record.type,
            content: built.content,
            prio: built.prio,
        });
        const existingRecord = existing.records.find((r) => inlinePriority(r) === expectedContent);
        if (existingRecord) {
            await pbFetch(config, `/dns/edit/${record.zoneId}/${existingRecord.id}`, payload);
            return { id: existingRecord.id };
        }
        const created = await pbFetch(config, `/dns/create/${record.zoneId}`, payload);
        return { id: created.id };
    },
    async updateRecord(config, zoneId, recordId, record) {
        const built = buildValue(record);
        await pbFetch(config, `/dns/edit/${zoneId}/${recordId}`, {
            name: toSubdomain(record.name, zoneId),
            type: record.type,
            content: built.content,
            ...(built.prio ? { prio: built.prio } : {}),
            ttl: record.ttl ?? 600,
        });
        return { id: recordId };
    },
    async deleteRecord(config, zoneId, recordId) {
        await pbFetch(config, `/dns/delete/${zoneId}/${recordId}`);
    },
    async testConnection(config) {
        await pbFetch(config, "/ping");
    },
};

import { proxiableDnsRecordTypes, } from "@dokploy/server/db/schema";
import { dnsFetch } from "./types";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const inlinePriority = (record) => record.type === "MX" && typeof record.priority === "number"
    ? `${record.priority} ${record.content}`
    : record.content;
const proxySettings = (record) => record.proxied !== undefined &&
    proxiableDnsRecordTypes.includes(record.type)
    ? { proxied: record.proxied }
    : {};
const buildValue = (record) => {
    const value = record.content.trim();
    if (record.type === "MX") {
        const match = /^(\d+)\s+(\S.*)$/.exec(value);
        return match
            ? { content: match[2], priority: Number(match[1]) }
            : { content: value, priority: 10 };
    }
    if (record.type === "SRV") {
        const parts = value.split(/\s+/);
        const [priority, weight, port, target] = parts;
        if (parts.length !== 4 || !target) {
            throw new Error(`Cloudflare: an SRV value must be "priority weight port target", got "${value}"`);
        }
        return {
            data: {
                priority: Number(priority),
                weight: Number(weight),
                port: Number(port),
                target,
            },
        };
    }
    if (record.type === "CAA") {
        const match = /^(\d+)\s+(\S+)\s+"?([^"]+)"?$/.exec(value);
        if (!match) {
            throw new Error(`Cloudflare: a CAA value must be \`flags tag "value"\`, got "${value}"`);
        }
        return {
            data: {
                flags: Number(match[1]),
                tag: match[2],
                value: match[3],
            },
        };
    }
    return { content: value };
};
const cfFetch = async (config, path, init = {}) => {
    const response = await dnsFetch(`${CLOUDFLARE_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${config.apiToken.trim()}`,
            "Content-Type": "application/json",
            ...init.headers,
        },
    });
    const body = (await response.json());
    if (!response.ok || !body.success) {
        const detail = body.errors?.map((e) => e.message).join(", ");
        throw new Error(`Cloudflare: request to ${path} failed${detail ? `: ${detail}` : ` (status ${response.status})`}`);
    }
    return body.result;
};
export const cloudflareClient = {
    async listZones(config) {
        const zones = [];
        let page = 1;
        while (true) {
            const result = await cfFetch(config, `/zones?per_page=50&page=${page}`);
            zones.push(...result.map((zone) => ({ id: zone.id, name: zone.name })));
            if (result.length < 50) {
                break;
            }
            page += 1;
        }
        return zones;
    },
    async listRecords(config, zoneId) {
        const records = [];
        let page = 1;
        while (true) {
            const result = await cfFetch(config, `/zones/${zoneId}/dns_records?per_page=50&page=${page}`);
            records.push(...result.map((record) => ({
                id: record.id,
                type: record.type,
                name: record.name,
                content: inlinePriority(record),
                ttl: record.ttl,
                proxied: record.proxied,
            })));
            if (result.length < 50) {
                break;
            }
            page += 1;
        }
        return records;
    },
    async upsertRecord(config, record) {
        const payload = {
            type: record.type,
            name: record.name,
            ...buildValue(record),
            ...proxySettings(record),
            ttl: record.ttl ?? 1,
        };
        const existing = await cfFetch(config, `/zones/${record.zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`);
        const built = buildValue(record);
        const existingRecord = existing.find((r) => {
            if (built.data) {
                return Object.entries(built.data).every(([k, v]) => r.data && r.data[k] === v);
            }
            const normalizedRecord = {
                type: record.type,
                content: built.content ?? record.content.trim(),
                priority: built.priority,
            };
            return inlinePriority(r) === inlinePriority(normalizedRecord);
        });
        if (existingRecord) {
            const updated = await cfFetch(config, `/zones/${record.zoneId}/dns_records/${existingRecord.id}`, { method: "PUT", body: JSON.stringify(payload) });
            return { id: updated.id };
        }
        const created = await cfFetch(config, `/zones/${record.zoneId}/dns_records`, { method: "POST", body: JSON.stringify(payload) });
        return { id: created.id };
    },
    async updateRecord(config, zoneId, recordId, record) {
        const updated = await cfFetch(config, `/zones/${zoneId}/dns_records/${recordId}`, {
            method: "PUT",
            body: JSON.stringify({
                type: record.type,
                name: record.name,
                ...buildValue(record),
                ...proxySettings(record),
                ttl: record.ttl ?? 1,
            }),
        });
        return { id: updated.id };
    },
    async deleteRecord(config, zoneId, recordId) {
        await cfFetch(config, `/zones/${zoneId}/dns_records/${recordId}`, {
            method: "DELETE",
        });
    },
    async testConnection(config) {
        await cfFetch(config, "/zones?per_page=1");
    },
};

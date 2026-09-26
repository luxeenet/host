import { dnsFetch } from "./types";
const INFOMANIAK_API = "https://api.infomaniak.com";
// Infomaniak requires a TTL on every record, within a 60..86400 range.
const DEFAULT_TTL = 300;
const ikRequest = async (config, path, init = {}) => {
    const response = await dnsFetch(`${INFOMANIAK_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${config.apiToken.trim()}`,
            "Content-Type": "application/json",
            ...init.headers,
        },
    });
    const body = (await response.json());
    if (!response.ok || body.result !== "success") {
        const detail = body.error?.description ?? body.error?.code;
        throw new Error(`Infomaniak: request to ${path} failed${detail ? `: ${detail}` : ` (status ${response.status})`}`);
    }
    return body;
};
const ikFetch = async (config, path, init = {}) => (await ikRequest(config, path, init)).data;
// Infomaniak's "source" holds the subdomain only, relative to the zone. The apex
// is a bare root dot; "" and "@" are accepted too so a hand-written record still
// round-trips.
const APEX_SOURCES = new Set(["", ".", "@"]);
const toSource = (name, zone) => {
    const fqdn = name.replace(/\.$/, "");
    if (fqdn === zone) {
        return ".";
    }
    const suffix = `.${zone}`;
    return fqdn.endsWith(suffix) ? fqdn.slice(0, -suffix.length) : fqdn;
};
const toFqdn = (source, zone) => APEX_SOURCES.has(source) ? zone : `${source}.${zone}`;
// toSource always writes the apex as ".", so an existing record stored under one
// of the other apex spellings has to normalize to the same thing before it can
// be matched.
const normalizeSource = (source) => APEX_SOURCES.has(source) ? "." : source;
// TXT targets are stored quoted; keep Dokploy's view of them unquoted so that
// editing a record does not stack a new pair of quotes on every save.
const unquoteTarget = (target) => {
    if (target.length >= 2 && target.startsWith('"') && target.endsWith('"')) {
        try {
            const unquoted = JSON.parse(target);
            if (typeof unquoted === "string") {
                return unquoted;
            }
        }
        catch {
            return target;
        }
    }
    return target;
};
const quoteTarget = (type, content) => {
    const value = content.trim();
    if (type !== "TXT") {
        return value;
    }
    return value.startsWith('"') && value.endsWith('"')
        ? value
        : JSON.stringify(value);
};
const recordPayload = (record, zone) => ({
    type: record.type,
    source: toSource(record.name, zone),
    target: quoteTarget(record.type, record.content),
    ttl: record.ttl ?? DEFAULT_TTL,
});
const PRODUCTS_PER_PAGE = 100;
// The products endpoint paginates — 15 per page by default — so an account with
// more domains than fit on one page would otherwise silently lose zones.
const listDomainProducts = async (config) => {
    const domains = [];
    let page = 1;
    while (true) {
        const body = await ikRequest(config, `/1/products?service_name=domain&page=${page}&per_page=${PRODUCTS_PER_PAGE}`);
        domains.push(...(body.data ?? []));
        if (page >= (body.pages ?? 1)) {
            return domains;
        }
        page += 1;
    }
};
const listZoneRecords = async (config, zoneId) => await ikFetch(config, `/2/zones/${encodeURIComponent(zoneId)}/records?with=records_description`);
// The API filters server-side, which avoids pulling a whole zone just to find
// one record. The match is still checked here: filter[source] is documented with
// a bare subdomain example, so nothing guarantees it compares exactly the way
// toSource writes the apex, and a filter that silently over-matches would
// otherwise turn an update into a duplicate.
const findRecord = async (config, zoneId, type, source, expectedContent) => {
    const query = new URLSearchParams({
        "filter[source]": source,
        "filter[types][]": type,
    });
    const candidates = await ikFetch(config, `/2/zones/${encodeURIComponent(zoneId)}/records?${query}`);
    return candidates.find((candidate) => candidate.type === type &&
        normalizeSource(candidate.source) === source &&
        unquoteTarget(candidate.target) === expectedContent);
};
export const infomaniakClient = {
    async listZones(config) {
        const domains = await listDomainProducts(config);
        // The v2 record endpoints are keyed by zone name, not by product id.
        return domains.map((domain) => ({
            id: domain.customer_name,
            name: domain.customer_name,
        }));
    },
    async listRecords(config, zoneId) {
        const records = await listZoneRecords(config, zoneId);
        return records.map((record) => ({
            id: String(record.id),
            type: record.type,
            name: toFqdn(record.source, zoneId),
            content: unquoteTarget(record.target),
            ttl: Number(record.ttl),
        }));
    },
    async upsertRecord(config, record) {
        const source = toSource(record.name, record.zoneId);
        const expectedContent = unquoteTarget(quoteTarget(record.type, record.content));
        const match = await findRecord(config, record.zoneId, record.type, source, expectedContent);
        const body = JSON.stringify(recordPayload(record, record.zoneId));
        const zone = encodeURIComponent(record.zoneId);
        if (match) {
            await ikFetch(config, `/2/zones/${zone}/records/${match.id}`, {
                method: "PUT",
                body,
            });
            return { id: String(match.id) };
        }
        const created = await ikFetch(config, `/2/zones/${zone}/records`, { method: "POST", body });
        // The API returns the created record, but older responses only carry its id.
        return {
            id: typeof created === "object" && created !== null
                ? String(created.id)
                : String(created),
        };
    },
    async updateRecord(config, zoneId, recordId, record) {
        await ikFetch(config, `/2/zones/${encodeURIComponent(zoneId)}/records/${recordId}`, { method: "PUT", body: JSON.stringify(recordPayload(record, zoneId)) });
        return { id: recordId };
    },
    async deleteRecord(config, zoneId, recordId) {
        await ikFetch(config, `/2/zones/${encodeURIComponent(zoneId)}/records/${recordId}`, { method: "DELETE" });
    },
    async testConnection(config) {
        await ikFetch(config, "/1/products?service_name=domain&per_page=1");
    },
};

import { parse } from "toml";
/**
 * Fetches the list of available templates from meta.json
 */
export async function fetchTemplatesList(baseUrl = "https://templates.dokploy.com") {
    const response = await fetch(`${baseUrl}/meta.json`, {
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch templates: ${response.statusText}`);
    }
    const templates = (await response.json());
    return templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        logo: template.logo,
        links: template.links,
        tags: template.tags,
    }));
}
const LOGO_MIME_TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    webp: "image/webp",
    gif: "image/gif",
};
export async function fetchTemplateLogo(templateId, baseUrl = "https://templates.dokploy.com") {
    try {
        const templates = await fetchTemplatesList(baseUrl);
        const template = templates.find((t) => t.id === templateId);
        if (!template?.logo)
            return null;
        const response = await fetch(`${baseUrl}/blueprints/${templateId}/${template.logo}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0)
            return null;
        const contentType = response.headers.get("content-type")?.split(";")[0];
        const extension = template.logo.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = contentType?.startsWith("image/")
            ? contentType
            : LOGO_MIME_TYPES[extension];
        if (!mimeType)
            return null;
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        if (dataUrl.length > 2 * 1024 * 1024)
            return null;
        return dataUrl;
    }
    catch {
        return null;
    }
}
/**
 * Fetches a specific template's files
 */
export async function fetchTemplateFiles(templateId, baseUrl = "https://templates.dokploy.com") {
    const timeout = AbortSignal.timeout(10000);
    const [templateYmlResponse, dockerComposeResponse] = await Promise.all([
        fetch(`${baseUrl}/blueprints/${templateId}/template.toml`, {
            signal: timeout,
        }),
        fetch(`${baseUrl}/blueprints/${templateId}/docker-compose.yml`, {
            signal: timeout,
        }),
    ]);
    if (!templateYmlResponse.ok || !dockerComposeResponse.ok) {
        throw new Error("Template files not found");
    }
    const [templateYml, dockerCompose] = await Promise.all([
        templateYmlResponse.text(),
        dockerComposeResponse.text(),
    ]);
    const config = parse(templateYml);
    return { config, dockerCompose };
}

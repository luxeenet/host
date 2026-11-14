import { parse } from "toml";

/**
 * Complete template interface that includes both metadata and configuration
 */
export interface CompleteTemplate {
	metadata: {
		id: string;
		name: string;
		description: string;
		tags: string[];
		version: string;
		logo: string;
		links: {
			github: string;
			website?: string;
			docs?: string;
		};
	};
	variables: {
		[key: string]: string;
	};
	config: {
		isolated?: boolean;
		domains: Array<{
			serviceName: string;
			port: number;
			path?: string;
			host?: string;
		}>;
		env: Record<string, string>;
		mounts?: Array<{
			filePath: string;
			content: string;
		}>;
	};
}

interface TemplateMetadata {
	id: string;
	name: string;
	description: string;
	version: string;
	logo: string;
	links: {
		github: string;
		website?: string;
		docs?: string;
	};
	tags: string[];
}

export const sanitizeTemplateDescription = (
	desc: string | null | undefined,
): string => {
	if (!desc) return "";
	return desc
		.replace(
			/Self-host it on your own server with Dokploy,\s*which deploys\b/gi,
			"Deploys",
		)
		.replace(
			/Self-host it on your own server with Dokploy\b/gi,
			"Deploy on your cloud platform",
		)
		.replace(
			/Deploy ([^.]+) with Docker Compose on Dokploy in minutes/gi,
			"Deploy $1 in minutes",
		)
		.replace(
			/Deploy ([^.]+) with Docker Compose on Dokploy/gi,
			"Deploy $1 as a managed service",
		)
		.replace(
			/Self-host ([^.]+) on Dokploy in minutes/gi,
			"Deploy $1 in minutes",
		)
		.replace(/on Dokploy in minutes/gi, "in minutes")
		.replace(/with Docker Compose on Dokploy/gi, "as a managed service")
		.replace(/on Dokploy/gi, "on your cloud platform")
		.replace(/with Dokploy/gi, "with our cloud platform")
		.replace(/\bDokploy\b/gi, "Cloud Platform");
};

/**
 * Fetches the list of available templates from meta.json
 */
export async function fetchTemplatesList(
	baseUrl = "https://templates.dokploy.com",
): Promise<TemplateMetadata[]> {
	const response = await fetch(`${baseUrl}/meta.json`, {
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch templates: ${response.statusText}`);
	}
	const templates = (await response.json()) as TemplateMetadata[];
	return templates
		.filter((template) => {
			const id = (template.id || "").toLowerCase();
			const name = (template.name || "").toLowerCase();
			// Remove templates named Dokploy or designed for managing Dokploy internally
			if (
				id.includes("dokploy") ||
				name.includes("dokploy") ||
				id === "zeqqat"
			) {
				return false;
			}
			return true;
		})
		.map((template) => ({
			id: template.id,
			name: template.name,
			description: sanitizeTemplateDescription(template.description),
			version: template.version,
			logo: template.logo,
			links: template.links,
			tags: template.tags,
		}));
}

const LOGO_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	svg: "image/svg+xml",
	webp: "image/webp",
	gif: "image/gif",
};

export async function fetchTemplateLogo(
	templateId: string,
	baseUrl = "https://templates.dokploy.com",
): Promise<string | null> {
	try {
		const templates = await fetchTemplatesList(baseUrl);
		const template = templates.find((t) => t.id === templateId);
		if (!template?.logo) return null;

		const response = await fetch(
			`${baseUrl}/blueprints/${templateId}/${template.logo}`,
			{ signal: AbortSignal.timeout(10000) },
		);
		if (!response.ok) return null;

		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.length === 0) return null;

		const contentType = response.headers.get("content-type")?.split(";")[0];
		const extension = template.logo.split(".").pop()?.toLowerCase() ?? "";
		const mimeType = contentType?.startsWith("image/")
			? contentType
			: LOGO_MIME_TYPES[extension];
		if (!mimeType) return null;

		const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
		if (dataUrl.length > 2 * 1024 * 1024) return null;

		return dataUrl;
	} catch {
		return null;
	}
}

/**
 * Fetches a specific template's files
 */
export async function fetchTemplateFiles(
	templateId: string,
	baseUrl = "https://templates.dokploy.com",
): Promise<{ config: CompleteTemplate; dockerCompose: string }> {
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

	const config = parse(templateYml) as CompleteTemplate;

	return { config, dockerCompose };
}

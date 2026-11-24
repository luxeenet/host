import { parse } from "toml";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "../db/schema/platform-settings";
import type { CompleteTemplate } from "./processors";

export type { CompleteTemplate };

export interface CustomTemplate {
	id: string;
	name: string;
	description: string;
	version?: string;
	logo?: string;
	tags?: string[];
	links?: {
		github?: string;
		website?: string;
		docs?: string;
	};
	dockerCompose: string;
	env?: string;
	variables?: Record<string, string>;
	config?: {
		isolated?: boolean;
		domains?: Array<{
			serviceName: string;
			port: number;
			path?: string;
			host?: string;
		}>;
		env?: Record<string, string>;
		mounts?: Array<{
			filePath: string;
			content: string;
		}>;
	};
	createdAt?: string;
}

const CUSTOM_TEMPLATES_KEY = "custom_templates";
const DELETED_TEMPLATE_IDS_KEY = "deleted_template_ids";

export async function getCustomTemplates(): Promise<CustomTemplate[]> {
	try {
		const row = await db.query.platformSettings.findFirst({
			where: eq(platformSettings.key, CUSTOM_TEMPLATES_KEY),
		});
		if (!row?.value) return [];
		return JSON.parse(row.value) as CustomTemplate[];
	} catch {
		return [];
	}
}

export async function getDeletedTemplateIds(): Promise<string[]> {
	try {
		const row = await db.query.platformSettings.findFirst({
			where: eq(platformSettings.key, DELETED_TEMPLATE_IDS_KEY),
		});
		if (!row?.value) return [];
		return JSON.parse(row.value) as string[];
	} catch {
		return [];
	}
}

export async function saveCustomTemplate(template: CustomTemplate): Promise<void> {
	const current = await getCustomTemplates();
	const deleted = await getDeletedTemplateIds();

	// Remove from deleted list if present
	const updatedDeleted = deleted.filter(
		(id) => id.toLowerCase() !== template.id.toLowerCase(),
	);
	await db
		.insert(platformSettings)
		.values({
			key: DELETED_TEMPLATE_IDS_KEY,
			value: JSON.stringify(updatedDeleted),
		})
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: {
				value: JSON.stringify(updatedDeleted),
				updatedAt: new Date(),
			},
		});

	// Upsert into custom templates
	const index = current.findIndex(
		(t) => t.id.toLowerCase() === template.id.toLowerCase(),
	);
	const newTemplate: CustomTemplate = {
		...template,
		version: template.version || "1.0.0",
		tags: template.tags && template.tags.length > 0 ? template.tags : ["Custom"],
		createdAt: template.createdAt || new Date().toISOString(),
	};

	let updatedList: CustomTemplate[];
	if (index >= 0) {
		updatedList = [...current];
		updatedList[index] = newTemplate;
	} else {
		updatedList = [newTemplate, ...current];
	}

	await db
		.insert(platformSettings)
		.values({
			key: CUSTOM_TEMPLATES_KEY,
			value: JSON.stringify(updatedList),
		})
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: {
				value: JSON.stringify(updatedList),
				updatedAt: new Date(),
			},
		});
}

export async function deleteTemplateById(templateId: string): Promise<void> {
	const lowerId = templateId.toLowerCase();
	const current = await getCustomTemplates();
	const deleted = await getDeletedTemplateIds();

	// Remove from custom templates if exists
	const filteredCustom = current.filter((t) => t.id.toLowerCase() !== lowerId);
	await db
		.insert(platformSettings)
		.values({
			key: CUSTOM_TEMPLATES_KEY,
			value: JSON.stringify(filteredCustom),
		})
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: {
				value: JSON.stringify(filteredCustom),
				updatedAt: new Date(),
			},
		});

	// Add to deleted IDs if not already present
	if (!deleted.map((id) => id.toLowerCase()).includes(lowerId)) {
		const updatedDeleted = [...deleted, templateId];
		await db
			.insert(platformSettings)
			.values({
				key: DELETED_TEMPLATE_IDS_KEY,
				value: JSON.stringify(updatedDeleted),
			})
			.onConflictDoUpdate({
				target: platformSettings.key,
				set: {
					value: JSON.stringify(updatedDeleted),
					updatedAt: new Date(),
				},
			});
	}
}

export async function getCustomTemplateById(
	templateId: string,
): Promise<CustomTemplate | null> {
	const custom = await getCustomTemplates();
	return (
		custom.find((t) => t.id.toLowerCase() === templateId.toLowerCase()) || null
	);
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
	isCustom?: boolean;
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
 * Fetches the list of available templates from meta.json, merged with custom admin templates
 * and excluding any templates deleted by admin.
 */
export async function fetchTemplatesList(
	baseUrl = "https://templates.dokploy.com",
): Promise<TemplateMetadata[]> {
	let remoteTemplates: TemplateMetadata[] = [];
	try {
		const response = await fetch(`${baseUrl}/meta.json`, {
			signal: AbortSignal.timeout(10000),
		});
		if (response.ok) {
			remoteTemplates = (await response.json()) as TemplateMetadata[];
		}
	} catch {
		// Remote catalog unreachable or timeout
	}

	const [customTemplates, deletedIds] = await Promise.all([
		getCustomTemplates(),
		getDeletedTemplateIds(),
	]);

	const deletedSet = new Set(deletedIds.map((id) => id.toLowerCase()));

	const filteredRemote = remoteTemplates
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
			if (deletedSet.has(id)) {
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
			tags: template.tags || [],
			isCustom: false,
		}));

	const formattedCustom: TemplateMetadata[] = customTemplates
		.filter((t) => !deletedSet.has(t.id.toLowerCase()))
		.map((t) => ({
			id: t.id,
			name: t.name,
			description: t.description,
			version: t.version || "1.0.0",
			logo: t.logo || "",
			links: {
				github: t.links?.github || "",
				website: t.links?.website,
				docs: t.links?.docs,
			},
			tags: t.tags || ["Custom"],
			isCustom: true,
		}));

	return [...formattedCustom, ...filteredRemote];
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
		const custom = await getCustomTemplateById(templateId);
		if (custom?.logo) {
			return custom.logo;
		}

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
	const custom = await getCustomTemplateById(templateId);
	if (custom) {
		const envRecord: Record<string, string> = { ...custom.config?.env };
		if (custom.env) {
			for (const line of custom.env.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;
				const eqIdx = trimmed.indexOf("=");
				if (eqIdx !== -1) {
					const key = trimmed.slice(0, eqIdx).trim();
					const val = trimmed.slice(eqIdx + 1).trim();
					envRecord[key] = val;
				}
			}
		}

		const config: CompleteTemplate = {
			metadata: {
				id: custom.id,
				name: custom.name,
				description: custom.description,
				tags: custom.tags || [],
				version: custom.version || "1.0.0",
				logo: custom.logo || "",
				links: {
					github: custom.links?.github || "",
					website: custom.links?.website,
					docs: custom.links?.docs,
				},
			},
			variables: custom.variables || {},
			config: {
				isolated: custom.config?.isolated,
				domains: (custom.config?.domains as any) || [],
				env: envRecord,
				mounts: custom.config?.mounts || [],
			},
		};
		return { config, dockerCompose: custom.dockerCompose };
	}

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

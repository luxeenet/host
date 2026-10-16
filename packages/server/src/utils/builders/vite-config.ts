import fs from "node:fs";
import path from "node:path";
import type { ApplicationNested } from ".";
import { getConfiguredPlatformDomain } from "../../services/domain";

export type ApplicationWithDomains = {
	appName?: string | null;
	domains?: Array<{ host?: string | null; enabled?: boolean | null }> | null;
	[key: string]: any;
};

export interface ViteConfigUpdateResult {
	content: string;
	modified: boolean;
	originalHosts?: string[];
	addedHosts: string[];
}

/**
 * Pure function: Safely updates Vite configuration file content to allow specific hostnames
 * in preview.allowedHosts (and server.allowedHosts), preserving all user plugins, options,
 * and existing allowedHosts without introducing syntax errors or duplicates.
 */
export const updateViteConfigContent = (
	content: string,
	allowedHosts: string[],
	mode: "preview" | "server" | "both" = "both",
): ViteConfigUpdateResult => {
	// 1. Sanitize and deduplicate hosts
	const cleanHosts = Array.from(
		new Set(
			allowedHosts
				.map((h) =>
					h
						.replace(/^https?:\/\//, "")
						.split(/[/:]/)[0]!
						.trim()
						.toLowerCase(),
				)
				.filter(
					(h) =>
						h.length > 0 &&
						h !== "localhost" &&
						h !== "127.0.0.1" &&
						h !== "0.0.0.0",
				),
		),
	);

	if (cleanHosts.length === 0) {
		return { content, modified: false, addedHosts: [] };
	}

	// 2. If customer explicitly configured `allowedHosts: true`, preserve customer's intent
	if (/allowedHosts\s*:\s*true\b/.test(content)) {
		return { content, modified: false, addedHosts: [] };
	}

	// 3. Check if allowedHosts array is already present anywhere in the content
	const existingArrayMatch = content.match(/allowedHosts\s*:\s*\[([\s\S]*?)\]/);
	if (existingArrayMatch) {
		const rawArrayContent = existingArrayMatch[1] || "";
		const existingItems: string[] = [];
		const strRegex = /['"`]([^'"`]+)['"`]/g;
		let match: RegExpExecArray | null;
		while ((match = strRegex.exec(rawArrayContent)) !== null) {
			if (match[1]) {
				existingItems.push(match[1].toLowerCase());
			}
		}

		const toAdd = cleanHosts.filter((h) => !existingItems.includes(h));
		if (toAdd.length === 0) {
			return {
				content,
				modified: false,
				originalHosts: existingItems,
				addedHosts: [],
			};
		}

		const formattedToAdd = toAdd.map((h) => JSON.stringify(h)).join(", ");
		const newArrayContent = rawArrayContent.trim()
			? `${rawArrayContent.trimEnd()}, ${formattedToAdd}`
			: formattedToAdd;
		const updated = content.replace(
			existingArrayMatch[0],
			`allowedHosts: [${newArrayContent}]`,
		);
		return {
			content: updated,
			modified: true,
			originalHosts: existingItems,
			addedHosts: toAdd,
		};
	}

	const formattedHosts = cleanHosts.map((h) => JSON.stringify(h)).join(", ");

	// 4. If preview: { ... } block exists but no allowedHosts
	const previewMatch = content.match(/(preview\s*:\s*\{)/i);
	if (previewMatch && (mode === "preview" || mode === "both")) {
		let updated = content.replace(
			/(preview\s*:\s*\{)/i,
			`$1\n    allowedHosts: [${formattedHosts}],`,
		);
		if (mode === "both") {
			const serverMatch = updated.match(/(server\s*:\s*\{)/i);
			if (serverMatch && !/server\s*:\s*\{[\s\S]*?allowedHosts/i.test(updated)) {
				updated = updated.replace(
					/(server\s*:\s*\{)/i,
					`$1\n    allowedHosts: [${formattedHosts}],`,
				);
			}
		}
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// 5. If server: { ... } block exists but preview does not
	const serverMatch = content.match(/(server\s*:\s*\{)/i);
	if (serverMatch) {
		let updated = content.replace(
			/(server\s*:\s*\{)/i,
			`$1\n    allowedHosts: [${formattedHosts}],`,
		);
		if (mode === "both" || mode === "preview") {
			updated = updated.replace(
				/(server\s*:\s*\{[\s\S]*?\n\s*\},?)/i,
				`$1\n  preview: {\n    allowedHosts: [${formattedHosts}],\n  },`,
			);
		}
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// 6. Neither preview nor server block exists -> inject into config object
	const insertBlock = `\n  preview: {\n    allowedHosts: [${formattedHosts}],\n  },\n  server: {\n    allowedHosts: [${formattedHosts}],\n  },`;

	// Pattern A: defineConfig({
	if (/defineConfig\s*\(\s*\{/i.test(content)) {
		const updated = content.replace(
			/(defineConfig\s*\(\s*\{)/i,
			`$1${insertBlock}`,
		);
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// Pattern B: defineConfig(({ ... }) => ({
	if (/defineConfig\s*\(\s*\([^)]*\)\s*=>\s*\(?\s*\{/i.test(content)) {
		const updated = content.replace(
			/(defineConfig\s*\(\s*\([^)]*\)\s*=>\s*\(?\s*\{)/i,
			`$1${insertBlock}`,
		);
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// Pattern C: export default {
	if (/export\s+default\s*\{/i.test(content)) {
		const updated = content.replace(
			/(export\s+default\s*\{)/i,
			`$1${insertBlock}`,
		);
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// Pattern D: module.exports = {
	if (/module\.exports\s*=\s*\{/i.test(content)) {
		const updated = content.replace(
			/(module\.exports\s*=\s*\{)/i,
			`$1${insertBlock}`,
		);
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// Pattern E: return { inside function body
	if (/return\s*\{/i.test(content)) {
		const updated = content.replace(/(return\s*\{)/i, `$1${insertBlock}`);
		return { content: updated, modified: true, addedHosts: cleanHosts };
	}

	// Fallback append
	const fallbackAppend = `\n// Injected by HatDot Universal Deployment Engine\nexport const preview = { allowedHosts: [${formattedHosts}] };\n`;
	return {
		content: content + fallbackAppend,
		modified: true,
		addedHosts: cleanHosts,
	};
};

/**
 * Inspects an application directory and injects allowed hosts into the Vite configuration
 * without destroying or overwriting user settings. Backs up original config file.
 */
export const configureViteAllowedHosts = (
	directory: string,
	allowedHosts: string[],
	mode: "preview" | "server" | "both" = "both",
): {
	success: boolean;
	file?: string;
	created?: boolean;
	modified?: boolean;
	addedHosts: string[];
} => {
	if (!fs.existsSync(directory)) {
		return { success: false, addedHosts: [] };
	}

	const candidates = [
		"vite.config.ts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cjs",
		"vite.config.mts",
		"vite.config.cts",
	];

	for (const candidate of candidates) {
		const fullPath = path.join(directory, candidate);
		if (fs.existsSync(fullPath)) {
			try {
				const content = fs.readFileSync(fullPath, "utf8");
				const result = updateViteConfigContent(content, allowedHosts, mode);
				if (result.modified) {
					// Create isolated backup of original file if not already present
					const backupPath = `${fullPath}.hatdot-backup`;
					if (!fs.existsSync(backupPath)) {
						fs.writeFileSync(backupPath, content, "utf8");
					}
					fs.writeFileSync(fullPath, result.content, "utf8");
					return {
						success: true,
						file: candidate,
						modified: true,
						addedHosts: result.addedHosts,
					};
				}
				return {
					success: true,
					file: candidate,
					modified: false,
					addedHosts: result.addedHosts,
				};
			} catch (err) {
				console.error(`Failed to update ${candidate}:`, err);
			}
		}
	}

	// No vite.config.* found, but directory might be a Vite project
	const pkgPath = path.join(directory, "package.json");
	let isViteProject = false;
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
			const allDeps = {
				...(pkg.dependencies || {}),
				...(pkg.devDependencies || {}),
			};
			isViteProject = Boolean(allDeps.vite);
		} catch {}
	}

	if (isViteProject) {
		const formattedHosts = allowedHosts
			.map((h) =>
				h
					.replace(/^https?:\/\//, "")
					.split(/[/:]/)[0]!
					.trim()
					.toLowerCase(),
			)
			.filter((h) => h.length > 0 && h !== "localhost" && h !== "127.0.0.1")
			.map((h) => JSON.stringify(h))
			.join(", ");

		const newConfigFile = path.join(directory, "vite.config.mjs");
		const content = `import { defineConfig } from "vite";

// Auto-generated by HatDot Universal Deployment Engine
export default defineConfig({
  preview: {
    allowedHosts: [${formattedHosts}],
  },
  server: {
    allowedHosts: [${formattedHosts}],
  },
});
`;
		fs.writeFileSync(newConfigFile, content, "utf8");
		return {
			success: true,
			file: "vite.config.mjs",
			created: true,
			modified: true,
			addedHosts: allowedHosts,
		};
	}

	return { success: false, addedHosts: [] };
};

/**
 * Returns the authoritative list of allowed hostnames for an application.
 * Multi-tenant safe: only extracts hostnames assigned or authorized for this specific application.
 */
export const getAuthorizedHostsSync = (
	application: ApplicationNested | ApplicationWithDomains,
	platformDomain?: string | null,
): string[] => {
	const hosts = new Set<string>();

	if (application.appName) {
		const domainBase =
			platformDomain ||
			process.env.PLATFORM_DOMAIN ||
			process.env.BRAND_PLATFORM_SUBDOMAIN_BASE ||
			"hatdot.cloud";
		hosts.add(`${application.appName}.${domainBase}`);
	}

	if (
		"domains" in application &&
		Array.isArray(application.domains) &&
		application.domains.length > 0
	) {
		for (const d of application.domains) {
			if (d?.host && d.enabled !== false) {
				const clean = d.host
					.replace(/^https?:\/\//, "")
					.split(/[/:]/)[0]!
					.trim()
					.toLowerCase();
				if (clean) {
					hosts.add(clean);
				}
			}
		}
	}

	return Array.from(hosts);
};

export const getAuthorizedHostsForApplication = async (
	application: ApplicationNested | ApplicationWithDomains,
): Promise<string[]> => {
	const platformDomain = await getConfiguredPlatformDomain();
	return getAuthorizedHostsSync(application, platformDomain);
};

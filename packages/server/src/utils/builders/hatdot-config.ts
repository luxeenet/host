import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { z } from "zod";

/**
 * HatDot Declarative Project Configuration Schema (Version 1)
 *
 * Developers can define a `hatdot.yaml` or `hatdot.yml` file in their repository
 * to specify build commands, runtime versions, system dependencies, start commands,
 * monorepo root paths, and health checks with version-controlled precision.
 */

export const HatDotBuilderEnum = z.enum([
	"railpack",
	"nixpacks",
	"dockerfile",
	"static",
	"paketo_buildpacks",
	"heroku_buildpacks",
]);
export type HatDotBuilder = z.infer<typeof HatDotBuilderEnum>;

export const HatDotPackageManagerEnum = z.enum([
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"pip",
	"poetry",
	"pipenv",
	"uv",
	"composer",
	"bundler",
	"cargo",
	"maven",
	"gradle",
	"nuget",
	"mix",
]);
export type HatDotPackageManager = z.infer<typeof HatDotPackageManagerEnum>;

export const HatDotProjectSchema = z.object({
	name: z.string().min(1).optional(),
	type: z.string().optional(),
	root: z.string().min(1).default("."),
});

export const HatDotBuildSchema = z.object({
	builder: HatDotBuilderEnum.optional(),
	language: z.string().min(1).optional(),
	runtime: z.string().min(1).optional(),
	runtimeVersion: z.string().optional(),
	packageManager: HatDotPackageManagerEnum.optional(),
	installCommand: z.string().optional(),
	buildCommand: z.string().optional(),
	publishDirectory: z.string().optional(),
	outputDirectory: z.string().optional(),
	dockerfilePath: z.string().optional(),
	systemPackages: z.array(z.string()).default([]),
	cleanCache: z.boolean().default(false),
	env: z.record(z.string(), z.string()).optional(),
});

export const HatDotRunSchema = z.object({
	command: z.string().optional(),
	startCommand: z.string().optional(),
	port: z.number().int().min(1).max(65535).optional(),
	healthcheckPath: z.string().optional(),
	bindHost: z.string().default("0.0.0.0"),
	env: z.record(z.string(), z.string()).optional(),
});

export const HatDotDeploySchema = z.object({
	replicas: z.number().int().min(1).default(1),
	healthcheck: z
		.object({
			enabled: z.boolean().default(true),
			path: z.string().default("/"),
			status: z.number().int().optional(),
			timeout: z.number().int().min(1).max(600).default(60),
			timeoutSeconds: z.number().int().min(1).max(600).optional(),
			intervalSeconds: z.number().int().optional(),
			retries: z.number().int().optional(),
			expectedStatuses: z.array(z.number().int()).default([200, 201, 204, 301, 302, 307, 308, 401, 403, 404]),
		})
		.optional(),
	restartPolicy: z.enum(["always", "on-failure", "unless-stopped", "none", "any"]).default("on-failure"),
	rollbackOnFailure: z.boolean().default(true),
});

export const HatDotConfigSchema = z.object({
	version: z.union([z.literal(1), z.literal("1")]),
	project: HatDotProjectSchema.default({ root: "." }),
	build: HatDotBuildSchema.default({ systemPackages: [], cleanCache: false }),
	run: HatDotRunSchema.default({ bindHost: "0.0.0.0" }),
	deploy: HatDotDeploySchema.default({ replicas: 1, restartPolicy: "on-failure", rollbackOnFailure: true }),
});

export type HatDotConfig = z.infer<typeof HatDotConfigSchema>;

export interface HatDotConfigResult {
	found: boolean;
	filePath?: string;
	config?: HatDotConfig;
	rawContent?: string;
	errors?: string[];
	warnings?: string[];
}

/**
 * Safely substitutes environment variables in the format `${VAR}` or `${VAR:-default}`.
 * Does not expose raw secret values if undefined.
 */
export const interpolateEnvVars = (
	text: string,
	envMap: Record<string, string> = {},
): string => {
	return text.replace(/\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_, key, defaultValue) => {
		if (Object.prototype.hasOwnProperty.call(envMap, key) && envMap[key] !== undefined) {
			return envMap[key];
		}
		if (defaultValue !== undefined) {
			return defaultValue;
		}
		// Return original if no match and no default
		return `\${${key}}`;
	});
};

/**
 * Parses and validates a hatdot.yaml string, applying optional environment variable interpolation.
 */
export const parseHatDotConfig = (
	rawContent: string,
	envMap: Record<string, string> = {},
): HatDotConfig | null => {
	try {
		const interpolated = interpolateEnvVars(rawContent, envMap);
		const parsedYaml = yaml.parse(interpolated);
		if (!parsedYaml || typeof parsedYaml !== "object") return null;
		const parsed = HatDotConfigSchema.safeParse(parsedYaml);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

/**
 * Validates raw hatdot.yaml content and returns structured validation errors if any.
 */
export const validateHatDotConfig = (
	rawContent: string,
): { valid: boolean; errors?: string[]; config?: HatDotConfig } => {
	try {
		const parsedYaml = yaml.parse(rawContent);
		if (!parsedYaml || typeof parsedYaml !== "object") {
			return { valid: false, errors: ["Content is not a valid YAML object"] };
		}
		const parsed = HatDotConfigSchema.safeParse(parsedYaml);
		if (!parsed.success) {
			const errors = parsed.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			);
			return { valid: false, errors };
		}
		return { valid: true, config: parsed.data };
	} catch (err) {
		return {
			valid: false,
			errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`],
		};
	}
};

/**
 * Recursively interpolates ${VAR:-default} strings inside an arbitrary config object or string.
 */
export const interpolateConfigValues = <T = any>(
	obj: T,
	envMap: Record<string, string> = {},
): T => {
	if (typeof obj === "string") {
		return interpolateEnvVars(obj, envMap) as unknown as T;
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => interpolateConfigValues(item, envMap)) as unknown as T;
	}
	if (obj && typeof obj === "object") {
		const result: Record<string, any> = {};
		for (const [k, v] of Object.entries(obj)) {
			result[k] = interpolateConfigValues(v, envMap);
		}
		return result as T;
	}
	return obj;
};

/**
 * Discovers a hatdot.yaml / hatdot.yml filename from a list of project file entries.
 */
export const findHatDotConfigFile = (
	files: { path?: string; name?: string }[],
): string | null => {
	for (const candidate of CONFIG_FILENAMES) {
		const match = files.find(
			(f) =>
				f.name === candidate ||
				f.path === candidate ||
				f.path?.endsWith(`/${candidate}`) ||
				f.path?.endsWith(`\\${candidate}`),
		);
		if (match) {
			return match.name || candidate;
		}
	}
	return null;
};

const CONFIG_FILENAMES = [
	"hatdot.yaml",
	"hatdot.yml",
	".hatdot.yaml",
	".hatdot.yml",
];

/**
 * Discovers and validates `hatdot.yaml` in a target directory.
 */
export const loadHatDotConfig = (
	projectDirectory: string,
	envMap: Record<string, string> = {},
): HatDotConfigResult => {
	if (!fs.existsSync(projectDirectory)) {
		return { found: false, warnings: [`Directory does not exist: ${projectDirectory}`] };
	}

	let targetFile: string | null = null;
	for (const filename of CONFIG_FILENAMES) {
		const fullPath = path.join(projectDirectory, filename);
		if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
			targetFile = fullPath;
			break;
		}
	}

	if (!targetFile) {
		return { found: false };
	}

	try {
		const rawContent = fs.readFileSync(targetFile, "utf-8");
		const interpolated = interpolateEnvVars(rawContent, envMap);
		const parsedYaml = yaml.parse(interpolated);

		if (!parsedYaml || typeof parsedYaml !== "object") {
			return {
				found: true,
				filePath: targetFile,
				rawContent,
				errors: [`The ${path.basename(targetFile)} file is empty or does not contain a valid YAML object.`],
			};
		}

		const parsed = HatDotConfigSchema.safeParse(parsedYaml);
		if (!parsed.success) {
			const errors = parsed.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`,
			);
			return {
				found: true,
				filePath: targetFile,
				rawContent,
				errors,
			};
		}

		const warnings: string[] = [];
		const config = parsed.data;

		// Warn on potentially conflicting or empty properties
		if (config.build.builder === "static" && config.build.publishDirectory === undefined) {
			warnings.push("Static builder selected without an explicit publishDirectory; default output directory will be inferred.");
		}

		if (config.build.builder === "dockerfile" && config.build.dockerfilePath) {
			const dfPath = path.isAbsolute(config.build.dockerfilePath)
				? config.build.dockerfilePath
				: path.join(projectDirectory, config.build.dockerfilePath);
			if (!fs.existsSync(dfPath)) {
				warnings.push(`Specified dockerfilePath does not exist: ${config.build.dockerfilePath}`);
			}
		}

		return {
			found: true,
			filePath: targetFile,
			config,
			rawContent,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	} catch (err) {
		return {
			found: true,
			filePath: targetFile,
			errors: [
				`Failed to parse ${path.basename(targetFile)}: ${err instanceof Error ? err.message : String(err)}`,
			],
		};
	}
};

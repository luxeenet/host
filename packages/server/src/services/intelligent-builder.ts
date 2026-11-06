import fs from "node:fs";
import path from "node:path";
import {
	detectFrameworkFromDirectorySync,
	detectFrameworkFromFiles,
	resolveProjectRoot,
	type DetectionResult,
	type FileEntry,
	type MonorepoComponent,
} from "./app-detector";
import {
	loadHatDotConfig,
	parseHatDotConfig,
	type HatDotBuilder,
	type HatDotConfig,
	type HatDotPackageManager,
} from "../utils/builders/hatdot-config";
import {
	extractPortFromCommand,
	type SupportedPackageManager,
} from "../utils/builders/runtime-resolver";

export interface StructuredInspectionResult {
	detectedFramework: string;
	framework?: string;
	detectedLanguage: string;
	language?: string;
	runtime?: string;
	detectedRuntimeVersion: string;
	runtimeVersion?: string;
	detectedPackageManager: SupportedPackageManager | string;
	packageManager?: SupportedPackageManager | string;
	selectedBuilder: HatDotBuilder | "compose";
	builderReason: string;
	builderSelectionReason?: string;
	buildCommand?: string;
	startCommand?: string;
	installCommand?: string;
	detectedCommands?: {
		buildCommand?: string;
		startCommand?: string;
		installCommand?: string;
	};
	outputDirectory?: string;
	expectedPort: number;
	detectedPort?: number;
	detectedSystemDependencies: string[];
	systemDependencies?: string[];
	confidence: "high" | "medium" | "low";
	warnings: string[];
	unresolvedAssumptions: string[];
	assumptions?: string[];
	hatdotConfig?: HatDotConfig;
	projectRoot: string;
	resolvedProjectRoot?: string;
	isLiveReady: boolean;
	canDeploy?: boolean;
	isMonorepo: boolean;
	monorepoComponents?: MonorepoComponent[];
	migrationCommand?: string;
	collectStaticCommand?: string;
	wsgiEntryPoint?: string;
	djangoSettingsModule?: string;
}

export interface InspectProjectOptions {
	baseDirectory?: string;
	explicitRoot?: string;
	projectRoot?: string;
	envMap?: Record<string, string>;
	files?: FileEntry[];
}

/**
 * System package inference based on framework, dependencies and manifest contents.
 */
export const inferSystemDependencies = (
	framework: string,
	files: FileEntry[] = [],
): string[] => {
	const deps = new Set<string>();
	const combined = files.map((f) => f.content || "").join("\n").toLowerCase();

	// Database drivers
	if (
		combined.includes("psycopg") ||
		combined.includes("pg_trgm") ||
		combined.includes("postgresql") ||
		combined.includes("pdo_pgsql")
	) {
		deps.add("libpq-dev");
		deps.add("postgresql-client");
	}

	if (
		combined.includes("mysqlclient") ||
		combined.includes("pymysql") ||
		combined.includes("pdo_mysql")
	) {
		deps.add("default-libmysqlclient-dev");
	}

	if (combined.includes("sqlite3")) {
		deps.add("sqlite3");
		deps.add("libsqlite3-dev");
	}

	// Media & Imaging
	if (
		combined.includes("pillow") ||
		combined.includes("sharp") ||
		combined.includes("image-magick") ||
		combined.includes("imagemagick")
	) {
		deps.add("libjpeg-dev");
		deps.add("zlib1g-dev");
		deps.add("libpng-dev");
		deps.add("libvips-dev");
	}

	if (combined.includes("ffmpeg") || combined.includes("fluent-ffmpeg") || combined.includes("moviepy")) {
		deps.add("ffmpeg");
	}

	// Browser automation
	if (
		combined.includes("playwright") ||
		combined.includes("puppeteer") ||
		combined.includes("selenium")
	) {
		deps.add("chromium");
		deps.add("libnss3");
		deps.add("libatk-bridge2.0-0");
		deps.add("libdrm2");
		deps.add("libxkbcommon0");
		deps.add("libxcomposite1");
	}

	// Cryptography & Compilation
	if (
		combined.includes("cryptography") ||
		combined.includes("bcrypt") ||
		combined.includes("cffi")
	) {
		deps.add("libffi-dev");
		deps.add("libssl-dev");
		deps.add("build-essential");
	}

	return Array.from(deps);
};

/**
 * Centralized Intelligent Multi-Builder Selection Engine for HatDot.
 * Inspects project source files, honors declarative `hatdot.yaml`, detects frameworks,
 * package managers, and runtimes without contradiction, and provides a clear audit explanation.
 */
export const inspectAndSelectBuilder = async (
	options: InspectProjectOptions,
): Promise<StructuredInspectionResult> => {
	const baseDirectory = options.baseDirectory || ".";
	const explicitRoot = options.explicitRoot || options.projectRoot;
	const envMap = options.envMap || {};
	const warnings: string[] = [];
	const assumptions: string[] = [];

	// 1. Resolve project root (monorepo awareness)
	const rootResolution = resolveProjectRoot(baseDirectory, explicitRoot);
	const targetRoot = explicitRoot || rootResolution.resolvedRoot || ".";
	const effectiveDir = path.isAbsolute(targetRoot)
		? targetRoot
		: path.join(baseDirectory, targetRoot);

	if (rootResolution.isAmbiguous && rootResolution.ambiguityWarning) {
		warnings.push(rootResolution.ambiguityWarning);
		assumptions.push("Project contains multiple candidate applications. Using highest-ranked service directory.");
	}

	// 2. Discover declarative `hatdot.yaml` configuration
	let hatdotConfig = undefined;
	if (options.files && options.files.length > 0) {
		const hatdotFile = options.files.find(
			(f) =>
				f.name === "hatdot.yaml" ||
				f.name === "hatdot.yml" ||
				f.path === "hatdot.yaml" ||
				f.path === "hatdot.yml" ||
				f.path?.endsWith("/hatdot.yaml") ||
				f.path?.endsWith("/hatdot.yml") ||
				f.path?.endsWith("\\hatdot.yaml") ||
				f.path?.endsWith("\\hatdot.yml"),
		);
		if (hatdotFile?.content) {
			hatdotConfig = parseHatDotConfig(hatdotFile.content, envMap) || undefined;
		}
	}

	if (!hatdotConfig && fs.existsSync(effectiveDir)) {
		const hatdotResult = loadHatDotConfig(effectiveDir, envMap);
		hatdotConfig = hatdotResult.config;
		if (hatdotResult.errors && hatdotResult.errors.length > 0) {
			warnings.push(...hatdotResult.errors);
		}
		if (hatdotResult.warnings && hatdotResult.warnings.length > 0) {
			warnings.push(...hatdotResult.warnings);
		}
	}

	// 3. File discovery and automatic framework detection
	let rawDetection: DetectionResult;
	if (options.files && options.files.length > 0) {
		rawDetection = detectFrameworkFromFiles(options.files);
	} else if (fs.existsSync(effectiveDir)) {
		rawDetection = detectFrameworkFromDirectorySync(effectiveDir);
	} else {
		rawDetection = {
			framework: "Generic Application",
			language: "Unknown",
			buildType: "nixpacks",
			suggestedPort: 3000,
			confidence: "low",
			reason: "Project directory not yet initialized on host.",
		};
	}

	// 4. Synthesize intelligent builder selection with user overrides
	let selectedBuilder: HatDotBuilder | "compose" = rawDetection.buildType as HatDotBuilder;
	let builderReason = rawDetection.reason;

	if (hatdotConfig?.build?.builder) {
		selectedBuilder = hatdotConfig.build.builder;
		builderReason = `Builder explicitly declared in hatdot.yaml (${selectedBuilder})`;
	} else if (selectedBuilder === "dockerfile" && rawDetection.dockerfilePath) {
		builderReason = `Detected project Dockerfile (${rawDetection.dockerfilePath})`;
	} else if (rawDetection.isStaticSpa || rawDetection.buildType === "static" || rawDetection.framework === "static") {
		selectedBuilder = "static";
		builderReason = `Static / SPA artifact detected (${rawDetection.framework})`;
	} else if (rawDetection.framework?.toLowerCase() === "nextjs" || rawDetection.framework?.toLowerCase() === "next.js") {
		selectedBuilder = "railpack";
		builderReason = "Selected Railpack for optimized Next.js caching and standalone output.";
	} else if (rawDetection.framework === "Django" || rawDetection.framework === "FastAPI" || rawDetection.framework === "Laravel") {
		// Modern web frameworks: Nixpacks offers native multi-runtime isolation with pinned Nix packages
		selectedBuilder = "nixpacks";
		builderReason = `Selected Nixpacks for optimized ${rawDetection.framework} runtime isolation and system dependency resolution.`;
	}

	// 5. Port reconciliation
	let expectedPort = hatdotConfig?.run?.port || rawDetection.suggestedPort || 3000;
	if (hatdotConfig?.run?.command) {
		const extracted = extractPortFromCommand(hatdotConfig.run.command);
		if (extracted) {
			expectedPort = extracted;
		}
	} else if (rawDetection.startCommand) {
		const extracted = extractPortFromCommand(rawDetection.startCommand);
		if (extracted) {
			expectedPort = extracted;
		}
	}

	// 6. Commands and runtime resolution
	const buildCommand = hatdotConfig?.build?.buildCommand || rawDetection.buildCommand;
	const startCommand = hatdotConfig?.run?.command || rawDetection.startCommand;
	const installCommand = hatdotConfig?.build?.installCommand || rawDetection.installCommand;
	const outputDirectory = hatdotConfig?.build?.publishDirectory || rawDetection.publishDirectory;
	const detectedLanguage = hatdotConfig?.build?.language || rawDetection.language || "Unknown";
	const detectedFramework = hatdotConfig?.project?.name || rawDetection.framework;
	const detectedRuntimeVersion = hatdotConfig?.build?.runtime || rawDetection.runtimeVersion || "LTS";
	const detectedPackageManager = hatdotConfig?.build?.packageManager || rawDetection.packageManager || "npm";

	// 7. System dependencies
	const inferredDeps = inferSystemDependencies(detectedFramework, options.files);
	const customPackages = hatdotConfig?.build?.systemPackages || [];
	const detectedSystemDependencies = Array.from(new Set([...customPackages, ...inferredDeps]));

	// 8. Confidence and readiness assessment
	let confidence: "high" | "medium" | "low" = rawDetection.confidence;
	if (hatdotConfig) {
		confidence = "high";
	} else if (!startCommand && selectedBuilder !== "static" && selectedBuilder !== "dockerfile") {
		confidence = "low";
		assumptions.push("No explicit start command detected. The application may fail to start unless a start script is defined.");
	}

	const isLiveReady =
		confidence !== "low" &&
		(selectedBuilder === "static" || Boolean(startCommand) || selectedBuilder === "dockerfile" || (selectedBuilder as string) === "compose");

	const hasMonorepoManifest = Boolean(
		options.files?.some(
			(f) =>
				f.name === "pnpm-workspace.yaml" ||
				f.name === "turbo.json" ||
				f.name === "nx.json" ||
				f.path?.includes("pnpm-workspace.yaml") ||
				f.path?.includes("turbo.json"),
		),
	);
	const isMonorepo =
		hasMonorepoManifest ||
		Boolean(rootResolution.secondaryComponents && rootResolution.secondaryComponents.length > 0);

	return {
		detectedFramework,
		framework: rawDetection.framework?.toLowerCase() || detectedFramework.toLowerCase(),
		detectedLanguage,
		language: detectedLanguage.toLowerCase(),
		runtime: rawDetection.runtime || detectedLanguage.toLowerCase(),
		detectedRuntimeVersion,
		runtimeVersion: detectedRuntimeVersion,
		detectedPackageManager,
		packageManager: detectedPackageManager,
		selectedBuilder,
		builderReason,
		builderSelectionReason: builderReason,
		buildCommand,
		startCommand,
		installCommand,
		detectedCommands: {
			buildCommand,
			startCommand,
			installCommand,
		},
		outputDirectory,
		expectedPort,
		detectedPort: expectedPort,
		detectedSystemDependencies,
		systemDependencies: detectedSystemDependencies,
		confidence,
		warnings,
		unresolvedAssumptions: assumptions,
		assumptions,
		hatdotConfig: hatdotConfig || undefined,
		projectRoot: explicitRoot || targetRoot,
		resolvedProjectRoot: explicitRoot || targetRoot,
		isLiveReady,
		canDeploy: isLiveReady,
		isMonorepo,
		monorepoComponents: rootResolution.secondaryComponents,
		migrationCommand: rawDetection.migrationCommand,
		collectStaticCommand: rawDetection.collectStaticCommand,
		wsgiEntryPoint: rawDetection.wsgiEntryPoint,
		djangoSettingsModule: rawDetection.djangoSettingsModule,
	};
};

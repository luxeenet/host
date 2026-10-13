import fs from "node:fs";
import path from "node:path";
import {
	DOTNET_CATALOG,
	GO_CATALOG,
	isLegacyRuntimePermitted,
	JAVA_CATALOG,
	NODE_CATALOG,
	PHP_CATALOG,
	PYTHON_CATALOG,
	RUBY_CATALOG,
} from "./runtime-catalog";

export { NIXPKGS_ARCHIVES, type RuntimeVersionInfo } from "./runtime-catalog";

export interface NodeRuntimeResolution {
	requestedVersion?: string;
	isEol: boolean;
	eolReason?: string;
	resolvedVersion: string;
	nixPackage: string;
	nixpkgsArchive?: string;
	archiveLabel?: string;
	warning?: string;
	isPermitted: boolean;
	policyError?: string;
	isAvailable: boolean;
	unavailabilityReason?: string;
}

export type SupportedPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageManagerResolution {
	packageManager: SupportedPackageManager;
	lockfile?: string;
	installCommand: string;
	buildCommand?: string;
	startCommand?: string;
	hasConflictingLockfiles: boolean;
	conflicts?: string[];
}

export interface FileItem {
	name: string;
	path: string;
	content?: string;
}

/**
 * Extract requested Node.js major version number from raw version string.
 */
export const parseNodeVersion = (rawVersion: string): number | null => {
	const cleaned = rawVersion.trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+)/);
	if (match?.[1]) {
		return Number.parseInt(match[1], 10);
	}
	return null;
};

/**
 * Resolve Node.js runtime version.
 * - Supports legacy Node.js 18 via pinned Nixpkgs archive without silent substitution.
 * - Supports legacy Node.js 16 via NixOS 23.11 archive.
 * - Preserves modern Node.js 20, 22, and 24 with standard channels.
 * - Respects configuration precedence: Explicit Setting > .nvmrc > .node-version > runtime.txt > package.json engines > default (22).
 */
export const resolveNodeRuntime = (params: {
	explicitVersion?: string;
	packageJsonContent?: string;
	nvmrcContent?: string;
	nodeVersionContent?: string;
	runtimeTxtContent?: string;
}): NodeRuntimeResolution => {
	let rawVersion: string | undefined;

	// 1. Explicit Setting (highest precedence)
	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}

	// 2. Project config file: .nvmrc
	if (!rawVersion && params.nvmrcContent?.trim()) {
		rawVersion = params.nvmrcContent.trim();
	}

	// 3. Project config file: .node-version
	if (!rawVersion && params.nodeVersionContent?.trim()) {
		rawVersion = params.nodeVersionContent.trim();
	}

	// 4. runtime.txt (e.g. nodejs-18.x or node-20)
	if (!rawVersion && params.runtimeTxtContent?.trim()) {
		const cleaned = params.runtimeTxtContent
			.trim()
			.replace(/^node(js)?[-_]?/i, "");
		if (cleaned) {
			rawVersion = cleaned;
		}
	}

	// 5. package.json engines.node
	if (!rawVersion && params.packageJsonContent) {
		try {
			const parsed = JSON.parse(params.packageJsonContent);
			if (parsed.engines?.node) {
				rawVersion = String(parsed.engines.node);
			}
		} catch {}
	}

	if (rawVersion) {
		const major = parseNodeVersion(rawVersion);
		if (major !== null) {
			const majorStr = String(major);
			const entry = NODE_CATALOG[majorStr];

			if (entry) {
				const permitted = !entry.isAvailable
					? false
					: entry.isEol
						? isLegacyRuntimePermitted()
						: true;
				const policyError = !entry.isAvailable
					? entry.unavailabilityReason
					: entry.isEol && !permitted
						? `❌ Deployment Rejected by Policy: Node.js ${majorStr} reached End-Of-Life on ${entry.eolDate} and organizational policy forbids unmaintained runtimes. To deploy, update your project to Node.js 20 or 22, or enable legacy runtime support in platform settings.`
						: undefined;

				let warning: string | undefined;
				if (entry.isEol && permitted) {
					warning = `⚠️ Notice: Node.js ${majorStr} reached End-Of-Life upstream on ${entry.eolDate}. Using pinned package source (${entry.archiveLabel}) to provide verified Node.js ${majorStr} runtime for backward compatibility.`;
				}

				return {
					requestedVersion: rawVersion,
					isEol: entry.isEol,
					eolReason: entry.eolReason,
					resolvedVersion: majorStr,
					nixPackage: entry.nixPackage,
					nixpkgsArchive: entry.archiveCommit,
					archiveLabel: entry.archiveLabel,
					warning,
					isPermitted: permitted,
					policyError,
					isAvailable: entry.isAvailable,
					unavailabilityReason: entry.unavailabilityReason,
				};
			}

			// Handled versions outside explicit catalog
			if (major < 16) {
				return {
					requestedVersion: rawVersion,
					isEol: true,
					eolReason: `Node.js ${major} is obsolete and reached End-Of-Life.`,
					resolvedVersion: majorStr,
					nixPackage: `nodejs_${major}`,
					isPermitted: false,
					policyError: `Node.js ${major} reached End-Of-Life and is no longer available in package archives. Please upgrade to a supported Node version or deploy using a custom Dockerfile.`,
					isAvailable: false,
					unavailabilityReason: `Node.js ${major} cannot be safely obtained from verified package sources.`,
				};
			}

			// Unknown modern version
			return {
				requestedVersion: rawVersion,
				isEol: false,
				resolvedVersion: majorStr,
				nixPackage: `nodejs_${major}`,
				isPermitted: true,
				isAvailable: true,
			};
		}
	}

	// Default fallback: Active LTS (Node 22)
	return {
		isEol: false,
		resolvedVersion: "22",
		nixPackage: "nodejs_22",
		isPermitted: true,
		isAvailable: true,
	};
};

/**
 * Resolve Python runtime version.
 */
export const resolvePythonRuntime = (params: {
	explicitVersion?: string;
	pythonVersionContent?: string;
	runtimeTxtContent?: string;
	pyprojectContent?: string;
	pipfileContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.pythonVersionContent?.trim()) {
		rawVersion = params.pythonVersionContent.trim();
	}
	if (!rawVersion && params.runtimeTxtContent?.trim()) {
		const cleaned = params.runtimeTxtContent
			.trim()
			.replace(/^python[-_]?/i, "");
		if (cleaned) rawVersion = cleaned;
	}
	if (!rawVersion && params.pipfileContent) {
		const match = params.pipfileContent.match(
			/python_version\s*=\s*["']([^"']+)["']/,
		);
		if (match?.[1]) rawVersion = match[1];
	}
	if (!rawVersion && params.pyprojectContent) {
		const match = params.pyprojectContent.match(
			/(?:requires-python|python)\s*=\s*["']([^"']+)["']/,
		);
		if (match?.[1]) rawVersion = match[1];
	}

	const cleaned = (rawVersion || "3.11").trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+\.\d+)/);
	const majorMinor = match?.[1] || "3.11";
	const entry = PYTHON_CATALOG[majorMinor] || {
		major: majorMinor,
		isEol: false,
		nixPackage: `python${majorMinor.replace(".", "")}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: Python ${majorMinor} reached End-Of-Life. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: majorMinor,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve PHP runtime version.
 */
export const resolvePhpRuntime = (params: {
	explicitVersion?: string;
	phpVersionContent?: string;
	composerJsonContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.phpVersionContent?.trim()) {
		rawVersion = params.phpVersionContent.trim();
	}
	if (!rawVersion && params.composerJsonContent) {
		try {
			const parsed = JSON.parse(params.composerJsonContent);
			if (parsed.require?.php) {
				rawVersion = String(parsed.require.php);
			}
		} catch {}
	}

	const cleaned = (rawVersion || "8.2").trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+\.\d+)/);
	const majorMinor = match?.[1] || "8.2";
	const entry = PHP_CATALOG[majorMinor] || {
		major: majorMinor,
		isEol: false,
		nixPackage: `php${majorMinor.replace(".", "")}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: PHP ${majorMinor} reached End-Of-Life. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: majorMinor,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve Ruby runtime version.
 */
export const resolveRubyRuntime = (params: {
	explicitVersion?: string;
	rubyVersionContent?: string;
	gemfileContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.rubyVersionContent?.trim()) {
		rawVersion = params.rubyVersionContent.trim();
	}
	if (!rawVersion && params.gemfileContent) {
		const match = params.gemfileContent.match(/ruby\s+["']([^"']+)["']/);
		if (match?.[1]) rawVersion = match[1];
	}

	const cleaned = (rawVersion || "3.2").trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+\.\d+)/);
	const majorMinor = match?.[1] || "3.2";
	const entry = RUBY_CATALOG[majorMinor] || {
		major: majorMinor,
		isEol: false,
		nixPackage: `ruby_${majorMinor.replace(".", "_")}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: Ruby ${majorMinor} reached End-Of-Life. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: majorMinor,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve Java / OpenJDK runtime version.
 */
export const resolveJavaRuntime = (params: {
	explicitVersion?: string;
	javaVersionContent?: string;
	pomXmlContent?: string;
	gradleContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.javaVersionContent?.trim()) {
		rawVersion = params.javaVersionContent.trim();
	}
	if (!rawVersion && params.pomXmlContent) {
		const match =
			params.pomXmlContent.match(/<java\.version>([^<]+)<\/java\.version>/) ||
			params.pomXmlContent.match(
				/<maven\.compiler\.source>([^<]+)<\/maven\.compiler\.source>/,
			);
		if (match?.[1]) rawVersion = match[1];
	}
	if (!rawVersion && params.gradleContent) {
		const match = params.gradleContent.match(
			/(?:sourceCompatibility|targetCompatibility)\s*=\s*['"]?(\d+)['"]?/,
		);
		if (match?.[1]) rawVersion = match[1];
	}

	const cleaned = (rawVersion || "17")
		.trim()
		.replace(/^[v^~>=<\s]+/, "")
		.replace(/^1\./, "");
	const match = cleaned.match(/^(\d+)/);
	const major = match?.[1] || "17";
	const entry = JAVA_CATALOG[major] || {
		major,
		isEol: false,
		nixPackage: `openjdk${major}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: OpenJDK ${major} is an older release. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: major,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve Go runtime version.
 */
export const resolveGoRuntime = (params: {
	explicitVersion?: string;
	goVersionContent?: string;
	goModContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.goVersionContent?.trim()) {
		rawVersion = params.goVersionContent.trim();
	}
	if (!rawVersion && params.goModContent) {
		const match = params.goModContent.match(/^go\s+([0-9.]+)/m);
		if (match?.[1]) rawVersion = match[1];
	}

	const cleaned = (rawVersion || "1.22").trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+\.\d+)/);
	const majorMinor = match?.[1] || "1.22";
	const entry = GO_CATALOG[majorMinor] || {
		major: majorMinor,
		isEol: false,
		nixPackage: `go_${majorMinor.replace(".", "_")}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: Go ${majorMinor} is End-Of-Life. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: majorMinor,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve .NET SDK runtime version.
 */
export const resolveDotnetRuntime = (params: {
	explicitVersion?: string;
	globalJsonContent?: string;
	csprojContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.globalJsonContent) {
		try {
			const parsed = JSON.parse(params.globalJsonContent);
			if (parsed.sdk?.version) {
				rawVersion = String(parsed.sdk.version);
			}
		} catch {}
	}
	if (!rawVersion && params.csprojContent) {
		const match = params.csprojContent.match(
			/<TargetFramework>net(\d+\.\d+)<\/TargetFramework>/i,
		);
		if (match?.[1]) rawVersion = match[1];
	}

	const cleaned = (rawVersion || "8.0").trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+\.\d+)/);
	const majorMinor = match?.[1] || "8.0";
	const entry = DOTNET_CATALOG[majorMinor] || {
		major: majorMinor,
		isEol: false,
		nixPackage: `dotnet-sdk_${majorMinor.replace(".", "_")}`,
		isAvailable: true,
	};

	const permitted = entry.isEol ? isLegacyRuntimePermitted() : true;
	let warning: string | undefined;
	if (entry.isEol && permitted) {
		warning = `⚠️ Notice: .NET ${majorMinor} reached End-Of-Life. Using pinned package source (${entry.archiveLabel || "legacy"}) for compatibility.`;
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: majorMinor,
		nixPackage: entry.nixPackage,
		nixpkgsArchive: entry.archiveCommit,
		isEol: entry.isEol,
		isPermitted: permitted,
		warning,
		isAvailable: entry.isAvailable,
		unavailabilityReason: entry.unavailabilityReason,
	};
};

/**
 * Resolve Rust runtime version.
 */
export const resolveRustRuntime = (params: {
	explicitVersion?: string;
	rustToolchainContent?: string;
	cargoTomlContent?: string;
}) => {
	let rawVersion: string | undefined;

	if (params.explicitVersion?.trim()) {
		rawVersion = params.explicitVersion.trim();
	}
	if (!rawVersion && params.rustToolchainContent) {
		const match = params.rustToolchainContent.match(
			/channel\s*=\s*["']([^"']+)["']/,
		);
		if (match?.[1]) rawVersion = match[1];
	}
	if (!rawVersion && params.cargoTomlContent) {
		const match = params.cargoTomlContent.match(
			/rust-version\s*=\s*["']([^"']+)["']/,
		);
		if (match?.[1]) rawVersion = match[1];
	}

	return {
		requestedVersion: rawVersion,
		resolvedVersion: rawVersion || "stable",
		nixPackage: "rustc",
		isEol: false,
		isPermitted: true,
		isAvailable: true,
	};
};

/**
 * Resolve package manager and ensure lockfile-command alignment.
 * Prevents dangerous mismatches such as running `npm ci` with `bun run build`.
 */
export const resolvePackageManagerAndCommands = (params: {
	files: FileItem[];
	packageJsonContent?: string;
}): PackageManagerResolution => {
	const fileNames = new Set(
		params.files.map((f) => (f.name || path.basename(f.path)).toLowerCase()),
	);

	let pkgJson: Record<string, any> = {};
	if (params.packageJsonContent) {
		try {
			pkgJson = JSON.parse(params.packageJsonContent);
		} catch {}
	}

	const scripts = pkgJson.scripts || {};
	const hasBuildScript = Boolean(scripts.build);
	const hasStartScript = Boolean(scripts.start);

	// Detect lockfiles present
	const hasPnpmLock = fileNames.has("pnpm-lock.yaml");
	const hasBunLock = fileNames.has("bun.lockb") || fileNames.has("bun.lock");
	const hasYarnLock = fileNames.has("yarn.lock");
	const hasNpmLock = fileNames.has("package-lock.json");

	const presentLockfiles: string[] = [];
	if (hasPnpmLock) presentLockfiles.push("pnpm-lock.yaml");
	if (hasBunLock) presentLockfiles.push("bun.lock / bun.lockb");
	if (hasYarnLock) presentLockfiles.push("yarn.lock");
	if (hasNpmLock) presentLockfiles.push("package-lock.json");

	const hasConflictingLockfiles = presentLockfiles.length > 1;

	// Check explicit packageManager field in package.json (e.g. corepack "pnpm@9.12.0")
	let explicitPm: SupportedPackageManager | undefined;
	if (pkgJson.packageManager && typeof pkgJson.packageManager === "string") {
		const lowerPm = pkgJson.packageManager.toLowerCase();
		if (lowerPm.startsWith("pnpm")) explicitPm = "pnpm";
		else if (lowerPm.startsWith("bun")) explicitPm = "bun";
		else if (lowerPm.startsWith("yarn")) explicitPm = "yarn";
		else if (lowerPm.startsWith("npm")) explicitPm = "npm";
	}

	// Decision precedence:
	// 1. Explicit packageManager field from manifest
	// 2. Lockfiles priority: bun > pnpm > yarn > npm
	let selectedPm: SupportedPackageManager = "npm";
	let selectedLockfile: string | undefined;

	if (explicitPm) {
		selectedPm = explicitPm;
		if (explicitPm === "pnpm" && hasPnpmLock)
			selectedLockfile = "pnpm-lock.yaml";
		else if (explicitPm === "bun" && hasBunLock) selectedLockfile = "bun.lockb";
		else if (explicitPm === "yarn" && hasYarnLock)
			selectedLockfile = "yarn.lock";
		else if (explicitPm === "npm" && hasNpmLock)
			selectedLockfile = "package-lock.json";
	} else if (hasBunLock) {
		selectedPm = "bun";
		selectedLockfile = fileNames.has("bun.lock") ? "bun.lock" : "bun.lockb";
	} else if (hasPnpmLock) {
		selectedPm = "pnpm";
		selectedLockfile = "pnpm-lock.yaml";
	} else if (hasYarnLock) {
		selectedPm = "yarn";
		selectedLockfile = "yarn.lock";
	} else if (hasNpmLock) {
		selectedPm = "npm";
		selectedLockfile = "package-lock.json";
	}

	// Generate frozen / reproducible install command
	let installCommand = "npm install";
	if (selectedPm === "pnpm") {
		installCommand = hasPnpmLock
			? "pnpm install --frozen-lockfile"
			: "pnpm install";
	} else if (selectedPm === "bun") {
		installCommand = hasBunLock
			? "bun install --frozen-lockfile"
			: "bun install";
	} else if (selectedPm === "yarn") {
		installCommand = hasYarnLock
			? "yarn install --frozen-lockfile"
			: "yarn install";
	} else if (selectedPm === "npm") {
		installCommand = hasNpmLock ? "npm ci" : "npm install";
	}

	// Generate build command using ONLY the selected package manager
	let buildCommand: string | undefined;
	if (hasBuildScript) {
		switch (selectedPm) {
			case "pnpm":
				buildCommand = "pnpm run build";
				break;
			case "bun":
				buildCommand = "bun run build";
				break;
			case "yarn":
				buildCommand = "yarn build";
				break;
			default:
				buildCommand = "npm run build";
				break;
		}
	}

	// Generate start command using ONLY the selected package manager
	let startCommand: string | undefined;
	if (hasStartScript) {
		switch (selectedPm) {
			case "pnpm":
				startCommand = "pnpm start";
				break;
			case "bun":
				startCommand = "bun start";
				break;
			case "yarn":
				startCommand = "yarn start";
				break;
			default:
				startCommand = "npm start";
				break;
		}
	} else if (pkgJson.main) {
		startCommand = `node ${pkgJson.main}`;
	}

	return {
		packageManager: selectedPm,
		lockfile: selectedLockfile,
		installCommand,
		buildCommand,
		startCommand,
		hasConflictingLockfiles,
		conflicts: hasConflictingLockfiles ? presentLockfiles : undefined,
	};
};

/**
 * Generate a Nixpacks configuration TOML content to pin the archive and packages
 */
export const generateNixpacksToml = (options: {
	nixpkgsArchive?: string;
	nixPkgs?: string[];
	installCmd?: string;
	buildCmd?: string;
	startCmd?: string;
}): string => {
	const lines: string[] = [];
	lines.push("# Generated by HatDot Universal Deployment Engine");

	if (
		options.nixpkgsArchive ||
		(options.nixPkgs && options.nixPkgs.length > 0)
	) {
		lines.push("[phases.setup]");
		if (options.nixpkgsArchive) {
			lines.push(`nixpkgsArchive = "${options.nixpkgsArchive}"`);
		}
		if (options.nixPkgs && options.nixPkgs.length > 0) {
			lines.push(
				`nixPkgs = [${options.nixPkgs.map((p) => `"${p}"`).join(", ")}]`,
			);
		}
	}

	if (options.installCmd) {
		lines.push("");
		lines.push("[phases.install]");
		lines.push(`cmds = [${JSON.stringify(options.installCmd)}]`);
	}

	if (options.buildCmd) {
		lines.push("");
		lines.push("[phases.build]");
		lines.push(`cmds = [${JSON.stringify(options.buildCmd)}]`);
	}

	if (options.startCmd) {
		lines.push("");
		lines.push("[start]");
		lines.push(`cmd = ${JSON.stringify(options.startCmd)}`);
	}

	return `${lines.join("\n")}\n`;
};

/**
 * Inspect a directory on the local disk to resolve Node runtime and package manager
 */
export const inspectDirectoryRuntime = async (dirPath: string) => {
	try {
		if (!fs.existsSync(dirPath)) {
			return {
				runtime: resolveNodeRuntime({}),
				packageManager: resolvePackageManagerAndCommands({ files: [] }),
			};
		}

		const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
		const files: FileItem[] = [];

		let pkgJsonContent: string | undefined;
		let nvmrcContent: string | undefined;
		let nodeVersionContent: string | undefined;
		let runtimeTxtContent: string | undefined;

		for (const entry of entries) {
			if (entry.isFile()) {
				const lowerName = entry.name.toLowerCase();
				files.push({ name: entry.name, path: path.join(dirPath, entry.name) });

				if (lowerName === "package.json") {
					try {
						pkgJsonContent = await fs.promises.readFile(
							path.join(dirPath, entry.name),
							"utf-8",
						);
					} catch {}
				} else if (lowerName === ".nvmrc") {
					try {
						nvmrcContent = await fs.promises.readFile(
							path.join(dirPath, entry.name),
							"utf-8",
						);
					} catch {}
				} else if (lowerName === ".node-version") {
					try {
						nodeVersionContent = await fs.promises.readFile(
							path.join(dirPath, entry.name),
							"utf-8",
						);
					} catch {}
				} else if (lowerName === "runtime.txt") {
					try {
						runtimeTxtContent = await fs.promises.readFile(
							path.join(dirPath, entry.name),
							"utf-8",
						);
					} catch {}
				}
			}
		}

		const runtime = resolveNodeRuntime({
			packageJsonContent: pkgJsonContent,
			nvmrcContent,
			nodeVersionContent,
			runtimeTxtContent,
		});

		const packageManager = resolvePackageManagerAndCommands({
			files,
			packageJsonContent: pkgJsonContent,
		});

		return { runtime, packageManager };
	} catch {
		return {
			runtime: resolveNodeRuntime({}),
			packageManager: resolvePackageManagerAndCommands({ files: [] }),
		};
	}
};

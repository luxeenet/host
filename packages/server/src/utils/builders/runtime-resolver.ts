import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "toml";
import { z } from "zod";
import {
	DOTNET_CATALOG,
	GO_CATALOG,
	isLegacyRuntimePermitted,
	JAVA_CATALOG,
	NIXPKGS_ARCHIVES,
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

export type SupportedPackageManager =
	| "npm"
	| "pnpm"
	| "yarn"
	| "bun"
	| "pip"
	| "poetry"
	| "pipenv"
	| "uv"
	| "composer"
	| "bundler"
	| "maven"
	| "gradle"
	| "cargo"
	| "go"
	| "dotnet";

export interface PackageManagerResolution {
	packageManager: SupportedPackageManager;
	lockfile?: string;
	installCommand: string;
	buildCommand?: string;
	startCommand?: string;
	startCommandSource?: string;
	isStaticSpa?: boolean;
	suggestedPublishDirectory?: string;
	missingStartCommandDiagnostic?: {
		framework?: string;
		availableScripts: string[];
		hasBuildScript: boolean;
		reason: string;
		remediation: string;
	};
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
	if (!rawVersion || typeof rawVersion !== "string") return null;
	if (rawVersion.includes("||")) {
		const parts = rawVersion.split("||").map((p) => p.trim());
		for (const part of parts) {
			const m = parseNodeVersion(part);
			if (m === 22) return 22;
		}
		for (const part of [...parts].reverse()) {
			const m = parseNodeVersion(part);
			if (m !== null) return m;
		}
	}
	const cleaned = rawVersion.trim().replace(/^[v^~>=<\s]+/, "");
	const match = cleaned.match(/^(\d+)/);
	if (match?.[1]) {
		return Number.parseInt(match[1], 10);
	}
	return null;
};

export interface LockfileAuditResult {
	isCrossPlatformLockfile: boolean;
	hasNativeDependencies: boolean;
	nativePackagesDetected: string[];
	missingLinuxBindings: string[];
	warning?: string;
	safeInstallCommand: string;
}

/**
 * Audit lockfile for cross-platform optional dependency omissions (npm/cli#4828).
 */
export const auditLockfilePlatformCompatibility = (params: {
	packageJsonContent?: string;
	lockfileContent?: string;
	hasNpmLock?: boolean;
}): LockfileAuditResult => {
	const nativePackagesDetected: string[] = [];
	const missingLinuxBindings: string[] = [];
	let isCrossPlatformLockfile = false;

	if (params.packageJsonContent) {
		try {
			const pkg = JSON.parse(params.packageJsonContent);
			const allDeps = {
				...(pkg.dependencies || {}),
				...(pkg.devDependencies || {}),
			};

			if (allDeps.rolldown || (allDeps.vite && /^[\^~]?[89]/.test(allDeps.vite))) {
				nativePackagesDetected.push("rolldown");
			}
			if (allDeps.vite) {
				nativePackagesDetected.push("vite");
			}
			if (allDeps["@rollup/rollup"] || allDeps.rollup) {
				nativePackagesDetected.push("rollup");
			}
			if (allDeps.esbuild) {
				nativePackagesDetected.push("esbuild");
			}
			if (allDeps["@swc/core"]) {
				nativePackagesDetected.push("@swc/core");
			}
			if (allDeps.sharp) {
				nativePackagesDetected.push("sharp");
			}
		} catch {}
	}

	if (params.lockfileContent && nativePackagesDetected.length > 0) {
		const lock = params.lockfileContent;
		const hasWindowsOrDarwin =
			lock.includes("win32-x64") ||
			lock.includes("win32-arm64") ||
			lock.includes("darwin-x64") ||
			lock.includes("darwin-arm64");

		if (nativePackagesDetected.includes("rolldown")) {
			const hasLinuxRolldown = lock.includes("@rolldown/binding-linux-x64-gnu");
			if (hasWindowsOrDarwin && !hasLinuxRolldown) {
				isCrossPlatformLockfile = true;
				missingLinuxBindings.push("@rolldown/binding-linux-x64-gnu");
			}
		}

		if (nativePackagesDetected.includes("rollup")) {
			const hasLinuxRollup = lock.includes("@rollup/rollup-linux-x64-gnu");
			if (hasWindowsOrDarwin && !hasLinuxRollup) {
				isCrossPlatformLockfile = true;
				missingLinuxBindings.push("@rollup/rollup-linux-x64-gnu");
			}
		}

		if (nativePackagesDetected.includes("esbuild")) {
			const hasLinuxEsbuild = lock.includes("@esbuild/linux-x64");
			if (hasWindowsOrDarwin && !hasLinuxEsbuild) {
				isCrossPlatformLockfile = true;
				missingLinuxBindings.push("@esbuild/linux-x64");
			}
		}
	}

	let warning: string | undefined;
	if (isCrossPlatformLockfile) {
		warning = `⚠️ Lockfile Platform Warning: package-lock.json was generated on a non-Linux platform and excludes Linux native optional dependencies (${missingLinuxBindings.join(", ")}). Due to npm bug npm/cli#4828, native optional dependencies may be omitted during installation. HatDot will ensure Linux bindings are installed during build without altering your lockfile.`;
	}

	const safeInstallCommand = params.hasNpmLock
		? "npm ci --include=dev --include=optional"
		: "npm install --include=dev --include=optional";

	return {
		isCrossPlatformLockfile,
		hasNativeDependencies: nativePackagesDetected.length > 0,
		nativePackagesDetected,
		missingLinuxBindings,
		warning,
		safeInstallCommand,
	};
};

/**
 * Resolve Node.js runtime version.
 * - Supports legacy Node.js 18 via pinned Nixpkgs archive without silent substitution.
 * - Supports legacy Node.js 16 via NixOS 23.11 archive.
 * - Preserves modern Node.js 20, 22, and 24 with standard channels.
 * - Resolves Node.js 22 modern patch release (22.13.1) when project or dependency constraints require >=22.12.0 (e.g. Vite 8 / Rolldown).
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

	// Inspect dependency engine constraints and modern build tooling requirements
	let requiresNode22Modern = false;
	let requiresNode24Modern = false;

	if (params.packageJsonContent) {
		try {
			const pkg = JSON.parse(params.packageJsonContent);
			const allDeps = {
				...(pkg.dependencies || {}),
				...(pkg.devDependencies || {}),
			};
			const engineNode = String(pkg.engines?.node || "");

			// Explicit engines.node requires >=22.12.0 or ^22.13.0 or 22.13+
			if (
				/22\.1[2-9]|22\.[2-9]|\^22\.1[3-9]|>=22\.1[2-9]/.test(engineNode)
			) {
				requiresNode22Modern = true;
			}

			// Explicit engines.node requires >=24.11.0 or ^24.11.0 or 24.11+
			if (
				/24\.1[1-9]|24\.[2-9]|\^24\.1[1-9]|>=24\.1[1-9]|\^22\.18\.0\s*\|\|\s*>=24\.11\.0/.test(
					engineNode,
				)
			) {
				requiresNode24Modern = true;
			}

			// Dependencies known to require Node >=20.19.0 || >=22.12.0
			const hasVite8 = allDeps.vite && /^[\^~]?[89]/.test(allDeps.vite);
			const hasRolldown = Boolean(allDeps.rolldown);
			const hasViteReact5 =
				allDeps["@vitejs/plugin-react"] &&
				/^[\^~]?[5-9]/.test(allDeps["@vitejs/plugin-react"]);
			const hasJsdom29 =
				allDeps.jsdom &&
				/^[\^~]?(?:29|3[0-9])/.test(allDeps.jsdom);

			if (hasVite8 || hasRolldown || hasViteReact5 || hasJsdom29) {
				requiresNode22Modern = true;
			}
		} catch {}
	}

	if (
		rawVersion &&
		/22\.1[2-9]|22\.[2-9]|\^22\.1[3-9]|>=22\.1[2-9]/.test(rawVersion)
	) {
		requiresNode22Modern = true;
	}

	if (
		rawVersion &&
		/24\.1[1-9]|24\.[2-9]|\^24\.1[1-9]|>=24\.1[1-9]/.test(rawVersion)
	) {
		requiresNode24Modern = true;
	}

	if (rawVersion) {
		const major = parseNodeVersion(rawVersion);
		if (major !== null) {
			const majorStr = String(major);

			// Incompatibility check: Vite 8 / Rolldown require Node >=20.19.0 || >=22.12.0
			if (requiresNode22Modern && (major === 18 || major === 16 || major === 14)) {
				return {
					requestedVersion: rawVersion,
					isEol: true,
					resolvedVersion: majorStr,
					nixPackage: `nodejs_${majorStr}`,
					isPermitted: false,
					policyError: `❌ Dependency Engine Conflict: Modern project dependencies (Vite 8 / Rolldown) require Node.js ^20.19.0 || >=22.12.0, which conflicts with requested Node.js ${majorStr}. Please upgrade your project to Node.js 20 or 22 in package.json engines or .nvmrc.`,
					isAvailable: false,
					unavailabilityReason: `Node.js ${majorStr} is incompatible with Vite 8 / Rolldown engine requirements.`,
				};
			}

			// If Node 22 is selected and modern patch >=22.12.0 is required
			if (major === 22 && requiresNode22Modern) {
				return {
					requestedVersion: rawVersion,
					isEol: false,
					resolvedVersion: "22.13.1",
					nixPackage: "nodejs_22",
					nixpkgsArchive: NIXPKGS_ARCHIVES.MODERN_22_13.commit,
					archiveLabel: NIXPKGS_ARCHIVES.MODERN_22_13.label,
					isPermitted: true,
					isAvailable: true,
				};
			}

			// If Node 24 is selected and modern patch >=24.11.0 is required
			if (major === 24 && requiresNode24Modern) {
				return {
					requestedVersion: rawVersion,
					isEol: false,
					resolvedVersion: "24.11.0",
					nixPackage: "nodejs_24",
					nixpkgsArchive: NIXPKGS_ARCHIVES.MODERN_24_11.commit,
					archiveLabel: NIXPKGS_ARCHIVES.MODERN_24_11.label,
					isPermitted: true,
					isAvailable: true,
				};
			}

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
					resolvedVersion: entry.full || majorStr,
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
	if (requiresNode22Modern) {
		return {
			isEol: false,
			resolvedVersion: "22.13.1",
			nixPackage: "nodejs_22",
			nixpkgsArchive: NIXPKGS_ARCHIVES.MODERN_22_13.commit,
			archiveLabel: NIXPKGS_ARCHIVES.MODERN_22_13.label,
			isPermitted: true,
			isAvailable: true,
		};
	}

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

	// Check if this project is non-JavaScript when package.json and JS lockfiles are absent
	const hasJsManifest = Boolean(params.packageJsonContent) || hasBunLock || hasPnpmLock || hasYarnLock || hasNpmLock;
	const isPythonProject = fileNames.has("requirements.txt") || fileNames.has("pyproject.toml") || fileNames.has("pipfile") || fileNames.has("poetry.lock") || fileNames.has("uv.lock") || fileNames.has("app.py") || fileNames.has("main.py");
	const isGoProject = fileNames.has("go.mod");
	const isRustProject = fileNames.has("cargo.toml");
	const isJavaProject = fileNames.has("pom.xml") || fileNames.has("build.gradle") || fileNames.has("build.gradle.kts") || fileNames.has("gradlew");
	const isPhpProject = fileNames.has("composer.json");
	const isRubyProject = fileNames.has("gemfile");
	const isDotnetProject = Array.from(fileNames).some((f) => f.endsWith(".csproj") || f.endsWith(".sln"));

	// Decision precedence:
	// 1. Explicit packageManager field from manifest
	// 2. Lockfiles priority: bun > pnpm > yarn > npm (for JS)
	// 3. Language specific package manager (pip/poetry/uv/composer/cargo/go/etc.)
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
	} else if (!hasJsManifest && isPythonProject) {
		if (fileNames.has("uv.lock")) {
			selectedPm = "uv";
			selectedLockfile = "uv.lock";
		} else if (fileNames.has("poetry.lock")) {
			selectedPm = "poetry";
			selectedLockfile = "poetry.lock";
		} else if (fileNames.has("pipfile.lock") || fileNames.has("pipfile")) {
			selectedPm = "pipenv";
			selectedLockfile = fileNames.has("pipfile.lock") ? "pipfile.lock" : "pipfile";
		} else {
			selectedPm = "pip";
			selectedLockfile = fileNames.has("requirements.txt") ? "requirements.txt" : undefined;
		}
	} else if (!hasJsManifest && isGoProject) {
		selectedPm = "go";
		selectedLockfile = "go.mod";
	} else if (!hasJsManifest && isRustProject) {
		selectedPm = "cargo";
		selectedLockfile = fileNames.has("cargo.lock") ? "cargo.lock" : "cargo.toml";
	} else if (!hasJsManifest && isJavaProject) {
		selectedPm = fileNames.has("pom.xml") ? "maven" : "gradle";
	} else if (!hasJsManifest && isPhpProject) {
		selectedPm = "composer";
		selectedLockfile = fileNames.has("composer.lock") ? "composer.lock" : "composer.json";
	} else if (!hasJsManifest && isRubyProject) {
		selectedPm = "bundler";
		selectedLockfile = fileNames.has("gemfile.lock") ? "gemfile.lock" : "gemfile";
	} else if (!hasJsManifest && isDotnetProject) {
		selectedPm = "dotnet";
	}

	// Check if this is a frontend SPA or requires a build phase
	const allDeps = {
		...(pkgJson.dependencies || {}),
		...(pkgJson.devDependencies || {}),
	};
	const isViteSpa = Boolean(allDeps.vite);
	const isReactCra = Boolean(allDeps["react-scripts"]);
	const isVueCli = Boolean(allDeps["@vue/cli-service"]);
	const isAngular = Boolean(allDeps["@angular/core"] || allDeps["@angular/cli"]);
	const isSvelteSpa = Boolean(allDeps.svelte && !allDeps["@sveltejs/kit"]);
	const isFrontendSpa =
		isViteSpa || isReactCra || isVueCli || isAngular || isSvelteSpa;
	const requiresBuild = hasBuildScript || isFrontendSpa;

	// Generate frozen / reproducible install command retaining development dependencies for build
	let installCommand = "npm install --include=dev --include=optional";
	if (selectedPm === "pnpm") {
		installCommand = hasPnpmLock
			? (requiresBuild ? "pnpm install --frozen-lockfile --prod=false" : "pnpm install --frozen-lockfile")
			: (requiresBuild ? "pnpm install --prod=false" : "pnpm install");
	} else if (selectedPm === "bun") {
		installCommand = hasBunLock
			? "bun install --frozen-lockfile"
			: "bun install";
	} else if (selectedPm === "yarn") {
		installCommand = hasYarnLock
			? (requiresBuild ? "yarn install --frozen-lockfile --production=false" : "yarn install --frozen-lockfile")
			: (requiresBuild ? "yarn install --production=false" : "yarn install");
	} else if (selectedPm === "npm") {
		installCommand = hasNpmLock
			? "npm ci --include=dev --include=optional"
			: "npm install --include=dev --include=optional";
	} else if (selectedPm === "uv") {
		installCommand = "uv sync";
	} else if (selectedPm === "poetry") {
		installCommand = "poetry install --no-interaction";
	} else if (selectedPm === "pipenv") {
		installCommand = "pipenv install --deploy";
	} else if (selectedPm === "pip") {
		installCommand = fileNames.has("requirements.txt")
			? "pip install -r requirements.txt"
			: "pip install .";
	} else if (selectedPm === "cargo") {
		installCommand = "cargo build --release";
	} else if (selectedPm === "go") {
		installCommand = "go build -o main .";
	} else if (selectedPm === "composer") {
		installCommand = "composer install --no-dev --optimize-autoloader";
	} else if (selectedPm === "maven") {
		installCommand = "mvn clean package -DskipTests";
	} else if (selectedPm === "gradle") {
		installCommand = "./gradlew build -x test";
	} else if (selectedPm === "bundler") {
		installCommand = "bundle install";
	} else if (selectedPm === "dotnet") {
		installCommand = "dotnet build";
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

	const suggestedPublishDirectory = isFrontendSpa
		? isReactCra
			? "build"
			: "dist"
		: undefined;

	// Generate start command using ONLY the selected package manager and detected project structure
	let startCommand: string | undefined;
	let startCommandSource: string | undefined;
	const runCmd =
		selectedPm === "bun"
			? "bun run"
			: selectedPm === "npm"
				? "npm run"
				: selectedPm;

	const rawStart = scripts.start ? String(scripts.start).trim() : "";
	const isViteDevServerStart =
		isViteSpa &&
		(rawStart === "vite" || /^vite(?:\s+(?:dev|serve))?\b/i.test(rawStart));
	const isVitePreviewStart =
		isViteSpa &&
		(/\bpreview\b/i.test(rawStart) || rawStart.startsWith("vite preview"));

	// Check if scripts.start is a development-only command that should not be used in production
	const isDevOnlyStart =
		/^(?:nest\s+start|ts-node|nodemon|tsx|concurrently|tsc\s+-w)\b/i.test(rawStart) ||
		/\b(?:--watch|-w)\b/i.test(rawStart);

	const allPkgDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
	const isNestJs = Boolean(
		allPkgDeps["@nestjs/core"] ||
		allPkgDeps["@nestjs/common"]
	);

	if (isNestJs && scripts["start:prod"]) {
		startCommand = `${runCmd} start:prod`;
		startCommandSource = "package.json scripts.start:prod (nestjs production)";
	} else if (hasStartScript && !isViteDevServerStart && (!isDevOnlyStart || !scripts["start:prod"])) {
		if (isVitePreviewStart) {
			startCommand = rawStart.includes("--host")
				? (selectedPm === "bun" ? "bun start" : `${selectedPm} start`)
				: (selectedPm === "bun" ? "bun start -- --port 4173 --host 0.0.0.0" : `${selectedPm} start -- --port 4173 --host 0.0.0.0`);
			startCommandSource = "package.json scripts.start (vite preview)";
		} else {
			startCommand = selectedPm === "bun" ? "bun start" : `${selectedPm} start`;
			startCommandSource = "package.json scripts.start";
		}
	} else if (hasStartScript && isViteDevServerStart && scripts.preview) {
		startCommand = `${runCmd} preview -- --port 4173 --host 0.0.0.0`;
		startCommandSource = "package.json scripts.preview (replacing dev server start)";
	} else if (scripts["start:prod"]) {
		startCommand = `${runCmd} start:prod`;
		startCommandSource = "package.json scripts.start:prod";
	} else if (scripts.serve) {
		startCommand = `${runCmd} serve`;
		startCommandSource = "package.json scripts.serve";
	} else if (scripts.server) {
		startCommand = `${runCmd} server`;
		startCommandSource = "package.json scripts.server";
	} else if (scripts.prod) {
		startCommand = `${runCmd} prod`;
		startCommandSource = "package.json scripts.prod";
	} else if (scripts.run) {
		startCommand = `${runCmd} run`;
		startCommandSource = "package.json scripts.run";
	} else if (pkgJson.main && typeof pkgJson.main === "string") {
		if (pkgJson.main.endsWith(".ts") && hasBuildScript) {
			const jsMain = pkgJson.main.replace(/\.ts$/, ".js").replace(/^src\//, "dist/");
			startCommand = `node ${jsMain}`;
			startCommandSource = `compiled main (${jsMain})`;
		} else {
			startCommand = `node ${pkgJson.main}`;
			startCommandSource = `package.json main (${pkgJson.main})`;
		}
	} else if (fileNames.has("server.js")) {
		startCommand = "node server.js";
		startCommandSource = "file: server.js";
	} else if (fileNames.has("server.mjs")) {
		startCommand = "node server.mjs";
		startCommandSource = "file: server.mjs";
	} else if (fileNames.has("server.cjs")) {
		startCommand = "node server.cjs";
		startCommandSource = "file: server.cjs";
	} else if (fileNames.has("app.js")) {
		startCommand = "node app.js";
		startCommandSource = "file: app.js";
	} else if (fileNames.has("app.mjs")) {
		startCommand = "node app.mjs";
		startCommandSource = "file: app.mjs";
	} else if (fileNames.has("index.js")) {
		startCommand = "node index.js";
		startCommandSource = "file: index.js";
	} else if (fileNames.has("index.mjs")) {
		startCommand = "node index.mjs";
		startCommandSource = "file: index.mjs";
	} else if (fileNames.has("main.js")) {
		startCommand = "node main.js";
		startCommandSource = "file: main.js";
	} else if (scripts.preview) {
		const previewStr = String(scripts.preview);
		const customPreviewPort = extractPortFromCommand(previewStr);
		const targetPreviewPort = customPreviewPort || 4173;
		const hasHostFlag = previewStr.includes("--host");
		const hasPortFlag = /--port|-p\b/i.test(previewStr);

		let flags = "";
		if (!hasPortFlag) flags += ` --port ${targetPreviewPort}`;
		if (!hasHostFlag) flags += " --host 0.0.0.0";

		startCommand = flags ? `${runCmd} preview --${flags}` : `${runCmd} preview`;
		startCommandSource = "package.json scripts.preview";
	}

	let missingStartCommandDiagnostic:
		| PackageManagerResolution["missingStartCommandDiagnostic"]
		| undefined;
	if (!startCommand) {
		const availableScripts = Object.keys(scripts);
		if (isFrontendSpa) {
			missingStartCommandDiagnostic = {
				framework: isViteSpa
					? "Vite SPA"
					: isReactCra
						? "Create React App"
						: "Frontend SPA",
				availableScripts,
				hasBuildScript,
				reason:
					"Frontend SPA detected with build step but no backend production start script.",
				remediation: `Configure Publish Directory as "${suggestedPublishDirectory}" to deploy with static Nginx, or add a "start" script in package.json.`,
			};
		} else if (params.packageJsonContent) {
			missingStartCommandDiagnostic = {
				availableScripts,
				hasBuildScript,
				reason:
					"Node.js application detected without a 'start', 'start:prod', 'serve', or main entrypoint script.",
				remediation:
					'Add a "start" script to package.json (e.g. "start": "node server.js" or "node index.js"), or configure a Custom Start Command in application settings.',
			};
		}
	}

	return {
		packageManager: selectedPm,
		lockfile: selectedLockfile,
		installCommand,
		buildCommand,
		startCommand,
		startCommandSource,
		isStaticSpa: isFrontendSpa,
		suggestedPublishDirectory,
		missingStartCommandDiagnostic,
		hasConflictingLockfiles,
		conflicts: hasConflictingLockfiles ? presentLockfiles : undefined,
	};
};

/**
 * Nixpacks GeneratePlanConfig schemas mirroring official Rust serde definitions.
 */
export const NixpacksPhaseSchema = z.object({
	name: z.string().optional(),
	nixpkgsArchive: z.string().optional(),
	nixpkgs_archive: z.string().optional(),
	nixPkgs: z.array(z.string()).optional(),
	nix_pkgs: z.array(z.string()).optional(),
	pkgs: z.array(z.string()).optional(),
	aptPkgs: z.array(z.string()).optional(),
	apt_pkgs: z.array(z.string()).optional(),
	cmds: z.array(z.string()).optional(),
	dependsOn: z.array(z.string()).optional(),
	depends_on: z.array(z.string()).optional(),
	onlyIncludeFiles: z.array(z.string()).optional(),
	only_include_files: z.array(z.string()).optional(),
	paths: z.array(z.string()).optional(),
});

export const NixpacksStartPhaseSchema = z.object({
	cmd: z.string().optional(),
	runImage: z.string().optional(),
	run_image: z.string().optional(),
	onlyIncludeFiles: z.array(z.string()).optional(),
	only_include_files: z.array(z.string()).optional(),
});

export const NixpacksConfigSchema = z.object({
	providers: z.array(z.string()).optional(),
	build_image: z.string().optional(),
	buildImage: z.string().optional(),
	variables: z.record(z.string(), z.string()).optional(),
	static_cache: z.array(z.string()).optional(),
	staticCache: z.array(z.string()).optional(),
	phases: z.record(z.string(), NixpacksPhaseSchema).optional(),
	start: NixpacksStartPhaseSchema.optional(),
});

export type NixpacksConfig = z.infer<typeof NixpacksConfigSchema>;

/**
 * Validates a TOML string against the official Nixpacks configuration schema.
 * Throws a detailed error if invalid (e.g. invalid type: sequence in variables).
 */
export const validateNixpacksToml = (tomlContent: string): NixpacksConfig => {
	const parsed = parseToml(tomlContent);
	return NixpacksConfigSchema.parse(parsed);
};

/**
 * Normalizes existing or generated nixpacks.toml content:
 * - Guarantees providers declaration is top-level (never nested under [variables] or phases)
 * - Safely integrates defaultProvider, nixpkgsArchive, and setupCmds without syntax errors
 */
export const normalizeNixpacksToml = (
	tomlContent: string,
	options: {
		defaultProvider?: string;
		nixpkgsArchive?: string;
		setupCmds?: string[];
	} = {},
): string => {
	let content = tomlContent.trim();
	if (!content) {
		return generateNixpacksToml({
			providers: options.defaultProvider ? [options.defaultProvider] : undefined,
			nixpkgsArchive: options.nixpkgsArchive,
			setupCmds: options.setupCmds,
		});
	}

	// 1. Detect if providers is already defined
	let extractedProviders: string[] | undefined;
	const providerMatch = content.match(/providers\s*=\s*\[([^\]]*)\]/);
	if (providerMatch?.[1] !== undefined) {
		extractedProviders = providerMatch[1]
			.split(",")
			.map((s) => s.replace(/["'\s]/g, ""))
			.filter(Boolean);
	} else if (options.defaultProvider) {
		extractedProviders = [options.defaultProvider];
	}

	// 2. Remove any misplaced providers declaration from within the body
	if (providerMatch) {
		content = content.replace(providerMatch[0], "").trim();
	}

	// 3. Construct clean normalized TOML with top-level fields first
	const topLevelLines: string[] = [];
	if (extractedProviders && extractedProviders.length > 0) {
		topLevelLines.push(`providers = [${extractedProviders.map((p) => `"${p}"`).join(", ")}]`);
	}

	let result = topLevelLines.length > 0
		? `${topLevelLines.join("\n")}\n\n${content}`
		: content;

	// If setup archive needs to be added and isn't present:
	if (options.nixpkgsArchive && !result.includes("nixpkgsArchive")) {
		result += `\n\n[phases.setup]\nnixpkgsArchive = "${options.nixpkgsArchive}"`;
	}

	// If setupCmds need to be added and aren't present:
	const hasSetupCmds = /\[phases\.setup\][\s\S]*?cmds\s*=/.test(result);
	if (options.setupCmds && options.setupCmds.length > 0 && !hasSetupCmds) {
		if (!result.includes("[phases.setup]")) {
			result += `\n\n[phases.setup]`;
		}
		result += `\ncmds = [${options.setupCmds.map((c) => JSON.stringify(c)).join(", ")}]`;
	}

	return `${result.trim().replace(/\n{3,}/g, "\n\n")}\n`;
};

/**
 * Generate a Nixpacks configuration TOML content to pin the archive and packages.
 * Strictly adheres to Nixpacks schema:
 * - providers is emitted at the top level before any table declarations.
 * - [variables] only contains string-compatible values and never contains providers.
 */
export const generateNixpacksToml = (options: {
	nixpkgsArchive?: string;
	nixPkgs?: string[];
	providers?: string[];
	setupCmds?: string[];
	installCmd?: string;
	buildCmd?: string;
	startCmd?: string;
	variables?: Record<string, string>;
}): string => {
	const lines: string[] = [];
	lines.push("# Generated by HatDot Universal Deployment Engine");

	// 1. Top-level keys MUST appear before any table headers ([section])
	if (options.providers && options.providers.length > 0) {
		lines.push(
			`providers = [${options.providers.map((p) => `"${p}"`).join(", ")}]`,
		);
	}

	// 2. Variables table ([variables])
	// In Nixpacks schema, variables is HashMap<String, String>.
	// All values must be strings, and 'providers' must NEVER be in variables.
	const rawVariables: Record<string, unknown> = {
		NPM_CONFIG_PRODUCTION: "",
		NPM_CONFIG_UPDATE_NOTIFIER: "false",
		...(options.variables || {}),
	};

	const cleanedVariables: Record<string, string> = {};
	for (const [key, val] of Object.entries(rawVariables)) {
		if (key === "providers") {
			// Protection against accidental 'providers' key inside variables
			continue;
		}
		if (Array.isArray(val)) {
			cleanedVariables[key] = val.map(String).join(",");
		} else if (val === null || val === undefined) {
			cleanedVariables[key] = "";
		} else {
			cleanedVariables[key] = String(val);
		}
	}

	if (Object.keys(cleanedVariables).length > 0) {
		lines.push("");
		lines.push("[variables]");
		for (const [key, val] of Object.entries(cleanedVariables)) {
			lines.push(`${key} = ${JSON.stringify(val)}`);
		}
	}

	// 3. Setup phase ([phases.setup])
	if (
		options.nixpkgsArchive ||
		(options.nixPkgs && options.nixPkgs.length > 0) ||
		(options.setupCmds && options.setupCmds.length > 0)
	) {
		lines.push("");
		lines.push("[phases.setup]");
		if (options.nixpkgsArchive) {
			lines.push(`nixpkgsArchive = "${options.nixpkgsArchive}"`);
		}
		if (options.nixPkgs && options.nixPkgs.length > 0) {
			lines.push(
				`nixPkgs = [${options.nixPkgs.map((p) => `"${p}"`).join(", ")}]`,
			);
		}
		if (options.setupCmds && options.setupCmds.length > 0) {
			lines.push(
				`cmds = [${options.setupCmds.map((c) => JSON.stringify(c)).join(", ")}]`,
			);
		}
	}

	// 4. Install phase ([phases.install])
	if (options.installCmd) {
		lines.push("");
		lines.push("[phases.install]");
		lines.push(`cmds = [${JSON.stringify(options.installCmd)}]`);
	}

	// 5. Build phase ([phases.build])
	if (options.buildCmd) {
		lines.push("");
		lines.push("[phases.build]");
		lines.push(`cmds = [${JSON.stringify(options.buildCmd)}]`);
	}

	// 6. Start phase ([start])
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

/**
 * Extract target listening port from startup command (e.g. --port 4173, --server.port=8501, 0.0.0.0:8000)
 */
export const extractPortFromCommand = (
	command?: string | null,
): number | undefined => {
	if (!command || typeof command !== "string") return undefined;

	// 1. Explicit --server.port=8501 or --server.port 8501
	const serverPortMatch = command.match(/--server\.port[=\s](\d+)/i);
	if (serverPortMatch?.[1]) {
		const port = Number.parseInt(serverPortMatch[1], 10);
		if (!Number.isNaN(port) && port > 0) return port;
	}

	// 2. Explicit --port=4173 or --port 4173
	const portMatch = command.match(/--port[=\s](\d+)/i);
	if (portMatch?.[1]) {
		const port = Number.parseInt(portMatch[1], 10);
		if (!Number.isNaN(port) && port > 0) return port;
	}

	// 3. Short flag -p 8080 or -p=8080
	const shortPortMatch = command.match(/(?:^|\s)-p[=\s](\d+)(?:\s|$)/i);
	if (shortPortMatch?.[1]) {
		const port = Number.parseInt(shortPortMatch[1], 10);
		if (!Number.isNaN(port) && port > 0) return port;
	}

	// 4. Bind address like 0.0.0.0:8000 or 127.0.0.1:8000 or :8000
	const hostPortMatch = command.match(
		/(?:(?:0\.0\.0\.0|127\.0\.0\.1|localhost):|:)(\d{2,5})(?:\s|$)/i,
	);
	if (hostPortMatch?.[1]) {
		const port = Number.parseInt(hostPortMatch[1], 10);
		if (!Number.isNaN(port) && port > 0) return port;
	}

	// 5. Framework-specific preview or default server patterns
	if (/\b(?:vite\s+preview|run\s+preview)\b/i.test(command)) {
		return 4173;
	}
	if (/\b(?:astro\s+preview)\b/i.test(command)) {
		return 4321;
	}
	if (/\bstreamlit\b/i.test(command)) {
		return 8501;
	}
	if (/\bgradio\b/i.test(command)) {
		return 7860;
	}

	return undefined;
};

/**
 * Inspect source code content (e.g. server.js, app.py, main.ts) to detect explicit listening port
 * when not specified via CLI command flags.
 */
export const extractPortFromSourceCode = (
	content?: string | null,
): number | undefined => {
	if (!content || typeof content !== "string") return undefined;

	// 1. process.env.PORT || 8080 or process.env.PORT ?? 8080
	const envFallbackMatch = content.match(
		/process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d{2,5})/,
	);
	if (envFallbackMatch?.[1]) {
		const p = Number.parseInt(envFallbackMatch[1], 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}

	// 2. const/let/var PORT = 8080 (or port = 8080, serverPort = 8080)
	const constPortMatch = content.match(
		/(?:const|let|var)\s+(?:PORT|port|serverPort|appPort)\s*=\s*(\d{2,5})\b/,
	);
	if (constPortMatch?.[1]) {
		const p = Number.parseInt(constPortMatch[1], 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}

	// 3. app.listen(8080) or server.listen(8080) or .listen({ port: 8080 })
	const listenMatch = content.match(
		/\.listen\(\s*(?:\{\s*port:\s*)?(\d{2,5})\b/,
	);
	if (listenMatch?.[1]) {
		const p = Number.parseInt(listenMatch[1], 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}

	// 4. Python Flask: app.run(port=5000) or run(port=5000)
	const flaskMatch = content.match(/\brun\([^)]*port\s*=\s*(\d{2,5})/i);
	if (flaskMatch?.[1]) {
		const p = Number.parseInt(flaskMatch[1], 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}

	// 5. Python Uvicorn: uvicorn.run(..., port=8000)
	const uvicornMatch = content.match(
		/uvicorn\.run\([^)]*port\s*=\s*(\d{2,5})/i,
	);
	if (uvicornMatch?.[1]) {
		const p = Number.parseInt(uvicornMatch[1], 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}

	return undefined;
};

export interface ApplicationRuntimeConfigParams {
	application?: {
		appName?: string | null;
		command?: string | null;
		ports?: Array<{ targetPort?: number | null }> | null;
		buildType?: string | null;
		env?: string | null;
		environment?: {
			env?: string | null;
			project?: { env?: string | null } | null;
		} | null;
	} | null;
	packageJsonContent?: string | null;
	nixpacksTomlContent?: string | null;
	files?: FileItem[];
	detectedFramework?: string;
	detectedLanguage?: string;
	detectedPort?: number;
	detectedStartCommand?: string;
	packageManager?: SupportedPackageManager;
	isStaticSpa?: boolean;
	publishDirectory?: string;
	imageCmd?: string;
	imageExposedPorts?: number[];
}

export interface ApplicationRuntimeConfig {
	framework: string;
	language: string;
	buildType: string;
	packageManager: SupportedPackageManager;
	startupCommand: string;
	startupCommandSource:
		| "customer_command"
		| "nixpacks_toml"
		| "package_json_start"
		| "package_json_preview"
		| "framework_default"
		| "image_inspect"
		| "fallback";
	port: number;
	portSource:
		| "customer_port"
		| "customer_command"
		| "customer_env"
		| "nixpacks_toml"
		| "project_manifest"
		| "framework_default"
		| "image_inspect"
		| "platform_default";
	isStaticSpa: boolean;
	publishDirectory?: string;
	isHttpWorkload: boolean;
	diagnostics?: string[];
}

/**
 * Authoritative Universal Application Startup & Port Resolution Pipeline.
 * Respects strict multi-tenant isolation and documented precedence.
 */
export const resolveApplicationRuntimeConfig = (
	params: ApplicationRuntimeConfigParams,
): ApplicationRuntimeConfig => {
	const app = params.application;
	const diagnostics: string[] = [];

	// 1. Explicit Customer Overrides
	const customerCommand = app?.command?.trim() || undefined;
	const customerPort =
		app?.ports?.[0]?.targetPort && app.ports[0].targetPort > 0
			? app.ports[0].targetPort
			: undefined;

	let customerEnvPort: number | undefined;
	const allEnvs = [
		app?.env,
		app?.environment?.env,
		app?.environment?.project?.env,
	];
	for (const envStr of allEnvs) {
		if (envStr) {
			const m = envStr.match(/^\s*PORT\s*=\s*["']?(\d+)["']?/m);
			if (m?.[1]) {
				const p = Number.parseInt(m[1], 10);
				if (!Number.isNaN(p) && p > 0) {
					customerEnvPort = p;
					break;
				}
			}
		}
	}

	// 2. Parse nixpacks.toml if available
	let nixpacksStartCmd: string | undefined;
	let nixpacksTomlPort: number | undefined;
	if (params.nixpacksTomlContent) {
		const toml = params.nixpacksTomlContent;
		const phaseStartMatch = toml.match(
			/\[phases\.start\][\s\S]*?cmd\s*=\s*["']([^"']+)["']/,
		);
		const startMatch = toml.match(/\[start\][\s\S]*?cmd\s*=\s*["']([^"']+)["']/);
		const cmdMatch =
			phaseStartMatch ||
			startMatch ||
			toml.match(/^\s*cmd\s*=\s*["']([^"']+)["']/m);
		if (cmdMatch?.[1]) {
			nixpacksStartCmd = cmdMatch[1].trim();
			const p = extractPortFromCommand(nixpacksStartCmd);
			if (p) nixpacksTomlPort = p;
		}
		const portMatch = toml.match(/^\s*PORT\s*=\s*["']?(\d+)["']?/m);
		if (portMatch?.[1]) {
			const p = Number.parseInt(portMatch[1], 10);
			if (!Number.isNaN(p) && p > 0) nixpacksTomlPort = p;
		}
	}

	// 3. Parse package.json if available
	let pkgScripts: Record<string, string> = {};
	let pkgDeps: Record<string, string> = {};
	let isViteSpa = false;
	let isAstro = false;
	if (params.packageJsonContent) {
		try {
			const parsed = JSON.parse(params.packageJsonContent);
			pkgScripts = parsed.scripts || {};
			pkgDeps = {
				...(parsed.dependencies || {}),
				...(parsed.devDependencies || {}),
			};
			isViteSpa = Boolean(pkgDeps.vite);
			isAstro = Boolean(pkgDeps.astro);
		} catch {}
	}

	// 4. Determine package manager
	const pm: SupportedPackageManager =
		params.packageManager ||
		(params.files
			? resolvePackageManagerAndCommands({
					files: params.files,
					packageJsonContent: params.packageJsonContent || undefined,
				}).packageManager
			: "npm");
	const runPrefix =
		pm === "bun"
			? "bun run"
			: pm === "pnpm"
				? "pnpm run"
				: pm === "yarn"
					? "yarn"
					: "npm run";

	// 5. Workload Classification: HTTP workload vs Background Worker / Scheduled Job
	const isWorkerCommand = Boolean(
		customerCommand &&
			/\b(celery|worker|sidekiq|queue:work|resque|cron|consumer)\b/i.test(
				customerCommand,
			),
	);
	const isHttpWorkload = !isWorkerCommand;

	// 6. Precedence for Effective Port
	let port = 3000;
	let portSource: ApplicationRuntimeConfig["portSource"] = "platform_default";

	if (app?.buildType === "static" || params.isStaticSpa) {
		port = 80;
		portSource = "framework_default";
	} else if (customerPort) {
		port = customerPort;
		portSource = "customer_port";
	} else if (customerCommand && extractPortFromCommand(customerCommand)) {
		port = extractPortFromCommand(customerCommand)!;
		portSource = "customer_command";
	} else if (customerEnvPort) {
		port = customerEnvPort;
		portSource = "customer_env";
	} else if (nixpacksTomlPort) {
		port = nixpacksTomlPort;
		portSource = "nixpacks_toml";
	} else if (params.detectedPort && params.detectedPort > 0) {
		port = params.detectedPort;
		portSource = "framework_default";
	} else if (params.imageExposedPorts && params.imageExposedPorts.length > 0) {
		port = params.imageExposedPorts[0]!;
		portSource = "image_inspect";
	} else if (isViteSpa && pkgScripts.preview) {
		const extracted = extractPortFromCommand(pkgScripts.preview);
		port = extracted || 4173;
		portSource = "framework_default";
	} else if (isAstro) {
		port = 4321;
		portSource = "framework_default";
	} else if (params.detectedLanguage === "Python") {
		const fw = (params.detectedFramework || "").toLowerCase();
		if (fw.includes("streamlit")) {
			port = 8501;
		} else if (fw.includes("flask")) {
			port = 5000;
		} else if (fw.includes("gradio")) {
			port = 7860;
		} else {
			port = 8000;
		}
		portSource = "framework_default";
	} else if (
		params.detectedLanguage === "Go" ||
		params.detectedLanguage === "Rust" ||
		params.detectedLanguage === "Java"
	) {
		port = 8080;
		portSource = "framework_default";
	} else if (params.detectedLanguage === ".NET" || params.detectedLanguage === "C#") {
		port = 5000;
		portSource = "framework_default";
	} else {
		port = 3000;
		portSource = "platform_default";
	}

	// 7. Precedence for Effective Startup Command
	let startupCommand = "npm start";
	let startupCommandSource: ApplicationRuntimeConfig["startupCommandSource"] =
		"fallback";

	const rawStartConfig = pkgScripts.start ? String(pkgScripts.start).trim() : "";
	const isDevOnlyStartConfig =
		/^(?:nest\s+start|ts-node|nodemon|tsx|concurrently)\b/i.test(rawStartConfig) ||
		/\b(?:--watch|-w)\b/i.test(rawStartConfig);
	const isNest = Boolean(pkgDeps["@nestjs/core"] || pkgDeps["@nestjs/common"]);

	if (customerCommand) {
		startupCommand = customerCommand;
		startupCommandSource = "customer_command";
	} else if (nixpacksStartCmd) {
		startupCommand = nixpacksStartCmd;
		startupCommandSource = "nixpacks_toml";
	} else if (isNest && pkgScripts["start:prod"]) {
		startupCommand = `${runPrefix} start:prod`;
		startupCommandSource = "package_json_start";
	} else if (isDevOnlyStartConfig && pkgScripts["start:prod"]) {
		startupCommand = `${runPrefix} start:prod`;
		startupCommandSource = "package_json_start";
	} else if (params.detectedStartCommand && (isDevOnlyStartConfig || !pkgScripts.start)) {
		startupCommand = params.detectedStartCommand;
		startupCommandSource = "framework_default";
	} else if (isViteSpa && pkgScripts.preview) {
		const previewStr = String(pkgScripts.preview);
		const hasHost = previewStr.includes("--host");
		const hasPort = /--port|-p\b/i.test(previewStr);
		let flags = "";
		if (!hasPort) flags += ` --port ${port}`;
		if (!hasHost) flags += " --host 0.0.0.0";
		startupCommand = flags
			? `${runPrefix} preview --${flags}`
			: `${runPrefix} preview`;
		startupCommandSource = "package_json_preview";
	} else if (isAstro && pkgScripts.preview) {
		const previewStr = String(pkgScripts.preview);
		const hasHost = previewStr.includes("--host");
		const hasPort = /--port|-p\b/i.test(previewStr);
		let flags = "";
		if (!hasPort) flags += ` --port ${port}`;
		if (!hasHost) flags += " --host 0.0.0.0";
		startupCommand = flags
			? `${runPrefix} preview --${flags}`
			: `${runPrefix} preview`;
		startupCommandSource = "package_json_preview";
	} else if (pkgScripts.start && !isDevOnlyStartConfig) {
		const rawStart = String(pkgScripts.start).trim();
		const isViteDev =
			isViteSpa &&
			(rawStart === "vite" || /^vite(?:\s+(?:dev|serve))?\b/i.test(rawStart));
		if (isViteDev && pkgScripts.preview) {
			startupCommand = `${runPrefix} preview -- --port ${port} --host 0.0.0.0`;
			startupCommandSource = "package_json_preview";
		} else {
			startupCommand = pm === "bun" ? "bun start" : `${pm} start`;
			startupCommandSource = "package_json_start";
		}
	} else if (params.detectedStartCommand) {
		startupCommand = params.detectedStartCommand;
		startupCommandSource = "framework_default";
	} else if (pkgScripts["start:prod"]) {
		startupCommand = `${runPrefix} start:prod`;
		startupCommandSource = "package_json_start";
	} else if (params.imageCmd) {
		startupCommand = params.imageCmd;
		startupCommandSource = "image_inspect";
	}

	return {
		framework: params.detectedFramework || (isViteSpa ? "Vite" : "Application"),
		language: params.detectedLanguage || "JavaScript",
		buildType: app?.buildType || (params.isStaticSpa ? "static" : "nixpacks"),
		packageManager: pm,
		startupCommand,
		startupCommandSource,
		port,
		portSource,
		isStaticSpa: Boolean(params.isStaticSpa),
		publishDirectory: params.publishDirectory,
		isHttpWorkload,
		diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
	};
};

export interface BuildDependencyDiagnostic {
	code: "UNDECLARED_BUILD_DEPENDENCY";
	packageName: string;
	configFile: string;
	message: string;
	severity: "error";
	remediation: string;
}

export interface BuildDependencyInspectionResult {
	diagnostics: BuildDependencyDiagnostic[];
	missingDependencies: string[];
	checkedFiles: string[];
}

const KNOWN_NODE_BUILTINS = new Set([
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"domain",
	"events",
	"fs",
	"fs/promises",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"path/posix",
	"path/win32",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"stream/consumers",
	"stream/promises",
	"stream/web",
	"string_decoder",
	"sys",
	"timers",
	"timers/promises",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"util/types",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
]);

/**
 * Inspect project configuration files (e.g. vite.config.js, next.config.js)
 * to verify that imported plugins and build-time packages are declared in package.json.
 * If a required build-time dependency is missing from the customer's manifest,
 * returns an actionable diagnostic rather than failing with an obscure module error.
 */
export const inspectBuildDependencies = (params: {
	files: FileItem[];
	packageJsonContent?: string;
}): BuildDependencyInspectionResult => {
	const diagnostics: BuildDependencyDiagnostic[] = [];
	const missingDependencies: string[] = [];
	const checkedFiles: string[] = [];

	let declaredDeps: Set<string> = new Set();
	if (params.packageJsonContent) {
		try {
			const parsed = JSON.parse(params.packageJsonContent);
			const allDeps = {
				...(parsed.dependencies || {}),
				...(parsed.devDependencies || {}),
				...(parsed.peerDependencies || {}),
				...(parsed.optionalDependencies || {}),
			};
			for (const dep of Object.keys(allDeps)) {
				declaredDeps.add(dep);
			}
		} catch {}
	}

	// Supported build configuration files
	const buildConfigFiles = params.files.filter((f) => {
		const base = (f.name || path.basename(f.path)).toLowerCase();
		return (
			base.startsWith("vite.config.") ||
			base.startsWith("next.config.") ||
			base.startsWith("nuxt.config.") ||
			base.startsWith("astro.config.") ||
			base.startsWith("svelte.config.") ||
			base.startsWith("webpack.config.") ||
			base.startsWith("rollup.config.")
		);
	});

	for (const configFile of buildConfigFiles) {
		const configName = configFile.name || path.basename(configFile.path);
		let content = configFile.content;
		if (!content && configFile.path) {
			try {
				if (fs.existsSync(configFile.path)) {
					content = fs.readFileSync(configFile.path, "utf-8");
				}
			} catch {}
		}

		if (!content) continue;
		checkedFiles.push(configName);

		// Strip comments to avoid false matches in commented code
		const stripped = content
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*/g, "");

		// Match static imports, dynamic imports, and require statements
		const importRegex =
			/(?:import\s+(?:[\w*\s{},]*\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

		let match: RegExpExecArray | null;
		while ((match = importRegex.exec(stripped)) !== null) {
			const specifier = match[1]?.trim();
			if (!specifier) continue;

			// Skip relative or absolute paths and Node built-in protocol
			if (
				specifier.startsWith(".") ||
				specifier.startsWith("/") ||
				specifier.startsWith("\\") ||
				specifier.startsWith("node:")
			) {
				continue;
			}

			// Extract root package name
			const parts = specifier.split("/");
			let pkgName = parts[0];
			if (!pkgName) continue;
			if (specifier.startsWith("@") && parts.length > 1 && parts[1]) {
				pkgName = `${parts[0]}/${parts[1]}`;
			}

			if (KNOWN_NODE_BUILTINS.has(pkgName)) {
				continue;
			}

			// If the manifest has dependencies declared but omits this imported plugin/package
			if (declaredDeps.size > 0 && !declaredDeps.has(pkgName)) {
				if (!missingDependencies.includes(pkgName)) {
					missingDependencies.push(pkgName);
					diagnostics.push({
						code: "UNDECLARED_BUILD_DEPENDENCY",
						packageName: pkgName,
						configFile: configName,
						message: `Configuration file '${configName}' imports '${pkgName}', but this package is not declared in package.json (neither in 'dependencies' nor 'devDependencies').`,
						severity: "error",
						remediation: `Add '${pkgName}' to 'devDependencies' in package.json (e.g. npm install -D ${pkgName}) and re-commit your lockfile before deploying.`,
					});
				}
			}
		}
	}

	return {
		diagnostics,
		missingDependencies,
		checkedFiles,
	};
};


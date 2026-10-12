import fs from "node:fs";
import path from "node:path";

export interface NodeRuntimeResolution {
	requestedVersion?: string;
	isEol: boolean;
	eolReason?: string;
	resolvedVersion: "20" | "22";
	nixPackage: "nodejs_20" | "nodejs_22";
	warning?: string;
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
 * End-of-Life Node.js major versions that have been removed or deprecated in modern Nixpkgs.
 * Specifically Node.js 18 reached EOL on 2025-04-30 and has been removed from Nixpkgs.
 */
export const EOL_NODE_VERSIONS: Record<string, string> = {
	"10": "Node.js 10 reached End-Of-Life on 2021-04-30 and has been removed from Nixpkgs.",
	"12": "Node.js 12 reached End-Of-Life on 2022-04-30 and has been removed from Nixpkgs.",
	"14": "Node.js 14 reached End-Of-Life on 2023-04-30 and has been removed from Nixpkgs.",
	"16": "Node.js 16 reached End-Of-Life on 2023-09-11 and has been removed from Nixpkgs.",
	"18": "Node.js 18.x reached End-Of-Life on 2025-04-30 and has been removed from Nixpkgs.",
	"19": "Node.js 19 reached End-Of-Life on 2023-06-01 and has been removed from Nixpkgs.",
	"21": "Node.js 21 reached End-Of-Life on 2024-06-01 and has been removed from Nixpkgs.",
	"23": "Node.js 23 is a short-lived release that reached End-Of-Life in 2025.",
};

/**
 * Supported LTS Node.js versions available in current Nixpkgs.
 */
export const SUPPORTED_NODE_LTS = {
	MAINTENANCE: "20", // Node 20 LTS (Iron)
	ACTIVE: "22", // Node 22 LTS (Jod)
} as const;

/**
 * Extract requested Node.js version string from raw configuration.
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
 * Resolve Node.js runtime version safely, avoiding EOL / removed Nixpkgs packages.
 */
export const resolveNodeRuntime = (params: {
	packageJsonContent?: string;
	nvmrcContent?: string;
	nodeVersionContent?: string;
	runtimeTxtContent?: string;
}): NodeRuntimeResolution => {
	let rawVersion: string | undefined;

	// 1. Check .nvmrc
	if (params.nvmrcContent?.trim()) {
		rawVersion = params.nvmrcContent.trim();
	}

	// 2. Check .node-version
	if (!rawVersion && params.nodeVersionContent?.trim()) {
		rawVersion = params.nodeVersionContent.trim();
	}

	// 3. Check runtime.txt (e.g. nodejs-20.x or node-18)
	if (!rawVersion && params.runtimeTxtContent?.trim()) {
		const cleaned = params.runtimeTxtContent
			.trim()
			.replace(/^node(js)?[-_]?/i, "");
		if (cleaned) {
			rawVersion = cleaned;
		}
	}

	// 4. Check package.json engines.node
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
			if (majorStr in EOL_NODE_VERSIONS) {
				// Project requested an EOL version (e.g. Node 18)
				// Node 18 projects run best when upgraded to Node 20 LTS
				const fallbackLts = major <= 18 ? ("20" as const) : ("22" as const);
				return {
					requestedVersion: rawVersion,
					isEol: true,
					eolReason: EOL_NODE_VERSIONS[majorStr],
					resolvedVersion: fallbackLts,
					nixPackage: fallbackLts === "20" ? "nodejs_20" : "nodejs_22",
					warning: `${EOL_NODE_VERSIONS[majorStr]} Automatically upgrading runtime to supported LTS: Node.js ${fallbackLts}. To strictly run Node.js ${majorStr}, deploy using a Dockerfile.`,
				};
			}

			if (major === 20) {
				return {
					requestedVersion: rawVersion,
					isEol: false,
					resolvedVersion: "20",
					nixPackage: "nodejs_20",
				};
			}

			if (major >= 22) {
				return {
					requestedVersion: rawVersion,
					isEol: false,
					resolvedVersion: "22",
					nixPackage: "nodejs_22",
				};
			}
		}
	}

	// Default fallback: Active LTS (Node 22)
	return {
		isEol: false,
		resolvedVersion: "22",
		nixPackage: "nodejs_22",
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

	// Check explicit packageManager field in package.json
	let explicitPm: SupportedPackageManager | undefined;
	if (pkgJson.packageManager && typeof pkgJson.packageManager === "string") {
		const lowerPm = pkgJson.packageManager.toLowerCase();
		if (lowerPm.startsWith("pnpm")) explicitPm = "pnpm";
		else if (lowerPm.startsWith("bun")) explicitPm = "bun";
		else if (lowerPm.startsWith("yarn")) explicitPm = "yarn";
		else if (lowerPm.startsWith("npm")) explicitPm = "npm";
	}

	// Decision precedence:
	// 1. Explicit packageManager if it matches one of the present lockfiles
	// 2. Lockfiles priority: bun (if bun lockfile exists and scripts or deps use bun) > pnpm > yarn > npm
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
	} else if (hasPnpmLock) {
		selectedPm = "pnpm";
		selectedLockfile = "pnpm-lock.yaml";
	} else if (hasBunLock) {
		selectedPm = "bun";
		selectedLockfile = "bun.lockb";
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

/**
 * Pinned Nixpkgs revisions catalog for reproducible legacy and modern runtime support.
 * These hashes are verified snapshots from upstream Nixpkgs providing complete package sets.
 */
export const NIXPKGS_ARCHIVES = {
	/**
	 * NixOS 24.05 channel release snapshot (evaluated before Node 18 / Python 3.8 removal)
	 * Provides: Node.js 18 (18.20.x), Node.js 20, Bun (1.1.x), Python 3.8 - 3.12,
	 * PHP 8.1 - 8.3, Ruby 3.1 - 3.3, Java / OpenJDK 8, 11, 17, 21, Go 1.21 - 1.22, .NET SDK 6, 7, 8
	 */
	LEGACY_24_05: {
		commit: "b134951a4c9f3c995fd7be05f3243f8ecd65d798",
		label: "NixOS 24.05 LTS (Pinned Release)",
		tarballUrl:
			"https://github.com/NixOS/nixpkgs/archive/b134951a4c9f3c995fd7be05f3243f8ecd65d798.tar.gz",
	},
	/**
	 * NixOS 23.11 channel release snapshot for older legacy runtimes
	 * Provides: Node.js 16 (16.20.x), PHP 8.0, Ruby 3.0, Go 1.20
	 */
	LEGACY_23_11: {
		commit: "057f9aecfb71c4437d2b247823be2864e70f14b3",
		label: "NixOS 23.11 LTS (Pinned Release)",
		tarballUrl:
			"https://github.com/NixOS/nixpkgs/archive/057f9aecfb71c4437d2b247823be2864e70f14b3.tar.gz",
	},
	/**
	 * NixOS 24.11 channel release snapshot providing Node.js 22.13.1
	 * Resolves Vite 8, Rolldown 1.2+, jsdom 29+, and >=22.12.0 engine requirements
	 */
	MODERN_22_13: {
		commit: "51ad838b03a05b1de6f9f2a0fffecee64a9788ee",
		label: "NixOS 24.11 (Node.js 22.13.1)",
		tarballUrl:
			"https://github.com/NixOS/nixpkgs/archive/51ad838b03a05b1de6f9f2a0fffecee64a9788ee.tar.gz",
	},
	/**
	 * Nixpkgs snapshot providing Node.js 24.11.0 (nodejs_24)
	 * Resolves dependencies requiring >=24.11.0 on Node 24 runtime
	 */
	MODERN_24_11: {
		commit: "1d4c88323ac36805d09657d13a5273aea1b34f0c",
		label: "Nixpkgs (Node.js 24.11.0)",
		tarballUrl:
			"https://github.com/NixOS/nixpkgs/archive/1d4c88323ac36805d09657d13a5273aea1b34f0c.tar.gz",
	},
} as const;

export interface RuntimeVersionInfo {
	major: string;
	full?: string;
	isEol: boolean;
	eolDate?: string;
	eolReason?: string;
	nixPackage: string;
	archiveCommit?: string;
	archiveLabel?: string;
	isAvailable: boolean;
	unavailabilityReason?: string;
}

/**
 * Node.js Runtime Catalog
 */
export const NODE_CATALOG: Record<string, RuntimeVersionInfo> = {
	"14": {
		major: "14",
		isEol: true,
		eolDate: "2023-04-30",
		eolReason: "Node.js 14 reached End-Of-Life on 2023-04-30.",
		nixPackage: "nodejs_14",
		isAvailable: false,
		unavailabilityReason:
			"Node.js 14 has reached End-Of-Life and cannot be safely obtained from verified package sources. Please upgrade to Node.js 18, 20, or 22, or build using a custom Dockerfile.",
	},
	"16": {
		major: "16",
		isEol: true,
		eolDate: "2023-09-11",
		eolReason: "Node.js 16 reached End-Of-Life on 2023-09-11.",
		nixPackage: "nodejs_16",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_23_11.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_23_11.label,
		isAvailable: true,
	},
	"18": {
		major: "18",
		isEol: true,
		eolDate: "2025-04-30",
		eolReason:
			"Node.js 18.x reached End-Of-Life on 2025-04-30 and was removed from rolling Nixpkgs channels.",
		nixPackage: "nodejs_18",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"20": {
		major: "20",
		isEol: false,
		nixPackage: "nodejs_20",
		isAvailable: true,
	},
	"22": {
		major: "22",
		isEol: false,
		nixPackage: "nodejs_22",
		isAvailable: true,
	},
	"24": {
		major: "24",
		isEol: false,
		nixPackage: "nodejs_24",
		isAvailable: true,
	},
	"24.11": {
		major: "24",
		full: "24.11.0",
		isEol: false,
		nixPackage: "nodejs_24",
		archiveCommit: NIXPKGS_ARCHIVES.MODERN_24_11.commit,
		archiveLabel: NIXPKGS_ARCHIVES.MODERN_24_11.label,
		isAvailable: true,
	},
};

/**
 * Python Runtime Catalog
 */
export const PYTHON_CATALOG: Record<string, RuntimeVersionInfo> = {
	"3.8": {
		major: "3.8",
		isEol: true,
		eolDate: "2024-10-07",
		eolReason: "Python 3.8 reached End-Of-Life on 2024-10-07.",
		nixPackage: "python38",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"3.9": {
		major: "3.9",
		isEol: true,
		eolDate: "2025-10-05",
		eolReason: "Python 3.9 is in maintenance / security phase.",
		nixPackage: "python39",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"3.10": {
		major: "3.10",
		isEol: false,
		nixPackage: "python310",
		isAvailable: true,
	},
	"3.11": {
		major: "3.11",
		isEol: false,
		nixPackage: "python311",
		isAvailable: true,
	},
	"3.12": {
		major: "3.12",
		isEol: false,
		nixPackage: "python312",
		isAvailable: true,
	},
	"3.13": {
		major: "3.13",
		isEol: false,
		nixPackage: "python313",
		isAvailable: true,
	},
};

/**
 * PHP Runtime Catalog
 */
export const PHP_CATALOG: Record<string, RuntimeVersionInfo> = {
	"7.4": {
		major: "7.4",
		isEol: true,
		eolDate: "2022-11-28",
		eolReason: "PHP 7.4 reached End-Of-Life on 2022-11-28.",
		nixPackage: "php74",
		isAvailable: false,
		unavailabilityReason:
			"PHP 7.4 reached End-Of-Life and is no longer available safely. Please upgrade to PHP 8.1 or higher, or build using a custom Dockerfile.",
	},
	"8.0": {
		major: "8.0",
		isEol: true,
		eolDate: "2023-11-26",
		eolReason: "PHP 8.0 reached End-Of-Life on 2023-11-26.",
		nixPackage: "php80",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_23_11.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_23_11.label,
		isAvailable: true,
	},
	"8.1": {
		major: "8.1",
		isEol: true,
		eolDate: "2024-11-25",
		eolReason: "PHP 8.1 reached End-Of-Life on 2024-11-25.",
		nixPackage: "php81",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"8.2": {
		major: "8.2",
		isEol: false,
		nixPackage: "php82",
		isAvailable: true,
	},
	"8.3": {
		major: "8.3",
		isEol: false,
		nixPackage: "php83",
		isAvailable: true,
	},
	"8.4": {
		major: "8.4",
		isEol: false,
		nixPackage: "php84",
		isAvailable: true,
	},
};

/**
 * Ruby Runtime Catalog
 */
export const RUBY_CATALOG: Record<string, RuntimeVersionInfo> = {
	"2.7": {
		major: "2.7",
		isEol: true,
		eolDate: "2023-03-31",
		eolReason: "Ruby 2.7 reached End-Of-Life on 2023-03-31.",
		nixPackage: "ruby_2_7",
		isAvailable: false,
		unavailabilityReason:
			"Ruby 2.7 reached End-Of-Life and is no longer available safely. Please upgrade to Ruby 3.1+ or use a custom Dockerfile.",
	},
	"3.0": {
		major: "3.0",
		isEol: true,
		eolDate: "2024-03-31",
		eolReason: "Ruby 3.0 reached End-Of-Life on 2024-03-31.",
		nixPackage: "ruby_3_0",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_23_11.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_23_11.label,
		isAvailable: true,
	},
	"3.1": {
		major: "3.1",
		isEol: true,
		eolDate: "2025-03-31",
		eolReason: "Ruby 3.1 reached End-Of-Life on 2025-03-31.",
		nixPackage: "ruby_3_1",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"3.2": {
		major: "3.2",
		isEol: false,
		nixPackage: "ruby_3_2",
		isAvailable: true,
	},
	"3.3": {
		major: "3.3",
		isEol: false,
		nixPackage: "ruby_3_3",
		isAvailable: true,
	},
};

/**
 * Java / OpenJDK Runtime Catalog
 */
export const JAVA_CATALOG: Record<string, RuntimeVersionInfo> = {
	"8": {
		major: "8",
		isEol: true,
		eolDate: "2022-03-31",
		eolReason: "Java 8 is an older legacy LTS.",
		nixPackage: "openjdk8",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"11": {
		major: "11",
		isEol: true,
		eolDate: "2023-09-30",
		eolReason: "Java 11 is an older legacy LTS.",
		nixPackage: "openjdk11",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"17": {
		major: "17",
		isEol: false,
		nixPackage: "openjdk17",
		isAvailable: true,
	},
	"21": {
		major: "21",
		isEol: false,
		nixPackage: "openjdk21",
		isAvailable: true,
	},
};

/**
 * Go Runtime Catalog
 */
export const GO_CATALOG: Record<string, RuntimeVersionInfo> = {
	"1.18": {
		major: "1.18",
		isEol: true,
		eolReason: "Go 1.18 is End-Of-Life upstream.",
		nixPackage: "go_1_18",
		isAvailable: false,
		unavailabilityReason:
			"Go 1.18 is obsolete. Please upgrade your go.mod to Go 1.21+ or deploy via Dockerfile.",
	},
	"1.19": {
		major: "1.19",
		isEol: true,
		eolReason: "Go 1.19 is End-Of-Life upstream.",
		nixPackage: "go_1_19",
		isAvailable: false,
		unavailabilityReason:
			"Go 1.19 is obsolete. Please upgrade your go.mod to Go 1.21+ or deploy via Dockerfile.",
	},
	"1.20": {
		major: "1.20",
		isEol: true,
		eolReason: "Go 1.20 is End-Of-Life upstream.",
		nixPackage: "go_1_20",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_23_11.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_23_11.label,
		isAvailable: true,
	},
	"1.21": {
		major: "1.21",
		isEol: true,
		eolReason: "Go 1.21 is End-Of-Life upstream.",
		nixPackage: "go_1_21",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"1.22": {
		major: "1.22",
		isEol: false,
		nixPackage: "go_1_22",
		isAvailable: true,
	},
	"1.23": {
		major: "1.23",
		isEol: false,
		nixPackage: "go_1_23",
		isAvailable: true,
	},
};

/**
 * .NET SDK Catalog
 */
export const DOTNET_CATALOG: Record<string, RuntimeVersionInfo> = {
	"6.0": {
		major: "6.0",
		isEol: true,
		eolDate: "2024-11-12",
		eolReason: ".NET 6.0 reached End-Of-Life on 2024-11-12.",
		nixPackage: "dotnet-sdk_6",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"7.0": {
		major: "7.0",
		isEol: true,
		eolDate: "2024-05-14",
		eolReason: ".NET 7.0 reached End-Of-Life on 2024-05-14.",
		nixPackage: "dotnet-sdk_7",
		archiveCommit: NIXPKGS_ARCHIVES.LEGACY_24_05.commit,
		archiveLabel: NIXPKGS_ARCHIVES.LEGACY_24_05.label,
		isAvailable: true,
	},
	"8.0": {
		major: "8.0",
		isEol: false,
		nixPackage: "dotnet-sdk_8",
		isAvailable: true,
	},
	"9.0": {
		major: "9.0",
		isEol: false,
		nixPackage: "dotnet-sdk_9",
		isAvailable: true,
	},
};

/**
 * Checks organizational policy to see if legacy / EOL runtimes are permitted.
 * Configured via environment variable:
 * - ALLOW_LEGACY_RUNTIMES (default: true)
 * - HATDOT_ALLOW_EOL_RUNTIMES (default: true)
 */
export const isLegacyRuntimePermitted = (): boolean => {
	const allowLegacy = process.env.ALLOW_LEGACY_RUNTIMES;
	const allowEol = process.env.HATDOT_ALLOW_EOL_RUNTIMES;
	if (allowLegacy !== undefined && allowLegacy.toLowerCase() === "false") {
		return false;
	}
	if (allowEol !== undefined && allowEol.toLowerCase() === "false") {
		return false;
	}
	return true;
};

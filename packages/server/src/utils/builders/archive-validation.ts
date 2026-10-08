import path from "node:path";

/**
 * Pre-extraction validation for customer-supplied source archives.
 *
 * These are *safety* limits (not commercial limits). Commercial limits such as
 * storage come from the customer's plan via PlanEntitlementService.
 * Safety limits can be tuned per deployment through environment variables.
 */
export interface ArchiveSafetyLimits {
	maxFiles: number;
	maxTotalUncompressedBytes: number;
	maxSingleFileBytes: number;
	maxCompressionRatio: number;
	maxPathLength: number;
	maxDepth: number;
}

const envInt = (name: string, fallback: number) => {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const getArchiveSafetyLimits = (): ArchiveSafetyLimits => ({
	maxFiles: envInt("HATDOT_ARCHIVE_MAX_FILES", 20_000),
	maxTotalUncompressedBytes: envInt(
		"HATDOT_ARCHIVE_MAX_UNCOMPRESSED_BYTES",
		2 * 1024 * 1024 * 1024,
	),
	maxSingleFileBytes: envInt(
		"HATDOT_ARCHIVE_MAX_FILE_BYTES",
		512 * 1024 * 1024,
	),
	maxCompressionRatio: envInt("HATDOT_ARCHIVE_MAX_RATIO", 200),
	maxPathLength: 512,
	maxDepth: 40,
});

/** Minimal shape we need from an archive entry (AdmZip-compatible). */
export interface ArchiveEntryLike {
	entryName: string;
	isDirectory: boolean;
	/** Uncompressed size declared by the archive header. */
	size: number;
	/** Compressed size declared by the archive header. */
	compressedSize: number;
	/** Unix mode bits live in the high 16 bits of the external attributes. */
	externalAttributes: number;
}

export class ArchiveValidationError extends Error {
	constructor(
		/** Safe to show to customers. */
		message: string,
		public readonly code:
			| "TOO_MANY_FILES"
			| "TOO_LARGE"
			| "FILE_TOO_LARGE"
			| "COMPRESSION_BOMB"
			| "PATH_TRAVERSAL"
			| "UNSAFE_ENTRY"
			| "EMPTY"
			| "INVALID_ARCHIVE",
	) {
		super(message);
		this.name = "ArchiveValidationError";
	}
}

const S_IFMT = 0o170000;
const UNSAFE_TYPES = new Set([
	0o120000, // symlink
	0o060000, // block device
	0o020000, // char device
	0o010000, // fifo
	0o140000, // socket
]);

/**
 * Normalizes an archive entry name to a safe relative POSIX path, or throws.
 * Rejects absolute paths, drive letters, NUL bytes, and any `..` segment.
 */
export const normalizeArchivePath = (rawName: string): string => {
	if (rawName.includes("\0")) {
		throw new ArchiveValidationError(
			"Path traversal detected: resolved path escapes output directory",
			"PATH_TRAVERSAL",
		);
	}
	const name = rawName.replace(/\\/g, "/");
	if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
		throw new ArchiveValidationError(
			"Path traversal detected: resolved path escapes output directory",
			"PATH_TRAVERSAL",
		);
	}
	const segments = name.split("/").filter((s) => s !== "" && s !== ".");
	if (segments.some((s) => s === "..")) {
		throw new ArchiveValidationError(
			"Path traversal detected: resolved path escapes output directory",
			"PATH_TRAVERSAL",
		);
	}
	return segments.join("/");
};

/** True when `child` resolves inside `root` (defense in depth after normalize). */
export const isInsideDirectory = (root: string, child: string): boolean => {
	const rel = path.relative(path.resolve(root), path.resolve(child));
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export interface ArchiveValidationResult {
	fileCount: number;
	totalUncompressedBytes: number;
	/** Entries that should be extracted (junk such as __MACOSX removed). */
	entries: ArchiveEntryLike[];
}

const isJunkEntry = (name: string) =>
	name.startsWith("__MACOSX/") || name.endsWith(".DS_Store");

/**
 * Validates every entry BEFORE anything is written to disk so a bad archive
 * never leaves a half-extracted workspace behind.
 */
export const validateArchiveEntries = (
	allEntries: ArchiveEntryLike[],
	limits: ArchiveSafetyLimits = getArchiveSafetyLimits(),
): ArchiveValidationResult => {
	const entries = allEntries.filter((e) => !isJunkEntry(e.entryName));
	if (entries.length === 0) {
		throw new ArchiveValidationError(
			"The ZIP file is empty or could not be read.",
			"EMPTY",
		);
	}

	let fileCount = 0;
	let total = 0;

	for (const entry of entries) {
		const normalized = normalizeArchivePath(entry.entryName);

		if (normalized.length > limits.maxPathLength) {
			throw new ArchiveValidationError(
				"The archive contains a file path that is too long.",
				"UNSAFE_ENTRY",
			);
		}
		if (normalized.split("/").length > limits.maxDepth) {
			throw new ArchiveValidationError(
				"The archive contains folders nested too deeply.",
				"UNSAFE_ENTRY",
			);
		}

		const type = (entry.externalAttributes >>> 16) & S_IFMT;
		if (UNSAFE_TYPES.has(type)) {
			throw new ArchiveValidationError(
				"Dangerous node entries are not allowed: symlinks, hardlinks, sockets, devices, and FIFOs are forbidden.",
				"UNSAFE_ENTRY",
			);
		}

		if (entry.isDirectory) continue;

		fileCount += 1;
		if (fileCount > limits.maxFiles) {
			throw new ArchiveValidationError(
				`The archive contains too many files (limit ${limits.maxFiles}).`,
				"TOO_MANY_FILES",
			);
		}

		if (entry.size > limits.maxSingleFileBytes) {
			throw new ArchiveValidationError(
				"The archive contains a single file that is too large.",
				"FILE_TOO_LARGE",
			);
		}

		if (
			entry.compressedSize > 0 &&
			entry.size / entry.compressedSize > limits.maxCompressionRatio &&
			entry.size > 10 * 1024 * 1024
		) {
			throw new ArchiveValidationError(
				"The archive looks like a compression bomb and was rejected.",
				"COMPRESSION_BOMB",
			);
		}

		total += entry.size;
		if (total > limits.maxTotalUncompressedBytes) {
			throw new ArchiveValidationError(
				"The archive is too large once extracted.",
				"TOO_LARGE",
			);
		}
	}

	if (fileCount === 0) {
		throw new ArchiveValidationError(
			"The ZIP file contains no files.",
			"EMPTY",
		);
	}

	return { fileCount, totalUncompressedBytes: total, entries };
};

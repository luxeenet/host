import { describe, expect, it } from "vitest";
import {
	ArchiveValidationError,
	type ArchiveEntryLike,
	type ArchiveSafetyLimits,
	isInsideDirectory,
	normalizeArchivePath,
	validateArchiveEntries,
} from "@dokploy/server/utils/builders/archive-validation";

const limits: ArchiveSafetyLimits = {
	maxFiles: 5,
	maxTotalUncompressedBytes: 1000,
	maxSingleFileBytes: 600,
	maxCompressionRatio: 50,
	maxPathLength: 64,
	maxDepth: 4,
};

const file = (
	entryName: string,
	overrides: Partial<ArchiveEntryLike> = {},
): ArchiveEntryLike => ({
	entryName,
	isDirectory: false,
	size: 10,
	compressedSize: 10,
	externalAttributes: 0o100644 << 16,
	...overrides,
});

const codeOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof ArchiveValidationError ? e.code : "OTHER";
	}
	return "NONE";
};

describe("normalizeArchivePath", () => {
	it("normalizes safe relative paths", () => {
		expect(normalizeArchivePath("src/./index.ts")).toBe("src/index.ts");
		expect(normalizeArchivePath("app\\lib\\a.js")).toBe("app/lib/a.js");
	});

	it.each([
		"../../etc/passwd",
		"a/../../b",
		"a/../b/../../c",
		"..\\..\\windows\\system32",
		"/etc/passwd",
		"C:\\Windows\\x.dll",
		"evil\0.txt",
	])("rejects malicious path %j", (p) => {
		expect(codeOf(() => normalizeArchivePath(p))).toBe("PATH_TRAVERSAL");
	});
});

describe("isInsideDirectory", () => {
	it("accepts children and rejects escapes and the root itself", () => {
		expect(isInsideDirectory("/srv/app/code", "/srv/app/code/a/b.txt")).toBe(
			true,
		);
		expect(isInsideDirectory("/srv/app/code", "/srv/app/code/../x")).toBe(
			false,
		);
		expect(isInsideDirectory("/srv/app/code", "/srv/other/x")).toBe(false);
		expect(isInsideDirectory("/srv/app/code", "/srv/app/code-evil/x")).toBe(
			false,
		);
		expect(isInsideDirectory("/srv/app/code", "/srv/app/code")).toBe(false);
	});
});

describe("validateArchiveEntries", () => {
	it("accepts a normal project and ignores macOS junk", () => {
		const result = validateArchiveEntries(
			[
				file("proj/package.json"),
				file("proj/src/index.ts"),
				file("__MACOSX/proj/._package.json"),
				file("proj/.DS_Store"),
			],
			limits,
		);
		expect(result.fileCount).toBe(2);
		expect(result.entries).toHaveLength(2);
	});

	it("rejects ZIP Slip entries", () => {
		expect(
			codeOf(() =>
				validateArchiveEntries([file("../../etc/cron.d/x")], limits),
			),
		).toBe("PATH_TRAVERSAL");
	});

	it("rejects symlinks and device files", () => {
		expect(
			codeOf(() =>
				validateArchiveEntries(
					[file("link", { externalAttributes: 0o120777 << 16 })],
					limits,
				),
			),
		).toBe("UNSAFE_ENTRY");
		expect(
			codeOf(() =>
				validateArchiveEntries(
					[file("dev", { externalAttributes: 0o060000 << 16 })],
					limits,
				),
			),
		).toBe("UNSAFE_ENTRY");
	});

	it("rejects too many files", () => {
		const many = Array.from({ length: 6 }, (_, i) => file(`f${i}.txt`));
		expect(codeOf(() => validateArchiveEntries(many, limits))).toBe(
			"TOO_MANY_FILES",
		);
	});

	it("rejects a single oversized file", () => {
		expect(
			codeOf(() =>
				validateArchiveEntries(
					[file("big.bin", { size: 700, compressedSize: 700 })],
					limits,
				),
			),
		).toBe("FILE_TOO_LARGE");
	});

	it("rejects an archive too large when extracted", () => {
		const entries = [
			file("a", { size: 500, compressedSize: 500 }),
			file("b", { size: 500, compressedSize: 500 }),
			file("c", { size: 500, compressedSize: 500 }),
		];
		expect(codeOf(() => validateArchiveEntries(entries, limits))).toBe(
			"TOO_LARGE",
		);
	});

	it("rejects compression bombs", () => {
		const bomb = file("zeros.bin", {
			size: 50 * 1024 * 1024,
			compressedSize: 1024,
		});
		const bombLimits = {
			...limits,
			maxSingleFileBytes: 1e12,
			maxTotalUncompressedBytes: 1e12,
		};
		expect(codeOf(() => validateArchiveEntries([bomb], bombLimits))).toBe(
			"COMPRESSION_BOMB",
		);
	});

	it("rejects empty archives and archives with only directories", () => {
		expect(codeOf(() => validateArchiveEntries([], limits))).toBe("EMPTY");
		expect(
			codeOf(() =>
				validateArchiveEntries(
					[file("dir/", { isDirectory: true, size: 0 })],
					limits,
				),
			),
		).toBe("EMPTY");
	});

	it("rejects overly deep or long paths", () => {
		expect(
			codeOf(() => validateArchiveEntries([file("a/b/c/d/e/f.txt")], limits)),
		).toBe("UNSAFE_ENTRY");
		expect(
			codeOf(() =>
				validateArchiveEntries([file(`${"x".repeat(80)}.txt`)], limits),
			),
		).toBe("UNSAFE_ENTRY");
	});

	it("customer-facing messages never contain filesystem paths", () => {
		try {
			validateArchiveEntries([file("../../etc/passwd")], limits);
		} catch (e) {
			expect((e as Error).message).not.toMatch(/etc|passwd|\/var|\/etc/);
		}
	});
});

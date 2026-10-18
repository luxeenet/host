import { TRPCError } from "@trpc/server";
import { quote } from "shell-quote";
import type { SupportedDatabaseType } from "./database-connection";
import {
	executeInsideServiceContainer,
	extractJsonFromStdout,
	libsqlAdapter,
	mongoAdapter,
	redisAdapter,
	sqlAdapter,
} from "./database-manager";
import { sanitizeDatabaseIdentifier } from "./database-security";

export type DuplicatePolicy = "reject" | "skip" | "update";
export type RedisDataStructure = "string" | "hash" | "list" | "set" | "zset";

export interface DatabaseImportOptions {
	databaseId: string;
	engine: SupportedDatabaseType;
	targetEntity: string;
	fileContent: string;
	fileType: "csv" | "json";
	fieldMappings?: Record<string, string>; // fileHeader -> targetColumnName (or "__ignore__")
	duplicatePolicy?: DuplicatePolicy;
	database?: string;
	redisConfig?: {
		structure?: RedisDataStructure;
		keyField?: string;
		keyPrefix?: string;
		scoreField?: string;
		ttl?: number;
	};
}

export interface RowErrorDetail {
	rowNumber: number;
	row?: number;
	keyOrId?: string;
	identifier?: string;
	reason: string;
	message?: string;
	data?: any;
}

export interface DatabaseImportResult {
	success: boolean;
	totalRecords: number;
	totalRows?: number;
	insertedCount: number;
	inserted?: number;
	updatedCount: number;
	updated?: number;
	skippedCount: number;
	skipped?: number;
	failedCount: number;
	failed?: number;
	durationMs?: number;
	errors: RowErrorDetail[];
	persisted: boolean;
	summaryMessage: string;
}

export interface ParsedImportData {
	headers: string[];
	rows: Record<string, any>[];
	inferredTypes: Record<string, string>;
	totalRecords: number;
	previewRows: Record<string, any>[];
	sampleInferredTypes: Record<string, string>;
}

/* =======================================================================
 * 1. PARSING UTILITIES (RFC 4180 CSV & MULTI-FORMAT JSON)
 * ======================================================================= */

/**
 * Parses RFC 4180 compliant CSV text into structured headers and rows.
 * Handles commas inside quotes, escaped double quotes (""), multiline fields, and BOM.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, any>[] } {
	if (!text || typeof text !== "string") {
		return { headers: [], rows: [] };
	}

	const clean = text.replace(/^\uFEFF/, ""); // strip UTF-8 BOM
	const parsedRows: string[][] = [];
	let currentRow: string[] = [];
	let currentField = "";
	let inQuotes = false;
	let i = 0;

	while (i < clean.length) {
		const char = clean[i];
		const nextChar = clean[i + 1];

		if (inQuotes) {
			if (char === '"' && nextChar === '"') {
				currentField += '"';
				i += 2;
				continue;
			}
			if (char === '"') {
				inQuotes = false;
				i++;
				continue;
			}
			currentField += char;
			i++;
		} else {
			if (char === '"') {
				inQuotes = true;
				i++;
				continue;
			}
			if (char === ",") {
				currentRow.push(currentField);
				currentField = "";
				i++;
				continue;
			}
			if (char === "\r" && nextChar === "\n") {
				currentRow.push(currentField);
				currentField = "";
				parsedRows.push(currentRow);
				currentRow = [];
				i += 2;
				continue;
			}
			if (char === "\n" || char === "\r") {
				currentRow.push(currentField);
				currentField = "";
				parsedRows.push(currentRow);
				currentRow = [];
				i++;
				continue;
			}
			currentField += char;
			i++;
		}
	}

	if (currentField.length > 0 || currentRow.length > 0) {
		currentRow.push(currentField);
		parsedRows.push(currentRow);
	}

	// Filter out purely empty lines
	const nonEmptyRows = parsedRows.filter((r) =>
		r.some((field) => field.trim().length > 0),
	);

	if (nonEmptyRows.length === 0) {
		return { headers: [], rows: [] };
	}

	// First row is headers
	const headers = nonEmptyRows[0]!.map((h) => h.trim());
	const rows = nonEmptyRows.slice(1).map((r) => {
		const obj: Record<string, any> = {};
		headers.forEach((h, idx) => {
			obj[h] = r[idx] !== undefined ? r[idx] : "";
		});
		return obj;
	});

	return { headers, rows };
}

/**
 * Parses JSON records from either an array of objects `[{...}, ...]`,
 * a single object `{...}`, or JSON Lines (NDJSON: newline-delimited JSON objects).
 */
export function parseJsonRecords(text: string): { headers: string[]; rows: Record<string, any>[] } {
	if (!text || typeof text !== "string") {
		return { headers: [], rows: [] };
	}

	const trimmed = text.trim();
	let parsed: any;

	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		parsed = JSON.parse(trimmed);
	} else if (trimmed.startsWith("{") && trimmed.endsWith("}") && !trimmed.includes("\n{")) {
		parsed = [JSON.parse(trimmed)];
	} else {
		// Newline-delimited JSON (NDJSON)
		const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
		parsed = lines.map((line, idx) => {
			try {
				return JSON.parse(line);
			} catch (err: any) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid JSON line at row ${idx + 1}: ${err.message}`,
				});
			}
		});
	}

	if (!Array.isArray(parsed) || parsed.length === 0) {
		return { headers: [], rows: [] };
	}

	// Collect all unique keys for headers across all objects
	const headerSet = new Set<string>();
	parsed.forEach((row) => {
		if (row && typeof row === "object" && !Array.isArray(row)) {
			Object.keys(row).forEach((k) => headerSet.add(k));
		}
	});

	const headers = Array.from(headerSet);
	return { headers, rows: parsed };
}

/**
 * Infers logical data types for previewing and smart schema mapping.
 */
export function inferFieldType(sampleValues: any[]): string {
	const nonNull = sampleValues.filter(
		(v) => v !== null && v !== undefined && v !== "",
	);
	if (nonNull.length === 0) return "text";

	let allInt = true;
	let allFloat = true;
	let allBool = true;
	let allDate = true;
	let allJson = true;

	for (const val of nonNull) {
		const str = String(val).trim();

		// Boolean check
		if (
			str.toLowerCase() !== "true" &&
			str.toLowerCase() !== "false" &&
			str !== "0" &&
			str !== "1"
		) {
			allBool = false;
		}

		// Integer check
		if (!/^-?\d+$/.test(str)) {
			allInt = false;
		}

		// Float check
		if (Number.isNaN(Number(str))) {
			allFloat = false;
		}

		// Date check
		const dateNum = Date.parse(str);
		if (Number.isNaN(dateNum) || !str.includes("-")) {
			allDate = false;
		}

		// JSON check
		if (!((str.startsWith("{") && str.endsWith("}")) || (str.startsWith("[") && str.endsWith("]")))) {
			allJson = false;
		}
	}

	if (allBool) return "boolean";
	if (allInt) return "integer";
	if (allFloat) return "numeric";
	if (allDate) return "timestamp";
	if (allJson) return "json";
	return "text";
}

/**
 * Previews import data, infers headers and types, and provides suggested column mappings.
 */
export function previewImport(
	fileContent: string,
	fileType: "csv" | "json",
): ParsedImportData {
	const { headers, rows } =
		fileType === "csv" ? parseCsv(fileContent) : parseJsonRecords(fileContent);

	const inferredTypes: Record<string, string> = {};
	headers.forEach((h) => {
		const samples = rows.slice(0, 10).map((r) => r[h]);
		inferredTypes[h] = inferFieldType(samples);
	});

	return {
		headers,
		rows: rows.slice(0, 10),
		inferredTypes,
		totalRecords: rows.length,
		previewRows: rows.slice(0, 10),
		sampleInferredTypes: inferredTypes,
	};
}

/* =======================================================================
 * 2. SCHEMA-AWARE VALUE CONVERTER
 * ======================================================================= */

/**
 * Safely converts an input raw value into the target database column's expected SQL representation.
 */
export function convertSqlValue(
	rawValue: any,
	columnMeta?:
		| string
		| { type?: string; isNullable?: boolean; defaultValue?: string },
	engine: "postgres" | "mysql" | "mariadb" | "libsql" = "postgres",
): { valueSql: string; isValid: boolean; error?: string } {
	const meta =
		typeof columnMeta === "string" ? { type: columnMeta } : columnMeta;

	if (rawValue === null || rawValue === undefined || rawValue === "") {
		if (meta?.isNullable === false && !meta?.defaultValue) {
			return {
				valueSql: "NULL",
				isValid: false,
				error: "Value cannot be null for non-nullable column.",
			};
		}
		return { valueSql: "NULL", isValid: true };
	}

	const colType = (meta?.type || "").toLowerCase();

	if (typeof rawValue === "object") {
		const jsonStr = JSON.stringify(rawValue).replace(/'/g, "''");
		return {
			valueSql: `'${jsonStr}'`,
			isValid: true,
		};
	}

	const str = String(rawValue).trim();

	// 1. Boolean types
	if (
		colType.includes("bool") ||
		(engine !== "postgres" &&
			(colType.includes("tinyint(1)") || colType === "tinyint"))
	) {
		const lower = str.toLowerCase();
		if (["true", "1", "t", "yes", "y"].includes(lower)) {
			return {
				valueSql:
					engine === "postgres" || engine === "libsql" ? "TRUE" : "1",
				isValid: true,
			};
		}
		if (["false", "0", "f", "no", "n"].includes(lower)) {
			return {
				valueSql:
					engine === "postgres" || engine === "libsql" ? "FALSE" : "0",
				isValid: true,
			};
		}
		return {
			valueSql: "NULL",
			isValid: false,
			error: `Invalid boolean representation: '${str}'`,
		};
	}

	// 2. Integer types
	if (
		colType.includes("int") ||
		colType.includes("serial") ||
		colType.includes("bigint") ||
		colType.includes("smallint")
	) {
		const cleanInt = str.replace(/,/g, "");
		if (/^-?\d+$/.test(cleanInt)) {
			return { valueSql: cleanInt, isValid: true };
		}
		return {
			valueSql: "NULL",
			isValid: false,
			error: `Invalid integer: '${str}'`,
		};
	}

	// 3. Numeric / Decimal / Float types
	if (
		colType.includes("numeric") ||
		colType.includes("decimal") ||
		colType.includes("float") ||
		colType.includes("double") ||
		colType.includes("real")
	) {
		const cleanNum = str.replace(/,/g, "");
		const num = Number(cleanNum);
		if (!Number.isNaN(num)) {
			return {
				valueSql: colType.includes("float") || colType.includes("double") ? String(num) : cleanNum,
				isValid: true,
			};
		}
		return {
			valueSql: "NULL",
			isValid: false,
			error: `Invalid decimal or numeric value: '${str}'`,
		};
	}

	// 4. JSON / JSONB types
	if (colType.includes("json")) {
		try {
			const jsonStr = typeof rawValue === "object" ? JSON.stringify(rawValue) : JSON.stringify(JSON.parse(str));
			const escaped = jsonStr.replace(/'/g, "''");
			return {
				valueSql: engine === "postgres" ? `'${escaped}'::jsonb` : `'${escaped}'`,
				isValid: true,
			};
		} catch {
			const escaped = str.replace(/'/g, "''");
			return {
				valueSql: engine === "postgres" ? `'${escaped}'::jsonb` : `'${escaped}'`,
				isValid: false,
				error: `Invalid JSON payload: '${str}'`,
			};
		}
	}

	// 5. Default text / varchar / string representation
	const escaped = str.replace(/'/g, "''");
	return {
		valueSql: `'${escaped}'`,
		isValid: true,
	};
}

/* =======================================================================
 * 3. ENGINE-SPECIFIC IMPORTERS
 * ======================================================================= */

/**
 * PostgreSQL Data Import with schema awareness, transactions, and duplicate handling.
 */
export async function importPostgres(
	record: any,
	tableName: string,
	rows: Record<string, any>[],
	fieldMappings: Record<string, string>,
	duplicatePolicy: DuplicatePolicy = "skip",
	database?: string,
): Promise<DatabaseImportResult> {
	const safeTable = sanitizeDatabaseIdentifier(tableName);
	let schema: any = { columns: [] };
	try {
		schema = await sqlAdapter.getTableSchema(record, "postgres", safeTable, database);
	} catch {
		// Introspection fallback if container not reachable or empty schema
	}
	const columnMap = new Map<string, any>();
	const primaryKeys: string[] = [];

	(schema.columns || []).forEach((c: any) => {
		columnMap.set(c.name, c);
		if (c.isPrimary) {
			primaryKeys.push(c.name);
		}
	});

	// Filter and map columns
	const targetCols: string[] = [];
	const sourceCols: string[] = [];

	Object.entries(fieldMappings).forEach(([source, target]) => {
		if (target && target !== "__ignore__") {
			const cleanTarget = sanitizeDatabaseIdentifier(target);
			if (cleanTarget && (columnMap.size === 0 || columnMap.has(cleanTarget))) {
				sourceCols.push(source);
				targetCols.push(cleanTarget);
			}
		}
	});

	if (targetCols.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No valid column mappings matching table schema were specified.",
		});
	}

	const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
	const targetDb = sanitizeDatabaseIdentifier(database || databaseName || "postgres");

	let insertedCount = 0;
	let updatedCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	const errors: RowErrorDetail[] = [];

	// Process in bounded batches (max 100 rows per batch)
	const batchSize = 100;
	for (let b = 0; b < rows.length; b += batchSize) {
		const chunk = rows.slice(b, b + batchSize);
		const validRowsSql: string[] = [];
		const rowIndices: number[] = [];

		chunk.forEach((row, idx) => {
			const rowNum = b + idx + 1;
			const values: string[] = [];
			let rowValid = true;

			for (let i = 0; i < targetCols.length; i++) {
				const sCol = sourceCols[i]!;
				const tCol = targetCols[i]!;
				const meta = columnMap.get(tCol);
				const converted = convertSqlValue(row[sCol], meta, "postgres");
				if (!converted.isValid) {
					errors.push({
						rowNumber: rowNum,
						reason: `Column '${tCol}': ${converted.error}`,
						data: row,
					});
					rowValid = false;
					break;
				}
				values.push(converted.valueSql);
			}

			if (rowValid) {
				validRowsSql.push(`(${values.join(", ")})`);
				rowIndices.push(rowNum);
			} else {
				failedCount++;
			}
		});

		if (validRowsSql.length === 0) continue;

		const colList = targetCols.map((c) => `"${c}"`).join(", ");
		let conflictClause = "";

		if (primaryKeys.length > 0) {
			const pkList = primaryKeys.map((k) => `"${k}"`).join(", ");
			if (duplicatePolicy === "skip") {
				conflictClause = `ON CONFLICT (${pkList}) DO NOTHING`;
			} else if (duplicatePolicy === "update") {
				const nonPkCols = targetCols.filter((c) => !primaryKeys.includes(c));
				if (nonPkCols.length > 0) {
					const updateSet = nonPkCols
						.map((c) => `"${c}" = EXCLUDED."${c}"`)
						.join(", ");
					conflictClause = `ON CONFLICT (${pkList}) DO UPDATE SET ${updateSet}`;
				} else {
					conflictClause = `ON CONFLICT (${pkList}) DO NOTHING`;
				}
			}
		}

		const sql = `
		BEGIN;
		WITH inserted AS (
			INSERT INTO "${safeTable}" (${colList})
			VALUES ${validRowsSql.join(", ")}
			${conflictClause}
			RETURNING 1
		)
		SELECT count(*) FROM inserted;
		COMMIT;
		`.trim();

		const cmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([sql])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const lines = res.stdout.trim().split("\n").filter(Boolean);
			const countVal = Number.parseInt(lines[lines.length - 1] || "0", 10);
			const count = Number.isNaN(countVal) ? validRowsSql.length : countVal;

			if (duplicatePolicy === "update") {
				updatedCount += count;
			} else {
				insertedCount += count;
				skippedCount += validRowsSql.length - count;
			}
		} catch (err: any) {
			if (duplicatePolicy === "reject") {
				failedCount += validRowsSql.length;
				rowIndices.forEach((num) => {
					errors.push({
						rowNumber: num,
						reason: err.message || "Batch rejected due to duplicate or constraint violation.",
					});
				});
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Import batch rejected: ${err.message}`,
				});
			} else {
				// Retry row-by-row on partial failure
				for (let i = 0; i < validRowsSql.length; i++) {
					const singleRowSql = validRowsSql[i]!;
					const singleIndex = rowIndices[i]!;
					const singleCmdSql = `INSERT INTO "${safeTable}" (${colList}) VALUES ${singleRowSql} ${conflictClause};`;
					const singleCmd = `env PGPASSWORD=${quote([databasePassword])} psql -U ${quote([databaseUser])} -d ${quote([targetDb])} -X -t -A -c ${quote([singleCmdSql])}`;
					try {
						await executeInsideServiceContainer(appName, serverId, singleCmd);
						insertedCount++;
					} catch (rowErr: any) {
						failedCount++;
						errors.push({
							rowNumber: singleIndex,
							reason: rowErr.message || "Constraint violation on row insert.",
						});
					}
				}
			}
		}
	}

	const persisted = insertedCount > 0 || updatedCount > 0;
	return {
		success: persisted && failedCount === 0,
		totalRecords: rows.length,
		insertedCount,
		updatedCount,
		skippedCount,
		failedCount,
		errors,
		persisted,
		summaryMessage: `PostgreSQL import complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`,
	};
}

/**
 * MySQL & MariaDB Data Import with schema awareness and duplicate handling.
 */
export async function importMySql(
	record: any,
	engine: "mysql" | "mariadb",
	tableName: string,
	rows: Record<string, any>[],
	fieldMappings: Record<string, string>,
	duplicatePolicy: DuplicatePolicy = "skip",
	database?: string,
): Promise<DatabaseImportResult> {
	const safeTable = sanitizeDatabaseIdentifier(tableName);
	let schema: any = { columns: [] };
	try {
		schema = await sqlAdapter.getTableSchema(record, engine, safeTable, database);
	} catch {
		// Introspection fallback if container not reachable or empty schema
	}
	const columnMap = new Map<string, any>();
	const primaryKeys: string[] = [];

	(schema.columns || []).forEach((c: any) => {
		columnMap.set(c.name, c);
		if (c.isPrimary) {
			primaryKeys.push(c.name);
		}
	});

	const targetCols: string[] = [];
	const sourceCols: string[] = [];

	Object.entries(fieldMappings).forEach(([source, target]) => {
		if (target && target !== "__ignore__") {
			const cleanTarget = sanitizeDatabaseIdentifier(target);
			if (cleanTarget && (columnMap.size === 0 || columnMap.has(cleanTarget))) {
				sourceCols.push(source);
				targetCols.push(cleanTarget);
			}
		}
	});

	if (targetCols.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No valid column mappings matching table schema were specified.",
		});
	}

	const { appName, serverId, databaseUser, databasePassword, databaseName } = record;
	const targetDb = sanitizeDatabaseIdentifier(database || databaseName || "");

	let insertedCount = 0;
	let updatedCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	const errors: RowErrorDetail[] = [];

	const batchSize = 100;
	for (let b = 0; b < rows.length; b += batchSize) {
		const chunk = rows.slice(b, b + batchSize);
		const validRowsSql: string[] = [];
		const rowIndices: number[] = [];

		chunk.forEach((row, idx) => {
			const rowNum = b + idx + 1;
			const values: string[] = [];
			let rowValid = true;

			for (let i = 0; i < targetCols.length; i++) {
				const sCol = sourceCols[i]!;
				const tCol = targetCols[i]!;
				const meta = columnMap.get(tCol);
				const converted = convertSqlValue(row[sCol], meta, engine);
				if (!converted.isValid) {
					errors.push({
						rowNumber: rowNum,
						reason: `Column '${tCol}': ${converted.error}`,
						data: row,
					});
					rowValid = false;
					break;
				}
				values.push(converted.valueSql);
			}

			if (rowValid) {
				validRowsSql.push(`(${values.join(", ")})`);
				rowIndices.push(rowNum);
			} else {
				failedCount++;
			}
		});

		if (validRowsSql.length === 0) continue;

		const colList = targetCols.map((c) => `\`${c}\``).join(", ");
		let insertKeyword = "INSERT INTO";
		let duplicateClause = "";

		if (duplicatePolicy === "skip") {
			insertKeyword = "INSERT IGNORE INTO";
		} else if (duplicatePolicy === "update") {
			insertKeyword = "INSERT INTO";
			const updateCols = targetCols.filter((c) => !primaryKeys.includes(c));
			if (updateCols.length > 0) {
				duplicateClause = `ON DUPLICATE KEY UPDATE ${updateCols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ")}`;
			}
		}

		const sql = `${insertKeyword} \`${safeTable}\` (${colList}) VALUES ${validRowsSql.join(", ")} ${duplicateClause};`;
		const cmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([sql])}`;

		try {
			await executeInsideServiceContainer(appName, serverId, cmd);
			if (duplicatePolicy === "update") {
				updatedCount += validRowsSql.length;
			} else {
				insertedCount += validRowsSql.length;
			}
		} catch (err: any) {
			if (duplicatePolicy === "reject") {
				failedCount += validRowsSql.length;
				rowIndices.forEach((num) => {
					errors.push({
						rowNumber: num,
						reason: err.message || "MySQL/MariaDB insert constraint rejected.",
					});
				});
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Import batch rejected: ${err.message}`,
				});
			} else {
				// Retry row-by-row
				for (let i = 0; i < validRowsSql.length; i++) {
					const singleRowSql = validRowsSql[i]!;
					const singleNum = rowIndices[i]!;
					const singleCmd = `mysql -u ${quote([databaseUser])} -p${quote([databasePassword])} ${quote([targetDb])} -e ${quote([`${insertKeyword} \`${safeTable}\` (${colList}) VALUES ${singleRowSql} ${duplicateClause};`])}`;
					try {
						await executeInsideServiceContainer(appName, serverId, singleCmd);
						insertedCount++;
					} catch (rowErr: any) {
						failedCount++;
						errors.push({
							rowNumber: singleNum,
							reason: rowErr.message || "Row insert constraint violation.",
						});
					}
				}
			}
		}
	}

	const persisted = insertedCount > 0 || updatedCount > 0;
	return {
		success: persisted && failedCount === 0,
		totalRecords: rows.length,
		insertedCount,
		updatedCount,
		skippedCount,
		failedCount,
		errors,
		persisted,
		summaryMessage: `${engine.toUpperCase()} import complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`,
	};
}

/**
 * LibSQL (sqld) Data Import via HTTP Pipeline API.
 */
export async function importLibSql(
	record: any,
	tableName: string,
	rows: Record<string, any>[],
	fieldMappings: Record<string, string>,
	duplicatePolicy: DuplicatePolicy = "skip",
): Promise<DatabaseImportResult> {
	const safeTable = sanitizeDatabaseIdentifier(tableName);
	let schema: any = { columns: [] };
	try {
		schema = await libsqlAdapter.getTableSchema(record, safeTable);
	} catch {
		// Introspection fallback if container not reachable or empty schema
	}
	const columnMap = new Map<string, any>();

	(schema.columns || []).forEach((c: any) => {
		columnMap.set(c.name, c);
	});

	const targetCols: string[] = [];
	const sourceCols: string[] = [];

	Object.entries(fieldMappings).forEach(([source, target]) => {
		if (target && target !== "__ignore__") {
			const cleanTarget = sanitizeDatabaseIdentifier(target);
			if (cleanTarget && (columnMap.size === 0 || columnMap.has(cleanTarget))) {
				sourceCols.push(source);
				targetCols.push(cleanTarget);
			}
		}
	});

	if (targetCols.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No valid column mappings matching table schema were specified.",
		});
	}

	const { appName, serverId } = record;

	let insertedCount = 0;
	let updatedCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	const errors: RowErrorDetail[] = [];

	const colList = targetCols.map((c) => `"${c}"`).join(", ");
	let insertVerb = "INSERT INTO";
	if (duplicatePolicy === "skip") {
		insertVerb = "INSERT OR IGNORE INTO";
	} else if (duplicatePolicy === "update") {
		insertVerb = "INSERT OR REPLACE INTO";
	}

	const batchSize = 100;
	for (let b = 0; b < rows.length; b += batchSize) {
		const chunk = rows.slice(b, b + batchSize);
		const requests: any[] = [];
		const rowIndices: number[] = [];

		chunk.forEach((row, idx) => {
			const rowNum = b + idx + 1;
			const values: string[] = [];
			let rowValid = true;

			for (let i = 0; i < targetCols.length; i++) {
				const sCol = sourceCols[i]!;
				const tCol = targetCols[i]!;
				const meta = columnMap.get(tCol);
				const converted = convertSqlValue(row[sCol], meta, "libsql");
				if (!converted.isValid) {
					errors.push({
						rowNumber: rowNum,
						reason: `Column '${tCol}': ${converted.error}`,
						data: row,
					});
					rowValid = false;
					break;
				}
				values.push(converted.valueSql);
			}

			if (rowValid) {
				const sql = `${insertVerb} "${safeTable}" (${colList}) VALUES (${values.join(", ")});`;
				requests.push({ type: "execute", stmt: { sql } });
				rowIndices.push(rowNum);
			} else {
				failedCount++;
			}
		});

		if (requests.length === 0) continue;

		const cmd = `curl -s -X POST http://127.0.0.1:8080/v1/pipeline -H "Content-Type: application/json" -d ${quote([
			JSON.stringify({ requests }),
		])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = JSON.parse(res.stdout);
			const results = parsed?.results || [];

			results.forEach((resObj: any, idx: number) => {
				const rowNum = rowIndices[idx] || b + idx + 1;
				if (resObj?.type === "ok") {
					const affected = resObj?.response?.result?.rows_affected || 0;
					if (affected > 0) {
						if (duplicatePolicy === "update") updatedCount++;
						else insertedCount++;
					} else {
						skippedCount++;
					}
				} else {
					failedCount++;
					errors.push({
						rowNumber: rowNum,
						reason: resObj?.error?.message || "LibSQL pipeline execution error.",
					});
				}
			});
		} catch (err: any) {
			failedCount += requests.length;
			rowIndices.forEach((num) => {
				errors.push({
					rowNumber: num,
					reason: err.message || "Failed to execute LibSQL batch pipeline.",
				});
			});
		}
	}

	const persisted = insertedCount > 0 || updatedCount > 0;
	return {
		success: persisted && failedCount === 0,
		totalRecords: rows.length,
		insertedCount,
		updatedCount,
		skippedCount,
		failedCount,
		errors,
		persisted,
		summaryMessage: `LibSQL import complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`,
	};
}

/**
 * MongoDB Documents and CSV Import with JSON validation and duplicate handling.
 */
export async function importMongo(
	record: any,
	collectionName: string,
	rows: Record<string, any>[],
	fieldMappings: Record<string, string>,
	duplicatePolicy: DuplicatePolicy = "skip",
	database?: string,
): Promise<DatabaseImportResult> {
	const safeCollection = sanitizeDatabaseIdentifier(collectionName);
	if (!safeCollection) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid target collection identifier.",
		});
	}

	// Transform rows according to fieldMappings
	const docsToInsert: any[] = [];
	const errors: RowErrorDetail[] = [];

	rows.forEach((row, idx) => {
		const doc: Record<string, any> = {};
		let hasField = false;

		Object.entries(row).forEach(([srcKey, val]) => {
			const targetKey = fieldMappings[srcKey] !== undefined ? fieldMappings[srcKey] : srcKey;
			if (targetKey && targetKey !== "__ignore__") {
				const cleanKey = sanitizeDatabaseIdentifier(targetKey);
				if (cleanKey) {
					// Attempt JSON parsing for nested strings
					if (
						typeof val === "string" &&
						((val.startsWith("{") && val.endsWith("}")) ||
							(val.startsWith("[") && val.endsWith("]")))
					) {
						try {
							doc[cleanKey] = JSON.parse(val);
						} catch {
							doc[cleanKey] = val;
						}
					} else {
						doc[cleanKey] = val;
					}
					hasField = true;
				}
			}
		});

		if (hasField) {
			docsToInsert.push(doc);
		} else {
			errors.push({
				rowNumber: idx + 1,
				reason: "Document had no fields mapped to target collection.",
			});
		}
	});

	if (docsToInsert.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No valid documents remained after field mapping.",
		});
	}

	const { appName, serverId, databaseUser, databasePassword } = record;
	const authDb = record.authSource || "admin";
	const targetDb = sanitizeDatabaseIdentifier(database || record.databaseName || "app");

	let insertedCount = 0;
	let updatedCount = 0;
	let skippedCount = 0;
	let failedCount = 0;

	// Execute inside container via mongosh script in chunks of 500
	const batchSize = 500;
	for (let b = 0; b < docsToInsert.length; b += batchSize) {
		const chunk = docsToInsert.slice(b, b + batchSize);
		const script = `
		(function() {
			try {
				const col = db.getSiblingDB(${JSON.stringify(targetDb)}).getCollection(${JSON.stringify(safeCollection)});
				const docs = ${JSON.stringify(chunk)};
				const policy = ${JSON.stringify(duplicatePolicy)};

				let ins = 0;
				let upd = 0;
				let skp = 0;
				let fld = 0;
				const errs = [];

				if (policy === 'update') {
					for (let i = 0; i < docs.length; i++) {
						const d = docs[i];
						try {
							if (d._id) {
								const res = col.replaceOne({ _id: d._id }, d, { upsert: true });
								if (res.upsertedCount > 0) ins++;
								else if (res.modifiedCount > 0 || res.matchedCount > 0) upd++;
								else ins++;
							} else {
								col.insertOne(d);
								ins++;
							}
						} catch(e) {
							fld++;
							errs.push({ rowNumber: ${b} + i + 1, reason: e.message });
						}
					}
				} else {
					const isOrdered = policy === 'reject';
					try {
						const res = col.insertMany(docs, { ordered: isOrdered });
						ins += (res.insertedIds ? Object.keys(res.insertedIds).length : docs.length);
					} catch(e) {
						if (e.writeErrors) {
							e.writeErrors.forEach(we => {
								if (we.code === 11000 && policy === 'skip') {
									skp++;
								} else {
									fld++;
									errs.push({ rowNumber: ${b} + we.index + 1, reason: we.errmsg });
								}
							});
							if (e.result && e.result.nInserted) {
								ins += e.result.nInserted;
							}
						} else {
							fld += docs.length;
							errs.push({ rowNumber: ${b} + 1, reason: e.message });
						}
					}
				}

				print(JSON.stringify({
					inserted: ins,
					updated: upd,
					skipped: skp,
					failed: fld,
					errors: errs,
				}));
			} catch(globalErr) {
				print(JSON.stringify({ error: globalErr.message }));
			}
		})();
		`.trim();

		const cmd = `mongosh "mongodb://${quote([databaseUser])}:${quote([databasePassword])}@127.0.0.1:27017/?authSource=${quote([authDb])}" --quiet --eval ${quote([script])}`;

		try {
			const res = await executeInsideServiceContainer(appName, serverId, cmd);
			const parsed = extractJsonFromStdout(res.stdout);
			if (parsed.error) {
				failedCount += chunk.length;
				errors.push({
					rowNumber: b + 1,
					reason: parsed.error,
				});
			} else {
				insertedCount += parsed.inserted || 0;
				updatedCount += parsed.updated || 0;
				skippedCount += parsed.skipped || 0;
				failedCount += parsed.failed || 0;
				if (Array.isArray(parsed.errors)) {
					errors.push(...parsed.errors);
				}
			}
		} catch (err: any) {
			failedCount += chunk.length;
			errors.push({
				rowNumber: b + 1,
				reason: err.message || "Failed to execute MongoDB batch insertion.",
			});
		}
	}

	const persisted = insertedCount > 0 || updatedCount > 0;
	return {
		success: persisted && failedCount === 0,
		totalRecords: rows.length,
		insertedCount,
		updatedCount,
		skippedCount,
		failedCount,
		errors,
		persisted,
		summaryMessage: `MongoDB import complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`,
	};
}

/**
 * Redis Key/Value and Structure Import.
 * Supports Strings, Hashes, Lists, Sets, and Sorted Sets.
 */
export async function importRedis(
	record: any,
	rows: Record<string, any>[],
	redisConfig: DatabaseImportOptions["redisConfig"] = {},
	duplicatePolicy: DuplicatePolicy = "skip",
): Promise<DatabaseImportResult> {
	const structure: RedisDataStructure = redisConfig?.structure || "hash";
	const keyPrefix = redisConfig?.keyPrefix || "";
	const keyField = redisConfig?.keyField || "id";
	const scoreField = redisConfig?.scoreField || "score";
	const ttl = redisConfig?.ttl;

	const { appName, serverId, databasePassword } = record;
	const auth = databasePassword ? `-a ${quote([databasePassword])} ` : "";

	let insertedCount = 0;
	let updatedCount = 0;
	let skippedCount = 0;
	let failedCount = 0;
	const errors: RowErrorDetail[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		const rowNum = i + 1;

		try {
			if (structure === "hash") {
				// Each row becomes a Redis Hash
				const keyVal = row[keyField] ?? rowNum;
				const fullKey = `${keyPrefix}${keyVal}`;

				// Check existing key for duplicate policy
				if (duplicatePolicy === "skip") {
					const existsCmd = `redis-cli ${auth}EXISTS ${quote([fullKey])}`;
					const exRes = await executeInsideServiceContainer(appName, serverId, existsCmd);
					if (exRes.stdout.trim() === "1") {
						skippedCount++;
						continue;
					}
				}

				const fieldValPairs: string[] = [];
				Object.entries(row).forEach(([f, v]) => {
					if (f && f !== "__ignore__") {
						fieldValPairs.push(quote([f]));
						fieldValPairs.push(quote([typeof v === "object" ? JSON.stringify(v) : String(v ?? "")]));
					}
				});

				if (fieldValPairs.length === 0) {
					skippedCount++;
					continue;
				}

				const hsetCmd = `redis-cli ${auth}HSET ${quote([fullKey])} ${fieldValPairs.join(" ")}`;
				await executeInsideServiceContainer(appName, serverId, hsetCmd);

				if (ttl && ttl > 0) {
					await executeInsideServiceContainer(
						appName,
						serverId,
						`redis-cli ${auth}EXPIRE ${quote([fullKey])} ${ttl}`,
					);
				}

				insertedCount++;
			} else if (structure === "string") {
				// Each row becomes a Redis String
				const keyVal = row[keyField] ?? rowNum;
				const fullKey = `${keyPrefix}${keyVal}`;
				const valueStr =
					Object.keys(row).length === 1
						? String(Object.values(row)[0] ?? "")
						: JSON.stringify(row);

				let setOpts = "";
				if (duplicatePolicy === "skip") setOpts = "NX";
				else if (duplicatePolicy === "update") setOpts = "XX";

				const exOpt = ttl && ttl > 0 ? `EX ${ttl}` : "";
				const setCmd = `redis-cli ${auth}SET ${quote([fullKey])} ${quote([valueStr])} ${setOpts} ${exOpt}`.trim();
				const res = await executeInsideServiceContainer(appName, serverId, setCmd);

				if (res.stdout.trim() === "OK") {
					insertedCount++;
				} else if (duplicatePolicy === "skip") {
					skippedCount++;
				} else {
					failedCount++;
					errors.push({
						rowNumber: rowNum,
						reason: "Failed to set string key (condition not met).",
					});
				}
			} else if (structure === "list") {
				// Push row payload into list key
				const fullKey = keyPrefix || "items";
				const valueStr =
					Object.keys(row).length === 1
						? String(Object.values(row)[0] ?? "")
						: JSON.stringify(row);

				const rpushCmd = `redis-cli ${auth}RPUSH ${quote([fullKey])} ${quote([valueStr])}`;
				await executeInsideServiceContainer(appName, serverId, rpushCmd);
				insertedCount++;
			} else if (structure === "set") {
				// Add member to Set
				const fullKey = keyPrefix || "set:items";
				const valueStr =
					Object.keys(row).length === 1
						? String(Object.values(row)[0] ?? "")
						: JSON.stringify(row);

				const saddCmd = `redis-cli ${auth}SADD ${quote([fullKey])} ${quote([valueStr])}`;
				const res = await executeInsideServiceContainer(appName, serverId, saddCmd);
				if (res.stdout.includes("1")) {
					insertedCount++;
				} else {
					skippedCount++; // already in set
				}
			} else if (structure === "zset") {
				// Add member with score to Sorted Set
				const fullKey = keyPrefix || "zset:items";
				const score = Number(row[scoreField] ?? rowNum);
				const memberStr =
					row[keyField] !== undefined
						? String(row[keyField])
						: JSON.stringify(row);

				const zaddCmd = `redis-cli ${auth}ZADD ${quote([fullKey])} ${Number.isNaN(score) ? 0 : score} ${quote([memberStr])}`;
				const res = await executeInsideServiceContainer(appName, serverId, zaddCmd);
				if (res.stdout.includes("1")) {
					insertedCount++;
				} else {
					updatedCount++; // score updated
				}
			}
		} catch (err: any) {
			failedCount++;
			errors.push({
				rowNumber: rowNum,
				reason: err.message || "Redis operation error.",
			});
		}
	}

	const persisted =
		insertedCount > 0 ||
		updatedCount > 0 ||
		(duplicatePolicy === "skip" && skippedCount > 0);
	return {
		success: persisted && failedCount === 0,
		totalRecords: rows.length,
		insertedCount,
		updatedCount,
		skippedCount,
		failedCount,
		errors,
		persisted,
		summaryMessage: `Redis import complete (${structure}): ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`,
	};
}

/* =======================================================================
 * 4. UNIVERSAL DISPATCHER
 * ======================================================================= */

/**
 * Universal dispatcher that authorizes, parses, validates, and imports data
 * into ANY of the 6 supported database engines.
 */
export async function executeDatabaseImport(
	record: any,
	options: DatabaseImportOptions,
): Promise<DatabaseImportResult> {
	const startTime = Date.now();
	const { engine, fileContent, fileType, targetEntity } = options;

	// Validate target entity name against arbitrary injection
	if (!targetEntity || !/^[a-zA-Z0-9_.:-]+$/.test(targetEntity.trim())) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid target identifier '${targetEntity}'. Target table or collection name contains illegal characters.`,
		});
	}

	// Enforce file size limit: 10MB
	if (!fileContent || fileContent.length > 10 * 1024 * 1024) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Import file exceeds maximum allowed limit of 10 MB.",
		});
	}

	// Parse records
	const { headers, rows } =
		fileType === "csv" ? parseCsv(fileContent) : parseJsonRecords(fileContent);

	if (rows.length === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The provided import file contains no data records.",
		});
	}

	// Enforce record count limit: 5,000 records per operation
	if (rows.length > 5000) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Import contains ${rows.length} records. Maximum allowed per operation is 5,000 records.`,
		});
	}

	const fieldMappings = options.fieldMappings || {};
	// Default mapping: 1-to-1 if not provided
	headers.forEach((h) => {
		if (fieldMappings[h] === undefined) {
			fieldMappings[h] = h;
		}
	});

	const duplicatePolicy: DuplicatePolicy = options.duplicatePolicy || "skip";

	let rawResult: DatabaseImportResult;

	if (engine === "postgres") {
		rawResult = await importPostgres(
			record,
			targetEntity,
			rows,
			fieldMappings,
			duplicatePolicy,
			options.database,
		);
	} else if (engine === "mysql" || engine === "mariadb") {
		rawResult = await importMySql(
			record,
			engine,
			targetEntity,
			rows,
			fieldMappings,
			duplicatePolicy,
			options.database,
		);
	} else if (engine === "libsql") {
		rawResult = await importLibSql(
			record,
			targetEntity,
			rows,
			fieldMappings,
			duplicatePolicy,
		);
	} else if (engine === "mongo") {
		rawResult = await importMongo(
			record,
			targetEntity,
			rows,
			fieldMappings,
			duplicatePolicy,
			options.database,
		);
	} else if (engine === "redis") {
		rawResult = await importRedis(
			record,
			rows,
			options.redisConfig,
			duplicatePolicy,
		);
	} else {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported database engine '${engine}'.`,
		});
	}

	const durationMs = Date.now() - startTime;
	return {
		...rawResult,
		totalRows: rawResult.totalRecords,
		inserted: rawResult.insertedCount,
		updated: rawResult.updatedCount,
		skipped: rawResult.skippedCount,
		failed: rawResult.failedCount,
		durationMs,
		errors: rawResult.errors.map((e) => ({
			...e,
			row: e.rowNumber,
			identifier: e.keyOrId,
			message: e.reason,
		})),
	};
}

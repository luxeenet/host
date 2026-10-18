import { validateRequest } from "@dokploy/server/lib/auth";
import { brand } from "@paas/branding";
import { createServerSideHelpers } from "@trpc/react-query/server";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	ChevronRight,
	Clock,
	Code2,
	Copy,
	Database,
	Download,
	Edit,
	Eye,
	FileText,
	HardDrive,
	Key,
	Layers,
	Lock,
	Play,
	Plus,
	Radio,
	RefreshCw,
	Search,
	Server,
	Settings2,
	Shield,
	ShieldAlert,
	Table as TableIcon,
	Terminal,
	Trash2,
	Upload,
	UserCheck,
	Users,
	Wrench,
	Zap,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import superjson from "superjson";
import { DatabaseConnectionCard } from "@/components/dashboard/database/connection/database-connection-card";
import {
	LibsqlIcon,
	MariadbIcon,
	MongodbIcon,
	MysqlIcon,
	PostgresqlIcon,
	RedisIcon,
} from "@/components/icons/data-tools-icons";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { CodeEditor } from "@/components/shared/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";

type SupportedEngine =
	| "mongo"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "redis"
	| "libsql";

const ENGINE_METAS: Record<
	SupportedEngine,
	{
		label: string;
		icon: React.ComponentType<{ className?: string }>;
		color: string;
		isSql: boolean;
	}
> = {
	mongo: {
		label: "MongoDB",
		icon: MongodbIcon,
		color: "text-emerald-400 border-emerald-500/20 bg-emerald-950/20",
		isSql: false,
	},
	postgres: {
		label: "PostgreSQL",
		icon: PostgresqlIcon,
		color: "text-blue-400 border-blue-500/20 bg-blue-950/20",
		isSql: true,
	},
	mysql: {
		label: "MySQL",
		icon: MysqlIcon,
		color: "text-cyan-400 border-cyan-500/20 bg-cyan-950/20",
		isSql: true,
	},
	mariadb: {
		label: "MariaDB",
		icon: MariadbIcon,
		color: "text-teal-400 border-teal-500/20 bg-teal-950/20",
		isSql: true,
	},
	redis: {
		label: "Redis",
		icon: RedisIcon,
		color: "text-red-400 border-red-500/20 bg-red-950/20",
		isSql: false,
	},
	libsql: {
		label: "LibSQL",
		icon: LibsqlIcon,
		color: "text-purple-400 border-purple-500/20 bg-purple-950/20",
		isSql: true,
	},
};

export default function DatabaseManagePage() {
	const router = useRouter();
	const { id, engine } = router.query;
	const databaseId = typeof id === "string" ? id : "";
	const databaseEngine = (
		typeof engine === "string" && engine in ENGINE_METAS ? engine : "mongo"
	) as SupportedEngine;

	const meta = ENGINE_METAS[databaseEngine];

	// Active tab
	const [activeTab, setActiveTab] = useState<string>("explorer");

	// Connection modal state
	const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

	// -------------------------------------------------------------
	// Overview & Server Data
	// -------------------------------------------------------------
	const { data: overviewData, refetch: refetchOverview } =
		api.databaseManager.overview.useQuery(undefined, {
			enabled: Boolean(databaseId),
		});

	const activeRecord = useMemo(() => {
		return overviewData?.find((d) => d.id === databaseId);
	}, [overviewData, databaseId]);

	// Discovered Logical Databases query (Supports MongoDB logical dbs, PostgreSQL/MySQL schemas, Redis db 0-15)
	const [selectedDatabase, setSelectedDatabase] = useState<string>("");
	const {
		data: databasesData,
		isLoading: isDatabasesLoading,
		isError: isDatabasesError,
		error: databasesError,
		refetch: refetchDatabases,
	} = api.databaseManager.listDatabases.useQuery(
		{ databaseId, engine: databaseEngine },
		{ enabled: Boolean(databaseId) },
	);

	const discoveredDatabases = useMemo(() => {
		return databasesData?.databases || [];
	}, [databasesData]);

	// Auto-select preferred default database
	useEffect(() => {
		if (discoveredDatabases.length > 0 && !selectedDatabase) {
			const preferred =
				databasesData?.selectedDatabase ||
				discoveredDatabases.find((d) => d.isDefault)?.name ||
				discoveredDatabases.find((d) => d.name === (activeRecord?.databaseName as string))?.name ||
				discoveredDatabases.find((d) => d.name === "test")?.name ||
				discoveredDatabases.find((d) => d.name === "app")?.name ||
				discoveredDatabases[0]?.name ||
				"";
			if (preferred) {
				setSelectedDatabase(preferred);
			}
		}
	}, [discoveredDatabases, databasesData, selectedDatabase, activeRecord]);

	// Engine stats query
	const {
		data: engineStats,
		isLoading: isStatsLoading,
		refetch: refetchStats,
	} = api.databaseManager.engineOverview.useQuery(
		{ databaseId, engine: databaseEngine, database: selectedDatabase || undefined },
		{ enabled: Boolean(databaseId) },
	);

	// -------------------------------------------------------------
	// Data Explorer (Collections / Tables)
	// -------------------------------------------------------------
	const {
		data: collectionsOrTables = [],
		isLoading: isListLoading,
		refetch: refetchList,
	} = api.databaseManager.listCollectionsOrTables.useQuery(
		{ databaseId, engine: databaseEngine, database: selectedDatabase || undefined },
		{ enabled: Boolean(databaseId) && databaseEngine !== "redis" },
	);

	const [selectedEntity, setSelectedEntity] = useState<string>("");

	useEffect(() => {
		if (collectionsOrTables.length > 0 && !selectedEntity) {
			setSelectedEntity(collectionsOrTables[0]?.name || "");
		}
	}, [collectionsOrTables, selectedEntity]);

	// Table schema query (for SQL engines)
	const { data: tableSchema, isLoading: isSchemaLoading } =
		api.databaseManager.getSchema.useQuery(
			{ databaseId, engine: databaseEngine, name: selectedEntity, database: selectedDatabase || undefined },
			{ enabled: Boolean(databaseId && selectedEntity && meta.isSql) },
		);

	// Paginated rows/documents query
	const [currentPage, setCurrentPage] = useState(1);
	const [filterInput, setFilterInput] = useState("");
	const [activeFilter, setActiveFilter] = useState<Record<string, any>>({});

	const {
		data: entityData,
		isLoading: isDataLoading,
		isError: isDataError,
		error: entityDataError,
		refetch: refetchData,
	} = api.databaseManager.queryData.useQuery(
		{
			databaseId,
			engine: databaseEngine,
			name: selectedEntity,
			page: currentPage,
			limit: 25,
			filter: filterInput || undefined,
			database: selectedDatabase || undefined,
		},
		{
			enabled: Boolean(
				databaseId && selectedEntity && databaseEngine !== "redis",
			),
		},
	);

	// Document/Row mutation modals & Document inspector
	const [isInsertModalOpen, setIsInsertModalOpen] = useState(false);
	const [insertPayload, setInsertPayload] = useState("{}");
	const [isEditModalOpen, setIsEditModalOpen] = useState(false);
	const [editRowId, setEditRowId] = useState<any>(null);
	const [editPayload, setEditPayload] = useState("{}");
	const [isCreateCollModalOpen, setIsCreateCollModalOpen] = useState(false);
	const [newCollName, setNewCollName] = useState("");
	const [viewingDocument, setViewingDocument] = useState<any>(null);
	const [isViewDocModalOpen, setIsViewDocModalOpen] = useState(false);

	const insertMutation = api.databaseManager.insertRecord.useMutation();
	const updateMutation = api.databaseManager.updateRecord.useMutation();
	const deleteMutation = api.databaseManager.deleteRecord.useMutation();
	const createCollMutation = api.databaseManager.createCollection.useMutation();
	const dropCollMutation = api.databaseManager.dropCollection.useMutation();

	const handleApplyFilter = () => {
		if (!filterInput.trim()) {
			setActiveFilter({});
			setCurrentPage(1);
			return;
		}
		try {
			const parsed = JSON.parse(filterInput);
			setActiveFilter(parsed);
			setCurrentPage(1);
		} catch {
			toast.error('Invalid JSON filter. Example: {"status": "active"}');
		}
	};

	const handleInsertSubmit = async () => {
		try {
			const parsed = JSON.parse(insertPayload);
			await insertMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				name: selectedEntity,
				data: parsed,
				database: selectedDatabase || undefined,
			});
			toast.success("Record created successfully");
			setIsInsertModalOpen(false);
			setInsertPayload("{}");
			await refetchData();
		} catch (err: any) {
			toast.error(err?.message || "Failed to insert record");
		}
	};

	const handleUpdateSubmit = async () => {
		try {
			const parsed = JSON.parse(editPayload);
			await updateMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				name: selectedEntity,
				id: editRowId,
				primaryKeyColumn: tableSchema?.columns?.find((c: any) => c.isPrimary)
					?.name,
				data: parsed,
				database: selectedDatabase || undefined,
			});
			toast.success("Record updated successfully");
			setIsEditModalOpen(false);
			await refetchData();
		} catch (err: any) {
			toast.error(err?.message || "Failed to update record");
		}
	};

	const handleDeleteRecord = async (row: any) => {
		const rowId = row._id || row.id || Object.values(row)[0];
		if (!confirm(`Are you sure you want to delete this record (${rowId})?`)) {
			return;
		}
		try {
			await deleteMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				name: selectedEntity,
				id: rowId,
				primaryKeyColumn: tableSchema?.columns?.find((c: any) => c.isPrimary)
					?.name,
				database: selectedDatabase || undefined,
			});
			toast.success("Record deleted");
			await refetchData();
		} catch (err: any) {
			toast.error(err?.message || "Failed to delete record");
		}
	};

	const handleCreateCollection = async () => {
		if (!newCollName.trim()) return;
		try {
			await createCollMutation.mutateAsync({
				databaseId,
				name: newCollName.trim(),
				database: selectedDatabase || undefined,
			});
			toast.success(`Collection '${newCollName}' created`);
			setIsCreateCollModalOpen(false);
			setNewCollName("");
			await refetchList();
			setSelectedEntity(newCollName.trim());
		} catch (err: any) {
			toast.error(err?.message || "Failed to create collection");
		}
	};

	const handleDropCollection = async (name: string) => {
		if (
			!confirm(
				`DANGER: Are you sure you want to drop collection '${name}'? All documents will be permanently lost.`,
			)
		) {
			return;
		}
		try {
			await dropCollMutation.mutateAsync({
				databaseId,
				name,
				database: selectedDatabase || undefined,
			});
			toast.success(`Collection '${name}' dropped`);
			await refetchList();
			setSelectedEntity("");
		} catch (err: any) {
			toast.error(err?.message || "Failed to drop collection");
		}
	};

	// -------------------------------------------------------------
	// Redis Explorer State
	// -------------------------------------------------------------
	const [redisPattern, setRedisPattern] = useState("*");
	const [redisCursor, setRedisCursor] = useState("0");
	const [selectedRedisKey, setSelectedRedisKey] = useState<string>("");
	const [redisRawCmd, setRedisRawCmd] = useState("");
	const [redisConsoleLogs, setRedisConsoleLogs] = useState<string[]>([]);
	const [isAddRedisKeyOpen, setIsAddRedisKeyOpen] = useState(false);
	const [newRedisKey, setNewRedisKey] = useState("");
	const [newRedisVal, setNewRedisVal] = useState("");
	const [newRedisTtl, setNewRedisTtl] = useState("");

	const {
		data: redisScanData,
		isLoading: isRedisScanning,
		refetch: refetchRedisKeys,
	} = api.databaseManager.redisScan.useQuery(
		{
			databaseId,
			pattern: redisPattern,
			cursor: redisCursor,
			database: selectedDatabase || undefined,
		},
		{ enabled: Boolean(databaseId && databaseEngine === "redis") },
	);

	const {
		data: redisKeyDetails,
		isLoading: isKeyDetailsLoading,
		refetch: refetchKeyDetails,
	} = api.databaseManager.redisGetKey.useQuery(
		{
			databaseId,
			key: selectedRedisKey,
			database: selectedDatabase || undefined,
		},
		{
			enabled: Boolean(
				databaseId && databaseEngine === "redis" && selectedRedisKey,
			),
		},
	);

	const redisSetMutation = api.databaseManager.redisSetKey.useMutation();
	const redisDeleteMutation = api.databaseManager.redisDeleteKey.useMutation();
	const redisExecuteMutation = api.databaseManager.redisExecute.useMutation();

	const handleAddRedisKey = async () => {
		if (!newRedisKey.trim()) return;
		try {
			await redisSetMutation.mutateAsync({
				databaseId,
				key: newRedisKey.trim(),
				value: newRedisVal,
				ttl: newRedisTtl ? Number.parseInt(newRedisTtl, 10) : undefined,
				database: selectedDatabase || undefined,
			});
			toast.success(`Key '${newRedisKey}' saved`);
			setIsAddRedisKeyOpen(false);
			setNewRedisKey("");
			setNewRedisVal("");
			setNewRedisTtl("");
			await refetchRedisKeys();
		} catch (err: any) {
			toast.error(err?.message || "Failed to save Redis key");
		}
	};

	const handleDeleteRedisKey = async (key: string) => {
		if (!confirm(`Delete key '${key}'?`)) return;
		try {
			await redisDeleteMutation.mutateAsync({
				databaseId,
				key,
				database: selectedDatabase || undefined,
			});
			toast.success(`Key '${key}' deleted`);
			if (selectedRedisKey === key) setSelectedRedisKey("");
			await refetchRedisKeys();
		} catch (err: any) {
			toast.error(err?.message || "Failed to delete key");
		}
	};

	const handleExecuteRedisConsole = async () => {
		if (!redisRawCmd.trim()) return;
		const cmd = redisRawCmd.trim();
		setRedisConsoleLogs((prev) => [...prev, `> ${cmd}`]);
		setRedisRawCmd("");

		try {
			const res = await redisExecuteMutation.mutateAsync({
				databaseId,
				command: cmd,
				database: selectedDatabase || undefined,
			});
			setRedisConsoleLogs((prev) => [...prev, res.output || "OK"]);
		} catch (err: any) {
			setRedisConsoleLogs((prev) => [
				...prev,
				`ERROR: ${err?.message || "Command failed"}`,
			]);
		}
	};

	// -------------------------------------------------------------
	// SQL Editor State (Postgres, MySQL, MariaDB, LibSQL)
	// -------------------------------------------------------------
	const defaultSql = meta.isSql
		? `SELECT * FROM "${selectedEntity || "information_schema.tables"}" LIMIT 25;`
		: "";
	const [sqlQuery, setSqlQuery] = useState(defaultSql);
	const [sqlResult, setSqlResult] = useState<any>(null);
	const [isExecutingSql, setIsExecutingSql] = useState(false);
	const [destructiveConfirmOpen, setDestructiveConfirmOpen] = useState(false);

	const executeSqlMutation = api.databaseManager.executeSql.useMutation();

	const runSqlQuery = async (overrideConfirm = false) => {
		if (!sqlQuery.trim()) return;

		// Detect destructive statements client-side for UX warning
		const isDestructive =
			/^(DROP|TRUNCATE|ALTER)\b/i.test(sqlQuery.trim()) ||
			(/\bDELETE\b/i.test(sqlQuery.trim()) &&
				!/\bWHERE\b/i.test(sqlQuery.trim()));

		if (isDestructive && !overrideConfirm) {
			setDestructiveConfirmOpen(true);
			return;
		}

		setIsExecutingSql(true);
		try {
			const res = await executeSqlMutation.mutateAsync({
				databaseId,
				engine: databaseEngine as any,
				sql: sqlQuery,
				database: selectedDatabase || undefined,
			});
			setSqlResult(res);
			toast.success(
				`Query completed in ${res.durationMs}ms (${res.rowCount || 0} rows)`,
			);
		} catch (err: any) {
			setSqlResult({ error: err?.message || "Query execution failed" });
			toast.error(err?.message || "SQL Error");
		} finally {
			setIsExecutingSql(false);
		}
	};

	// -------------------------------------------------------------
	// Users & Privileges
	// -------------------------------------------------------------
	const {
		data: dbUsers = [],
		isLoading: isUsersLoading,
		refetch: refetchUsers,
	} = api.databaseManager.listUsers.useQuery(
		{
			databaseId,
			engine: databaseEngine,
			database: selectedDatabase || undefined,
		},
		{
			enabled: Boolean(
				databaseId && databaseEngine !== "redis" && databaseEngine !== "libsql",
			),
		},
	);

	const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
	const [newDbUser, setNewDbUser] = useState("");
	const [newDbUserPass, setNewDbUserPass] = useState("");
	const [newDbUserRoles, setNewDbUserRoles] = useState("readWrite");

	const createUserMutation = api.databaseManager.createUser.useMutation();
	const dropUserMutation = api.databaseManager.dropUser.useMutation();

	const handleCreateUser = async () => {
		if (!newDbUser.trim() || !newDbUserPass.trim()) return;
		try {
			await createUserMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				username: newDbUser.trim(),
				password: newDbUserPass,
				role: newDbUserRoles,
				database: selectedDatabase || undefined,
			});
			toast.success(`User '${newDbUser}' created with ${newDbUserRoles} role`);
			setIsCreateUserOpen(false);
			setNewDbUser("");
			setNewDbUserPass("");
			await refetchUsers();
		} catch (err: any) {
			toast.error(err?.message || "Failed to create user");
		}
	};

	const handleDropUser = async (user: string) => {
		if (!confirm(`Revoke and drop database user '${user}'?`)) return;
		try {
			await dropUserMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				username: user,
				database: selectedDatabase || undefined,
			});
			toast.success(`User '${user}' dropped`);
			await refetchUsers();
		} catch (err: any) {
			toast.error(err?.message || "Failed to drop user");
		}
	};
	// -------------------------------------------------------------
	// Universal Data Import State & Handlers (All 6 Engines)
	// -------------------------------------------------------------
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const [importStep, setImportStep] = useState<
		"upload" | "mapping" | "preview" | "importing" | "result"
	>("upload");
	const [importFileName, setImportFileName] = useState("");
	const [importFileSize, setImportFileSize] = useState(0);
	const [importFileType, setImportFileType] = useState<"csv" | "json">("csv");
	const [importFileContent, setImportFileContent] = useState("");
	const [importTargetEntity, setImportTargetEntity] = useState("");
	const [importDuplicatePolicy, setImportDuplicatePolicy] = useState<
		"skip" | "update" | "reject"
	>("skip");
	const [importFieldMappings, setImportFieldMappings] = useState<
		Record<string, string>
	>({});

	// Redis specific import settings
	const [redisStructure, setRedisStructure] = useState<
		"hash" | "string" | "list" | "set" | "zset"
	>("hash");
	const [redisKeyField, setRedisKeyField] = useState("");
	const [redisKeyPrefix, setRedisKeyPrefix] = useState("item:");
	const [redisScoreField, setRedisScoreField] = useState("");
	const [redisTtl, setRedisTtl] = useState("");

	// Dynamic target schema query for SQL
	const { data: targetTableSchema } = api.databaseManager.getSchema.useQuery(
		{ databaseId, engine: databaseEngine, name: importTargetEntity },
		{
			enabled: Boolean(
				databaseId && importTargetEntity && meta.isSql && isImportModalOpen,
			),
		},
	);

	// Preview & Execution state
	const [previewData, setPreviewData] = useState<{
		headers: string[];
		totalRecords: number;
		previewRows: any[];
		sampleInferredTypes: Record<string, string>;
	} | null>(null);

	const [importResult, setImportResult] = useState<{
		totalRows?: number;
		totalRecords?: number;
		inserted?: number;
		insertedCount?: number;
		updated?: number;
		updatedCount?: number;
		skipped?: number;
		skippedCount?: number;
		failed?: number;
		failedCount?: number;
		durationMs?: number;
		errors?: Array<{
			row?: number;
			rowNumber?: number;
			identifier?: string;
			keyOrId?: string;
			message?: string;
			reason?: string;
		}>;
	} | null>(null);

	const previewMutation = api.databaseManager.previewImportFile.useMutation();
	const importMutation = api.databaseManager.importData.useMutation();

	const handleOpenImportModal = (target?: string) => {
		const defaultTarget =
			target ||
			selectedEntity ||
			(collectionsOrTables.length > 0 ? collectionsOrTables[0]?.name : "") ||
			(databaseEngine === "redis" ? "item:" : "records");

		setImportTargetEntity(defaultTarget);
		setImportStep("upload");
		setImportFileName("");
		setImportFileSize(0);
		setImportFileType("csv");
		setImportFileContent("");
		setImportDuplicatePolicy("skip");
		setImportFieldMappings({});
		setPreviewData(null);
		setImportResult(null);
		setRedisStructure("hash");
		setRedisKeyField("");
		setRedisKeyPrefix(databaseEngine === "redis" ? "item:" : "");
		setRedisScoreField("");
		setRedisTtl("");
		setIsImportModalOpen(true);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		if (file.size > 10 * 1024 * 1024) {
			toast.error("File is too large. Maximum file size is 10MB.");
			return;
		}

		setImportFileName(file.name);
		setImportFileSize(file.size);

		const isJson =
			file.name.endsWith(".json") ||
			file.name.endsWith(".jsonl") ||
			file.name.endsWith(".ndjson");
		const detectedType = isJson ? "json" : "csv";
		setImportFileType(detectedType);

		const reader = new FileReader();
		reader.onload = async (event) => {
			const text = String(event.target?.result || "");
			setImportFileContent(text);
			await processFileContent(text, detectedType);
		};
		reader.onerror = () => {
			toast.error("Failed to read selected file.");
		};
		reader.readAsText(file);
	};

	const processFileContent = async (text: string, type: "csv" | "json") => {
		if (!text.trim()) {
			toast.error("File appears to be empty.");
			return;
		}

		try {
			const preview = await previewMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				fileContent: text,
				fileType: type,
			});

			setPreviewData(preview);

			// Initialize default field mappings
			const initialMappings: Record<string, string> = {};
			for (const h of preview.headers) {
				initialMappings[h] = h;
			}
			setImportFieldMappings(initialMappings);

			// Auto detect Redis key field
			const keyCandidates = ["id", "key", "_id", "code", "uuid", "name"];
			const matchedKey = preview.headers.find((h) =>
				keyCandidates.includes(h.toLowerCase()),
			);
			if (matchedKey) {
				setRedisKeyField(matchedKey);
			} else if (preview.headers.length > 0) {
				setRedisKeyField(preview.headers[0] || "");
			}

			// Auto detect Redis score field if zset
			const scoreCandidates = [
				"score",
				"rank",
				"points",
				"timestamp",
				"weight",
			];
			const matchedScore = preview.headers.find((h) =>
				scoreCandidates.includes(h.toLowerCase()),
			);
			if (matchedScore) {
				setRedisScoreField(matchedScore);
			}

			setImportStep("mapping");
		} catch (err: any) {
			toast.error(err?.message || "Failed to preview file contents");
		}
	};

	const handleExecuteImport = async () => {
		if (!importTargetEntity.trim()) {
			toast.error(
				databaseEngine === "redis"
					? "Please specify a key prefix or target name"
					: databaseEngine === "mongo"
						? "Please specify target collection name"
						: "Please specify target table name",
			);
			return;
		}

		setImportStep("importing");
		try {
			const res = await importMutation.mutateAsync({
				databaseId,
				engine: databaseEngine,
				targetEntity: importTargetEntity.trim(),
				fileContent: importFileContent,
				fileType: importFileType,
				fieldMappings: importFieldMappings,
				duplicatePolicy: importDuplicatePolicy,
				database: selectedDatabase || undefined,
				redisConfig:
					databaseEngine === "redis"
						? {
								structure: redisStructure,
								keyField: redisKeyField || undefined,
								keyPrefix: redisKeyPrefix || undefined,
								scoreField: redisScoreField || undefined,
								ttl: redisTtl ? Number.parseInt(redisTtl, 10) : undefined,
							}
						: undefined,
			});

			setImportResult(res);
			setImportStep("result");

			const inserted = res.inserted ?? res.insertedCount ?? 0;
			const updated = res.updated ?? res.updatedCount ?? 0;
			const skipped = res.skipped ?? res.skippedCount ?? 0;
			const failed = res.failed ?? res.failedCount ?? 0;

			if (inserted > 0 || updated > 0) {
				toast.success(
					`Import complete: ${inserted} inserted, ${updated} updated${
						skipped > 0 ? `, ${skipped} skipped` : ""
					}`,
				);
			} else if (failed > 0) {
				toast.error(`Import failed: ${failed} errors encountered`);
			} else {
				toast.info(`Import processed: ${skipped} records skipped`);
			}

			// Automatically refresh data explorer
			await refetchList();
			if (databaseEngine === "redis") {
				await refetchRedisKeys();
			} else {
				await refetchData();
			}
			await refetchStats();
		} catch (err: any) {
			setImportStep("mapping");
			toast.error(err?.message || "Data import failed");
		}
	};

	const handleDownloadFailureReport = () => {
		if (!importResult || !importResult.errors || importResult.errors.length === 0) return;
		const report = {
			databaseId,
			engine: databaseEngine,
			targetEntity: importTargetEntity,
			timestamp: new Date().toISOString(),
			summary: {
				totalRows: importResult.totalRows ?? importResult.totalRecords ?? 0,
				inserted: importResult.inserted ?? importResult.insertedCount ?? 0,
				updated: importResult.updated ?? importResult.updatedCount ?? 0,
				skipped: importResult.skipped ?? importResult.skippedCount ?? 0,
				failed: importResult.failed ?? importResult.failedCount ?? 0,
			},
			errors: importResult.errors,
		};

		const blob = new Blob([JSON.stringify(report, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `import-failures-${importTargetEntity}-${Date.now()}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast.success("Failure report downloaded");
	};

	const handleViewInExplorer = () => {
		setIsImportModalOpen(false);
		if (databaseEngine !== "redis" && importTargetEntity) {
			setSelectedEntity(importTargetEntity);
		}
		setActiveTab("explorer");
	};

	return (
		<>
			<Head>
				<title>
					{activeRecord?.name || "Database"} Management Workspace -{" "}
					{brand.APP_NAME}
				</title>
			</Head>

			<div className="space-y-6 pb-16">
				{/* Top Bar / Breadcrumb Navigation */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
					<div className="flex items-center gap-3">
						<Link href="/dashboard/home/databases">
							<Button
								variant="ghost"
								size="sm"
								className="text-slate-400 hover:text-white p-2 h-9 w-9"
							>
								<ArrowLeft className="w-4 h-4" />
							</Button>
						</Link>

						<div
							className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${meta.color}`}
						>
							<meta.icon className="w-5 h-5" />
						</div>

						<div>
							<div className="flex items-center gap-2">
								<h1 className="text-xl font-bold text-white tracking-tight">
									{activeRecord?.name || databaseId}
								</h1>
								<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
									RUNNING
								</span>
								<Badge
									variant="outline"
									className="text-[10px] border-slate-800 text-slate-400 font-mono"
								>
									{meta.label}
								</Badge>
							</div>
							<p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
								<span className="font-mono text-slate-300">
									Service: {activeRecord?.appName || "instance"}
								</span>
								<span>•</span>
								<span className="flex items-center gap-1">
									Database:{" "}
									<span className="text-indigo-300 font-mono font-semibold">
										{selectedDatabase || (activeRecord?.databaseName as string) || "default"}
									</span>
								</span>
								{activeRecord?.externalPort && (
									<>
										<span>•</span>
										<span className="text-cyan-400 font-mono">
											Endpoint: db.hatdot.cloud:{activeRecord.externalPort}
										</span>
									</>
								)}
							</p>
						</div>
					</div>

					{/* Header Actions */}
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => handleOpenImportModal()}
							className="border-indigo-500/30 text-indigo-300 hover:bg-indigo-950/30 text-xs gap-1.5 h-8 font-medium"
						>
							<Upload className="w-3.5 h-3.5 text-indigo-400" /> Import Data
						</Button>

						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsConnectionModalOpen(true)}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8 font-medium"
						>
							<Key className="w-3.5 h-3.5 text-cyan-400" /> Connection Details
						</Button>

						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								refetchOverview();
								refetchDatabases();
								refetchStats();
								refetchList();
								if (databaseEngine === "redis") refetchRedisKeys();
								else refetchData();
							}}
							className="border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 text-xs gap-1.5 h-8"
						>
							<RefreshCw className="w-3.5 h-3.5" /> Refresh
						</Button>
					</div>
				</div>

				{/* Primary Workspace Navigation Tabs */}
				<Tabs
					value={activeTab}
					onValueChange={setActiveTab}
					className="space-y-6"
				>
					<TabsList className="bg-slate-900 border border-slate-800 p-1 rounded-xl">
						<TabsTrigger
							value="explorer"
							className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-1.5"
						>
							<TableIcon className="w-3.5 h-3.5" />
							{databaseEngine === "mongo"
								? "Collections & Documents"
								: databaseEngine === "redis"
									? "Key-Value Browser"
									: "Tables & Records"}
						</TabsTrigger>

						{meta.isSql && (
							<TabsTrigger
								value="sql"
								className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-1.5"
							>
								<Code2 className="w-3.5 h-3.5" /> SQL Editor
							</TabsTrigger>
						)}

						{databaseEngine !== "redis" && databaseEngine !== "libsql" && (
							<TabsTrigger
								value="users"
								className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-1.5"
							>
								<Users className="w-3.5 h-3.5" /> Users & Privileges
							</TabsTrigger>
						)}

						<TabsTrigger
							value="stats"
							className="text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white gap-1.5"
						>
							<Activity className="w-3.5 h-3.5" /> Engine Health & Metrics
						</TabsTrigger>
					</TabsList>

					{/* ========================================================= */}
					{/* TAB 1: DATA EXPLORER (MONGODB / SQL / REDIS)              */}
					{/* ========================================================= */}
					<TabsContent value="explorer" className="space-y-4 m-0">
						{/* REDIS BROWSER */}
						{databaseEngine === "redis" ? (
							<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
								{/* Left: Keys List & Search */}
								<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-4">
									<div className="flex items-center justify-between">
										<h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
											<Layers className="w-3.5 h-3.5 text-red-400" /> Keys
											Explorer
										</h3>
										<div className="flex items-center gap-1.5">
											<Button
												size="sm"
												variant="outline"
												onClick={() => handleOpenImportModal()}
												className="border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] h-7 px-2.5 gap-1"
											>
												<Upload className="w-3 h-3 text-red-400" /> Import
											</Button>
											<Button
												size="sm"
												onClick={() => setIsAddRedisKeyOpen(true)}
												className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] h-7 px-2.5 gap-1"
											>
												<Plus className="w-3 h-3" /> New Key
											</Button>
										</div>
									</div>

									{/* Key search filter */}
									<div className="flex items-center gap-1.5">
										<Input
											placeholder="Key pattern (e.g. user:*)"
											value={redisPattern}
											onChange={(e) => setRedisPattern(e.target.value)}
											className="bg-slate-950 border-slate-800 text-xs h-8 text-white font-mono"
										/>
										<Button
											size="sm"
											onClick={() => refetchRedisKeys()}
											className="bg-slate-800 text-white text-xs h-8 px-2.5"
										>
											Scan
										</Button>
									</div>

									{/* Keys list */}
									<div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
										{isRedisScanning ? (
											<div className="p-4 text-center text-xs text-slate-500">
												Scanning keyspace...
											</div>
										) : redisScanData?.keys?.length === 0 ? (
											<div className="p-4 text-center text-xs text-slate-500">
												No keys found matching pattern.
											</div>
										) : (
											redisScanData?.keys?.map((k) => (
												<div
													key={k.key}
													onClick={() => setSelectedRedisKey(k.key)}
													className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${
														selectedRedisKey === k.key
															? "bg-indigo-950/40 border-indigo-500/60 text-white"
															: "bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700"
													}`}
												>
													<div className="min-w-0 pr-2">
														<p className="font-mono truncate font-medium text-slate-200">
															{k.key}
														</p>
														<div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
															<span className="uppercase text-red-400 font-semibold">
																{k.type}
															</span>
															<span>•</span>
															<span>
																TTL: {k.ttl === -1 ? "Persistent" : `${k.ttl}s`}
															</span>
														</div>
													</div>

													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															handleDeleteRedisKey(k.key);
														}}
														className="text-slate-500 hover:text-red-400 p-1 rounded"
													>
														<Trash2 className="w-3.5 h-3.5" />
													</button>
												</div>
											))
										)}
									</div>
								</div>

								{/* Right: Key Inspector & Safe Console */}
								<div className="md:col-span-2 space-y-4">
									{/* Key Value Inspector */}
									<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
										<div className="flex items-center justify-between border-b border-slate-800 pb-3">
											<div>
												<h3 className="text-xs font-bold text-white uppercase tracking-wider">
													Key Value Inspector
												</h3>
												<p className="text-[11px] text-slate-400 font-mono mt-0.5">
													{selectedRedisKey || "Select a key to view value"}
												</p>
											</div>
											{selectedRedisKey && (
												<Badge
													variant="outline"
													className="border-red-500/30 text-red-400 text-[10px] uppercase font-mono"
												>
													{redisKeyDetails?.type || "string"}
												</Badge>
											)}
										</div>

										{isKeyDetailsLoading ? (
											<div className="p-8 text-center text-xs text-slate-500">
												Fetching key payload...
											</div>
										) : !selectedRedisKey ? (
											<div className="p-8 text-center text-xs text-slate-500">
												Click on any key on the left to inspect its data
												structure.
											</div>
										) : (
											<div className="space-y-3">
												<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-200 max-h-60 overflow-auto whitespace-pre-wrap">
													{typeof redisKeyDetails?.value === "object"
														? JSON.stringify(redisKeyDetails?.value, null, 2)
														: String(redisKeyDetails?.value ?? "")}
												</div>

												<div className="flex items-center justify-between text-xs text-slate-400 pt-1">
													<span>
														TTL:{" "}
														{redisKeyDetails?.ttl === -1
															? "Persistent (no expiry)"
															: `${redisKeyDetails?.ttl} seconds`}
													</span>
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															handleDeleteRedisKey(selectedRedisKey)
														}
														className="border-red-500/20 text-red-400 hover:bg-red-950/20 text-xs h-7"
													>
														Delete Key
													</Button>
												</div>
											</div>
										)}
									</div>

									{/* Safe Redis Command Console */}
									<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
										<div className="flex items-center justify-between">
											<h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
												<Terminal className="w-3.5 h-3.5 text-indigo-400" />
												Safe Redis CLI Console
											</h3>
											<span className="text-[10px] text-slate-500">
												Destructive & admin commands blocked
											</span>
										</div>

										<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 min-h-[140px] max-h-[220px] overflow-auto space-y-1">
											{redisConsoleLogs.length === 0 ? (
												<p className="text-slate-600">
													Type safe Redis commands like &apos;INFO&apos;,
													&apos;DBSIZE&apos;, &apos;PING&apos;, &apos;TTL
													key&apos;...
												</p>
											) : (
												redisConsoleLogs.map((log, idx) => (
													<p
														key={idx}
														className={
															log.startsWith(">")
																? "text-cyan-400 font-semibold"
																: log.startsWith("ERROR")
																	? "text-red-400"
																	: "text-slate-300"
														}
													>
														{log}
													</p>
												))
											)}
										</div>

										<div className="flex items-center gap-2">
											<Input
												placeholder="Enter safe command (e.g. INFO, DBSIZE, GET mykey)"
												value={redisRawCmd}
												onChange={(e) => setRedisRawCmd(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") handleExecuteRedisConsole();
												}}
												className="bg-slate-950 border-slate-800 text-xs h-8 text-white font-mono"
											/>
											<Button
												size="sm"
												onClick={handleExecuteRedisConsole}
												className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-3"
											>
												Execute
											</Button>
										</div>
									</div>
								</div>
							</div>
						) : (
							/* MONGODB OR SQL DATA EXPLORER */
							<div className="grid grid-cols-1 md:grid-cols-4 gap-5">
								{/* Left: Logical Database & Collections / Tables List */}
								<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
									{/* Logical Database Selector */}
									<div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/90 space-y-1.5">
										<div className="flex items-center justify-between text-[11px]">
											<span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-slate-300">
												<Database className="w-3.5 h-3.5 text-indigo-400" /> Logical DB
											</span>
											{isDatabasesLoading ? (
												<RefreshCw className="w-3 h-3 animate-spin text-slate-500" />
											) : (
												<span className="text-[10px] text-slate-500 font-mono">
													{discoveredDatabases.length} found
												</span>
											)}
										</div>
										<Select
											value={selectedDatabase}
											onValueChange={(val) => {
												setSelectedDatabase(val);
												setSelectedEntity("");
												setCurrentPage(1);
											}}
										>
											<SelectTrigger className="w-full bg-slate-900 border-slate-800 text-xs h-8 font-mono text-white">
												<SelectValue placeholder="Select Database" />
											</SelectTrigger>
											<SelectContent className="bg-slate-900 border-slate-800 text-white">
												{discoveredDatabases.map((db) => (
													<SelectItem key={db.name} value={db.name} className="text-xs font-mono">
														<div className="flex items-center justify-between gap-2 w-full">
															<span>{db.name}</span>
															{db.isDefault && (
																<span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-sans">
																	Default
																</span>
															)}
														</div>
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="flex items-center justify-between pt-1">
										<h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
											<Layers className="w-3.5 h-3.5 text-indigo-400" />
											{databaseEngine === "mongo" ? "Collections" : "Tables"}
										</h3>

										{databaseEngine === "mongo" && (
											<Button
												size="sm"
												onClick={() => setIsCreateCollModalOpen(true)}
												className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] h-7 px-2 gap-1"
											>
												<Plus className="w-3 h-3" /> New
											</Button>
										)}
									</div>

									<div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
										{isListLoading ? (
											<div className="p-4 text-center text-xs text-slate-500">
												Loading schema...
											</div>
										) : collectionsOrTables.length === 0 ? (
											<div className="p-4 text-center text-xs text-slate-500">
												No{" "}
												{databaseEngine === "mongo" ? "collections" : "tables"}{" "}
												found in &apos;{selectedDatabase || "current database"}&apos;.
											</div>
										) : (
											collectionsOrTables.map((item: any) => (
												<div
													key={item.name}
													onClick={() => {
														setSelectedEntity(item.name);
														setCurrentPage(1);
													}}
													className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${
														selectedEntity === item.name
															? "bg-indigo-950/40 border-indigo-500/60 text-white font-medium"
															: "bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700"
													}`}
												>
													<div className="flex items-center gap-2 truncate">
														<TableIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
														<span className="font-mono truncate">
															{item.name}
														</span>
													</div>

													<div className="flex items-center gap-1.5">
														{item.estimatedRows !== undefined && (
															<span className="text-[10px] text-slate-500 font-mono">
																{item.estimatedRows} rows
															</span>
														)}
														{databaseEngine === "mongo" && (
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	handleDropCollection(item.name);
																}}
																className="text-slate-600 hover:text-red-400 p-0.5"
															>
																<Trash2 className="w-3 h-3" />
															</button>
														)}
													</div>
												</div>
											))
										)}
									</div>
								</div>

								{/* Right: Records / Documents Data Table */}
								<div className="md:col-span-3 rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
										<div>
											<h2 className="text-sm font-bold text-white font-mono flex items-center gap-2">
												<span>{selectedEntity || "Select target"}</span>
												{selectedDatabase && (
													<Badge
														variant="outline"
														className="text-[10px] border-slate-800 text-indigo-300 font-mono"
													>
														db: {selectedDatabase}
													</Badge>
												)}
												{entityData?.total !== undefined && (
													<span className="text-[11px] font-normal text-slate-400">
														({entityData.total} total records)
													</span>
												)}
											</h2>
											<p className="text-xs text-slate-400 mt-0.5">
												Browse, filter, inspect, and modify live database records.
											</p>
										</div>

										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleOpenImportModal(selectedEntity)}
												className="border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs h-8 px-3 gap-1.5"
											>
												<Upload className="w-3.5 h-3.5 text-indigo-400" /> Import Data
											</Button>

											<Button
												size="sm"
												onClick={() => {
													setInsertPayload(
														databaseEngine === "mongo"
															? '{\n  "name": "example",\n  "active": true\n}'
															: "{}",
													);
													setIsInsertModalOpen(true);
												}}
												className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-3 gap-1.5"
											>
												<Plus className="w-3.5 h-3.5" /> Insert{" "}
												{databaseEngine === "mongo" ? "Document" : "Row"}
											</Button>
										</div>
									</div>

									{/* Filter bar */}
									{databaseEngine === "mongo" && (
										<div className="flex items-center gap-2">
											<Input
												placeholder='JSON Filter (e.g. {"status": "active"})'
												value={filterInput}
												onChange={(e) => setFilterInput(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") handleApplyFilter();
												}}
												className="bg-slate-950 border-slate-800 text-xs h-8 text-white font-mono"
											/>
											<Button
												size="sm"
												onClick={handleApplyFilter}
												className="bg-slate-800 text-white text-xs h-8 px-3"
											>
												Filter
											</Button>
										</div>
									)}

									{/* Data Table */}
									<div className="rounded-lg border border-slate-800 overflow-x-auto min-h-[280px]">
										{isDataLoading ? (
											<div className="p-12 text-center text-xs text-slate-500">
												<RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
												Querying instance records...
											</div>
										) : isDataError || (entityData as any)?.error ? (
											<div className="p-8 text-center text-xs space-y-3">
												<div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
													<AlertTriangle className="w-5 h-5" />
												</div>
												<div>
													<p className="text-sm font-semibold text-white">
														Unable to retrieve records from &apos;{selectedEntity}&apos;
													</p>
													<p className="text-xs text-red-400 font-mono mt-1 max-w-lg mx-auto break-words">
														{(entityData as any)?.error ||
															entityDataError?.message ||
															"Database query failed."}
													</p>
												</div>
												<Button
													size="sm"
													variant="outline"
													onClick={() => refetchData()}
													className="border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs h-8 px-4 gap-1.5"
												>
													<RefreshCw className="w-3.5 h-3.5" /> Retry Query
												</Button>
											</div>
										) : (!entityData?.rows && !(entityData as any)?.documents) ||
										  ((entityData?.rows || (entityData as any)?.documents || []).length === 0) ? (
											<div className="p-12 text-center text-xs text-slate-500 space-y-2">
												<TableIcon className="w-8 h-8 text-slate-700 mx-auto" />
												<p className="text-slate-400 font-medium">
													{filterInput
														? "No records match the current filter criteria."
														: "No records in this collection/table."}
												</p>
												{filterInput && (
													<Button
														size="sm"
														variant="outline"
														onClick={() => {
															setFilterInput("");
															setActiveFilter({});
															setCurrentPage(1);
														}}
														className="border-slate-800 text-slate-300 text-xs h-7 px-3 mt-2"
													>
														Clear Filter
													</Button>
												)}
											</div>
										) : (
											(() => {
												const records = Array.isArray(entityData?.rows)
													? entityData.rows
													: Array.isArray((entityData as any)?.documents)
														? (entityData as any).documents
														: [];
												const colSet = new Set<string>();
												for (const r of records) {
													if (r && typeof r === "object") {
														for (const k of Object.keys(r)) {
															colSet.add(k);
														}
													}
												}
												const cols = Array.from(colSet);
												cols.sort((a, b) => {
													if (a === "_id" || a === "id") return -1;
													if (b === "_id" || b === "id") return 1;
													return a.localeCompare(b);
												});

												return (
													<table className="w-full text-left text-xs font-mono">
														<thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
															<tr>
																{cols.map((col) => (
																	<th
																		key={col}
																		className="px-3 py-2.5 font-semibold text-slate-300"
																	>
																		{col}
																	</th>
																))}
																<th className="px-3 py-2.5 text-right">Actions</th>
															</tr>
														</thead>
														<tbody className="divide-y divide-slate-800/60">
															{records.map((row: any, rIdx: number) => (
																<tr
																	key={row._id || row.id || rIdx}
																	className="hover:bg-slate-800/40 transition-colors"
																>
																	{cols.map((col) => (
																		<td
																			key={col}
																			className="px-3 py-2 text-slate-300 truncate max-w-xs"
																		>
																			{row[col] === null ? (
																				<span className="text-slate-600 italic">null</span>
																			) : row[col] === undefined ? (
																				<span className="text-slate-600 italic">undefined</span>
																			) : typeof row[col] === "boolean" ? (
																				<span
																					className={
																						row[col]
																							? "text-emerald-400 font-semibold"
																							: "text-amber-400 font-semibold"
																					}
																				>
																					{String(row[col])}
																				</span>
																			) : typeof row[col] === "number" ? (
																				<span className="text-cyan-400">
																					{row[col]}
																				</span>
																			) : typeof row[col] === "object" ? (
																				<span
																					className="text-slate-300 truncate block max-w-[200px]"
																					title={JSON.stringify(row[col])}
																				>
																					{JSON.stringify(row[col])}
																				</span>
																			) : (
																				<span
																					className="truncate block max-w-[200px]"
																					title={String(row[col])}
																				>
																					{String(row[col])}
																				</span>
																			)}
																		</td>
																	))}
																	<td className="px-3 py-2 text-right shrink-0">
																		<div className="flex items-center justify-end gap-1.5">
																			<button
																				type="button"
																				title="Inspect document"
																				onClick={() => {
																					setViewingDocument(row);
																					setIsViewDocModalOpen(true);
																				}}
																				className="p-1 text-slate-400 hover:text-cyan-300 rounded hover:bg-slate-800"
																			>
																				<Eye className="w-3.5 h-3.5" />
																			</button>
																			<button
																				type="button"
																				title="Edit record"
																				onClick={() => {
																					const rowId =
																						row._id ||
																						row.id ||
																						Object.values(row)[0];
																					setEditRowId(rowId);
																					setEditPayload(
																						JSON.stringify(row, null, 2),
																					);
																					setIsEditModalOpen(true);
																				}}
																				className="p-1 text-slate-400 hover:text-indigo-300 rounded hover:bg-slate-800"
																			>
																				<Edit className="w-3.5 h-3.5" />
																			</button>
																			<button
																				type="button"
																				title="Delete record"
																				onClick={() => handleDeleteRecord(row)}
																				className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800"
																			>
																				<Trash2 className="w-3.5 h-3.5" />
																			</button>
																		</div>
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												);
											})()
										)}
									</div>

									{/* Pagination footer */}
									{entityData &&
										(entityData.total > 0 ||
											(entityData.rows || (entityData as any).documents)?.length >
												0) &&
										(() => {
											const recordsArr = entityData.rows || (entityData as any).documents;
											const totalCount =
												entityData.total !== undefined
													? entityData.total
													: recordsArr?.length || 0;
											const totalPages = Math.max(1, Math.ceil(totalCount / 25));
											const start = (currentPage - 1) * 25 + 1;
											const end = Math.min(currentPage * 25, totalCount);

											return (
												<div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 pt-3 border-t border-slate-800/80 gap-3">
													<span>
														Showing records {start} to {end} of {totalCount} total
														{totalPages > 1 &&
															` (Page ${currentPage} of ${totalPages})`}
													</span>
													<div className="flex items-center gap-1.5">
														<Button
															size="sm"
															disabled={currentPage <= 1}
															onClick={() => setCurrentPage(1)}
															className="bg-slate-800 text-white text-xs h-7 px-2.5 disabled:opacity-40"
														>
															First
														</Button>
														<Button
															size="sm"
															disabled={currentPage <= 1}
															onClick={() =>
																setCurrentPage((p) => Math.max(1, p - 1))
															}
															className="bg-slate-800 text-white text-xs h-7 px-3 disabled:opacity-40"
														>
															Previous
														</Button>
														<Button
															size="sm"
															disabled={currentPage >= totalPages}
															onClick={() => setCurrentPage((p) => p + 1)}
															className="bg-slate-800 text-white text-xs h-7 px-3 disabled:opacity-40"
														>
															Next
														</Button>
														<Button
															size="sm"
															disabled={currentPage >= totalPages}
															onClick={() => setCurrentPage(totalPages)}
															className="bg-slate-800 text-white text-xs h-7 px-2.5 disabled:opacity-40"
														>
															Last
														</Button>
													</div>
												</div>
											);
										})()}
								</div>
							</div>
						)}
					</TabsContent>

					{/* ========================================================= */}
					{/* TAB 2: SQL QUERY EDITOR                                   */}
					{/* ========================================================= */}
					{meta.isSql && (
						<TabsContent value="sql" className="space-y-4 m-0">
							<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
								<div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
									<div>
										<h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
											<Code2 className="w-4 h-4 text-indigo-400" /> SQL Query
											Studio
										</h2>
										<p className="text-xs text-slate-400 mt-0.5">
											Execute custom queries with parameter protection, syntax
											highlighting, and execution metrics.
										</p>
									</div>

									<Button
										size="sm"
										disabled={isExecutingSql}
										onClick={() => runSqlQuery(false)}
										className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-4 gap-1.5 shadow-sm"
									>
										{isExecutingSql ? (
											<RefreshCw className="w-3.5 h-3.5 animate-spin" />
										) : (
											<Play className="w-3.5 h-3.5" />
										)}
										Run Query
									</Button>
								</div>

								{/* Query Editor */}
								<div className="border border-slate-800 rounded-lg overflow-hidden min-h-[160px] bg-slate-950">
									<CodeEditor
										value={sqlQuery}
										onChange={(val) => setSqlQuery(val)}
										language="shell"
										className="font-mono text-xs"
									/>
								</div>

								{/* SQL Results view */}
								{sqlResult && (
									<div className="space-y-2 pt-2">
										<div className="flex items-center justify-between text-xs text-slate-400">
											<span className="font-semibold text-white">
												Query Results
											</span>
											{sqlResult.durationMs !== undefined && (
												<span>
													Returned {sqlResult.rowCount} rows in{" "}
													{sqlResult.durationMs}ms
												</span>
											)}
										</div>

										{sqlResult.error ? (
											<div className="p-3 rounded-lg bg-red-950/30 border border-red-500/30 text-xs text-red-300 font-mono">
												{sqlResult.error}
											</div>
										) : sqlResult.rows?.length === 0 ? (
											<div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400">
												{sqlResult.statusMessage ||
													"Query executed successfully with 0 rows returned."}
											</div>
										) : (
											<div className="rounded-lg border border-slate-800 overflow-x-auto max-h-96">
												<table className="w-full text-left text-xs font-mono">
													<thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
														<tr>
															{sqlResult.columns?.map((col: string) => (
																<th
																	key={col}
																	className="px-3 py-2.5 font-semibold text-slate-300"
																>
																	{col}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
														{sqlResult.rows?.map((row: any, rIdx: number) => (
															<tr key={rIdx} className="hover:bg-slate-800/40">
																{sqlResult.columns?.map((col: string) => (
																	<td
																		key={col}
																		className="px-3 py-2 text-slate-300 truncate max-w-xs"
																	>
																		{typeof row[col] === "object"
																			? JSON.stringify(row[col])
																			: String(row[col] ?? "")}
																	</td>
																))}
															</tr>
														))}
													</tbody>
												</table>
											</div>
										)}
									</div>
								)}
							</div>
						</TabsContent>
					)}

					{/* ========================================================= */}
					{/* TAB 3: USERS & PRIVILEGES                                 */}
					{/* ========================================================= */}
					<TabsContent value="users" className="space-y-4 m-0">
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
							<div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
								<div>
									<h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
										<Users className="w-4 h-4 text-indigo-400" /> Database Users
										& Roles
									</h2>
									<p className="text-xs text-slate-400 mt-0.5">
										Manage least-privilege credentials scoped directly to this
										customer database.
									</p>
								</div>

								<Button
									size="sm"
									onClick={() => setIsCreateUserOpen(true)}
									className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-3 gap-1.5"
								>
									<Plus className="w-3.5 h-3.5" /> Add Database User
								</Button>
							</div>

							<div className="rounded-lg border border-slate-800 overflow-x-auto">
								<table className="w-full text-left text-xs font-mono">
									<thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
										<tr>
											<th className="px-4 py-3">Username</th>
											<th className="px-4 py-3">Database / AuthSource</th>
											<th className="px-4 py-3">Assigned Roles</th>
											<th className="px-4 py-3 text-right">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
										{isUsersLoading ? (
											<tr>
												<td
													colSpan={4}
													className="p-8 text-center text-slate-500"
												>
													Loading database users...
												</td>
											</tr>
										) : dbUsers.length === 0 ? (
											<tr>
												<td
													colSpan={4}
													className="p-8 text-center text-slate-500"
												>
													No extra database users found.
												</td>
											</tr>
										) : (
											dbUsers.map((u: any) => (
												<tr
													key={u.user}
													className="hover:bg-slate-800/30 transition-colors"
												>
													<td className="px-4 py-3 font-bold text-white">
														{u.user}
													</td>
													<td className="px-4 py-3 text-slate-300">
														{u.db || activeRecord?.databaseName || "app"}
													</td>
													<td className="px-4 py-3">
														<div className="flex flex-wrap gap-1">
															{u.roles?.map((r: string, i: number) => (
																<Badge
																	key={i}
																	variant="outline"
																	className="text-[10px] bg-slate-900 border-slate-800 text-indigo-300"
																>
																	{r}
																</Badge>
															))}
														</div>
													</td>
													<td className="px-4 py-3 text-right">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleDropUser(u.user)}
															className="text-slate-500 hover:text-red-400 h-7 w-7 p-0"
														>
															<Trash2 className="w-3.5 h-3.5" />
														</Button>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					</TabsContent>

					{/* ========================================================= */}
					{/* TAB 4: ENGINE METRICS & STATS                             */}
					{/* ========================================================= */}
					<TabsContent value="stats" className="space-y-4 m-0">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-1">
								<span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
									Engine Version
								</span>
								<p className="text-xl font-bold text-white">
									{engineStats?.version || meta.label}
								</p>
								<span className="text-[11px] text-slate-400 block pt-1">
									Managed Database Runtime
								</span>
							</div>

							<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-1">
								<span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
									Storage Allocation
								</span>
								<p className="text-xl font-bold text-indigo-400">
									{engineStats?.dataSize ||
										engineStats?.usedMemory ||
										"Managed Volume"}
								</p>
								<span className="text-[11px] text-slate-400 block pt-1">
									Encrypted Persistent Storage
								</span>
							</div>

							<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-1">
								<span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
									Schema Objects
								</span>
								<p className="text-xl font-bold text-emerald-400">
									{engineStats?.collectionsCount ??
										engineStats?.tablesCount ??
										engineStats?.totalKeys ??
										collectionsOrTables.length}
								</p>
								<span className="text-[11px] text-slate-400 block pt-1">
									{databaseEngine === "mongo"
										? "Collections"
										: databaseEngine === "redis"
											? "Keys"
											: "Tables"}
								</span>
							</div>
						</div>

						{/* Security & Access Overview */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-3">
							<h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
								<Shield className="w-4 h-4 text-emerald-400" /> Isolation
								Architecture
							</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
								<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
									<span className="text-slate-500 font-semibold block text-[10px]">
										AUTHENTICATION PROTOCOL
									</span>
									<p className="font-mono text-slate-200">
										{databaseEngine === "mongo"
											? "SCRAM-SHA-256 (authSource: admin)"
											: "Native Handshake & Password Auth"}
									</p>
								</div>
								<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
									<span className="text-slate-500 font-semibold block text-[10px]">
										NETWORK BOUNDARY
									</span>
									<p className="font-mono text-slate-200">
										Isolated Private VPC + Edge Routing
									</p>
								</div>
							</div>
						</div>
					</TabsContent>
				</Tabs>
			</div>

			{/* ========================================================= */}
			{/* MODALS                                                    */}
			{/* ========================================================= */}

			{/* Connection Details Modal */}
			{isConnectionModalOpen && activeRecord && (
				<Dialog
					open={isConnectionModalOpen}
					onOpenChange={setIsConnectionModalOpen}
				>
					<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Key className="w-5 h-5 text-indigo-400" />
								<span>Connection Information: {activeRecord.name}</span>
							</DialogTitle>
						</DialogHeader>
						<div className="py-2">
							<DatabaseConnectionCard
								databaseId={databaseId}
								databaseType={databaseEngine}
								data={activeRecord}
								refetch={refetchOverview}
							/>
						</div>
					</DialogContent>
				</Dialog>
			)}

			{/* Insert Document / Row Modal */}
			<Dialog open={isInsertModalOpen} onOpenChange={setIsInsertModalOpen}>
				<DialogContent className="max-w-xl bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle>
							Insert New {databaseEngine === "mongo" ? "Document" : "Row"}
						</DialogTitle>
						<DialogDescription className="text-xs text-slate-400">
							Enter valid JSON record payload for &apos;{selectedEntity}&apos;.
						</DialogDescription>
					</DialogHeader>

					<div className="py-2">
						<Textarea
							value={insertPayload}
							onChange={(e) => setInsertPayload(e.target.value)}
							rows={8}
							className="font-mono text-xs bg-slate-900 border-slate-800 text-white"
						/>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsInsertModalOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleInsertSubmit}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4"
						>
							Insert Record
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Edit Document / Row Modal */}
			<Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
				<DialogContent className="max-w-xl bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle>
							Edit {databaseEngine === "mongo" ? "Document" : "Row"}
						</DialogTitle>
						<DialogDescription className="text-xs text-slate-400">
							Update JSON payload for record ID {String(editRowId)}.
						</DialogDescription>
					</DialogHeader>

					<div className="py-2">
						<Textarea
							value={editPayload}
							onChange={(e) => setEditPayload(e.target.value)}
							rows={8}
							className="font-mono text-xs bg-slate-900 border-slate-800 text-white"
						/>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsEditModalOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleUpdateSubmit}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4"
						>
							Save Changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* View Document Details Modal */}
			<Dialog open={isViewDocModalOpen} onOpenChange={setIsViewDocModalOpen}>
				<DialogContent className="max-w-2xl bg-slate-950 border-slate-800 text-white max-h-[85vh] flex flex-col">
					<DialogHeader className="border-b border-slate-800 pb-3">
						<div className="flex items-center justify-between pr-6">
							<DialogTitle className="flex items-center gap-2 text-sm font-bold font-mono">
								<FileText className="w-4 h-4 text-indigo-400" />
								<span>Document Details: {selectedEntity}</span>
							</DialogTitle>
							<Badge
								variant="outline"
								className="text-[10px] border-slate-800 font-mono text-slate-400"
							>
								ID: {String(viewingDocument?._id || viewingDocument?.id || "N/A")}
							</Badge>
						</div>
						<DialogDescription className="text-xs text-slate-400 mt-1">
							Structured document inspection with preserved BSON types, dates, and nested structures.
						</DialogDescription>
					</DialogHeader>

					<div className="flex-1 overflow-y-auto py-3 space-y-4">
						{/* Field Breakdown */}
						<div className="rounded-lg border border-slate-800/80 divide-y divide-slate-800/60 bg-slate-900/40 text-xs font-mono">
							{viewingDocument &&
								Object.entries(viewingDocument).map(([key, value]) => {
									const valType =
										value === null
											? "null"
											: Array.isArray(value)
												? `array[${value.length}]`
												: typeof value;
									return (
										<div
											key={key}
											className="p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 hover:bg-slate-800/30 transition-colors"
										>
											<div className="flex items-center gap-2 shrink-0 sm:w-1/3">
												<span className="font-semibold text-indigo-300">
													{key}
												</span>
												<span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-sans">
													{valType}
												</span>
											</div>
											<div className="sm:w-2/3 break-all text-slate-200">
												{typeof value === "object" && value !== null ? (
													<pre className="p-2 rounded bg-slate-950 border border-slate-800/80 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48 text-emerald-300 font-mono">
														{JSON.stringify(value, null, 2)}
													</pre>
												) : typeof value === "boolean" ? (
													<span
														className={
															value
																? "text-emerald-400 font-semibold"
																: "text-amber-400 font-semibold"
														}
													>
														{String(value)}
													</span>
												) : typeof value === "number" ? (
													<span className="text-cyan-400">{value}</span>
												) : value === null ? (
													<span className="text-slate-500 italic">null</span>
												) : (
													<span className="text-slate-100">
														{String(value)}
													</span>
												)}
											</div>
										</div>
									);
								})}
						</div>

						{/* Raw JSON */}
						<div className="space-y-1.5">
							<div className="flex items-center justify-between text-xs text-slate-400">
								<span className="font-semibold uppercase tracking-wider text-[10px]">
									Raw JSON Representation
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										navigator.clipboard.writeText(
											JSON.stringify(viewingDocument, null, 2),
										);
										toast.success("Document JSON copied to clipboard");
									}}
									className="h-6 text-[11px] text-slate-400 hover:text-white gap-1 px-2"
								>
									<Copy className="w-3 h-3" /> Copy JSON
								</Button>
							</div>
							<pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
								{JSON.stringify(viewingDocument, null, 2)}
							</pre>
						</div>
					</div>

					<DialogFooter className="border-t border-slate-800 pt-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsViewDocModalOpen(false)}
							className="text-xs text-slate-400"
						>
							Close
						</Button>
						<Button
							size="sm"
							onClick={() => {
								setIsViewDocModalOpen(false);
								const rowId =
									viewingDocument?._id ||
									viewingDocument?.id ||
									Object.values(viewingDocument || {})[0];
								setEditRowId(rowId);
								setEditPayload(JSON.stringify(viewingDocument, null, 2));
								setIsEditModalOpen(true);
							}}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3.5 gap-1.5"
						>
							<Edit className="w-3.5 h-3.5" /> Edit Record
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Create Mongo Collection Modal */}
			<Dialog
				open={isCreateCollModalOpen}
				onOpenChange={setIsCreateCollModalOpen}
			>
				<DialogContent className="max-w-md bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle>Create MongoDB Collection</DialogTitle>
						<DialogDescription className="text-xs text-slate-400">
							Add a new collection namespace to this database.
						</DialogDescription>
					</DialogHeader>

					<div className="py-2">
						<Input
							placeholder="Collection name (e.g. orders, users)"
							value={newCollName}
							onChange={(e) => setNewCollName(e.target.value)}
							className="bg-slate-900 border-slate-800 text-xs text-white"
						/>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsCreateCollModalOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleCreateCollection}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4"
						>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Add Redis Key Modal */}
			<Dialog open={isAddRedisKeyOpen} onOpenChange={setIsAddRedisKeyOpen}>
				<DialogContent className="max-w-md bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle>Add Redis Key</DialogTitle>
					</DialogHeader>

					<div className="space-y-3 py-2">
						<div>
							<label className="text-xs text-slate-400">Key Name</label>
							<Input
								placeholder="e.g. session:user_123"
								value={newRedisKey}
								onChange={(e) => setNewRedisKey(e.target.value)}
								className="bg-slate-900 border-slate-800 text-xs text-white font-mono mt-1"
							/>
						</div>

						<div>
							<label className="text-xs text-slate-400">String Value</label>
							<Textarea
								placeholder="Value payload"
								value={newRedisVal}
								onChange={(e) => setNewRedisVal(e.target.value)}
								className="bg-slate-900 border-slate-800 text-xs text-white font-mono mt-1"
								rows={4}
							/>
						</div>

						<div>
							<label className="text-xs text-slate-400">
								TTL in seconds (optional)
							</label>
							<Input
								placeholder="e.g. 3600 (leave blank for persistent)"
								value={newRedisTtl}
								onChange={(e) => setNewRedisTtl(e.target.value)}
								className="bg-slate-900 border-slate-800 text-xs text-white mt-1"
							/>
						</div>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsAddRedisKeyOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleAddRedisKey}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4"
						>
							Save Key
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Create Database User Modal */}
			<Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
				<DialogContent className="max-w-md bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle>Add Dedicated Database User</DialogTitle>
						<DialogDescription className="text-xs text-slate-400">
							Create credentials restricted solely to this database.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3 py-2">
						<div>
							<label className="text-xs text-slate-400">Username</label>
							<Input
								placeholder="e.g. report_worker"
								value={newDbUser}
								onChange={(e) => setNewDbUser(e.target.value)}
								className="bg-slate-900 border-slate-800 text-xs text-white mt-1"
							/>
						</div>

						<div>
							<label className="text-xs text-slate-400">Password</label>
							<Input
								type="text"
								placeholder="Secure password"
								value={newDbUserPass}
								onChange={(e) => setNewDbUserPass(e.target.value)}
								className="bg-slate-900 border-slate-800 text-xs text-white font-mono mt-1"
							/>
						</div>

						<div>
							<label className="text-xs text-slate-400">Role Privilege</label>
							<Select
								value={newDbUserRoles}
								onValueChange={(val) => setNewDbUserRoles(val)}
							>
								<SelectTrigger className="bg-slate-900 border-slate-800 text-xs text-white mt-1">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="bg-slate-900 border-slate-800 text-white">
									<SelectItem value="readWrite">
										Read & Write (readWrite)
									</SelectItem>
									<SelectItem value="read">Read Only (read)</SelectItem>
									<SelectItem value="dbAdmin">
										Database Admin (dbAdmin)
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsCreateUserOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleCreateUser}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4"
						>
							Create User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* ========================================================= */}
			{/* UNIVERSAL DATA IMPORT DIALOG (ALL 6 ENGINES)               */}
			{/* ========================================================= */}
			<Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
				<DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white p-6 max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2.5">
								<div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-indigo-400">
									<Upload className="w-5 h-5" />
								</div>
								<div>
									<DialogTitle className="text-base font-bold text-white flex items-center gap-2">
										<span>Import Data into {meta.label}</span>
										<Badge
											variant="outline"
											className="text-[10px] uppercase font-mono border-slate-700"
										>
											{databaseEngine}
										</Badge>
									</DialogTitle>
									<DialogDescription className="text-xs text-slate-400 mt-0.5">
										Upload CSV or JSON records with schema-aware mapping, type
										validation, and duplicate handling.
									</DialogDescription>
								</div>
							</div>
						</div>

						{/* Step indicator bar */}
						<div className="flex items-center justify-between border-t border-b border-slate-800/80 py-2.5 my-3 text-xs">
							<div
								className={`flex items-center gap-1.5 font-medium ${
									importStep === "upload"
										? "text-indigo-400"
										: "text-slate-400"
								}`}
							>
								<span
									className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
										importStep === "upload"
											? "bg-indigo-600 text-white"
											: "bg-slate-800 text-slate-400"
									}`}
								>
									1
								</span>
								<span>Select Source</span>
							</div>
							<ChevronRight className="w-3.5 h-3.5 text-slate-600" />
							<div
								className={`flex items-center gap-1.5 font-medium ${
									importStep === "mapping"
										? "text-indigo-400"
										: "text-slate-400"
								}`}
							>
								<span
									className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
										importStep === "mapping"
											? "bg-indigo-600 text-white"
											: "bg-slate-800 text-slate-400"
									}`}
								>
									2
								</span>
								<span>Configure & Map</span>
							</div>
							<ChevronRight className="w-3.5 h-3.5 text-slate-600" />
							<div
								className={`flex items-center gap-1.5 font-medium ${
									importStep === "preview"
										? "text-indigo-400"
										: "text-slate-400"
								}`}
							>
								<span
									className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
										importStep === "preview"
											? "bg-indigo-600 text-white"
											: "bg-slate-800 text-slate-400"
									}`}
								>
									3
								</span>
								<span>Preview</span>
							</div>
							<ChevronRight className="w-3.5 h-3.5 text-slate-600" />
							<div
								className={`flex items-center gap-1.5 font-medium ${
									importStep === "result" || importStep === "importing"
										? "text-indigo-400"
										: "text-slate-400"
								}`}
							>
								<span
									className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
										importStep === "result"
											? "bg-emerald-600 text-white"
											: "bg-slate-800 text-slate-400"
									}`}
								>
									4
								</span>
								<span>Results</span>
							</div>
						</div>
					</DialogHeader>

					{/* STEP 1: SELECT SOURCE */}
					{importStep === "upload" && (
						<div className="space-y-4 py-2">
							{/* Engine Support Summary Banner */}
							<div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5">
								<Database className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
								<div>
									<p className="font-semibold text-white">
										Supported Format for {meta.label}
									</p>
									<p className="text-[11px] text-slate-400 mt-0.5">
										{meta.isSql
											? "CSV and JSON records imported into any selected table with schema-aware type conversion (integers, floats, booleans, timestamps, JSON)."
											: databaseEngine === "mongo"
												? "JSON document arrays or CSV-to-document records imported into any collection with automatic type preservation."
												: "JSON or CSV records mapped into Redis keys (Hashes, Strings, Lists, Sets, or Sorted Sets)."}
									</p>
								</div>
							</div>

							{/* File Dropzone / Selector */}
							<div className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-8 text-center transition-all bg-slate-900/30">
								<input
									type="file"
									id="import-file-input"
									accept=".csv,.json,.jsonl,.ndjson,text/csv,application/json"
									className="hidden"
									onChange={handleFileChange}
								/>
								<label
									htmlFor="import-file-input"
									className="cursor-pointer flex flex-col items-center gap-2.5"
								>
									<div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-indigo-400">
										<Upload className="w-6 h-6" />
									</div>
									<div>
										<p className="text-sm font-semibold text-white">
											Click to upload or drag and drop
										</p>
										<p className="text-xs text-slate-400 mt-0.5">
											CSV or JSON files up to 10MB
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="border-slate-700 text-xs text-slate-300 pointer-events-none mt-1"
									>
										Browse Files
									</Button>
								</label>
							</div>

							{/* Or Direct Paste Toggle */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<label className="text-xs font-semibold text-slate-300">
										Or Paste Raw CSV / JSON Data Directly:
									</label>
									<div className="flex items-center gap-2">
										<span className="text-[11px] text-slate-400">Format:</span>
										<Select
											value={importFileType}
											onValueChange={(val: "csv" | "json") =>
												setImportFileType(val)
											}
										>
											<SelectTrigger className="bg-slate-900 border-slate-800 text-[11px] h-7 w-24 text-white">
												<SelectValue />
											</SelectTrigger>
											<SelectContent className="bg-slate-900 border-slate-800 text-white">
												<SelectItem value="csv">CSV</SelectItem>
												<SelectItem value="json">JSON</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>

								<Textarea
									placeholder={
										importFileType === "csv"
											? "id,name,email,created_at\n1,Alice,alice@example.com,2026-01-01\n2,Bob,bob@example.com,2026-01-02"
											: '[\n  {"id": 1, "name": "Alice", "email": "alice@example.com"},\n  {"id": 2, "name": "Bob", "email": "bob@example.com"}\n]'
									}
									value={importFileContent}
									onChange={(e) => {
										setImportFileContent(e.target.value);
										setImportFileName(`pasted_data.${importFileType}`);
										setImportFileSize(e.target.value.length);
									}}
									rows={4}
									className="bg-slate-900/60 border-slate-800 text-xs font-mono text-slate-200"
								/>

								{importFileContent.trim() && (
									<div className="flex justify-end">
										<Button
											size="sm"
											onClick={() =>
												processFileContent(importFileContent, importFileType)
											}
											disabled={previewMutation.isPending}
											className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-4 gap-1.5"
										>
											{previewMutation.isPending ? (
												<>
													<RefreshCw className="w-3.5 h-3.5 animate-spin" />
													Analyzing...
												</>
											) : (
												<>
													Continue to Mapping
													<ArrowRight className="w-3.5 h-3.5" />
												</>
											)}
										</Button>
									</div>
								)}
							</div>
						</div>
					)}

					{/* STEP 2: CONFIGURE & MAP */}
					{importStep === "mapping" && (
						<div className="space-y-4 py-2">
							{/* Destination Target & Duplicate Policy Controls */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
								{/* Target Entity */}
								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1.5">
										{meta.isSql
											? "Target Table"
											: databaseEngine === "mongo"
												? "Target Collection"
												: "Redis Key Prefix / Target"}
									</label>

									{databaseEngine === "redis" ? (
										<Input
											placeholder="e.g. user: or item:"
											value={importTargetEntity}
											onChange={(e) => {
												setImportTargetEntity(e.target.value);
												setRedisKeyPrefix(e.target.value);
											}}
											className="bg-slate-950 border-slate-800 text-xs text-white font-mono h-8"
										/>
									) : (
										<div className="flex items-center gap-2">
											<Select
												value={importTargetEntity}
												onValueChange={(val) => setImportTargetEntity(val)}
											>
												<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white font-mono h-8">
													<SelectValue placeholder="Select target" />
												</SelectTrigger>
												<SelectContent className="bg-slate-900 border-slate-800 text-white">
													{collectionsOrTables.map((item: any) => (
														<SelectItem key={item.name} value={item.name}>
															{item.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>

											<Input
												placeholder="Or type new name"
												value={importTargetEntity}
												onChange={(e) => setImportTargetEntity(e.target.value)}
												className="bg-slate-950 border-slate-800 text-xs text-white font-mono h-8 w-44 shrink-0"
											/>
										</div>
									)}
								</div>

								{/* Duplicate Policy */}
								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1.5">
										Duplicate Record Handling Policy
									</label>
									<Select
										value={importDuplicatePolicy}
										onValueChange={(val: "skip" | "update" | "reject") =>
											setImportDuplicatePolicy(val)
										}
									>
										<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white h-8">
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="bg-slate-900 border-slate-800 text-white">
											<SelectItem value="skip">
												Skip Duplicates (Ignore conflict, preserve existing)
											</SelectItem>
											<SelectItem value="update">
												Update Existing (Upsert / Overwrite with new data)
											</SelectItem>
											<SelectItem value="reject">
												Reject on Duplicate (Strict unique constraint
												enforcement)
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							{/* Redis Engine Specific Controls */}
							{databaseEngine === "redis" && (
								<div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20 space-y-3">
									<h4 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
										<Settings2 className="w-3.5 h-3.5" /> Redis Key-Value
										Structure Mapping
									</h4>

									<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
										<div>
											<label className="text-[11px] text-slate-300 block mb-1">
												Redis Data Structure
											</label>
											<Select
												value={redisStructure}
												onValueChange={(val: any) => setRedisStructure(val)}
											>
												<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white h-8">
													<SelectValue />
												</SelectTrigger>
												<SelectContent className="bg-slate-900 border-slate-800 text-white">
													<SelectItem value="hash">
														Hash (Recommended)
													</SelectItem>
													<SelectItem value="string">
														String (JSON stringified)
													</SelectItem>
													<SelectItem value="list">List (RPUSH)</SelectItem>
													<SelectItem value="set">
														Set (SADD unique members)
													</SelectItem>
													<SelectItem value="zset">
														Sorted Set (ZADD with score)
													</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div>
											<label className="text-[11px] text-slate-300 block mb-1">
												Key Identifier Column
											</label>
											<Select
												value={redisKeyField}
												onValueChange={(val) => setRedisKeyField(val)}
											>
												<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white h-8 font-mono">
													<SelectValue placeholder="Choose key field" />
												</SelectTrigger>
												<SelectContent className="bg-slate-900 border-slate-800 text-white font-mono">
													{previewData?.headers.map((h) => (
														<SelectItem key={h} value={h}>
															{h}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										{redisStructure === "zset" ? (
											<div>
												<label className="text-[11px] text-slate-300 block mb-1">
													Score Column
												</label>
												<Select
													value={redisScoreField}
													onValueChange={(val) => setRedisScoreField(val)}
												>
													<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white h-8 font-mono">
														<SelectValue placeholder="Score field" />
													</SelectTrigger>
													<SelectContent className="bg-slate-900 border-slate-800 text-white font-mono">
														{previewData?.headers.map((h) => (
															<SelectItem key={h} value={h}>
																{h}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										) : (
											<div>
												<label className="text-[11px] text-slate-300 block mb-1">
													TTL in seconds (optional)
												</label>
												<Input
													placeholder="e.g. 86400 (blank = persistent)"
													value={redisTtl}
													onChange={(e) => setRedisTtl(e.target.value)}
													className="bg-slate-950 border-slate-800 text-xs text-white h-8 font-mono"
												/>
											</div>
										)}
									</div>
								</div>
							)}

							{/* Field to Column Mapping Section */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
										<TableIcon className="w-3.5 h-3.5 text-indigo-400" /> Field
										to Column Mappings
									</h4>
									<span className="text-[11px] text-slate-400">
										{previewData?.headers.length || 0} fields detected in source
									</span>
								</div>

								<div className="rounded-xl border border-slate-800 overflow-hidden max-h-56 overflow-y-auto">
									<table className="w-full text-left text-xs font-mono">
										<thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
											<tr>
												<th className="px-3 py-2">Source Field</th>
												<th className="px-3 py-2">Detected Type</th>
												<th className="px-3 py-2">Target Column / Field</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
											{previewData?.headers.map((header) => {
												const detectedType =
													previewData.sampleInferredTypes?.[header] || "string";
												const currentTarget =
													importFieldMappings[header] ?? header;

												return (
													<tr key={header} className="hover:bg-slate-800/30">
														<td className="px-3 py-2 text-white font-semibold">
															{header}
														</td>
														<td className="px-3 py-2">
															<span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-cyan-300 border border-slate-700">
																{detectedType}
															</span>
														</td>
														<td className="px-3 py-2">
															<div className="flex items-center gap-2">
																{targetTableSchema?.columns &&
																targetTableSchema.columns.length > 0 ? (
																	<Select
																		value={currentTarget}
																		onValueChange={(val) => {
																			setImportFieldMappings((prev) => ({
																				...prev,
																				[header]: val,
																			}));
																		}}
																	>
																		<SelectTrigger className="bg-slate-950 border-slate-800 text-xs text-white h-7 font-mono w-48">
																			<SelectValue />
																		</SelectTrigger>
																		<SelectContent className="bg-slate-900 border-slate-800 text-white font-mono">
																			<SelectItem value="__ignore__">
																				[ Skip / Ignore ]
																			</SelectItem>
																			{targetTableSchema.columns.map(
																				(col: any) => (
																					<SelectItem
																						key={col.name}
																						value={col.name}
																					>
																						{col.name} ({col.type})
																					</SelectItem>
																				),
																			)}
																		</SelectContent>
																	</Select>
																) : (
																	<Input
																		value={
																			currentTarget === "__ignore__"
																				? ""
																				: currentTarget
																		}
																		placeholder="Target column (or leave blank to skip)"
																		onChange={(e) => {
																			const val =
																				e.target.value.trim() || "__ignore__";
																			setImportFieldMappings((prev) => ({
																				...prev,
																				[header]: val,
																			}));
																		}}
																		className="bg-slate-950 border-slate-800 text-xs text-white font-mono h-7 w-48"
																	/>
																)}

																{currentTarget === "__ignore__" && (
																	<span className="text-[10px] text-amber-400">
																		Omitted
																	</span>
																)}
															</div>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							</div>

							{/* Actions */}
							<div className="flex items-center justify-between pt-2 border-t border-slate-800">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setImportStep("upload")}
									className="text-xs text-slate-400"
								>
									Back
								</Button>
								<Button
									size="sm"
									onClick={() => setImportStep("preview")}
									className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-4 gap-1.5"
								>
									Review Data Preview
									<ArrowRight className="w-3.5 h-3.5" />
								</Button>
							</div>
						</div>
					)}

					{/* STEP 3: PREVIEW & CONFIRM */}
					{importStep === "preview" && (
						<div className="space-y-4 py-2">
							{/* Summary metrics header */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Engine & Target
									</span>
									<span className="text-xs font-mono font-bold text-white mt-0.5 truncate block">
										{meta.label} • {importTargetEntity}
									</span>
								</div>
								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Total Records
									</span>
									<span className="text-xs font-mono font-bold text-indigo-400 mt-0.5 block">
										{previewData?.totalRecords || 0} rows
									</span>
								</div>
								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Duplicate Policy
									</span>
									<span className="text-xs font-mono font-bold text-emerald-400 mt-0.5 uppercase block">
										{importDuplicatePolicy}
									</span>
								</div>
								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Format & Size
									</span>
									<span className="text-xs font-mono font-bold text-slate-300 mt-0.5 uppercase block">
										{importFileType} • {(importFileSize / 1024).toFixed(1)} KB
									</span>
								</div>
							</div>

							{/* Preview table */}
							<div className="space-y-2">
								<label className="text-xs font-semibold text-slate-300 block">
									Sample Record Preview (First 5 Rows)
								</label>
								<div className="rounded-xl border border-slate-800 overflow-x-auto max-h-60">
									<table className="w-full text-left text-xs font-mono">
										<thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
											<tr>
												{previewData?.headers
													.filter((h) => importFieldMappings[h] !== "__ignore__")
													.map((h) => (
														<th key={h} className="px-3 py-2 text-slate-300">
															{importFieldMappings[h] || h}
														</th>
													))}
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
											{previewData?.previewRows?.map((row, idx) => (
												<tr key={idx} className="hover:bg-slate-800/30">
													{previewData.headers
														.filter(
															(h) => importFieldMappings[h] !== "__ignore__",
														)
														.map((h) => (
															<td
																key={h}
																className="px-3 py-2 text-slate-300 truncate max-w-xs"
															>
																{typeof row[h] === "object"
																	? JSON.stringify(row[h])
																	: String(row[h] ?? "")}
															</td>
														))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>

							{/* Actions */}
							<div className="flex items-center justify-between pt-2 border-t border-slate-800">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setImportStep("mapping")}
									className="text-xs text-slate-400"
								>
									Back to Mapping
								</Button>
								<Button
									size="sm"
									onClick={handleExecuteImport}
									disabled={importMutation.isPending}
									className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-5 gap-1.5 font-semibold"
								>
									<Upload className="w-3.5 h-3.5" />
									Execute Universal Import
								</Button>
							</div>
						</div>
					)}

					{/* STEP: IMPORTING IN PROGRESS */}
					{importStep === "importing" && (
						<div className="py-12 text-center space-y-4">
							<RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
							<div>
								<h3 className="text-sm font-bold text-white">
									Persisting Records to {meta.label}...
								</h3>
								<p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
									Validating constraints, executing schema conversions, and
									writing to database safely in bounded batches.
								</p>
							</div>
						</div>
					)}

					{/* STEP 4: IMPORT RESULTS */}
					{importStep === "result" && importResult && (
						<div className="space-y-4 py-2">
							{/* Status Banner */}
							<div
								className={`p-4 rounded-xl border flex items-start gap-3 ${
									(importResult.failed ?? importResult.failedCount ?? 0) === 0
										? "bg-emerald-950/20 border-emerald-500/30 text-emerald-400"
										: (importResult.inserted ?? importResult.insertedCount ?? 0) > 0 ||
											  (importResult.updated ?? importResult.updatedCount ?? 0) > 0
											? "bg-amber-950/20 border-amber-500/30 text-amber-400"
											: "bg-red-950/20 border-red-500/30 text-red-400"
								}`}
							>
								{(importResult.failed ?? importResult.failedCount ?? 0) === 0 ? (
									<CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-400" />
								) : (
									<AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
								)}
								<div>
									<h4 className="text-sm font-bold text-white">
										{(importResult.failed ?? importResult.failedCount ?? 0) === 0
											? "Data Import Succeeded"
											: (importResult.inserted ?? importResult.insertedCount ?? 0) > 0 ||
												  (importResult.updated ?? importResult.updatedCount ?? 0) > 0
												? "Data Import Completed with Partial Warnings"
												: "Data Import Failed"}
									</h4>
									<p className="text-xs text-slate-300 mt-0.5">
										Processed {importResult.totalRows ?? importResult.totalRecords ?? 0} records in{" "}
										{importResult.durationMs ?? 0}ms into &apos;{importTargetEntity}&apos;.
									</p>
								</div>
							</div>

							{/* Metric Cards */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Inserted
									</span>
									<span className="text-lg font-mono font-bold text-emerald-400 mt-0.5 block">
										{importResult.inserted ?? importResult.insertedCount ?? 0}
									</span>
								</div>

								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Updated
									</span>
									<span className="text-lg font-mono font-bold text-cyan-400 mt-0.5 block">
										{importResult.updated ?? importResult.updatedCount ?? 0}
									</span>
								</div>

								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Skipped
									</span>
									<span className="text-lg font-mono font-bold text-slate-400 mt-0.5 block">
										{importResult.skipped ?? importResult.skippedCount ?? 0}
									</span>
								</div>

								<div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
									<span className="text-[10px] text-slate-500 uppercase tracking-wider block">
										Failed
									</span>
									<span className="text-lg font-mono font-bold text-red-400 mt-0.5 block">
										{importResult.failed ?? importResult.failedCount ?? 0}
									</span>
								</div>
							</div>

							{/* Row Error Details (if any errors occurred) */}
							{importResult.errors && importResult.errors.length > 0 && (
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<label className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
											<AlertTriangle className="w-3.5 h-3.5" />
											Row Error Details ({importResult.errors.length})
										</label>
										<Button
											size="sm"
											variant="outline"
											onClick={handleDownloadFailureReport}
											className="border-red-500/30 text-red-400 hover:bg-red-950/20 text-xs h-7 gap-1"
										>
											<Download className="w-3 h-3" /> Download Failure Report
										</Button>
									</div>

									<div className="rounded-xl border border-red-500/20 bg-red-950/10 overflow-hidden max-h-48 overflow-y-auto">
										<table className="w-full text-left text-xs font-mono">
											<thead className="bg-red-950/30 text-red-300 border-b border-red-500/20 text-[10px] uppercase">
												<tr>
													<th className="px-3 py-1.5 w-16">Row #</th>
													<th className="px-3 py-1.5 w-32">Identifier</th>
													<th className="px-3 py-1.5">Error Message</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-red-500/10 text-slate-300">
												{importResult.errors.slice(0, 50).map((err, idx) => (
													<tr key={idx}>
														<td className="px-3 py-1.5 text-red-400 font-bold">
															{err.row ?? err.rowNumber ?? idx + 1}
														</td>
														<td className="px-3 py-1.5 text-slate-400 truncate max-w-[120px]">
															{err.identifier ?? err.keyOrId ?? "-"}
														</td>
														<td className="px-3 py-1.5 text-red-300">
															{err.message ?? err.reason ?? "Unknown error"}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}

							{/* Result Actions */}
							<DialogFooter className="gap-2 pt-2 border-t border-slate-800">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => handleOpenImportModal(importTargetEntity)}
									className="text-xs text-slate-400"
								>
									Import Another File
								</Button>
								<Button
									size="sm"
									onClick={handleViewInExplorer}
									className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 gap-1.5 font-semibold"
								>
									<TableIcon className="w-3.5 h-3.5" />
									View In Data Explorer
								</Button>
							</DialogFooter>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Destructive Query Confirmation Modal */}
			<Dialog
				open={destructiveConfirmOpen}
				onOpenChange={setDestructiveConfirmOpen}
			>
				<DialogContent className="max-w-md bg-slate-950 border-red-500/40 text-white">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-red-400">
							<AlertTriangle className="w-5 h-5" />
							<span>Potentially Destructive Operation</span>
						</DialogTitle>
						<DialogDescription className="text-xs text-slate-300">
							This query contains structural or mass-deletion keywords (DROP,
							TRUNCATE, ALTER, or DELETE without WHERE).
						</DialogDescription>
					</DialogHeader>

					<div className="p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-xs font-mono text-red-300 max-h-32 overflow-auto">
						{sqlQuery}
					</div>

					<DialogFooter className="gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setDestructiveConfirmOpen(false)}
							className="text-xs text-slate-400"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={() => {
								setDestructiveConfirmOpen(false);
								runSqlQuery(true);
							}}
							className="bg-red-600 hover:bg-red-500 text-white text-xs px-4 font-semibold"
						>
							I Understand, Execute Query
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

DatabaseManagePage.getLayout = (page: ReactElement) => (
	<DashboardLayout>{page}</DashboardLayout>
);

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
	const { user, session } = await validateRequest(req);

	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	await helpers.settings.isCloud.prefetch();
	await helpers.user.get.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

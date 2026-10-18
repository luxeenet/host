import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	Check,
	CheckCircle2,
	ChevronRight,
	Clock,
	Code2,
	Copy,
	Database,
	Edit,
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
	Shield,
	ShieldAlert,
	Table as TableIcon,
	Terminal,
	Trash2,
	UserCheck,
	Users,
	Wrench,
	Zap,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { CodeEditor } from "@/components/shared/code-editor";
import { DatabaseConnectionCard } from "@/components/dashboard/database/connection/database-connection-card";
import {
	LibsqlIcon,
	MariadbIcon,
	MongodbIcon,
	MysqlIcon,
	PostgresqlIcon,
	RedisIcon,
} from "@/components/icons/data-tools-icons";

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
	const {
		data: overviewData,
		refetch: refetchOverview,
	} = api.databaseManager.overview.useQuery(undefined, {
		enabled: Boolean(databaseId),
	});

	const activeRecord = useMemo(() => {
		return overviewData?.find((d) => d.id === databaseId);
	}, [overviewData, databaseId]);

	// Engine stats query
	const {
		data: engineStats,
		isLoading: isStatsLoading,
		refetch: refetchStats,
	} = api.databaseManager.engineOverview.useQuery(
		{ databaseId, engine: databaseEngine },
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
		{ databaseId, engine: databaseEngine },
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
			{ databaseId, engine: databaseEngine, name: selectedEntity },
			{ enabled: Boolean(databaseId && selectedEntity && meta.isSql) },
		);

	// Paginated rows/documents query
	const [currentPage, setCurrentPage] = useState(1);
	const [filterInput, setFilterInput] = useState("");
	const [activeFilter, setActiveFilter] = useState<Record<string, any>>({});

	const {
		data: entityData,
		isLoading: isDataLoading,
		refetch: refetchData,
	} = api.databaseManager.queryData.useQuery(
		{
			databaseId,
			engine: databaseEngine,
			name: selectedEntity,
			page: currentPage,
			limit: 25,
			filter: filterInput || undefined,
		},
		{ enabled: Boolean(databaseId && selectedEntity && databaseEngine !== "redis") },
	);

	// Document/Row mutation modals
	const [isInsertModalOpen, setIsInsertModalOpen] = useState(false);
	const [insertPayload, setInsertPayload] = useState("{}");
	const [isEditModalOpen, setIsEditModalOpen] = useState(false);
	const [editRowId, setEditRowId] = useState<any>(null);
	const [editPayload, setEditPayload] = useState("{}");
	const [isCreateCollModalOpen, setIsCreateCollModalOpen] = useState(false);
	const [newCollName, setNewCollName] = useState("");

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
			toast.error("Invalid JSON filter. Example: {\"status\": \"active\"}");
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
				primaryKeyColumn: tableSchema?.columns?.find((c: any) => c.isPrimary)?.name,
				data: parsed,
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
				primaryKeyColumn: tableSchema?.columns?.find((c: any) => c.isPrimary)?.name,
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
			await dropCollMutation.mutateAsync({ databaseId, name });
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
		{ databaseId, pattern: redisPattern, cursor: redisCursor },
		{ enabled: Boolean(databaseId && databaseEngine === "redis") },
	);

	const { data: redisKeyDetails, isLoading: isKeyDetailsLoading, refetch: refetchKeyDetails } =
		api.databaseManager.redisGetKey.useQuery(
			{ databaseId, key: selectedRedisKey },
			{ enabled: Boolean(databaseId && databaseEngine === "redis" && selectedRedisKey) },
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
			await redisDeleteMutation.mutateAsync({ databaseId, key });
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
			});
			setRedisConsoleLogs((prev) => [...prev, res.output || "OK"]);
		} catch (err: any) {
			setRedisConsoleLogs((prev) => [...prev, `ERROR: ${err?.message || "Command failed"}`]);
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
			(/\bDELETE\b/i.test(sqlQuery.trim()) && !/\bWHERE\b/i.test(sqlQuery.trim()));

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
		{ databaseId, engine: databaseEngine },
		{ enabled: Boolean(databaseId && databaseEngine !== "redis" && databaseEngine !== "libsql") },
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
			});
			toast.success(`User '${user}' dropped`);
			await refetchUsers();
		} catch (err: any) {
			toast.error(err?.message || "Failed to drop user");
		}
	};

	return (
		<>
			<Head>
				<title>
					{activeRecord?.name || "Database"} Management Workspace - {brand.APP_NAME}
				</title>
			</Head>

			<div className="space-y-6 pb-16">
				{/* Top Bar / Breadcrumb Navigation */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
					<div className="flex items-center gap-3">
						<Link href="/dashboard/databases">
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
							<p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
								<span className="font-mono text-slate-300">
									{activeRecord?.appName || "instance"}
								</span>
								<span>•</span>
								<span>{activeRecord?.databaseName || "default"}</span>
								{activeRecord?.externalPort && (
									<>
										<span>•</span>
										<span className="text-cyan-400 font-mono">
											db.hatdot.cloud:{activeRecord.externalPort}
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
				<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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
											<Layers className="w-3.5 h-3.5 text-red-400" /> Keys Explorer
										</h3>
										<Button
											size="sm"
											onClick={() => setIsAddRedisKeyOpen(true)}
											className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] h-7 px-2.5 gap-1"
										>
											<Plus className="w-3 h-3" /> New Key
										</Button>
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
												Click on any key on the left to inspect its data structure.
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
													Type safe Redis commands like &apos;INFO&apos;, &apos;DBSIZE&apos;, &apos;PING&apos;,
													&apos;TTL key&apos;...
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
								{/* Left: Collections / Tables List */}
								<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
									<div className="flex items-center justify-between">
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
												No {databaseEngine === "mongo" ? "collections" : "tables"}{" "}
												found.
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
														<span className="font-mono truncate">{item.name}</span>
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
												{entityData?.total !== undefined && (
													<span className="text-[11px] font-normal text-slate-400">
														({entityData.total} total records)
													</span>
												)}
											</h2>
											<p className="text-xs text-slate-400 mt-0.5">
												Browse, filter, insert, and modify records in real-time.
											</p>
										</div>

										<div className="flex items-center gap-2">
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
												Querying instance data...
											</div>
										) : !entityData?.rows || entityData.rows.length === 0 ? (
											<div className="p-12 text-center text-xs text-slate-500">
												No records in this collection/table.
											</div>
										) : (
											<table className="w-full text-left text-xs font-mono">
												<thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
													<tr>
														{Object.keys(entityData.rows[0] || {}).map(
															(col) => (
																<th
																	key={col}
																	className="px-3 py-2.5 font-semibold text-slate-300"
																>
																	{col}
																</th>
															),
														)}
														<th className="px-3 py-2.5 text-right">Actions</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-slate-800/60">
													{entityData.rows.map((row: any, rIdx: number) => (
														<tr
															key={rIdx}
															className="hover:bg-slate-800/40 transition-colors"
														>
															{Object.keys(entityData.rows[0] || {}).map(
																(col) => (
																	<td
																		key={col}
																		className="px-3 py-2 text-slate-300 truncate max-w-xs"
																	>
																		{typeof row[col] === "object"
																			? JSON.stringify(row[col])
																			: String(row[col] ?? "")}
																	</td>
																),
															)}
															<td className="px-3 py-2 text-right shrink-0">
																<div className="flex items-center justify-end gap-1.5">
																	<button
																		type="button"
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
																		className="p-1 text-slate-400 hover:text-indigo-300 rounded"
																	>
																		<Edit className="w-3.5 h-3.5" />
																	</button>
																	<button
																		type="button"
																		onClick={() =>
																			handleDeleteRecord(row)
																		}
																		className="p-1 text-slate-500 hover:text-red-400 rounded"
																	>
																		<Trash2 className="w-3.5 h-3.5" />
																	</button>
																</div>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										)}
									</div>

									{/* Pagination footer */}
									{entityData && entityData.total > 0 && (
										<div className="flex items-center justify-between text-xs text-slate-400 pt-2">
											<span>
												Showing page {currentPage} of{" "}
												{Math.ceil(entityData.total / 25) || 1}
											</span>
											<div className="flex items-center gap-2">
												<Button
													size="sm"
													disabled={currentPage <= 1}
													onClick={() =>
														setCurrentPage((p) => Math.max(1, p - 1))
													}
													className="bg-slate-800 text-white text-xs h-7 px-3"
												>
													Previous
												</Button>
												<Button
													size="sm"
													disabled={currentPage * 25 >= entityData.total}
													onClick={() => setCurrentPage((p) => p + 1)}
													className="bg-slate-800 text-white text-xs h-7 px-3"
												>
													Next
												</Button>
											</div>
										</div>
									)}
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
											Execute custom queries with parameter protection, syntax highlighting, and execution metrics.
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
														{sqlResult.rows?.map(
															(row: any, rIdx: number) => (
																<tr
																	key={rIdx}
																	className="hover:bg-slate-800/40"
																>
																	{sqlResult.columns?.map(
																		(col: string) => (
																			<td
																				key={col}
																				className="px-3 py-2 text-slate-300 truncate max-w-xs"
																			>
																				{typeof row[col] === "object"
																					? JSON.stringify(row[col])
																					: String(row[col] ?? "")}
																			</td>
																		),
																	)}
																</tr>
															),
														)}
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
										<Users className="w-4 h-4 text-indigo-400" /> Database Users &
										Roles
									</h2>
									<p className="text-xs text-slate-400 mt-0.5">
										Manage least-privilege credentials scoped directly to this customer database.
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
									Official Dockerized Engine
								</span>
							</div>

							<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-1">
								<span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
									Storage Allocation
								</span>
								<p className="text-xl font-bold text-indigo-400">
									{engineStats?.dataSize ||
										engineStats?.usedMemory ||
										"Container Volume"}
								</p>
								<span className="text-[11px] text-slate-400 block pt-1">
									Persistent Docker volume
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
								<Shield className="w-4 h-4 text-emerald-400" /> Isolation Architecture
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
										Docker Swarm Overlay + Traefik directConnection
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
									<SelectItem value="dbAdmin">Database Admin (dbAdmin)</SelectItem>
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
							This query contains structural or mass-deletion keywords (DROP, TRUNCATE, ALTER, or DELETE without WHERE).
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
	<CustomerLayout>{page}</CustomerLayout>
);

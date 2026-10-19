import { validateRequest } from "@dokploy/server/lib/auth";
import { brand } from "@paas/branding";
import { createServerSideHelpers } from "@trpc/react-query/server";
import {
	Activity,
	AlertCircle,
	Check,
	CheckCircle2,
	Clock,
	Copy,
	Database,
	ExternalLink,
	HardDrive,
	Key,
	Layers,
	Lock,
	Plus,
	Radio,
	RefreshCw,
	Search,
	Server,
	Shield,
	ShieldAlert,
	Terminal,
	Trash2,
	Wrench,
	Zap,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DatabaseManagementComingSoon } from "@/components/dashboard/database/database-management-coming-soon";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";

type SupportedEngine =
	| "mongo"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "redis"
	| "libsql";

const ENGINE_CONFIG: Record<
	SupportedEngine,
	{
		label: string;
		version: string;
		icon: React.ComponentType<{ className?: string }>;
		badge: string;
		defaultPort: number;
		defaultUser: string;
		defaultDb: string;
		color: string;
	}
> = {
	mongo: {
		label: "MongoDB",
		version: "7.0",
		icon: MongodbIcon,
		badge: "Document NoSQL",
		defaultPort: 27017,
		defaultUser: "mongo",
		defaultDb: "app",
		color: "text-emerald-400 border-emerald-500/20 bg-emerald-950/20",
	},
	postgres: {
		label: "PostgreSQL",
		version: "16",
		icon: PostgresqlIcon,
		badge: "Relational SQL",
		defaultPort: 5432,
		defaultUser: "postgres",
		defaultDb: "postgres",
		color: "text-blue-400 border-blue-500/20 bg-blue-950/20",
	},
	mysql: {
		label: "MySQL",
		version: "8.0",
		icon: MysqlIcon,
		badge: "Relational SQL",
		defaultPort: 3306,
		defaultUser: "mysql",
		defaultDb: "mysql",
		color: "text-cyan-400 border-cyan-500/20 bg-cyan-950/20",
	},
	mariadb: {
		label: "MariaDB",
		version: "11",
		icon: MariadbIcon,
		badge: "Relational SQL",
		defaultPort: 3306,
		defaultUser: "mariadb",
		defaultDb: "mariadb",
		color: "text-teal-400 border-teal-500/20 bg-teal-950/20",
	},
	redis: {
		label: "Redis",
		version: "7.2",
		icon: RedisIcon,
		badge: "In-Memory Cache",
		defaultPort: 6379,
		defaultUser: "default",
		defaultDb: "0",
		color: "text-red-400 border-red-500/20 bg-red-950/20",
	},
	libsql: {
		label: "LibSQL",
		version: "sqld",
		icon: LibsqlIcon,
		badge: "Serverless SQLite",
		defaultPort: 8080,
		defaultUser: "libsql",
		defaultDb: "main",
		color: "text-purple-400 border-purple-500/20 bg-purple-950/20",
	},
};

export default function ManagedDatabasesPage() {
	const utils = api.useUtils();
	const [selectedEngineFilter, setSelectedEngineFilter] =
		useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [activeConnectionDb, setActiveConnectionDb] = useState<{
		id: string;
		engine: SupportedEngine;
		record: any;
	} | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Provisioning Dialog State
	const [isProvisionOpen, setIsProvisionOpen] = useState(false);
	const [provEngine, setProvEngine] = useState<SupportedEngine>("mongo");
	const [provName, setProvName] = useState("");
	const [provDbName, setProvDbName] = useState("");
	const [provUser, setProvUser] = useState("");
	const [provPassword, setProvPassword] = useState("");
	const [provPublic, setProvPublic] = useState(true);
	const [provProjectId, setProvProjectId] = useState<string>("");
	const [isProvisioning, setIsProvisioning] = useState(false);

	const { data: authUser } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean((authUser?.user as any)?.isPlatformAdmin);
	const isPublicEnabled =
		process.env.NEXT_PUBLIC_ENABLE_DATABASE_MANAGEMENT === "true";
	const canAccess = isPlatformAdmin || isPublicEnabled;

	// Queries
	const {
		data: overviewData,
		isLoading: isOverviewLoading,
		refetch: refetchOverview,
	} = api.databaseManager.overview.useQuery(undefined, {
		enabled: canAccess,
		refetchInterval: canAccess ? 15000 : false,
	});

	const { data: allProjects } = api.project.all.useQuery();

	// Mutations for provisioning
	const mongoCreate = api.mongo.create.useMutation();
	const postgresCreate = api.postgres.create.useMutation();
	const mysqlCreate = api.mysql.create.useMutation();
	const mariadbCreate = api.mariadb.create.useMutation();
	const redisCreate = api.redis.create.useMutation();
	const libsqlCreate = api.libsql.create.useMutation();

	const copyToClipboard = (text: string, key: string) => {
		navigator.clipboard.writeText(text);
		setCopiedKey(key);
		toast.success("Copied to clipboard!");
		setTimeout(() => setCopiedKey(null), 2000);
	};

	if (!canAccess) {
		return <DatabaseManagementComingSoon />;
	}

	const databases = overviewData || [];

	// Filtered database instances
	const filteredDatabases = useMemo(() => {
		return databases.filter((db) => {
			const matchesEngine =
				selectedEngineFilter === "all" || db.engine === selectedEngineFilter;
			const query = searchQuery.toLowerCase().trim();
			const matchesSearch =
				!query ||
				db.name.toLowerCase().includes(query) ||
				db.appName.toLowerCase().includes(query) ||
				db.engine.toLowerCase().includes(query);
			return matchesEngine && matchesSearch;
		});
	}, [databases, selectedEngineFilter, searchQuery]);

	// Summary Statistics
	const stats = useMemo(() => {
		const total = databases.length;
		const running = databases.filter(
			(d) => d.status === "done" || d.status === "running",
		).length;
		const publicCount = databases.filter((d) => Boolean(d.externalPort)).length;
		const distinctEngines = new Set(databases.map((d) => d.engine)).size;
		return { total, running, publicCount, distinctEngines };
	}, [databases]);

	const handleOpenProvisionModal = () => {
		const randSuffix = Math.random().toString(36).substring(2, 7);
		const defaultPass = `SecPass_${Math.random().toString(36).substring(2, 10)}!`;
		setProvEngine("mongo");
		setProvName(`db-${randSuffix}`);
		setProvDbName("app");
		setProvUser("mongo_user");
		setProvPassword(defaultPass);
		setProvPublic(true);
		if (allProjects && allProjects.length > 0 && allProjects[0]) {
			setProvProjectId(allProjects[0].projectId);
		}
		setIsProvisionOpen(true);
	};

	const handleProvisionSubmit = async () => {
		if (!provName.trim()) {
			toast.error("Please enter a database instance name");
			return;
		}

		// Ensure we have a project and environment
		const targetProject =
			allProjects?.find((p) => p.projectId === provProjectId) ||
			allProjects?.[0];

		if (!targetProject) {
			toast.error("No active project found. Please create a project first.");
			return;
		}

		const environmentId = targetProject.environments?.[0]?.environmentId;
		if (!environmentId) {
			toast.error(
				"No environment found in project. Please initialize an environment.",
			);
			return;
		}

		setIsProvisioning(true);
		const appName = `${provName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${Math.random().toString(36).substring(2, 6)}`;

		try {
			if (provEngine === "mongo") {
				await mongoCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databaseName: provDbName || "app",
					databaseUser: provUser || "mongo_user",
					databasePassword: provPassword,
					dockerImage: "mongo:7",
				});
			} else if (provEngine === "postgres") {
				await postgresCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databaseName: provDbName || "postgres",
					databaseUser: provUser || "postgres",
					databasePassword: provPassword,
					dockerImage: "postgres:16",
				});
			} else if (provEngine === "mysql") {
				await mysqlCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databaseName: provDbName || "mysql",
					databaseUser: provUser || "mysql",
					databasePassword: provPassword,
					dockerImage: "mysql:8",
				});
			} else if (provEngine === "mariadb") {
				await mariadbCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databaseName: provDbName || "mariadb",
					databaseUser: provUser || "mariadb",
					databasePassword: provPassword,
					dockerImage: "mariadb:11",
				});
			} else if (provEngine === "redis") {
				await redisCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databasePassword: provPassword,
					dockerImage: "redis:7",
				});
			} else if (provEngine === "libsql") {
				await libsqlCreate.mutateAsync({
					name: provName,
					appName,
					environmentId,
					databasePassword: provPassword,
					databaseUser: provUser || "libsql",
					dockerImage: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
					description: null,
					serverId: null,
					enableNamespaces: false,
					sqldNode: "primary",
					sqldPrimaryUrl: null,
				});
			}

			toast.success(
				`${ENGINE_CONFIG[provEngine].label} database '${provName}' provisioned successfully!`,
			);
			setIsProvisionOpen(false);
			await refetchOverview();
		} catch (err: any) {
			toast.error(err?.message || "Failed to provision database instance");
		} finally {
			setIsProvisioning(false);
		}
	};

	return (
		<>
			<Head>
				<title>Managed Databases - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8 pb-12">
				{/* Header Section */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
					<div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-indigo-500/30 flex items-center justify-center">
								<Database className="w-5 h-5 text-indigo-400" />
							</div>
							<div>
								<h1 className="text-2xl font-bold text-white tracking-tight">
									Database Management Platform
								</h1>
								<p className="text-slate-400 text-sm mt-0.5">
									Enterprise multi-engine hosting: MongoDB, PostgreSQL, MySQL,
									MariaDB, Redis, and LibSQL with native isolation.
								</p>
							</div>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetchOverview()}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-9"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${isOverviewLoading ? "animate-spin text-indigo-400" : ""}`}
							/>
							Refresh
						</Button>

						<Button
							onClick={handleOpenProvisionModal}
							className="bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-medium text-xs px-4 h-9 rounded-lg shadow-lg shadow-indigo-600/20 gap-1.5"
						>
							<Plus className="w-4 h-4" /> Provision Database
						</Button>
					</div>
				</div>

				{/* Summary Metrics */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
						<div className="flex items-center justify-between text-slate-400 text-xs">
							<span>Total Instances</span>
							<Layers className="w-4 h-4 text-indigo-400" />
						</div>
						<p className="text-2xl font-bold text-white mt-2">{stats.total}</p>
						<span className="text-[11px] text-slate-500 mt-1 block">
							Dedicated customer databases
						</span>
					</div>

					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
						<div className="flex items-center justify-between text-slate-400 text-xs">
							<span>Running Status</span>
							<Activity className="w-4 h-4 text-emerald-400" />
						</div>
						<p className="text-2xl font-bold text-white mt-2">
							{stats.running}
						</p>
						<span className="text-[11px] text-slate-500 mt-1 block">
							Healthy & listening
						</span>
					</div>

					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
						<div className="flex items-center justify-between text-slate-400 text-xs">
							<span>Public Endpoints</span>
							<Radio className="w-4 h-4 text-cyan-400" />
						</div>
						<p className="text-2xl font-bold text-white mt-2">
							{stats.publicCount}
						</p>
						<span className="text-[11px] text-slate-500 mt-1 block">
							Routed via db.hatdot.cloud
						</span>
					</div>

					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
						<div className="flex items-center justify-between text-slate-400 text-xs">
							<span>Engines in Use</span>
							<Zap className="w-4 h-4 text-purple-400" />
						</div>
						<p className="text-2xl font-bold text-white mt-2">
							{stats.distinctEngines}
						</p>
						<span className="text-[11px] text-slate-500 mt-1 block">
							Across 6 supported types
						</span>
					</div>
				</div>

				{/* Search & Engine Filter Tabs */}
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
						{[
							{ id: "all", label: "All Engines" },
							{ id: "mongo", label: "MongoDB" },
							{ id: "postgres", label: "PostgreSQL" },
							{ id: "mysql", label: "MySQL" },
							{ id: "mariadb", label: "MariaDB" },
							{ id: "redis", label: "Redis" },
							{ id: "libsql", label: "LibSQL" },
						].map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setSelectedEngineFilter(tab.id)}
								className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
									selectedEngineFilter === tab.id
										? "bg-indigo-600 text-white shadow-sm"
										: "bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					<div className="relative w-full sm:w-64">
						<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
						<Input
							placeholder="Search databases..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9 bg-slate-900/70 border-slate-800 text-xs h-9 text-white placeholder:text-slate-500"
						/>
					</div>
				</div>

				{/* Database Instances List */}
				{isOverviewLoading && databases.length === 0 ? (
					<div className="flex flex-col items-center justify-center p-16 rounded-xl border border-slate-800 bg-slate-900/30 text-center space-y-3">
						<RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
						<p className="text-sm text-slate-400">
							Loading database instances...
						</p>
					</div>
				) : filteredDatabases.length === 0 ? (
					<div className="flex flex-col items-center justify-center p-16 rounded-xl border border-slate-800 bg-slate-900/30 text-center space-y-4">
						<div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
							<Database className="w-6 h-6" />
						</div>
						<div>
							<h3 className="text-base font-semibold text-white">
								No database instances found
							</h3>
							<p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
								{searchQuery || selectedEngineFilter !== "all"
									? "No databases match the selected filters. Try clearing your search query."
									: "Launch your first dedicated MongoDB, PostgreSQL, MySQL, Redis, or LibSQL database in seconds."}
							</p>
						</div>
						<Button
							onClick={handleOpenProvisionModal}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs gap-1.5 h-8 px-4"
						>
							<Plus className="w-3.5 h-3.5" /> Provision First Database
						</Button>
					</div>
				) : (
					<div className="grid grid-cols-1 gap-4">
						{filteredDatabases.map((db) => {
							const cfg =
								ENGINE_CONFIG[db.engine as SupportedEngine] ||
								ENGINE_CONFIG.postgres;
							const isRunning = db.status === "done" || db.status === "running";

							// Display URI preview
							const internalHost = `${db.appName}:${cfg.defaultPort}`;
							const externalHost = db.externalPort
								? `db.hatdot.cloud:${db.externalPort}`
								: "Not exposed";

							const authSourceInfo =
								db.engine === "mongo"
									? "authSource: admin"
									: `db: ${db.databaseName || "app"}`;

							return (
								<div
									key={db.id}
									className="rounded-xl bg-slate-900/70 border border-slate-800 p-5 space-y-4 hover:border-slate-700 transition-all shadow-sm"
								>
									{/* Top Bar: Icon, Name, Status, Action Buttons */}
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
										<div className="flex items-center gap-3.5">
											<div
												className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${cfg.color}`}
											>
												<cfg.icon className="w-6 h-6" />
											</div>

											<div>
												<div className="flex items-center gap-2.5">
													<h3 className="text-base font-bold text-white tracking-tight">
														{db.name}
													</h3>
													<span
														className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1.5 ${
															isRunning
																? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
																: "bg-amber-500/10 text-amber-400 border-amber-500/30"
														}`}
													>
														<span
															className={`w-1.5 h-1.5 rounded-full ${
																isRunning
																	? "bg-emerald-400 animate-pulse"
																	: "bg-amber-400"
															}`}
														/>
														{db.status ? db.status.toUpperCase() : "ACTIVE"}
													</span>
													<Badge
														variant="outline"
														className="text-[10px] border-slate-800 text-slate-400 font-mono"
													>
														{cfg.label} {cfg.version}
													</Badge>
												</div>
												<div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
													<span className="font-mono text-slate-300">
														{db.appName}
													</span>
													<span>•</span>
													<span>{cfg.badge}</span>
													<span>•</span>
													<span>
														Created{" "}
														{new Date(db.createdAt).toLocaleDateString()}
													</span>
												</div>
											</div>
										</div>

										{/* Quick Management Buttons */}
										<div className="flex items-center gap-2 shrink-0">
											<Link
												href={`/dashboard/home/databases/manage?id=${db.id}&engine=${db.engine}`}
											>
												<Button
													size="sm"
													className="bg-indigo-600/90 hover:bg-indigo-600 text-white text-xs gap-1.5 h-8 font-medium shadow-sm"
												>
													<Wrench className="w-3.5 h-3.5" /> Manage Workspace
												</Button>
											</Link>

											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													setActiveConnectionDb({
														id: db.id,
														engine: db.engine as SupportedEngine,
														record: db,
													})
												}
												className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
											>
												<Key className="w-3.5 h-3.5 text-cyan-400" /> Connection
												Details
											</Button>
										</div>
									</div>

									{/* Endpoints & Security Grid */}
									<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
										{/* Public Endpoint */}
										<div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
											<div className="flex items-center justify-between text-slate-500 text-[10px]">
												<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
													<Radio className="w-3 h-3 text-cyan-400" /> Public
													Endpoint
												</span>
												{db.externalPort && (
													<button
														type="button"
														onClick={() =>
															copyToClipboard(externalHost, `ext-${db.id}`)
														}
														className="text-slate-500 hover:text-white"
													>
														{copiedKey === `ext-${db.id}` ? (
															<Check className="w-3 h-3 text-emerald-400" />
														) : (
															<Copy className="w-3 h-3" />
														)}
													</button>
												)}
											</div>
											<p className="text-slate-200 font-mono truncate">
												{externalHost}
											</p>
										</div>

										{/* Internal Endpoint */}
										<div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
											<div className="flex items-center justify-between text-slate-500 text-[10px]">
												<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
													<Server className="w-3 h-3 text-indigo-400" />{" "}
													Internal Address
												</span>
												<button
													type="button"
													onClick={() =>
														copyToClipboard(internalHost, `int-${db.id}`)
													}
													className="text-slate-500 hover:text-white"
												>
													{copiedKey === `int-${db.id}` ? (
														<Check className="w-3 h-3 text-emerald-400" />
													) : (
														<Copy className="w-3 h-3" />
													)}
												</button>
											</div>
											<p className="text-slate-200 font-mono truncate">
												{internalHost}
											</p>
										</div>

										{/* Restricted User & Auth Source */}
										<div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
											<div className="flex items-center justify-between text-slate-500 text-[10px]">
												<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
													<Shield className="w-3 h-3 text-emerald-400" />{" "}
													Identity & Auth
												</span>
											</div>
											<div className="flex items-center gap-2">
												<span className="text-slate-200 font-mono truncate">
													{db.databaseUser || "default"}
												</span>
												<span className="text-[10px] text-slate-500 bg-slate-800/60 px-1 rounded font-mono">
													{authSourceInfo}
												</span>
											</div>
										</div>

										{/* Target Application DB */}
										<div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1">
											<div className="flex items-center justify-between text-slate-500 text-[10px]">
												<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
													<Database className="w-3 h-3 text-purple-400" />{" "}
													Database Name
												</span>
											</div>
											<p className="text-slate-200 font-mono truncate">
												{db.databaseName || "default"}
											</p>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Connection Details Modal */}
			{activeConnectionDb && (
				<Dialog
					open={Boolean(activeConnectionDb)}
					onOpenChange={(open) => {
						if (!open) setActiveConnectionDb(null);
					}}
				>
					<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Key className="w-5 h-5 text-indigo-400" />
								<span>
									Connection Information: {activeConnectionDb.record?.name}
								</span>
							</DialogTitle>
							<DialogDescription className="text-slate-400 text-xs">
								Authenticated credentials and multi-tenant connection URIs.
								External connections are routed via db.hatdot.cloud with direct
								connection support.
							</DialogDescription>
						</DialogHeader>

						<div className="py-2">
							<DatabaseConnectionCard
								databaseId={activeConnectionDb.id}
								databaseType={activeConnectionDb.engine}
								data={activeConnectionDb.record}
								refetch={refetchOverview}
							/>
						</div>
					</DialogContent>
				</Dialog>
			)}

			{/* Provision New Database Guided Modal */}
			<Dialog open={isProvisionOpen} onOpenChange={setIsProvisionOpen}>
				<DialogContent className="max-w-2xl bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Plus className="w-5 h-5 text-indigo-400" />
							<span>Provision Dedicated Database Instance</span>
						</DialogTitle>
						<DialogDescription className="text-slate-400 text-xs">
							Deploy an enterprise-grade isolated container with least-privilege
							credentials and optional public connectivity.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-5 py-3">
						{/* Step 1: Select Engine */}
						<div className="space-y-2">
							<label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
								1. Select Database Engine
							</label>
							<div className="grid grid-cols-3 gap-2.5">
								{(
									[
										"mongo",
										"postgres",
										"mysql",
										"mariadb",
										"redis",
										"libsql",
									] as const
								).map((eng) => {
									const cfg = ENGINE_CONFIG[eng];
									const isSelected = provEngine === eng;
									return (
										<button
											key={eng}
											type="button"
											onClick={() => {
												setProvEngine(eng);
												setProvUser(cfg.defaultUser);
												setProvDbName(cfg.defaultDb);
											}}
											className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
												isSelected
													? "bg-indigo-950/60 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-500/10"
													: "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700"
											}`}
										>
											<div className="flex items-center justify-between">
												<cfg.icon className="w-5 h-5" />
												<span className="text-[10px] text-slate-400 font-mono">
													v{cfg.version}
												</span>
											</div>
											<div className="mt-2.5">
												<p className="text-xs font-bold text-white">
													{cfg.label}
												</p>
												<p className="text-[10px] text-slate-400">
													{cfg.badge}
												</p>
											</div>
										</button>
									);
								})}
							</div>
						</div>

						{/* Step 2: Name & Target Project */}
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-300">
									Database Instance Name
								</label>
								<Input
									placeholder="e.g. production-mongo-cluster"
									value={provName}
									onChange={(e) => setProvName(e.target.value)}
									className="bg-slate-900 border-slate-800 text-xs text-white"
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-300">
									Target Project
								</label>
								<Select
									value={provProjectId}
									onValueChange={(val) => setProvProjectId(val)}
								>
									<SelectTrigger className="bg-slate-900 border-slate-800 text-xs text-white">
										<SelectValue placeholder="Select target project" />
									</SelectTrigger>
									<SelectContent className="bg-slate-900 border-slate-800 text-white">
										{allProjects?.map((p) => (
											<SelectItem key={p.projectId} value={p.projectId}>
												{p.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Step 3: Credentials */}
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-300">
									Target Database Name
								</label>
								<Input
									placeholder="e.g. app"
									value={provDbName}
									onChange={(e) => setProvDbName(e.target.value)}
									className="bg-slate-900 border-slate-800 text-xs text-white"
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-300">
									Restricted Username
								</label>
								<Input
									placeholder="e.g. app_user"
									value={provUser}
									onChange={(e) => setProvUser(e.target.value)}
									className="bg-slate-900 border-slate-800 text-xs text-white"
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-slate-300">
									Secure Password
								</label>
								<Input
									type="text"
									placeholder="Secure password"
									value={provPassword}
									onChange={(e) => setProvPassword(e.target.value)}
									className="bg-slate-900 border-slate-800 text-xs text-white font-mono"
								/>
							</div>
						</div>

						{/* Step 4: Security & Networking Info */}
						<div className="rounded-lg bg-indigo-950/30 border border-indigo-500/20 p-3 text-xs text-indigo-300 space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-white">
								<Shield className="w-3.5 h-3.5 text-indigo-400" />
								<span>Automated Isolation & AuthSource Handling</span>
							</div>
							<p className="text-[11px] text-slate-300">
								HatDot automatically isolates customer databases, registers
								credentials with standard SCRAM-SHA / native protocols, sets the
								correct authSource, and allocates external port routing via
								db.hatdot.cloud.
							</p>
						</div>
					</div>

					<DialogFooter className="gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsProvisionOpen(false)}
							className="text-slate-400 hover:text-white text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							disabled={isProvisioning || !provName.trim()}
							onClick={handleProvisionSubmit}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs gap-1.5 px-5"
						>
							{isProvisioning ? (
								<>
									<RefreshCw className="w-3.5 h-3.5 animate-spin" />{" "}
									Provisioning...
								</>
							) : (
								<>
									<Zap className="w-3.5 h-3.5" /> Launch Database
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

ManagedDatabasesPage.getLayout = (page: ReactElement) => (
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

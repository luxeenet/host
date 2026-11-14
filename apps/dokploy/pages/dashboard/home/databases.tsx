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
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";

function StatCard({
	label,
	value,
	delta,
}: {
	label: string;
	value: string;
	delta?: string;
}) {
	return (
		<div className="rounded-xl border bg-background p-5 min-h-[140px] flex flex-col justify-between">
			<span className="text-xs uppercase tracking-wider text-muted-foreground">
				{label}
			</span>
			<div className="flex flex-col gap-1">
				<span className="text-3xl font-semibold tracking-tight">{value}</span>
				{delta && (
					<span className="text-xs text-muted-foreground">{delta}</span>
				)}
			</div>
		</div>
	);
}

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
	// Queries
	const {
		data: overviewData,
		isLoading: isOverviewLoading,
		refetch: refetchOverview,
	} = api.databaseManager.overview.useQuery(undefined, {
		refetchInterval: 15000,
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
		setProvDbName(`db_${randSuffix}`.replace(/[^a-z0-9_]/gi, "_"));
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
					databaseName: provDbName || `db_${provName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
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
			<BreadcrumbSidebar
				list={[
					{ name: "Home", href: "/dashboard/home" },
					{ name: "Databases", href: "/dashboard/home/databases" },
				]}
			/>
			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl min-h-[85vh]">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6 h-full">
						{/* Header Section */}
						<div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
							<div>
								<h1 className="text-3xl font-semibold tracking-tight">
									Databases
								</h1>
								<p className="text-sm text-muted-foreground mt-1">
									Manage your MongoDB, PostgreSQL, MySQL, MariaDB, Redis, and LibSQL databases.
								</p>
							</div>

							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => refetchOverview()}
									disabled={isOverviewLoading}
								>
									<RefreshCw
										className={`size-4 mr-1.5 ${isOverviewLoading ? "animate-spin" : ""}`}
									/>
									Refresh
								</Button>

								<Button
									onClick={handleOpenProvisionModal}
									size="sm"
								>
									<Plus className="size-4 mr-1.5" /> New Database
								</Button>
							</div>
						</div>

						{/* Summary Metrics */}
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<StatCard
								label="Total Databases"
								value={String(stats.total)}
								delta="Active databases in your account"
							/>
							<StatCard
								label="Running Status"
								value={String(stats.running)}
								delta="Healthy & running"
							/>
							<StatCard
								label="External Access"
								value={String(stats.publicCount)}
								delta="Available for external connections"
							/>
							<StatCard
								label="Engines in Use"
								value={String(stats.distinctEngines)}
								delta="Across 6 supported types"
							/>
						</div>

						{/* Search & Engine Filter Tabs */}
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<Tabs
								value={selectedEngineFilter}
								onValueChange={setSelectedEngineFilter}
								className="w-full sm:w-auto"
							>
								<TabsList className="h-9">
									<TabsTrigger value="all">All Engines</TabsTrigger>
									<TabsTrigger value="mongo">MongoDB</TabsTrigger>
									<TabsTrigger value="postgres">PostgreSQL</TabsTrigger>
									<TabsTrigger value="mysql">MySQL</TabsTrigger>
									<TabsTrigger value="mariadb">MariaDB</TabsTrigger>
									<TabsTrigger value="redis">Redis</TabsTrigger>
									<TabsTrigger value="libsql">LibSQL</TabsTrigger>
								</TabsList>
							</Tabs>

							<div className="relative w-full sm:w-64">
								<Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Search databases..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-9 h-9"
								/>
							</div>
						</div>

						{/* Database Instances List */}
						{isOverviewLoading && databases.length === 0 ? (
							<div className="flex flex-col items-center justify-center p-16 rounded-xl border border-dashed text-center space-y-3">
								<RefreshCw className="size-8 text-muted-foreground animate-spin" />
								<p className="text-sm text-muted-foreground">
									Loading databases...
								</p>
							</div>
						) : filteredDatabases.length === 0 ? (
							<div className="flex flex-col items-center justify-center p-16 rounded-xl border border-dashed text-center space-y-4">
								<div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
									<Database className="size-6" />
								</div>
								<div>
									<h3 className="text-base font-semibold">
										No databases found
									</h3>
									<p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
										{searchQuery || selectedEngineFilter !== "all"
											? "No databases match the selected filters. Try clearing your search query."
											: "Launch your first dedicated MongoDB, PostgreSQL, MySQL, Redis, or LibSQL database in seconds."}
									</p>
								</div>
								<Button
									onClick={handleOpenProvisionModal}
									size="sm"
								>
									<Plus className="size-3.5 mr-1.5" /> Create Database
								</Button>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-4">
								{filteredDatabases.map((db) => {
									const cfg =
										ENGINE_CONFIG[db.engine as SupportedEngine] ||
										ENGINE_CONFIG.postgres;

									// Display URI preview
									const internalHost = `${db.appName}:${cfg.defaultPort}`;
									const externalHost = db.externalPort
										? `db.hatdot.cloud:${db.externalPort}`
										: "Internal Network Only";

									const authSourceInfo =
										db.engine === "mongo"
											? "Protected Auth"
											: "Native Auth";

									return (
										<div
											key={db.id}
											className="rounded-xl border bg-card p-5 space-y-4 hover:border-border transition-all shadow-sm"
										>
											{/* Top Bar: Icon, Name, Status, Action Buttons */}
											<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
												<div className="flex items-center gap-3.5">
													<div className="size-10 rounded-xl border flex items-center justify-center shrink-0 bg-muted">
														<cfg.icon className="size-5" />
													</div>

													<div>
														<div className="flex items-center gap-2.5">
															<h3 className="text-base font-semibold tracking-tight">
																{db.name}
															</h3>
															{db.status === "done" ? (
																<Badge
																	variant="outline"
																	className="text-[11px] gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
																>
																	<span className="size-1.5 rounded-full bg-emerald-500" />
																	READY
																</Badge>
															) : db.status === "running" ? (
																<Badge
																	variant="outline"
																	className="text-[11px] gap-1.5 border-sky-500/30 text-sky-600 dark:text-sky-400 bg-sky-500/10"
																>
																	<span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
																	STARTING
																</Badge>
															) : db.status === "error" ? (
																<Badge
																	variant="destructive"
																	className="text-[11px]"
																>
																	FAILED
																</Badge>
															) : (
																<Badge
																	variant="outline"
																	className="text-[11px] gap-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10"
																>
																	<span className="size-1.5 rounded-full bg-amber-500" />
																	PENDING
																</Badge>
															)}
															<Badge
																variant="secondary"
																className="text-[11px] font-mono"
															>
																{cfg.label} {cfg.version}
															</Badge>
														</div>
														<div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
															<span className="font-mono text-foreground">
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
													<Button size="sm" asChild>
														<Link
															href={`/dashboard/home/databases/manage?id=${db.id}&engine=${db.engine}`}
														>
															<Wrench className="size-3.5 mr-1.5" /> Manage Workspace
														</Link>
													</Button>

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
													>
														<Key className="size-3.5 mr-1.5 text-muted-foreground" /> Connection Details
													</Button>
												</div>
											</div>

											{/* Endpoints & Security Grid */}
											<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
												{/* Public Endpoint */}
												<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
													<div className="flex items-center justify-between text-muted-foreground text-[10px]">
														<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
															<Radio className="size-3" /> Public Endpoint
														</span>
														{db.externalPort && (
															<button
																type="button"
																onClick={() =>
																	copyToClipboard(externalHost, `ext-${db.id}`)
																}
																className="text-muted-foreground hover:text-foreground"
															>
																{copiedKey === `ext-${db.id}` ? (
																	<Check className="size-3 text-emerald-500" />
																) : (
																	<Copy className="size-3" />
																)}
															</button>
														)}
													</div>
													<p className="text-foreground font-mono truncate">
														{externalHost}
													</p>
												</div>

												{/* Internal Endpoint */}
												<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
													<div className="flex items-center justify-between text-muted-foreground text-[10px]">
														<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
															<Server className="size-3" /> Internal Address
														</span>
														<button
															type="button"
															onClick={() =>
																copyToClipboard(internalHost, `int-${db.id}`)
															}
															className="text-muted-foreground hover:text-foreground"
														>
															{copiedKey === `int-${db.id}` ? (
																<Check className="size-3 text-emerald-500" />
															) : (
																<Copy className="size-3" />
															)}
														</button>
													</div>
													<p className="text-foreground font-mono truncate">
														{internalHost}
													</p>
												</div>

												{/* Restricted User & Auth Source */}
												<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
													<div className="flex items-center justify-between text-muted-foreground text-[10px]">
														<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
															<Shield className="size-3" /> Identity & Auth
														</span>
													</div>
													<div className="flex items-center gap-2">
														<span className="text-foreground font-mono truncate">
															{db.databaseUser || "default"}
														</span>
														<span className="text-[10px] text-muted-foreground bg-muted px-1 rounded font-mono">
															{authSourceInfo}
														</span>
													</div>
												</div>

												{/* Target Application DB */}
												<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
													<div className="flex items-center justify-between text-muted-foreground text-[10px]">
														<span className="flex items-center gap-1 font-semibold uppercase tracking-wider">
															<Database className="size-3" /> Database Name
														</span>
													</div>
													<p className="text-foreground font-mono truncate">
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
				</Card>
			</div>

			{/* Connection Details Modal */}
			{activeConnectionDb && (
				<Dialog
					open={Boolean(activeConnectionDb)}
					onOpenChange={(open) => {
						if (!open) setActiveConnectionDb(null);
					}}
				>
					<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Key className="size-5" />
								<span>
									Connection Information: {activeConnectionDb.record?.name}
								</span>
							</DialogTitle>
							<DialogDescription className="text-xs">
								Connection credentials and parameters for your database. Direct
								connection strings and secure endpoints are provided below.
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
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Plus className="size-5" />
							<span>Create Database</span>
						</DialogTitle>
						<DialogDescription className="text-xs">
							Set up a database with secure credentials and optional external connection.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-5 py-3">
						{/* Step 1: Select Engine */}
						<div className="space-y-2">
							<label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
													? "border-primary bg-primary/10 text-primary shadow-sm"
													: "border hover:bg-muted/50 text-muted-foreground"
											}`}
										>
											<div className="flex items-center justify-between">
												<cfg.icon className="size-5" />
												<span className="text-[10px] text-muted-foreground font-mono">
													v{cfg.version}
												</span>
											</div>
											<div className="mt-2.5">
												<p className="text-xs font-bold text-foreground">
													{cfg.label}
												</p>
												<p className="text-[10px] text-muted-foreground">
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
								<label className="text-xs font-semibold text-muted-foreground">
									Database Instance Name
								</label>
								<Input
									placeholder="e.g. production-mongo-cluster"
									value={provName}
									onChange={(e) => setProvName(e.target.value)}
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-muted-foreground">
									Target Project
								</label>
								<Select
									value={provProjectId}
									onValueChange={(val) => setProvProjectId(val)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select target project" />
									</SelectTrigger>
									<SelectContent>
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
								<label className="text-xs font-semibold text-muted-foreground">
									Target Database Name
								</label>
								<Input
									placeholder="e.g. app"
									value={provDbName}
									onChange={(e) => setProvDbName(e.target.value)}
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-muted-foreground">
									Restricted Username
								</label>
								<Input
									placeholder="e.g. app_user"
									value={provUser}
									onChange={(e) => setProvUser(e.target.value)}
								/>
							</div>

							<div className="space-y-1.5">
								<label className="text-xs font-semibold text-muted-foreground">
									Secure Password
								</label>
								<Input
									type="text"
									placeholder="Secure password"
									value={provPassword}
									onChange={(e) => setProvPassword(e.target.value)}
									className="font-mono"
								/>
							</div>
						</div>

						{/* Step 4: Security & Networking Info */}
						<div className="rounded-lg bg-muted/50 border p-3 text-xs space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-foreground">
								<Shield className="size-3.5 text-primary" />
								<span>Dedicated Security & Automated Deployment</span>
							</div>
							<p className="text-[11px] text-muted-foreground">
								Your database is automatically provisioned and deployed in a
								dedicated, isolated environment with encrypted persistent storage,
								production-ready credentials, and secure connection endpoints.
							</p>
						</div>
					</div>

					<DialogFooter className="gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsProvisionOpen(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							disabled={isProvisioning || !provName.trim()}
							onClick={handleProvisionSubmit}
						>
							{isProvisioning ? (
								<>
									<RefreshCw className="size-3.5 mr-1.5 animate-spin" />{" "}
									Provisioning...
								</>
							) : (
								<>
									<Zap className="size-3.5 mr-1.5" /> Launch Database
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

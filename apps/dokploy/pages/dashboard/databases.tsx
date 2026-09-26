import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Database,
	Plus,
	Server,
	Key,
	Copy,
	Check,
	RefreshCw,
	ShieldAlert,
	Trash2,
	ExternalLink,
	HardDrive,
	Clock,
	Zap,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_DATABASES = [
	{
		id: "db-pg-prod-01",
		name: "main-postgres-db",
		type: "PostgreSQL 16",
		status: "RUNNING",
		host: "db.ourplatform.net",
		port: 5432,
		dbName: "app_production",
		user: "postgres_user",
		storage: "5GB",
		createdAt: "2 days ago",
	},
	{
		id: "db-redis-cache-01",
		name: "session-redis-cache",
		type: "Redis 7",
		status: "RUNNING",
		host: "cache.ourplatform.net",
		port: 6379,
		dbName: "0",
		user: "default",
		storage: "1GB",
		createdAt: "5 days ago",
	},
];

export default function ManagedDatabasesPage() {
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [dbType, setDbType] = useState<"postgres" | "mysql" | "redis" | "mongo">("postgres");
	const [dbName, setDbName] = useState("");

	const copyToClipboard = (text: string, id: string) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		toast.success("Connection details copied to clipboard!");
		setTimeout(() => setCopiedId(null), 2000);
	};

	const handleCreateDatabase = () => {
		if (!dbName) {
			toast.error("Please enter a database name");
			return;
		}
		setIsCreating(true);
		setTimeout(() => {
			setIsCreating(false);
			setDbName("");
			toast.success(`Managed ${dbType.toUpperCase()} database '${dbName}' provisioned successfully!`);
		}, 1500);
	};

	return (
		<>
			<Head>
				<title>Managed Databases - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Header & Quick Create */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Managed Databases</h1>
						<p className="text-slate-400 text-sm mt-1">
							Instantly launch dedicated PostgreSQL, MySQL, Redis, or MongoDB databases with auto-backups.
						</p>
					</div>
				</div>

				{/* Create New Database Panel */}
				<div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 space-y-5">
					<h3 className="text-base font-semibold text-white flex items-center gap-2">
						<Plus className="w-4 h-4 text-indigo-400" /> Provision New Database Instance
					</h3>

					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{[
							{ id: "postgres", label: "PostgreSQL 16", desc: "Relational DB", badge: "Popular" },
							{ id: "mysql", label: "MySQL 8.0", desc: "Relational DB", badge: "" },
							{ id: "redis", label: "Redis 7.2", desc: "In-Memory / Cache", badge: "Fast" },
							{ id: "mongo", label: "MongoDB 7.0", desc: "Document NoSQL", badge: "" },
						].map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => setDbType(item.id as any)}
								className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
									dbType === item.id
										? "bg-indigo-950/40 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-500/10"
										: "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<Database className={`w-5 h-5 ${dbType === item.id ? "text-indigo-400" : "text-slate-500"}`} />
									{item.badge && (
										<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300">
											{item.badge}
										</span>
									)}
								</div>
								<div className="mt-3">
									<p className="text-xs font-bold text-white">{item.label}</p>
									<p className="text-[10px] text-slate-400">{item.desc}</p>
								</div>
							</button>
						))}
					</div>

					<div className="flex flex-col md:flex-row gap-3 pt-2">
						<input
							type="text"
							value={dbName}
							onChange={(e) => setDbName(e.target.value)}
							placeholder="Database instance name (e.g. production-user-db)"
							className="flex-1 px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
						/>
						<Button
							disabled={isCreating}
							onClick={handleCreateDatabase}
							className="bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-medium text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-indigo-600/20"
						>
							{isCreating ? (
								<span className="flex items-center gap-2">
									<RefreshCw className="w-4 h-4 animate-spin" /> Provisioning Instance...
								</span>
							) : (
								<span className="flex items-center gap-2">
									<Zap className="w-4 h-4" /> Provision Database
								</span>
							)}
						</Button>
					</div>
				</div>

				{/* Provisioned Databases List */}
				<div className="space-y-4">
					<h3 className="text-base font-semibold text-white">Your Provisioned Databases</h3>

					<div className="grid grid-cols-1 gap-4">
						{MOCK_DATABASES.map((db) => {
							const connStr = `${db.type.toLowerCase().includes("postgres") ? "postgresql" : "redis"}://${db.user}:••••••••@${db.host}:${db.port}/${db.dbName}`;

							return (
								<div
									key={db.id}
									className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 hover:border-slate-700 transition-all"
								>
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-indigo-950/60 border border-indigo-500/20 flex items-center justify-center shrink-0">
												<Database className="w-5 h-5 text-indigo-400" />
											</div>
											<div>
												<div className="flex items-center gap-2">
													<h4 className="text-sm font-bold text-white">{db.name}</h4>
													<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
														{db.status}
													</span>
												</div>
												<p className="text-xs text-slate-400 mt-0.5">
													{db.type} • Provisioned {db.createdAt}
												</p>
											</div>
										</div>

										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => toast.success(`Automated S3 backup triggered for ${db.name}`)}
												className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
											>
												<HardDrive className="w-3.5 h-3.5 text-indigo-400" /> Trigger Backup
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => toast.error("Database deletion requires password confirmation")}
												className="text-slate-500 hover:text-red-400 hover:bg-red-950/20 h-8 w-8 p-0"
											>
												<Trash2 className="w-4 h-4" />
											</Button>
										</div>
									</div>

									{/* Connection Box */}
									<div className="space-y-2">
										<label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
											Connection String (Internal & External)
										</label>
										<div className="flex items-center gap-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
											<code className="text-xs text-indigo-300 font-mono flex-1 truncate">{connStr}</code>
											<button
												type="button"
												onClick={() => copyToClipboard(connStr, db.id)}
												className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors shrink-0"
											>
												{copiedId === db.id ? (
													<Check className="w-4 h-4 text-emerald-400" />
												) : (
													<Copy className="w-4 h-4" />
												)}
											</button>
										</div>
									</div>

									{/* Quick Stats Grid */}
									<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
										<div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60">
											<span className="text-slate-500 text-[10px] block">Host Address</span>
											<span className="text-slate-200 font-mono">{db.host}</span>
										</div>
										<div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60">
											<span className="text-slate-500 text-[10px] block">Port</span>
											<span className="text-slate-200 font-mono">{db.port}</span>
										</div>
										<div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60">
											<span className="text-slate-500 text-[10px] block">Database Name</span>
											<span className="text-slate-200 font-mono">{db.dbName}</span>
										</div>
										<div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60">
											<span className="text-slate-500 text-[10px] block">Allocated Storage</span>
											<span className="text-slate-200 font-mono">{db.storage}</span>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</>
	);
}

ManagedDatabasesPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

import { brand } from "@paas/branding";
import {
	Activity,
	ArrowLeft,
	Clock,
	Database,
	ExternalLink,
	HardDrive,
	Lock,
	Rocket,
	Shield,
	Sparkles,
	Zap,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import React from "react";
import {
	LibsqlIcon,
	MariadbIcon,
	MongodbIcon,
	MysqlIcon,
	PostgresqlIcon,
	RedisIcon,
} from "@/components/icons/data-tools-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PREVIEW_ENGINES = [
	{
		name: "PostgreSQL",
		version: "16 Enterprise",
		type: "Relational SQL",
		description:
			"ACID-compliant relational clustering with extensions, schema explorer, and automated backups.",
		icon: PostgresqlIcon,
		glowColor: "from-blue-500/20 via-blue-500/5 to-transparent",
		badgeColor: "text-blue-400 border-blue-500/30 bg-blue-500/10",
		borderColor: "hover:border-blue-500/40",
	},
	{
		name: "MongoDB",
		version: "7.0 Community",
		type: "Document NoSQL",
		description:
			"High-performance document store with nested BSON indexing, collection management, and Compass connectivity.",
		icon: MongodbIcon,
		glowColor: "from-emerald-500/20 via-emerald-500/5 to-transparent",
		badgeColor: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
		borderColor: "hover:border-emerald-500/40",
	},
	{
		name: "MySQL",
		version: "8.0 High-Availability",
		type: "Relational SQL",
		description:
			"Scalable relational data engine with visual table schema browser, transactional safeguards, and CSV imports.",
		icon: MysqlIcon,
		glowColor: "from-cyan-500/20 via-cyan-500/5 to-transparent",
		badgeColor: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
		borderColor: "hover:border-cyan-500/40",
	},
	{
		name: "Redis",
		version: "7.2 In-Memory",
		type: "Key-Value & Cache",
		description:
			"Sub-millisecond latency in-memory data structures, cache key inspection, and TTL expiration controls.",
		icon: RedisIcon,
		glowColor: "from-red-500/20 via-red-500/5 to-transparent",
		badgeColor: "text-red-400 border-red-500/30 bg-red-500/10",
		borderColor: "hover:border-red-500/40",
	},
	{
		name: "MariaDB",
		version: "11.2 Optimized",
		type: "Relational SQL",
		description:
			"Enterprise community SQL database engine with high concurrency, advanced analytics, and storage engines.",
		icon: MariadbIcon,
		glowColor: "from-teal-500/20 via-teal-500/5 to-transparent",
		badgeColor: "text-teal-400 border-teal-500/30 bg-teal-500/10",
		borderColor: "hover:border-teal-500/40",
	},
	{
		name: "LibSQL",
		version: "Server 0.24",
		type: "Distributed SQLite",
		description:
			"Modern edge-ready SQLite fork with HTTP and WebSocket streaming endpoints for low-overhead embedded workloads.",
		icon: LibsqlIcon,
		glowColor: "from-purple-500/20 via-purple-500/5 to-transparent",
		badgeColor: "text-purple-400 border-purple-500/30 bg-purple-500/10",
		borderColor: "hover:border-purple-500/40",
	},
];

const PLATFORM_HIGHLIGHTS = [
	{
		icon: Shield,
		title: "Zero-Trust Private VPC",
		description:
			"Workload isolation with strict network segmentation and edge security.",
	},
	{
		icon: Lock,
		title: "Encrypted Storage",
		description:
			"Automatic encryption at rest with persistent enterprise volume snapshots.",
	},
	{
		icon: Activity,
		title: "Deep Health Telemetry",
		description:
			"Real-time I/O, RAM allocation, and query metrics tailored to your subscription.",
	},
	{
		icon: HardDrive,
		title: "Automated Data Ingestion",
		description:
			"Universal data importing for CSV and JSON datasets across all 6 engines.",
	},
];

export function DatabaseManagementComingSoon() {
	return (
		<>
			<Head>
				<title>Managed Databases (Coming Soon) - {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Managed Database Management for ${brand.APP_NAME} is being prepared for general release.`}
				/>
			</Head>

			<div className="min-h-[82vh] w-full flex flex-col justify-between py-6 px-4 sm:px-8 space-y-10">
				{/* Top Hero Section */}
				<div className="max-w-4xl mx-auto text-center space-y-6 pt-4">
					<div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-semibold tracking-wide shadow-sm animate-pulse">
						<Sparkles className="w-3.5 h-3.5 text-indigo-400" />
						Scheduled Platform Upgrades in Progress
					</div>

					<h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
						Managed Database Platform
						<span className="block mt-2 bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
							Coming Soon to {brand.APP_NAME}
						</span>
					</h1>

					<p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
						We are preparing our unified managed database suite for general
						release. Customers will soon enjoy visual schema exploration,
						real-time document filtering, in-browser SQL and Redis consoles,
						automated disaster recovery snapshots, and universal dataset imports
						across all major engines.
					</p>

					<div className="flex flex-wrap items-center justify-center gap-3 pt-2">
						<Button asChild size="default" className="gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/20">
							<Link href="/dashboard/home">
								<ArrowLeft className="w-4 h-4" />
								Return to Home Dashboard
							</Link>
						</Button>

						<Button asChild variant="outline" size="default" className="gap-2 border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-200">
							<Link href="/dashboard/projects">
								<Rocket className="w-4 h-4 text-emerald-400" />
								Deploy Applications
							</Link>
						</Button>

						<Button asChild variant="ghost" size="default" className="gap-2 text-slate-400 hover:text-white">
							<Link href="/dashboard/support">
								<Clock className="w-4 h-4 text-cyan-400" />
								Request Early Access
							</Link>
						</Button>
					</div>
				</div>

				{/* Engine Architecture Preview Grid */}
				<div className="max-w-6xl mx-auto w-full space-y-4">
					<div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
						<div className="flex items-center gap-2">
							<Database className="w-4 h-4 text-indigo-400" />
							<h2 className="text-sm font-semibold tracking-wide uppercase text-slate-300">
								Supported Database Engines (Staging & Staged Release)
							</h2>
						</div>
						<span className="text-xs text-slate-500 font-mono">
							6 Engines In Staging
						</span>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{PREVIEW_ENGINES.map((engine) => {
							const IconComponent = engine.icon;
							return (
								<div
									key={engine.name}
									className={`relative group rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 transition-all duration-300 hover:bg-slate-900/80 hover:shadow-xl ${engine.borderColor}`}
								>
									<div className="flex items-start justify-between gap-3 mb-3">
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-center p-2 shadow-inner">
												<IconComponent className="w-6 h-6" />
											</div>
											<div>
												<h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
													{engine.name}
												</h3>
												<p className="text-[11px] text-slate-400 font-mono">
													{engine.version}
												</p>
											</div>
										</div>

										<Badge
											variant="outline"
											className={`text-[10px] px-2 py-0.5 font-medium ${engine.badgeColor}`}
										>
											{engine.type}
										</Badge>
									</div>

									<p className="text-xs text-slate-400 leading-relaxed mb-4">
										{engine.description}
									</p>

									<div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
										<span className="inline-flex items-center gap-1.5 text-amber-400/90 font-medium">
											<span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
											Private Preview
										</span>
										<span className="text-slate-500">Scheduled for Release</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Architectural Guarantees Footer */}
				<div className="max-w-6xl mx-auto w-full pt-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5 rounded-xl border border-slate-800/60 bg-slate-950/40 backdrop-blur-sm">
						{PLATFORM_HIGHLIGHTS.map((item) => {
							const HighlightIcon = item.icon;
							return (
								<div key={item.title} className="flex items-start gap-3">
									<div className="w-8 h-8 rounded-lg bg-indigo-950/40 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
										<HighlightIcon className="w-4 h-4 text-indigo-400" />
									</div>
									<div className="space-y-0.5">
										<h4 className="text-xs font-semibold text-white">
											{item.title}
										</h4>
										<p className="text-[11px] text-slate-400 leading-normal">
											{item.description}
										</p>
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

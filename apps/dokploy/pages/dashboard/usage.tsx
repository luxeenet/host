import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Activity,
	Cpu,
	HardDrive,
	Zap,
	Globe,
	TrendingUp,
	Clock,
	CheckCircle,
	AlertTriangle,
	ArrowUpRight,
	RefreshCw,
	Database,
	Layers,
	ShieldCheck,
	Sparkles,
	Box,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { api } from "@/utils/api";
import { appRouter } from "@/server/api/root";

function getProgressColor(percentage: number): {
	bar: string;
	badge: string;
	text: string;
} {
	if (percentage >= 90) {
		return {
			bar: "bg-red-500",
			badge: "bg-red-500/20 text-red-400 border-red-500/30",
			text: "text-red-400",
		};
	}
	if (percentage >= 75) {
		return {
			bar: "bg-amber-500",
			badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
			text: "text-amber-400",
		};
	}
	return {
		bar: "bg-primary",
		badge: "bg-secondary text-secondary-foreground border",
		text: "text-foreground font-semibold",
	};
}

export default function ResourceUsagePage() {
	const [isRefreshing, setIsRefreshing] = useState(false);

	const {
		data: usage,
		isLoading,
		isError,
		error,
		refetch,
	} = api.subscription.customerUsage.useQuery(undefined, {
		refetchInterval: 30000,
	});

	const handleManualRefresh = async () => {
		setIsRefreshing(true);
		try {
			await refetch();
			toast.success("Resource usage refreshed");
		} catch (err: any) {
			toast.error(err?.message || "Failed to refresh resource usage");
		} finally {
			setIsRefreshing(false);
		}
	};

	const ramColors = getProgressColor(usage?.ram?.percentage || 0);
	const cpuColors = getProgressColor(usage?.cpu?.percentage || 0);
	const storageColors = getProgressColor(usage?.storage?.percentage || 0);
	const bandwidthColors = getProgressColor(usage?.bandwidth?.percentage || 0);
	const appColors = getProgressColor(usage?.applications?.percentage || 0);
	const dbColors = getProgressColor(usage?.databases?.percentage || 0);

	const isNearAnyLimit =
		(usage?.ram?.percentage || 0) >= 80 ||
		(usage?.cpu?.percentage || 0) >= 80 ||
		(usage?.storage?.percentage || 0) >= 80 ||
		(usage?.applications?.percentage || 0) >= 90;

	return (
		<>
			<Head>
				<title>Resource Usage Analytics - {brand.APP_NAME}</title>
			</Head>

			<BreadcrumbSidebar
				list={[
					{ name: "Home", href: "/dashboard/home" },
					{ name: "Usage", href: "/dashboard/usage" },
				]}
			/>

			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl min-h-[85vh]">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6 h-full">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<h1 className="text-3xl font-semibold tracking-tight">
								Resource Usage & Metering
							</h1>
							{usage?.planName && (
								<span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border">
									{usage.planName} Plan
								</span>
							)}
						</div>
						<p className="text-sm text-muted-foreground mt-1">
							Live resource usage, quota tracking, and subscription limits.
						</p>
					</div>

					<div className="flex items-center gap-2.5">
						{usage?.billingPeriodEnd && (
							<span className="px-3 py-1 rounded-full text-xs font-medium bg-muted/40 text-foreground border border flex items-center gap-1.5">
								<Clock className="w-3.5 h-3.5 text-muted-foreground" />
								Period resets {new Date(usage.billingPeriodEnd).toLocaleDateString()}
							</span>
						)}

						<Button
							variant="outline"
							size="sm"
							onClick={handleManualRefresh}
							disabled={isRefreshing || isLoading}
							className="border text-foreground hover:text-foreground bg-muted/40 text-xs h-8 px-3 gap-1.5"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>

						<Link href="/dashboard/billing">
							<Button
								size="sm"
								className="text-xs h-8 px-3.5 gap-1.5 font-medium"
							>
								<Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
								Upgrade Plan
							</Button>
						</Link>
					</div>
				</div>

				{/* Upgrade Advisory Banner if nearing limits */}
				{isNearAnyLimit && (
					<div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div className="flex items-start gap-3">
							<AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
							<div>
								<h3 className="text-sm font-semibold text-foreground">
									Approaching Subscription Quota Limits
								</h3>
								<p className="text-xs text-muted-foreground mt-0.5">
									One or more workloads are nearing the memory, CPU, or service capacity allocated to your current plan. Upgrade anytime for instantaneous limit expansion.
								</p>
							</div>
						</div>
						<Link href="/dashboard/billing" className="shrink-0">
							<Button
								size="sm"
								className="bg-amber-600 hover:bg-amber-500 text-foreground text-xs h-8 px-4 gap-1.5 font-semibold"
							>
								View Upgrades <ArrowUpRight className="w-3.5 h-3.5" />
							</Button>
						</Link>
					</div>
				)}

				{/* Loading State */}
				{isLoading && !usage && (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						{[...Array(6)].map((_, i) => (
							<div
								key={i}
								className="rounded-xl border bg-card p-6 space-y-4 animate-pulse"
							>
								<div className="h-4 bg-muted rounded w-1/3" />
								<div className="h-8 bg-muted rounded w-2/3" />
								<div className="h-2 bg-muted rounded w-full" />
							</div>
						))}
					</div>
				)}

				{/* Error State */}
				{isError && (
					<div className="p-8 rounded-xl bg-red-950/20 border border-red-500/20 text-center space-y-3">
						<AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
						<h3 className="text-sm font-semibold text-foreground">
							Unable to Load Resource Usage
						</h3>
						<p className="text-xs text-muted-foreground max-w-md mx-auto">
							{error?.message || "An unexpected error occurred while loading resource metrics."}
						</p>
						<Button
							size="sm"
							variant="outline"
							onClick={() => refetch()}
							className="border-red-500/30 text-red-300 text-xs mt-2"
						>
							Try Again
						</Button>
					</div>
				)}

				{/* Metric Gauges Grid */}
				{usage && (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{/* RAM Quota Gauge */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									RAM Usage
								</span>
								<div className="w-8 h-8 rounded-lg bg-muted border flex items-center justify-center">
									<Activity className="w-4 h-4 text-foreground font-semibold" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.ram.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.ram.formattedLimit} Limit
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${ramColors.text}`}>
										<TrendingUp className="w-3 h-3" />
										{usage.ram.percentage}% Used
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.ram.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${ramColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.ram.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<ShieldCheck className="w-3 h-3 text-emerald-500/80 shrink-0" />
								{usage.ram.statusLabel || "Memory used by your active applications."}
							</p>
						</div>

						{/* CPU Load Gauge */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									CPU Usage
								</span>
								<div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-500/20 flex items-center justify-center">
									<Cpu className="w-4 h-4 text-blue-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.cpu.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.cpu.formattedLimit}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${cpuColors.text}`}>
										<Activity className="w-3 h-3" />
										{usage.cpu.percentage}% Utilization
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.cpu.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${cpuColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.cpu.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-blue-400/80 shrink-0" />
								{usage.cpu.statusLabel}
							</p>
						</div>

						{/* Storage Quota Gauge */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									Storage Usage
								</span>
								<div className="w-8 h-8 rounded-lg bg-purple-950/80 border border-purple-500/20 flex items-center justify-center">
									<HardDrive className="w-4 h-4 text-purple-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.storage.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.storage.formattedLimit}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${storageColors.text}`}>
										<TrendingUp className="w-3 h-3" />
										{usage.storage.percentage}% Used
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.storage.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${storageColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.storage.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-purple-400/80 shrink-0" />
								{usage.storage.statusLabel || "Storage used by your files, applications, and backups."}
							</p>
						</div>

						{/* Monthly Egress Bandwidth */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									Bandwidth Usage
								</span>
								<div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center">
									<Globe className="w-4 h-4 text-cyan-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.bandwidth.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.bandwidth.formattedLimit} Included
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${bandwidthColors.text}`}>
										<CheckCircle className="w-3 h-3" />
										{usage.bandwidth.percentage}% Consumed
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.bandwidth.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${bandwidthColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.bandwidth.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<Globe className="w-3 h-3 text-cyan-400/80 shrink-0" />
								{usage.bandwidth.statusLabel || "Outbound HTTP and service egress for the active billing cycle."}
							</p>
						</div>

						{/* Application Slots */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									Application Slots
								</span>
								<div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center">
									<Zap className="w-4 h-4 text-emerald-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.applications.used} Apps
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.applications.limit === -1 ? "Unlimited" : `${usage.applications.limit} Max`}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${appColors.text}`}>
										<Layers className="w-3 h-3" />
										{usage.applications.percentage}% Slots Active
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.applications.remaining === -1 ? "Unlimited" : `${usage.applications.remaining} available`}
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${appColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.applications.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<Box className="w-3 h-3 text-emerald-400/80 shrink-0" />
								Standalone applications and Git repository deployments.
							</p>
						</div>

						{/* Database Slots */}
						<div className="rounded-xl border bg-card p-6 space-y-4 relative overflow-hidden group hover:border transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground">
									Database Quota
								</span>
								<div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-500/20 flex items-center justify-center">
									<Database className="w-4 h-4 text-amber-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
										{usage.databases.used} DBs
									</h3>
									<span className="text-xs font-medium text-muted-foreground">
										/ {usage.databases.limit === -1 ? "Unlimited" : `${usage.databases.limit} Max`}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${dbColors.text}`}>
										<Database className="w-3 h-3" />
										{usage.databases.percentage}% Quota Used
									</span>
									<span className="text-muted-foreground font-medium">
										{usage.databases.remaining === -1 ? "Unlimited" : `${usage.databases.remaining} available`}
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
								<div
									className={`h-full ${dbColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.databases.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-amber-400/80 shrink-0" />
								Managed database instances provisioned for this organization.
							</p>
						</div>
					</div>
				)}

				{/* Workload Breakdown Table */}
				<div className="rounded-xl border bg-card overflow-hidden">
					<div className="p-6 border-b border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div>
							<h3 className="text-base font-semibold text-foreground">
								Application & Database Usage
							</h3>
							<p className="text-xs text-muted-foreground mt-0.5">
								Resource metrics for your active applications and services.
							</p>
						</div>

						{usage?.timestamp && (
							<span className="text-[11px] text-muted-foreground font-mono">
								Last measured {new Date(usage.timestamp).toLocaleTimeString()}
							</span>
						)}
					</div>

					{usage?.workloads && usage.workloads.length > 0 ? (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-muted/40/60 text-muted-foreground border-b border">
									<tr>
										<th className="px-6 py-3.5 font-medium">Service Name</th>
										<th className="px-6 py-3.5 font-medium">Type</th>
										<th className="px-6 py-3.5 font-medium">Project / Environment</th>
										<th className="px-6 py-3.5 font-medium">Measured RAM</th>
										<th className="px-6 py-3.5 font-medium">CPU Load</th>
										<th className="px-6 py-3.5 font-medium">Bandwidth</th>
										<th className="px-6 py-3.5 font-medium">Status</th>
										<th className="px-6 py-3.5 font-medium text-right">Status</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border text-foreground">
									{usage.workloads.map((w) => (
										<tr
											key={w.id}
											className="hover:bg-muted/30 transition-colors"
										>
											<td className="px-6 py-4 font-bold text-foreground flex items-center gap-2">
												{w.serviceType === "database" ? (
													<Database className="w-4 h-4 text-amber-400 shrink-0" />
												) : (
													<Box className="w-4 h-4 text-foreground font-semibold shrink-0" />
												)}
												<span className="truncate max-w-xs">{w.name}</span>
											</td>
											<td className="px-6 py-4 text-muted-foreground">
												<span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-muted text-foreground border border">
													{w.engine || w.serviceType}
												</span>
											</td>
											<td className="px-6 py-4 text-muted-foreground font-mono text-[11px]">
												{w.projectName} / {w.environmentName}
											</td>
											<td className="px-6 py-4 font-mono font-medium text-foreground font-semibold">
												{w.telemetryStatus === "collecting" ? (
													<span className="text-amber-400">Collecting...</span>
												) : w.telemetryStatus === "unavailable" ? (
													<span className="text-muted-foreground">
														{w.allocatedRamMb ? `${w.allocatedRamMb} MB (limit)` : "Unavailable"}
													</span>
												) : w.telemetryStatus === "zero" || w.measuredRamMb === 0 ? (
													"0.0 MB"
												) : w.telemetryStatus === "stale" ? (
													<span>{`${w.measuredRamMb.toFixed(1)} MB (stale)`}</span>
												) : (
													`${w.measuredRamMb < 0.1 ? "<0.1" : w.measuredRamMb.toFixed(1)} MB`
												)}
											</td>
											<td className="px-6 py-4 font-mono">
												{w.telemetryStatus === "collecting" ? (
													<span className="text-amber-400">Collecting...</span>
												) : w.telemetryStatus === "unavailable" ? (
													<span className="text-muted-foreground">Unavailable</span>
												) : w.telemetryStatus === "zero" || (w.measuredCpuPercent === 0 && (!w.measuredCpuMcores || w.measuredCpuMcores === 0)) ? (
													<span className="text-muted-foreground">0 mCPU (0.0%)</span>
												) : w.telemetryStatus === "stale" ? (
													<span>{`${(w.measuredCpuPercent * 10).toFixed(0)} mCPU (${w.measuredCpuPercent.toFixed(1)}% stale)`}</span>
												) : (
													`${(w.measuredCpuPercent * 10).toFixed(0)} mCPU (${w.measuredCpuPercent.toFixed(1)}%)`
												)}
											</td>
											<td className="px-6 py-4 font-mono text-foreground">
												{w.telemetryStatus === "collecting" ? (
													<span className="text-amber-400">Collecting...</span>
												) : w.telemetryStatus === "unavailable" ? (
													<span className="text-muted-foreground">Unavailable</span>
												) : w.telemetryStatus === "zero" || ((w.measuredEgressMb ?? w.measuredNetworkMb) === 0) ? (
													"0.0 MB"
												) : (
													`${(w.measuredEgressMb ?? w.measuredNetworkMb).toFixed(1)} MB`
												)}
											</td>
											<td className="px-6 py-4">
												{w.telemetryStatus === "measured" ? (
													<span
														className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
														title={w.telemetryReason || "Active"}
													>
														Active
													</span>
												) : w.telemetryStatus === "collecting" ? (
													<span
														className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"
														title={w.telemetryReason || "Starting up"}
													>
														Starting
													</span>
												) : w.telemetryStatus === "stale" ? (
													<span
														className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
														title={w.telemetryReason || "Updating"}
													>
														Updating
													</span>
												) : w.telemetryStatus === "zero" ? (
													<span
														className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
														title={w.telemetryReason || "Idle"}
													>
														Idle
													</span>
												) : (
													<span
														className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border"
														title={w.telemetryReason || "Offline"}
													>
														Offline
													</span>
												)}
											</td>
											<td className="px-6 py-4 text-right">
												<span
													className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
														(w.lifecycleStatus || w.status) === "running"
															? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
															: (w.lifecycleStatus || w.status) === "stopped"
																? "bg-muted text-muted-foreground border"
																: (w.lifecycleStatus || w.status) === "pending"
																	? "bg-amber-500/20 text-amber-400 border-amber-500/30"
																	: "bg-red-500/20 text-red-400 border-red-500/30"
													}`}
												>
													{(w.lifecycleStatus || w.status || "idle").toUpperCase()}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<div className="p-12 text-center space-y-3">
							<Box className="w-10 h-10 text-muted-foreground mx-auto" />
							<h4 className="text-sm font-semibold text-foreground">
								No Deployed Applications Found
							</h4>
							<p className="text-xs text-muted-foreground max-w-sm mx-auto">
								Deploy an application or database to view real-time resource usage and plan limits.
							</p>
							<div className="pt-2">
								<Link href="/dashboard/home">
									<Button
										size="sm"
										className="text-xs h-8 px-4"
									>
										Deploy an Application
									</Button>
								</Link>
							</div>
						</div>
					)}

					{/* Resource Tracking Footer */}
					<div className="p-4 bg-muted/40 border-t text-[11px] text-muted-foreground flex items-center justify-between">
						<span className="flex items-center gap-1.5">
							<ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
							<strong>Resource Tracking:</strong> Usage is calculated in real time based on your active services.
						</span>
						<span>
							Units: MB / GB • Rounding: 1 decimal place
						</span>
					</div>
				</div>
					</div>
				</Card>
			</div>
		</>
	);
}

ResourceUsagePage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Resource Usage">{page}</DashboardLayout>
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
	await helpers.project.onboardingStatus.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

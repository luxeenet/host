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
	HelpCircle,
	Server,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

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
		bar: "bg-indigo-500",
		badge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
		text: "text-indigo-400",
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
			toast.success("Resource telemetry refreshed");
		} catch (err: any) {
			toast.error(err?.message || "Failed to refresh telemetry");
		} finally {
			setIsRefreshing(false);
		}
	};

	const ramColors = getProgressColor(usage?.ram.percentage || 0);
	const cpuColors = getProgressColor(usage?.cpu.percentage || 0);
	const storageColors = getProgressColor(usage?.storage.percentage || 0);
	const bandwidthColors = getProgressColor(usage?.bandwidth.percentage || 0);
	const appColors = getProgressColor(usage?.applications.percentage || 0);
	const dbColors = getProgressColor(usage?.databases.percentage || 0);

	const isNearAnyLimit =
		(usage?.ram.percentage || 0) >= 80 ||
		(usage?.cpu.percentage || 0) >= 80 ||
		(usage?.storage.percentage || 0) >= 80 ||
		(usage?.applications.percentage || 0) >= 90;

	return (
		<>
			<Head>
				<title>Resource Usage Analytics - {brand.APP_NAME}</title>
			</Head>

			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<h1 className="text-2xl font-bold text-white tracking-tight">
								Resource Usage & Metering
							</h1>
							{usage?.planName && (
								<span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
									{usage.planName} Plan
								</span>
							)}
						</div>
						<p className="text-slate-400 text-sm mt-1">
							Live tenant resource telemetry, quota consumption, and effective subscription limits.
						</p>
					</div>

					<div className="flex items-center gap-2.5">
						{usage?.billingPeriodEnd && (
							<span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-slate-300 border border-slate-800 flex items-center gap-1.5">
								<Clock className="w-3.5 h-3.5 text-slate-400" />
								Period resets {new Date(usage.billingPeriodEnd).toLocaleDateString()}
							</span>
						)}

						<Button
							variant="outline"
							size="sm"
							onClick={handleManualRefresh}
							disabled={isRefreshing || isLoading}
							className="border-slate-800 text-slate-300 hover:text-white bg-slate-900/60 text-xs h-8 px-3 gap-1.5"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>

						<Link href="/dashboard/billing">
							<Button
								size="sm"
								className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-3.5 gap-1.5 font-medium"
							>
								<Sparkles className="w-3.5 h-3.5 text-indigo-200" />
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
								<h3 className="text-sm font-semibold text-white">
									Approaching Subscription Quota Limits
								</h3>
								<p className="text-xs text-slate-400 mt-0.5">
									One or more workloads are nearing the memory, CPU, or service capacity allocated to your current plan. Upgrade anytime for instantaneous limit expansion.
								</p>
							</div>
						</div>
						<Link href="/dashboard/billing" className="shrink-0">
							<Button
								size="sm"
								className="bg-amber-600 hover:bg-amber-500 text-white text-xs h-8 px-4 gap-1.5 font-semibold"
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
								className="rounded-xl bg-slate-900/40 border border-slate-800 p-6 space-y-4 animate-pulse"
							>
								<div className="h-4 bg-slate-800 rounded w-1/3" />
								<div className="h-8 bg-slate-800 rounded w-2/3" />
								<div className="h-2 bg-slate-800 rounded w-full" />
							</div>
						))}
					</div>
				)}

				{/* Error State */}
				{isError && (
					<div className="p-8 rounded-xl bg-red-950/20 border border-red-500/20 text-center space-y-3">
						<AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
						<h3 className="text-sm font-semibold text-white">
							Unable to Load Resource Telemetry
						</h3>
						<p className="text-xs text-slate-400 max-w-md mx-auto">
							{error?.message || "An unexpected error occurred while querying organization metrics."}
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
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									RAM Quota Usage
								</span>
								<div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-500/20 flex items-center justify-center">
									<Activity className="w-4 h-4 text-indigo-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.ram.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.ram.formattedLimit} Limit
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${ramColors.text}`}>
										<TrendingUp className="w-3 h-3" />
										{usage.ram.percentage}% Plan Capacity
									</span>
									<span className="text-slate-400 font-medium">
										{usage.ram.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${ramColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.ram.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<ShieldCheck className="w-3 h-3 text-emerald-500/80 shrink-0" />
								Strictly measured for your workloads; host physical RAM is never exposed.
							</p>
						</div>

						{/* CPU Load Gauge */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									CPU Quota Allocation
								</span>
								<div className="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-500/20 flex items-center justify-center">
									<Cpu className="w-4 h-4 text-blue-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.cpu.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.cpu.formattedLimit}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${cpuColors.text}`}>
										<Activity className="w-3 h-3" />
										{usage.cpu.percentage}% Utilization
									</span>
									<span className="text-slate-400 font-medium">
										{usage.cpu.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${cpuColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.cpu.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-blue-400/80 shrink-0" />
								{usage.cpu.statusLabel}
							</p>
						</div>

						{/* Storage Quota Gauge */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									Volume & Database Storage
								</span>
								<div className="w-8 h-8 rounded-lg bg-purple-950/80 border border-purple-500/20 flex items-center justify-center">
									<HardDrive className="w-4 h-4 text-purple-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.storage.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.storage.formattedLimit} Quota
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${storageColors.text}`}>
										<TrendingUp className="w-3 h-3" />
										{usage.storage.percentage}% Allocated
									</span>
									<span className="text-slate-400 font-medium">
										{usage.storage.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${storageColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.storage.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-purple-400/80 shrink-0" />
								Persistent volume footprints and backups for this tenant.
							</p>
						</div>

						{/* Monthly Egress Bandwidth */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									Monthly Egress Bandwidth
								</span>
								<div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center">
									<Globe className="w-4 h-4 text-cyan-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.bandwidth.formattedUsed}
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.bandwidth.formattedLimit} Included
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${bandwidthColors.text}`}>
										<CheckCircle className="w-3 h-3" />
										{usage.bandwidth.percentage}% Consumed
									</span>
									<span className="text-slate-400 font-medium">
										{usage.bandwidth.formattedRemaining} remaining
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${bandwidthColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.bandwidth.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<Globe className="w-3 h-3 text-cyan-400/80 shrink-0" />
								Outbound HTTP and service egress for the active billing cycle.
							</p>
						</div>

						{/* Application Slots */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									Application Slots
								</span>
								<div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center">
									<Zap className="w-4 h-4 text-emerald-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.applications.used} Apps
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.applications.limit === -1 ? "Unlimited" : `${usage.applications.limit} Max`}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${appColors.text}`}>
										<Layers className="w-3 h-3" />
										{usage.applications.percentage}% Slots Active
									</span>
									<span className="text-slate-400 font-medium">
										{usage.applications.remaining === -1 ? "Unlimited" : `${usage.applications.remaining} available`}
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${appColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.applications.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<Box className="w-3 h-3 text-emerald-400/80 shrink-0" />
								Standalone applications and Git repository deployments.
							</p>
						</div>

						{/* Database Slots */}
						<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4 relative overflow-hidden group hover:border-slate-700 transition-colors">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-slate-300">
									Database Quota
								</span>
								<div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-500/20 flex items-center justify-center">
									<Database className="w-4 h-4 text-amber-400" />
								</div>
							</div>

							<div>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="text-2xl font-extrabold text-white tracking-tight">
										{usage.databases.used} DBs
									</h3>
									<span className="text-xs font-medium text-slate-400">
										/ {usage.databases.limit === -1 ? "Unlimited" : `${usage.databases.limit} Max`}
									</span>
								</div>

								<div className="flex items-center justify-between mt-1 text-[11px]">
									<span className={`font-semibold flex items-center gap-1 ${dbColors.text}`}>
										<Database className="w-3 h-3" />
										{usage.databases.percentage}% Quota Used
									</span>
									<span className="text-slate-400 font-medium">
										{usage.databases.remaining === -1 ? "Unlimited" : `${usage.databases.remaining} available`}
									</span>
								</div>
							</div>

							<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
								<div
									className={`h-full ${dbColors.bar} transition-all duration-500 rounded-full`}
									style={{ width: `${Math.min(usage.databases.percentage, 100)}%` }}
								/>
							</div>

							<p className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
								<CheckCircle className="w-3 h-3 text-amber-400/80 shrink-0" />
								Managed database instances provisioned for this organization.
							</p>
						</div>
					</div>
				)}

				{/* Workload Breakdown Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div>
							<h3 className="text-base font-semibold text-white">
								Tenant Workload Breakdown
							</h3>
							<p className="text-xs text-slate-400 mt-0.5">
								Attributed resource telemetry measured strictly for your organization's active services.
							</p>
						</div>

						{usage?.timestamp && (
							<span className="text-[11px] text-slate-500 font-mono">
								Last measured {new Date(usage.timestamp).toLocaleTimeString()}
							</span>
						)}
					</div>

					{usage?.workloads && usage.workloads.length > 0 ? (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
									<tr>
										<th className="px-6 py-3.5 font-medium">Service Name</th>
										<th className="px-6 py-3.5 font-medium">Type</th>
										<th className="px-6 py-3.5 font-medium">Project / Environment</th>
										<th className="px-6 py-3.5 font-medium">Measured RAM</th>
										<th className="px-6 py-3.5 font-medium">CPU Load</th>
										<th className="px-6 py-3.5 font-medium">Bandwidth</th>
										<th className="px-6 py-3.5 font-medium">Telemetry</th>
										<th className="px-6 py-3.5 font-medium text-right">Status</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60 text-slate-300">
									{usage.workloads.map((w) => (
										<tr
											key={w.id}
											className="hover:bg-slate-800/30 transition-colors"
										>
											<td className="px-6 py-4 font-bold text-white flex items-center gap-2">
												{w.serviceType === "database" ? (
													<Database className="w-4 h-4 text-amber-400 shrink-0" />
												) : (
													<Box className="w-4 h-4 text-indigo-400 shrink-0" />
												)}
												<span className="truncate max-w-xs">{w.name}</span>
											</td>
											<td className="px-6 py-4 text-slate-400">
												<span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-300 border border-slate-700">
													{w.engine || w.serviceType}
												</span>
											</td>
											<td className="px-6 py-4 text-slate-400 font-mono text-[11px]">
												{w.projectName} / {w.environmentName}
											</td>
											<td className="px-6 py-4 font-mono font-medium text-indigo-300">
												{w.measuredRamMb > 0
													? `${w.measuredRamMb.toFixed(1)} MB`
													: w.allocatedRamMb
														? `${w.allocatedRamMb} MB (res)`
														: "0 MB"}
											</td>
											<td className="px-6 py-4 font-mono">
												{w.measuredCpuPercent > 0
													? `${w.measuredCpuPercent.toFixed(1)}%`
													: "Idle"}
											</td>
											<td className="px-6 py-4 font-mono text-slate-300">
												{w.measuredNetworkMb > 0
													? `${w.measuredNetworkMb.toFixed(1)} MB`
													: "0 MB"}
											</td>
											<td className="px-6 py-4">
												{w.hasLiveTelemetry ? (
													<span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
														Live Metrics
													</span>
												) : (
													<span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
														Standby / Reserved
													</span>
												)}
											</td>
											<td className="px-6 py-4 text-right">
												<span
													className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
														w.status === "running"
															? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
															: w.status === "idle"
																? "bg-slate-800 text-slate-400 border-slate-700"
																: "bg-red-500/20 text-red-400 border-red-500/30"
													}`}
												>
													{w.status.toUpperCase()}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<div className="p-12 text-center space-y-3">
							<Box className="w-10 h-10 text-slate-600 mx-auto" />
							<h4 className="text-sm font-semibold text-white">
								No Deployed Workloads Found
							</h4>
							<p className="text-xs text-slate-400 max-w-sm mx-auto">
								Deploy an application or create a service in this workspace to see live resource telemetry and meter consumption against your plan.
							</p>
							<div className="pt-2">
								<Link href="/dashboard/home">
									<Button
										size="sm"
										className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs h-8 px-4"
									>
										Deploy an Application
									</Button>
								</Link>
							</div>
						</div>
					)}

					{/* Isolation Disclosure Footer */}
					<div className="p-4 bg-slate-950/40 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
						<span className="flex items-center gap-1.5">
							<ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
							<strong>Strict Isolation:</strong> Physical server hardware capacity and other tenants' workloads are fully concealed and excluded from your dashboard.
						</span>
						<span>
							Units: MB / GB • Rounding: 1 decimal place
						</span>
					</div>
				</div>
			</div>
		</>
	);
}

ResourceUsagePage.getLayout = (page: ReactElement) => (
	<CustomerLayout>{page}</CustomerLayout>
);

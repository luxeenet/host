import Head from "next/head";
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
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

export default function ResourceUsagePage() {
	return (
		<>
			<Head>
				<title>Resource Usage Analytics - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Resource Usage & Metering</h1>
						<p className="text-slate-400 text-sm mt-1">
							Real-time RAM, CPU, and egress network bandwidth telemetry for your active services.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
							<Clock className="w-3.5 h-3.5 text-indigo-400" /> Current Period (Sep 2026)
						</span>
					</div>
				</div>

				{/* Resource Metrics Gauges Grid */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{/* RAM Allocation Meter */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">RAM Quota Usage</span>
							<div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-500/20 flex items-center justify-center">
								<Activity className="w-4 h-4 text-indigo-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">1.5 GB <span className="text-slate-400 text-xs font-normal">/ 4.0 GB Limit</span></h3>
							<p className="text-[11px] text-indigo-400 font-medium flex items-center gap-1 mt-1">
								<TrendingUp className="w-3 h-3" /> 37.5% Plan Capacity Allocated
							</p>
						</div>
						<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
							<div className="h-full bg-indigo-500 rounded-full" style={{ width: "37.5%" }} />
						</div>
					</div>

					{/* Bandwidth Usage Meter */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Monthly Egress Bandwidth</span>
							<div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center">
								<Globe className="w-4 h-4 text-cyan-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">45.2 GB <span className="text-slate-400 text-xs font-normal">/ 500 GB Included</span></h3>
							<p className="text-[11px] text-cyan-400 font-medium flex items-center gap-1 mt-1">
								<CheckCircle className="w-3 h-3 text-cyan-400" /> Normal Consumption Rate
							</p>
						</div>
						<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
							<div className="h-full bg-cyan-500 rounded-full" style={{ width: "9%" }} />
						</div>
					</div>

					{/* Deployed Service Count */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Service Slot Allocation</span>
							<div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center">
								<Zap className="w-4 h-4 text-emerald-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">3 Apps <span className="text-slate-400 text-xs font-normal">/ 10 Slots Max</span></h3>
							<p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
								7 Available Slots Remaining
							</p>
						</div>
						<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
							<div className="h-full bg-emerald-500 rounded-full" style={{ width: "30%" }} />
						</div>
					</div>
				</div>

				{/* Usage Breakdown By Service */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800">
						<h3 className="text-base font-semibold text-white">Service Usage Breakdown</h3>
						<p className="text-xs text-slate-400">Resource consumption by active application and database service.</p>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
								<tr>
									<th className="px-6 py-3.5 font-medium">Service Name</th>
									<th className="px-6 py-3.5 font-medium">Service Type</th>
									<th className="px-6 py-3.5 font-medium">RAM Consumed</th>
									<th className="px-6 py-3.5 font-medium">CPU Load</th>
									<th className="px-6 py-3.5 font-medium">Egress Traffic</th>
									<th className="px-6 py-3.5 font-medium text-right">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/60 text-slate-300">
								<tr className="hover:bg-slate-800/30 transition-colors">
									<td className="px-6 py-4 font-bold text-white">frontend-nextjs-app</td>
									<td className="px-6 py-4 text-slate-400">Next.js Web App</td>
									<td className="px-6 py-4 font-mono font-medium text-indigo-300">512 MB</td>
									<td className="px-6 py-4 font-mono">1.2%</td>
									<td className="px-6 py-4 font-mono text-slate-300">32.4 GB</td>
									<td className="px-6 py-4 text-right">
										<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
											HEALTHY
										</span>
									</td>
								</tr>

								<tr className="hover:bg-slate-800/30 transition-colors">
									<td className="px-6 py-4 font-bold text-white">production-backend-api</td>
									<td className="px-6 py-4 text-slate-400">Node.js API Container</td>
									<td className="px-6 py-4 font-mono font-medium text-indigo-300">768 MB</td>
									<td className="px-6 py-4 font-mono">4.8%</td>
									<td className="px-6 py-4 font-mono text-slate-300">11.8 GB</td>
									<td className="px-6 py-4 text-right">
										<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
											HEALTHY
										</span>
									</td>
								</tr>

								<tr className="hover:bg-slate-800/30 transition-colors">
									<td className="px-6 py-4 font-bold text-white">main-postgres-db</td>
									<td className="px-6 py-4 text-slate-400">PostgreSQL 16 DB</td>
									<td className="px-6 py-4 font-mono font-medium text-indigo-300">256 MB</td>
									<td className="px-6 py-4 font-mono">0.6%</td>
									<td className="px-6 py-4 font-mono text-slate-300">1.0 GB</td>
									<td className="px-6 py-4 text-right">
										<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
											HEALTHY
										</span>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}

ResourceUsagePage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

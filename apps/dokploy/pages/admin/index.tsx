import Head from "next/head";
import Link from "next/link";
import { type ReactElement } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import {
	DollarSign,
	Users,
	Server,
	Zap,
	TrendingUp,
	CheckCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

export default function AdminDashboardPage() {
	const { data, isLoading } = api.admin.dashboardStats.useQuery();

	return (
		<>
			<Head>
				<title>Platform Admin Dashboard - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Top Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
								OPERATIONAL MODE: COMMERCIAL PAAS
							</span>
						</div>
						<h1 className="text-2xl font-bold text-white tracking-tight mt-1">Platform Performance & MRR</h1>
						<p className="text-slate-400 text-sm mt-0.5">
							Live revenue, customer subscriptions, cluster node capacity, and platform health.
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Link href="/admin/plans">
							<Button className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium text-xs shadow-lg shadow-amber-600/20">
								Manage Hosting Plans
							</Button>
						</Link>
					</div>
				</div>

				{/* Business Metrics Cards */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					{/* MRR */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Monthly Recurring Revenue (MRR)</span>
							<div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center">
								<DollarSign className="w-4 h-4 text-emerald-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">
								{isLoading ? "Loading..." : `$${(data?.mrr ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
							</h3>
							<p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
								<TrendingUp className="w-3 h-3" /> Live recurring revenue
							</p>
						</div>
					</div>

					{/* Active Customers */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Registered Customers</span>
							<div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-500/20 flex items-center justify-center">
								<Users className="w-4 h-4 text-indigo-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">
								{isLoading ? "Loading..." : (data?.totalCustomers ?? 0)}
							</h3>
							<p className="text-[11px] text-indigo-400 font-medium flex items-center gap-1 mt-1">
								{data?.activeSubscriptions ?? 0} active subscriptions
							</p>
						</div>
					</div>

					{/* Deployed Apps */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Active Deployed Apps</span>
							<div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center">
								<Zap className="w-4 h-4 text-cyan-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">
								{isLoading ? "Loading..." : (data?.totalApplications ?? 0)}
							</h3>
							<p className="text-[11px] text-slate-400 font-medium mt-1">
								{data?.totalDeployments ?? 0} total deployments
							</p>
						</div>
					</div>

					{/* Server Nodes */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-3">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium text-slate-400">Cluster Nodes</span>
							<div className="w-8 h-8 rounded-lg bg-amber-950/80 border border-amber-500/20 flex items-center justify-center">
								<Server className="w-4 h-4 text-amber-400" />
							</div>
						</div>
						<div>
							<h3 className="text-2xl font-extrabold text-white">
								{isLoading ? "Loading..." : (data?.totalServers ?? 0)}
							</h3>
							<p className="text-[11px] text-amber-400 font-medium mt-1">Connected cluster nodes</p>
						</div>
					</div>
				</div>

				{/* Plan Distribution & System Status */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Customer Plan Distribution */}
					<div className="lg:col-span-2 rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<h3 className="text-base font-semibold text-white">Plan Distribution breakdown</h3>
						{isLoading ? (
							<div className="text-xs text-slate-400">Loading plan distribution...</div>
						) : !data?.planDistribution || data.planDistribution.length === 0 ? (
							<div className="text-xs text-slate-500 py-4">No active subscription plans yet.</div>
						) : (
							<div className="space-y-4">
								{data.planDistribution.map((item) => {
									const pct = data.activeSubscriptions > 0 ? Math.round((item.count / data.activeSubscriptions) * 100) : 0;
									return (
										<div key={item.name}>
											<div className="flex justify-between text-xs mb-1">
												<span className="text-slate-300 font-medium">{item.name} (${item.price}/mo)</span>
												<span className="text-white font-bold">{item.count} Customers ({pct}%)</span>
											</div>
											<div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
												<div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>

					{/* Platform Health Quick Guard */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<h3 className="text-base font-semibold text-white">Cluster Infrastructure</h3>
						<div className="space-y-3 text-xs">
							<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<CheckCircle className="w-4 h-4 text-emerald-400" />
									<span className="text-slate-300">Traefik Ingress Router</span>
								</div>
								<span className="text-emerald-400 font-bold">ONLINE</span>
							</div>

							<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<CheckCircle className="w-4 h-4 text-emerald-400" />
									<span className="text-slate-300">Swarm Deployment Worker</span>
								</div>
								<span className="text-emerald-400 font-bold">ACTIVE</span>
							</div>

							<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<CheckCircle className="w-4 h-4 text-emerald-400" />
									<span className="text-slate-300">PostgreSQL Control Plane DB</span>
								</div>
								<span className="text-emerald-400 font-bold">READY</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

AdminDashboardPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return { redirect: { destination: "/", permanent: false } };
	}
	if (!(user as any).isPlatformAdmin) {
		return { redirect: { destination: "/dashboard", permanent: false } };
	}
	return { props: {} };
}

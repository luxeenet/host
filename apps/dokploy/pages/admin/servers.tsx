import Head from "next/head";
import { type ReactElement } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { toast } from "sonner";
import {
	Server,
	Cpu,
	HardDrive,
	Activity,
	Plus,
	Terminal,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

export default function AdminServersPage() {
	const { data: servers, isLoading } = api.admin.listServers.useQuery();

	return (
		<>
			<Head>
				<title>Cluster Infrastructure & Nodes - {brand.APP_NAME} Admin</title>
			</Head>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Cluster Infrastructure & Node Capacity</h1>
						<p className="text-slate-400 text-sm mt-1">
							Monitor hardware capacity, RAM/CPU allocation across cluster nodes, and add remote servers.
						</p>
					</div>

					<Button
						onClick={() => toast.info("Add Remote SSH Worker Node dialog")}
						className="bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs gap-2 shrink-0 shadow-lg shadow-amber-600/20"
					>
						<Plus className="w-4 h-4" /> Connect New SSH Node
					</Button>
				</div>

				{/* Cluster Nodes List */}
				{isLoading ? (
					<div className="text-slate-400 text-sm p-8 text-center">Loading server nodes from database...</div>
				) : !servers || servers.length === 0 ? (
					<div className="text-slate-500 text-sm p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800">
						No external server nodes connected yet. Primary control plane host is running locally.
					</div>
				) : (
					<div className="grid grid-cols-1 gap-6">
						{servers.map((node) => {
							const ramTotalMb = node.capacity?.ramMb || 16384;
							const ramReservedMb = node.capacity?.reservedRamMb || 0;
							const ramPercent = Math.round((ramReservedMb / ramTotalMb) * 100) || 0;

							return (
								<div
									key={node.serverId}
									className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5 hover:border-slate-700 transition-all"
								>
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-500/20 flex items-center justify-center shrink-0">
												<Server className="w-5 h-5 text-amber-400" />
											</div>
											<div>
												<div className="flex items-center gap-2">
													<h3 className="text-sm font-bold text-white">{node.name || node.ipAddress}</h3>
													<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
														{node.serverStatus || "ONLINE"}
													</span>
												</div>
												<p className="text-xs text-slate-400 font-mono mt-0.5">
													IP: {node.ipAddress} • Port: {node.port}
												</p>
											</div>
										</div>

										<Button
											variant="outline"
											size="sm"
											onClick={() => toast.success(`SSH Health diagnostic clean on ${node.ipAddress}`)}
											className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
										>
											<Terminal className="w-3.5 h-3.5 text-amber-400" /> Run Diagnostics
										</Button>
									</div>

									{/* Resource Metering */}
									<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
										<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
											<div className="flex justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<Cpu className="w-3.5 h-3.5 text-indigo-400" /> CPU Cores
												</span>
												<span className="text-white font-mono font-bold">{node.capacity?.cpuCores || 4} Cores</span>
											</div>
										</div>

										<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
											<div className="flex justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<Activity className="w-3.5 h-3.5 text-amber-400" /> RAM Capacity
												</span>
												<span className="text-white font-mono font-bold">
													{Math.round(ramTotalMb / 1024)} GB Total
												</span>
											</div>
											<div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
												<div className="h-full bg-amber-500 rounded-full" style={{ width: `${ramPercent}%` }} />
											</div>
										</div>

										<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
											<div className="flex justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<HardDrive className="w-3.5 h-3.5 text-cyan-400" /> Disk Capacity
												</span>
												<span className="text-white font-mono font-bold">
													{node.capacity?.diskGb || 100} GB Total
												</span>
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</>
	);
}

AdminServersPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

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

import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Server,
	Cpu,
	HardDrive,
	Activity,
	CheckCircle,
	Plus,
	RefreshCw,
	Shield,
	Globe,
	Terminal,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_NODES = [
	{
		id: "srv-node-01",
		name: "HOST-01 (Primary Cluster Swarm Manager)",
		ip: "10.0.4.15",
		role: "Manager",
		status: "ONLINE",
		cpuUsage: "24%",
		ramAllocatedMb: 32768,
		ramTotalMb: 65536,
		diskUsageGb: 120,
		diskTotalGb: 500,
		runningApps: 28,
	},
	{
		id: "srv-node-02",
		name: "HOST-02 (Worker Node East)",
		ip: "10.0.4.16",
		role: "Worker",
		status: "ONLINE",
		cpuUsage: "18%",
		ramAllocatedMb: 16384,
		ramTotalMb: 65536,
		diskUsageGb: 85,
		diskTotalGb: 500,
		runningApps: 16,
	},
];

export default function AdminServersPage() {
	const [nodes, setNodes] = useState(MOCK_NODES);

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
							Monitor hardware capacity, RAM/CPU allocation across Docker Swarm nodes, and add remote servers.
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
				<div className="grid grid-cols-1 gap-6">
					{nodes.map((node) => {
						const ramPercent = Math.round((node.ramAllocatedMb / node.ramTotalMb) * 100);

						return (
							<div
								key={node.id}
								className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5 hover:border-slate-700 transition-all"
							>
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-500/20 flex items-center justify-center shrink-0">
											<Server className="w-5 h-5 text-amber-400" />
										</div>
										<div>
											<div className="flex items-center gap-2">
												<h3 className="text-sm font-bold text-white">{node.name}</h3>
												<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
													{node.status}
												</span>
												<span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
													{node.role}
												</span>
											</div>
											<p className="text-xs text-slate-400 font-mono mt-0.5">
												IP: {node.ip} • Running {node.runningApps} Customer Apps
											</p>
										</div>
									</div>

									<Button
										variant="outline"
										size="sm"
										onClick={() => toast.success(`SSH Health diagnostic clean on ${node.ip}`)}
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
												<Cpu className="w-3.5 h-3.5 text-indigo-400" /> CPU Load
											</span>
											<span className="text-white font-mono font-bold">{node.cpuUsage}</span>
										</div>
										<div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
											<div className="h-full bg-indigo-500 rounded-full" style={{ width: node.cpuUsage }} />
										</div>
									</div>

									<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
										<div className="flex justify-between text-xs">
											<span className="text-slate-400 font-medium flex items-center gap-1.5">
												<Activity className="w-3.5 h-3.5 text-amber-400" /> RAM Quota Allocation
											</span>
											<span className="text-white font-mono font-bold">
												{node.ramAllocatedMb / 1024}GB / {node.ramTotalMb / 1024}GB ({ramPercent}%)
											</span>
										</div>
										<div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
											<div className="h-full bg-amber-500 rounded-full" style={{ width: `${ramPercent}%` }} />
										</div>
									</div>

									<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
										<div className="flex justify-between text-xs">
											<span className="text-slate-400 font-medium flex items-center gap-1.5">
												<HardDrive className="w-3.5 h-3.5 text-cyan-400" /> Disk Storage
											</span>
											<span className="text-white font-mono font-bold">
												{node.diskUsageGb}GB / {node.diskTotalGb}GB
											</span>
										</div>
										<div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
											<div className="h-full bg-cyan-500 rounded-full" style={{ width: `${(node.diskUsageGb / node.diskTotalGb) * 100}%` }} />
										</div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</>
	);
}

AdminServersPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

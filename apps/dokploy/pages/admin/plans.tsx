import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Zap,
	Plus,
	Edit,
	Trash2,
	Check,
	Server,
	Cpu,
	HardDrive,
	Globe,
	Shield,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const INITIAL_PLANS = [
	{
		id: "plan-starter",
		name: "Starter Hobby",
		price: "$9.00",
		cycle: "month",
		maxApps: 3,
		maxDatabases: 1,
		maxRamMb: 1024,
		maxCpuCores: 1,
		maxBandwidthGb: 100,
		customDomains: true,
		sslAuto: true,
		activeSubscribers: 120,
	},
	{
		id: "plan-pro",
		name: "Pro Developer",
		price: "$29.00",
		cycle: "month",
		maxApps: 10,
		maxDatabases: 4,
		maxRamMb: 4096,
		maxCpuCores: 2,
		maxBandwidthGb: 500,
		customDomains: true,
		sslAuto: true,
		activeSubscribers: 240,
	},
	{
		id: "plan-business",
		name: "Business Scale",
		price: "$79.00",
		cycle: "month",
		maxApps: 30,
		maxDatabases: 15,
		maxRamMb: 16384,
		maxCpuCores: 8,
		maxBandwidthGb: 2000,
		customDomains: true,
		sslAuto: true,
		activeSubscribers: 52,
	},
];

export default function AdminPlansPage() {
	const [plans, setPlans] = useState(INITIAL_PLANS);
	const [showModal, setShowModal] = useState(false);
	const [newPlanName, setNewPlanName] = useState("");
	const [newPrice, setNewPrice] = useState("");

	const handleCreatePlan = () => {
		if (!newPlanName || !newPrice) {
			toast.error("Please specify plan name and price.");
			return;
		}
		const created = {
			id: `plan-${Date.now()}`,
			name: newPlanName,
			price: `$${newPrice}`,
			cycle: "month",
			maxApps: 5,
			maxDatabases: 2,
			maxRamMb: 2048,
			maxCpuCores: 2,
			maxBandwidthGb: 250,
			customDomains: true,
			sslAuto: true,
			activeSubscribers: 0,
		};
		setPlans([...plans, created]);
		setShowModal(false);
		setNewPlanName("");
		setNewPrice("");
		toast.success(`Plan '${newPlanName}' created and activated for customer checkout!`);
	};

	return (
		<>
			<Head>
				<title>Hosting Plans & Quotas - {brand.APP_NAME} Admin</title>
			</Head>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Hosting Plans & Resource Quotas</h1>
						<p className="text-slate-400 text-sm mt-1">
							Configure database-driven hosting tiers, price tags, and strict Docker RAM/CPU entitlement limits.
						</p>
					</div>

					<Button
						onClick={() => setShowModal(true)}
						className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-medium text-xs gap-2 shrink-0 shadow-lg shadow-amber-600/20"
					>
						<Plus className="w-4 h-4" /> Create New Tier Plan
					</Button>
				</div>

				{/* Create Modal */}
				{showModal && (
					<div className="p-6 rounded-xl bg-slate-900 border border-amber-500/40 space-y-4 shadow-2xl">
						<h3 className="text-base font-bold text-white">Create New Commercial Plan</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-medium text-slate-300 block mb-1">Plan Name</label>
								<input
									type="text"
									value={newPlanName}
									onChange={(e) => setNewPlanName(e.target.value)}
									placeholder="e.g. Agency Unlimited"
									className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-amber-500"
								/>
							</div>
							<div>
								<label className="text-xs font-medium text-slate-300 block mb-1">Monthly Price ($)</label>
								<input
									type="number"
									value={newPrice}
									onChange={(e) => setNewPrice(e.target.value)}
									placeholder="149"
									className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-amber-500"
								/>
							</div>
						</div>
						<div className="flex justify-end gap-3 pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowModal(false)}
								className="border-slate-800 text-slate-300 text-xs"
							>
								Cancel
							</Button>
							<Button
								onClick={handleCreatePlan}
								className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-5"
							>
								Save Plan Tier
							</Button>
						</div>
					</div>
				)}

				{/* Plan Cards Grid */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{plans.map((p) => (
						<div
							key={p.id}
							className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5 flex flex-col justify-between hover:border-slate-700 transition-all"
						>
							<div className="space-y-4">
								<div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
									<h3 className="text-base font-bold text-white">{p.name}</h3>
									<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
										{p.activeSubscribers} Subscribers
									</span>
								</div>

								<div>
									<span className="text-3xl font-extrabold text-white">{p.price}</span>
									<span className="text-slate-400 text-xs"> / {p.cycle}</span>
								</div>

								{/* Quotas */}
								<div className="space-y-2 text-xs text-slate-300">
									<div className="flex items-center justify-between p-2 rounded bg-slate-950">
										<span className="text-slate-400">Applications Limit:</span>
										<strong className="text-white">{p.maxApps} Apps</strong>
									</div>
									<div className="flex items-center justify-between p-2 rounded bg-slate-950">
										<span className="text-slate-400">Managed DBs Limit:</span>
										<strong className="text-white">{p.maxDatabases} DBs</strong>
									</div>
									<div className="flex items-center justify-between p-2 rounded bg-slate-950">
										<span className="text-slate-400">RAM Quota:</span>
										<strong className="text-white">{p.maxRamMb / 1024} GB RAM</strong>
									</div>
									<div className="flex items-center justify-between p-2 rounded bg-slate-950">
										<span className="text-slate-400">CPU Cores Max:</span>
										<strong className="text-white">{p.maxCpuCores} Cores</strong>
									</div>
								</div>
							</div>

							<div className="flex items-center gap-2 pt-3 border-t border-slate-800">
								<Button
									variant="outline"
									size="sm"
									onClick={() => toast.info(`Editing plan ${p.name}`)}
									className="flex-1 border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5"
								>
									<Edit className="w-3.5 h-3.5" /> Edit Quotas
								</Button>
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

AdminPlansPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

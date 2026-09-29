import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Zap,
	Plus,
	Server,
	Cpu,
	HardDrive,
	Globe,
	Shield,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

export default function AdminPlansPage() {
	const { data: plans, isLoading, refetch } = api.plan.adminList.useQuery();
	const createPlanMutation = api.plan.create.useMutation();

	const [showModal, setShowModal] = useState(false);
	const [newPlanName, setNewPlanName] = useState("");
	const [newPrice, setNewPrice] = useState("");
	const [newSlug, setNewSlug] = useState("");

	const handleCreatePlan = async () => {
		if (!newPlanName || !newPrice || !newSlug) {
			toast.error("Please specify plan name, slug, and price.");
			return;
		}
		try {
			await createPlanMutation.mutateAsync({
				name: newPlanName,
				slug: newSlug.toLowerCase().trim(),
				price: newPrice,
				currency: "USD",
				billingCycle: "monthly",
				status: "active",
				isPublic: true,
			});
			await refetch();
			setShowModal(false);
			setNewPlanName("");
			setNewPrice("");
			setNewSlug("");
			toast.success(`Plan '${newPlanName}' created successfully!`);
		} catch (err: any) {
			toast.error(err?.message || "Failed to create plan");
		}
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
				{isLoading ? (
					<div className="text-slate-400 text-sm py-8 text-center">Loading plans from PostgreSQL database...</div>
				) : !plans || plans.length === 0 ? (
					<div className="text-slate-500 text-sm py-8 text-center bg-slate-900/40 rounded-xl border border-slate-800">
						No plans configured yet. Click "Create New Tier Plan" to add your first commercial plan.
					</div>
				) : (
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
											Status: {p.status}
										</span>
									</div>

									<div>
										<span className="text-3xl font-extrabold text-white">${p.price}</span>
										<span className="text-slate-400 text-xs"> / {p.billingCycle}</span>
									</div>

									{/* Features & Resources list */}
									<div className="space-y-2 text-xs text-slate-300">
										<div className="flex items-center justify-between p-2 rounded bg-slate-950">
											<span className="text-slate-400">Slug:</span>
											<strong className="text-amber-400">{p.slug}</strong>
										</div>
										<div className="flex items-center justify-between p-2 rounded bg-slate-950">
											<span className="text-slate-400">Currency:</span>
											<strong className="text-white">{p.currency}</strong>
										</div>
										<div className="flex items-center justify-between p-2 rounded bg-slate-950">
											<span className="text-slate-400">Trial Days:</span>
											<strong className="text-white">{p.trialDays} Days</strong>
										</div>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</>
	);
}

AdminPlansPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

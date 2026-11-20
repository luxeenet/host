import Head from "next/head";
import { type ReactElement, useState } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { toast } from "sonner";
import {
	Zap,
	Plus,
	Edit3,
	Trash2,
	Check,
	X,
	Layers,
	Database,
	Globe,
	Cpu,
	HardDrive,
	Users,
	ShieldCheck,
	Sparkles,
	Tag,
	DollarSign,
	Clock,
	Radio,
	Activity,
	CheckCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";

interface PlanFormData {
	id?: string;
	name: string;
	slug: string;
	description: string;
	price: string;
	currency: string;
	billingCycle: "monthly" | "yearly";
	status: "active" | "inactive" | "archived";
	isPublic: boolean;
	isFeatured: boolean;
	trialDays: number;
	sortOrder: number;
	resources: {
		max_projects: number;
		max_applications: number;
		max_databases: number;
		max_domains: number;
		max_ram_mb: number;
		max_cpu_millicores: number;
		max_storage_gb: number;
		max_bandwidth_gb: number;
		backup_storage_gb: number;
		max_team_members: number;
	};
	features: {
		ssl: boolean;
		custom_domains: boolean;
		automatic_deployments: boolean;
		backups: boolean;
		databases: boolean;
		preview_deployments: boolean;
		team_members: boolean;
		api_access: boolean;
		priority_support: boolean;
		rollbacks: boolean;
	};
}

const DEFAULT_FORM_DATA: PlanFormData = {
	name: "",
	slug: "",
	description: "",
	price: "29000",
	currency: "TZS",
	billingCycle: "monthly",
	status: "active",
	isPublic: true,
	isFeatured: false,
	trialDays: 14,
	sortOrder: 10,
	resources: {
		max_projects: 3,
		max_applications: 5,
		max_databases: 3,
		max_domains: 5,
		max_ram_mb: 2048,
		max_cpu_millicores: 2000,
		max_storage_gb: 20,
		max_bandwidth_gb: 200,
		backup_storage_gb: 10,
		max_team_members: 3,
	},
	features: {
		ssl: true,
		custom_domains: true,
		automatic_deployments: true,
		backups: true,
		databases: true,
		preview_deployments: true,
		team_members: true,
		api_access: true,
		priority_support: false,
		rollbacks: true,
	},
};

export default function AdminPlansPage() {
	const utils = api.useUtils();
	const { data: plans, isLoading, refetch } = api.plan.adminList.useQuery();

	const savePackageMutation = api.plan.savePackage.useMutation();
	const deletePlanMutation = api.plan.delete.useMutation();
	const toggleStatusMutation = api.plan.toggleStatus.useMutation();

	const [showModal, setShowModal] = useState(false);
	const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
	const [formData, setFormData] = useState<PlanFormData>(DEFAULT_FORM_DATA);
	const [activeFormTab, setActiveFormTab] = useState<"general" | "quotas" | "features">("general");

	const handleOpenCreate = () => {
		setEditingPlanId(null);
		setFormData(DEFAULT_FORM_DATA);
		setActiveFormTab("general");
		setShowModal(true);
	};

	const handleOpenEdit = (plan: any) => {
		setEditingPlanId(plan.id);

		// Map existing resources to state
		const resMap: Record<string, number> = {};
		plan.resources?.forEach((r: any) => {
			resMap[r.resourceKey] = r.value;
		});

		// Map existing features to state
		const featMap: Record<string, boolean> = {};
		plan.features?.forEach((f: any) => {
			featMap[f.featureKey] = f.enabled;
		});

		setFormData({
			id: plan.id,
			name: plan.name,
			slug: plan.slug,
			description: plan.description || "",
			price: String(plan.price),
			currency: plan.currency || "TZS",
			billingCycle: plan.billingCycle || "monthly",
			status: plan.status || "active",
			isPublic: Boolean(plan.isPublic),
			isFeatured: Boolean(plan.isFeatured),
			trialDays: plan.trialDays || 0,
			sortOrder: plan.sortOrder || 0,
			resources: {
				max_projects: resMap["max_projects"] ?? 3,
				max_applications: resMap["max_applications"] ?? 5,
				max_databases: resMap["max_databases"] ?? 3,
				max_domains: resMap["max_domains"] ?? 5,
				max_ram_mb: resMap["max_ram_mb"] ?? 2048,
				max_cpu_millicores: resMap["max_cpu_millicores"] ?? 2000,
				max_storage_gb: resMap["max_storage_gb"] ?? 20,
				max_bandwidth_gb: resMap["max_bandwidth_gb"] ?? 200,
				backup_storage_gb: resMap["backup_storage_gb"] ?? 10,
				max_team_members: resMap["max_team_members"] ?? 3,
			},
			features: {
				ssl: featMap["ssl"] ?? true,
				custom_domains: featMap["custom_domains"] ?? true,
				automatic_deployments: featMap["automatic_deployments"] ?? true,
				backups: featMap["backups"] ?? true,
				databases: featMap["databases"] ?? true,
				preview_deployments: featMap["preview_deployments"] ?? true,
				team_members: featMap["team_members"] ?? true,
				api_access: featMap["api_access"] ?? true,
				priority_support: featMap["priority_support"] ?? false,
				rollbacks: featMap["rollbacks"] ?? true,
			},
		});

		setActiveFormTab("general");
		setShowModal(true);
	};

	const handleSavePackage = async () => {
		if (!formData.name.trim() || !formData.slug.trim() || !formData.price.trim()) {
			toast.error("Please provide Package Name, Slug, and Price.");
			return;
		}

		try {
			const resourceArray = Object.entries(formData.resources).map(([resourceKey, value]) => ({
				resourceKey,
				value: Number(value),
			}));

			const featureArray = Object.entries(formData.features).map(([featureKey, enabled]) => ({
				featureKey,
				enabled: Boolean(enabled),
			}));

			await savePackageMutation.mutateAsync({
				id: editingPlanId || undefined,
				name: formData.name.trim(),
				slug: formData.slug.toLowerCase().trim(),
				description: formData.description.trim() || null,
				price: formData.price.trim(),
				currency: formData.currency.toUpperCase().trim(),
				billingCycle: formData.billingCycle,
				status: formData.status,
				isPublic: formData.isPublic,
				isFeatured: formData.isFeatured,
				trialDays: Number(formData.trialDays),
				sortOrder: Number(formData.sortOrder),
				resources: resourceArray,
				features: featureArray,
			});

			toast.success(
				editingPlanId
					? `Package '${formData.name}' updated successfully!`
					: `New Package '${formData.name}' created successfully!`,
			);
			setShowModal(false);
			await refetch();
			await utils.plan.list.invalidate();
		} catch (err: any) {
			toast.error(err?.message || "Failed to save package");
		}
	};

	const handleToggleStatus = async (planId: string, currentStatus: string) => {
		const newStatus = currentStatus === "active" ? "inactive" : "active";
		try {
			await toggleStatusMutation.mutateAsync({
				id: planId,
				status: newStatus as any,
			});
			toast.success(`Package status switched to ${newStatus}`);
			await refetch();
		} catch (err: any) {
			toast.error(err?.message || "Failed to toggle status");
		}
	};

	const handleDeletePlan = async (planId: string, planName: string) => {
		if (!confirm(`Are you sure you want to permanently delete '${planName}'? This action cannot be undone.`)) {
			return;
		}

		try {
			await deletePlanMutation.mutateAsync({ id: planId });
			toast.success(`Package '${planName}' deleted successfully.`);
			await refetch();
		} catch (err: any) {
			toast.error(err?.message || "Cannot delete package with active subscriptions.");
		}
	};

	return (
		<>
			<Head>
				<title>Commercial Packages & Plans - {brand.APP_NAME} Admin</title>
			</Head>

			<div className="space-y-8">
				{/* Top Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px] font-bold">
								COMMERCIAL SUBSCRIPTION TIERS
							</Badge>
						</div>
						<h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2.5">
							<Zap className="w-6 h-6 text-amber-400" />
							Packages & Resource Quotas Setup
						</h1>
						<p className="text-slate-400 text-sm mt-0.5">
							Configure customer subscription tiers, pricing tags (TZS / USD), RAM & CPU compute limits, and feature entitlements.
						</p>
					</div>

					<Button
						onClick={handleOpenCreate}
						className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-xs gap-2 shrink-0 shadow-lg shadow-amber-600/20"
					>
						<Plus className="w-4 h-4" /> Setup New Package
					</Button>
				</div>

				{/* Package Creation & Edit Modal */}
				{showModal && (
					<div className="rounded-2xl border border-amber-500/40 bg-slate-900 p-6 sm:p-8 space-y-6 shadow-2xl">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
							<div>
								<h3 className="text-lg font-bold text-white flex items-center gap-2">
									<Sparkles className="w-5 h-5 text-amber-400" />
									{editingPlanId ? `Edit Package: ${formData.name}` : "Setup New Hosting Package"}
								</h3>
								<p className="text-xs text-slate-400 mt-0.5">
									Changes are saved directly to PostgreSQL and take effect immediately for customer signups and upgrades.
								</p>
							</div>

							{/* Form Subtabs */}
							<div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800 self-start sm:self-auto">
								<button
									type="button"
									onClick={() => setActiveFormTab("general")}
									className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
										activeFormTab === "general"
											? "bg-amber-500 text-slate-950 shadow-sm"
											: "text-slate-400 hover:text-white"
									}`}
								>
									Pricing & Terms
								</button>
								<button
									type="button"
									onClick={() => setActiveFormTab("quotas")}
									className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
										activeFormTab === "quotas"
											? "bg-amber-500 text-slate-950 shadow-sm"
											: "text-slate-400 hover:text-white"
									}`}
								>
									Compute & Quotas
								</button>
								<button
									type="button"
									onClick={() => setActiveFormTab("features")}
									className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
										activeFormTab === "features"
											? "bg-amber-500 text-slate-950 shadow-sm"
											: "text-slate-400 hover:text-white"
									}`}
								>
									Feature Flags
								</button>
							</div>
						</div>

						{/* Tab 1: General Info & Pricing */}
						{activeFormTab === "general" && (
							<div className="space-y-4">
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Package Name *
										</label>
										<Input
											value={formData.name}
											onChange={(e) => setFormData({ ...formData, name: e.target.value })}
											placeholder="e.g. Pro Developer"
											className="bg-slate-950 border-slate-800 text-white text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Unique Slug * (alphanumeric & hyphens)
										</label>
										<Input
											value={formData.slug}
											onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
											placeholder="e.g. pro-developer"
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Price *
										</label>
										<div className="flex gap-2">
											<Input
												type="number"
												value={formData.price}
												onChange={(e) => setFormData({ ...formData, price: e.target.value })}
												placeholder="29000"
												className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
											/>
											<select
												value={formData.currency}
												onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
												className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-bold"
											>
												<option value="TZS">TZS</option>
												<option value="USD">USD</option>
											</select>
										</div>
									</div>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Billing Frequency
										</label>
										<select
											value={formData.billingCycle}
											onChange={(e) => setFormData({ ...formData, billingCycle: e.target.value as any })}
											className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
										>
											<option value="monthly">Monthly Recurring</option>
											<option value="yearly">Yearly Prepaid</option>
										</select>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Free Trial (Days)
										</label>
										<Input
											type="number"
											value={formData.trialDays}
											onChange={(e) => setFormData({ ...formData, trialDays: Number(e.target.value) })}
											placeholder="14"
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Status & Visibility
										</label>
										<select
											value={formData.status}
											onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
											className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
										>
											<option value="active">Active (Available for purchase)</option>
											<option value="inactive">Inactive (Hidden from customers)</option>
											<option value="archived">Archived (Grandfathered)</option>
										</select>
									</div>
								</div>

								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1">
										Package Description (shown on pricing card)
									</label>
									<Input
										value={formData.description}
										onChange={(e) => setFormData({ ...formData, description: e.target.value })}
										placeholder="e.g. Best for growing engineering teams and production microservices."
										className="bg-slate-950 border-slate-800 text-white text-xs"
									/>
								</div>

								<div className="flex flex-wrap items-center gap-6 pt-2">
									<label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
										<input
											type="checkbox"
											checked={formData.isPublic}
											onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
											className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0"
										/>
										<span>Show on Public Landing & Onboarding Pricing Matrix</span>
									</label>

									<label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
										<input
											type="checkbox"
											checked={formData.isFeatured}
											onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
											className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0"
										/>
										<span>Highlight with "Popular" Badge</span>
									</label>
								</div>
							</div>
						)}

						{/* Tab 2: Compute Resources & Quotas */}
						{activeFormTab === "quotas" && (
							<div className="space-y-4">
								<p className="text-xs text-slate-400">
									Set hard limits on cloud compute allocations. Use <code className="text-amber-400 font-bold">-1</code> for unlimited quotas.
								</p>

								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Layers className="w-3.5 h-3.5 text-amber-400" /> Max Projects
										</label>
										<Input
											type="number"
											value={formData.resources.max_projects}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_projects: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Zap className="w-3.5 h-3.5 text-amber-400" /> Max Applications
										</label>
										<Input
											type="number"
											value={formData.resources.max_applications}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_applications: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Database className="w-3.5 h-3.5 text-amber-400" /> Max Databases
										</label>
										<Input
											type="number"
											value={formData.resources.max_databases}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_databases: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Globe className="w-3.5 h-3.5 text-amber-400" /> Custom Domains
										</label>
										<Input
											type="number"
											value={formData.resources.max_domains}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_domains: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Cpu className="w-3.5 h-3.5 text-emerald-400" /> RAM Quota (MB)
										</label>
										<Input
											type="number"
											value={formData.resources.max_ram_mb}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_ram_mb: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
										<span className="text-[10px] text-slate-500">1024 MB = 1 GB RAM</span>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Activity className="w-3.5 h-3.5 text-emerald-400" /> CPU Millicores (m)
										</label>
										<Input
											type="number"
											value={formData.resources.max_cpu_millicores}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_cpu_millicores: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
										<span className="text-[10px] text-slate-500">1000m = 1.0 vCPU core</span>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<HardDrive className="w-3.5 h-3.5 text-indigo-400" /> Disk Storage (GB)
										</label>
										<Input
											type="number"
											value={formData.resources.max_storage_gb}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_storage_gb: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
											<Users className="w-3.5 h-3.5 text-indigo-400" /> Team Member Seats
										</label>
										<Input
											type="number"
											value={formData.resources.max_team_members}
											onChange={(e) => setFormData({
												...formData,
												resources: { ...formData.resources, max_team_members: Number(e.target.value) },
											})}
											className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
										/>
									</div>
								</div>
							</div>
						)}

						{/* Tab 3: Feature Flags */}
						{activeFormTab === "features" && (
							<div className="space-y-4">
								<p className="text-xs text-slate-400">
									Toggle platform capabilities included in this package tier:
								</p>

								<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
									{[
										{ key: "ssl", label: "Automatic Edge SSL / TLS", desc: "Free Let's Encrypt certificates" },
										{ key: "custom_domains", label: "Custom Domains", desc: "Attach company domain names" },
										{ key: "automatic_deployments", label: "Git Auto-Deploy", desc: "Trigger build on git push" },
										{ key: "backups", label: "Automated Backups", desc: "Scheduled DB snapshot backups" },
										{ key: "databases", label: "Managed Databases", desc: "PostgreSQL, MySQL, Redis, Mongo" },
										{ key: "preview_deployments", label: "Preview Environments", desc: "Ephemeral branch previews" },
										{ key: "team_members", label: "Team Collaboration", desc: "RBAC & multi-user workspaces" },
										{ key: "api_access", label: "API & CLI Access", desc: "Programmable deploy tokens" },
										{ key: "priority_support", label: "Priority Support SLA", desc: "Dedicated WhatsApp & ticket queue" },
										{ key: "rollbacks", label: "Instant Rollbacks", desc: "One-click deployment version restore" },
									].map(({ key, label, desc }) => {
										const isEnabled = (formData.features as any)[key] ?? false;
										return (
											<div
												key={key}
												onClick={() => setFormData({
													...formData,
													features: {
														...formData.features,
														[key]: !isEnabled,
													},
												})}
												className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
													isEnabled
														? "border-emerald-500/50 bg-emerald-950/20 text-white"
														: "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
												}`}
											>
												<div
													className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
														isEnabled ? "bg-emerald-500 text-slate-950" : "border border-slate-700 bg-slate-900"
													}`}
												>
													{isEnabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
												</div>
												<div>
													<div className="font-bold text-xs">{label}</div>
													<div className="text-[11px] text-slate-400 mt-0.5">{desc}</div>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}

						{/* Modal Footer Controls */}
						<div className="flex justify-between items-center pt-4 border-t border-slate-800">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowModal(false)}
								className="border-slate-800 text-slate-300 text-xs"
							>
								Cancel
							</Button>

							<div className="flex items-center gap-3">
								<Button
									type="button"
									onClick={handleSavePackage}
									disabled={savePackageMutation.isPending}
									className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-6 shadow-lg shadow-amber-600/20"
								>
									{savePackageMutation.isPending ? "Saving..." : "Save Package"}
								</Button>
							</div>
						</div>
					</div>
				)}

				{/* Plans Cards Grid */}
				{isLoading ? (
					<div className="text-slate-400 text-sm py-12 text-center">Loading plans from PostgreSQL database...</div>
				) : !plans || plans.length === 0 ? (
					<div className="text-slate-500 text-sm py-12 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
						No commercial packages configured yet. Click "Setup New Package" above to create your first subscription tier.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{plans.map((p) => {
							const resMap: Record<string, number> = {};
							p.resources?.forEach((r: any) => {
								resMap[r.resourceKey] = r.value;
							});

							const featCount = p.features?.filter((f: any) => f.enabled)?.length || 0;

							return (
								<div
									key={p.id}
									className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6 space-y-5 flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg"
								>
									<div className="space-y-4">
										{/* Card Header */}
										<div className="flex items-start justify-between border-b border-slate-800 pb-3 gap-2">
											<div>
												<div className="flex items-center gap-2">
													<h3 className="text-base font-bold text-white">{p.name}</h3>
													{p.isFeatured && (
														<Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px]">
															POPULAR
														</Badge>
													)}
												</div>
												<span className="text-xs font-mono text-slate-400">slug: {p.slug}</span>
											</div>

											<Badge
												className={
													p.status === "active"
														? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]"
														: "bg-slate-800 text-slate-400 border-slate-700 text-[10px]"
												}
											>
												{p.status.toUpperCase()}
											</Badge>
										</div>

										{/* Price */}
										<div className="flex items-baseline gap-1.5">
											<span className="text-3xl font-extrabold text-white tracking-tight">
												{Number(p.price).toLocaleString()}
											</span>
											<span className="text-xs font-bold text-amber-400">{p.currency}</span>
											<span className="text-xs text-slate-400"> / {p.billingCycle}</span>
										</div>

										{p.description && (
											<p className="text-xs text-slate-400 line-clamp-2">{p.description}</p>
										)}

										{/* Compute Quotas Summary */}
										<div className="grid grid-cols-2 gap-2 text-xs">
											<div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between">
												<span className="text-slate-400 flex items-center gap-1">
													<Cpu className="w-3.5 h-3.5 text-emerald-400" /> RAM:
												</span>
												<strong className="text-white font-mono">
													{resMap["max_ram_mb"] === -1 ? "Unlimited" : `${resMap["max_ram_mb"] || 1024} MB`}
												</strong>
											</div>

											<div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between">
												<span className="text-slate-400 flex items-center gap-1">
													<Activity className="w-3.5 h-3.5 text-emerald-400" /> CPU:
												</span>
												<strong className="text-white font-mono">
													{resMap["max_cpu_millicores"] === -1 ? "Unlimited" : `${(resMap["max_cpu_millicores"] || 1000) / 1000} vCPU`}
												</strong>
											</div>

											<div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between">
												<span className="text-slate-400 flex items-center gap-1">
													<Layers className="w-3.5 h-3.5 text-amber-400" /> Apps:
												</span>
												<strong className="text-white font-mono">
													{resMap["max_applications"] === -1 ? "Unlimited" : (resMap["max_applications"] || 1)}
												</strong>
											</div>

											<div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between">
												<span className="text-slate-400 flex items-center gap-1">
													<Database className="w-3.5 h-3.5 text-indigo-400" /> Databases:
												</span>
												<strong className="text-white font-mono">
													{resMap["max_databases"] === -1 ? "Unlimited" : (resMap["max_databases"] || 0)}
												</strong>
											</div>
										</div>

										{/* Meta details */}
										<div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
											<span>{p.trialDays > 0 ? `${p.trialDays}-day free trial` : "No free trial"}</span>
											<span>{featCount} features enabled</span>
										</div>
									</div>

									{/* Action Buttons */}
									<div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-800">
										<button
											type="button"
											onClick={() => handleToggleStatus(p.id, p.status)}
											className="text-[11px] font-semibold text-slate-400 hover:text-white transition-colors"
										>
											{p.status === "active" ? "Deactivate" : "Activate"}
										</button>

										<div className="flex items-center gap-2">
											<Button
												size="sm"
												variant="outline"
												onClick={() => handleOpenEdit(p)}
												className="border-slate-700 hover:bg-slate-800 text-white text-xs gap-1.5 h-8"
											>
												<Edit3 className="w-3.5 h-3.5" /> Edit Package
											</Button>

											<Button
												size="sm"
												variant="ghost"
												onClick={() => handleDeletePlan(p.id, p.name)}
												className="text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 h-8 w-8 p-0"
											>
												<Trash2 className="w-4 h-4" />
											</Button>
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

AdminPlansPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

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

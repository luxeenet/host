import Head from "next/head";
import { type ReactElement, useState, useMemo } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import {
	AlertTriangle,
	ArrowUpRight,
	Boxes,
	CheckCircle2,
	CreditCard,
	Database,
	ExternalLink,
	Globe,
	Layers,
	Lock,
	Power,
	RefreshCw,
	Search,
	ShieldCheck,
	Trash2,
	Unlock,
	UserCheck,
	Users,
	XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AdminCustomersPage() {
	const utils = api.useUtils();
	const { data: customers = [], isLoading, isError, error, refetch } = api.admin.listCustomers.useQuery();
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | "active" | "banned">("all");

	// Selected customer for detailed inspection modal
	const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

	// Confirmation dialog states
	const [accountToDelete, setAccountToDelete] = useState<{ id: string; name: string; email: string } | null>(null);
	const [appToDelete, setAppToDelete] = useState<{ id: string; name: string; type: "app" | "compose" } | null>(null);
	const [banAction, setBanAction] = useState<{ id: string; name: string; banned: boolean } | null>(null);
	const [banReasonInput, setBanReasonInput] = useState("");

	// Mutations
	const toggleStatusMutation = api.admin.toggleCustomerStatus.useMutation({
		onSuccess: () => {
			toast.success("Customer status updated successfully");
			utils.admin.listCustomers.invalidate();
			setBanAction(null);
			setBanReasonInput("");
		},
		onError: (err) => {
			toast.error(err.message || "Failed to update customer status");
		},
	});

	const deleteAccountMutation = api.admin.deleteCustomerAccount.useMutation({
		onSuccess: () => {
			toast.success("Customer account and all associated containers/volumes purged");
			utils.admin.listCustomers.invalidate();
			setAccountToDelete(null);
			setSelectedCustomerId(null);
		},
		onError: (err) => {
			toast.error(err.message || "Failed to delete customer account");
		},
	});

	const deleteAppMutation = api.admin.deleteCustomerApplication.useMutation({
		onSuccess: () => {
			toast.success("Customer application and container deleted");
			utils.admin.listCustomers.invalidate();
			setAppToDelete(null);
		},
		onError: (err) => {
			toast.error(err.message || "Failed to delete application");
		},
	});

	const deleteComposeMutation = api.admin.deleteCustomerCompose.useMutation({
		onSuccess: () => {
			toast.success("Customer compose stack and volumes deleted");
			utils.admin.listCustomers.invalidate();
			setAppToDelete(null);
		},
		onError: (err) => {
			toast.error(err.message || "Failed to delete compose stack");
		},
	});

	const filtered = useMemo(() => {
		return customers.filter((c) => {
			const matchesSearch =
				`${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
				c.email.toLowerCase().includes(search.toLowerCase()) ||
				c.role.toLowerCase().includes(search.toLowerCase()) ||
				(c.subscription?.planName || "").toLowerCase().includes(search.toLowerCase());

			if (!matchesSearch) return false;

			if (statusFilter === "active") return !c.banned;
			if (statusFilter === "banned") return c.banned;
			return true;
		});
	}, [customers, search, statusFilter]);

	// Stats
	const totalCustomers = customers.length;
	const activeCount = customers.filter((c) => !c.banned).length;
	const totalRevenue = customers.reduce((sum, c) => sum + (c.totalAmountPaid || 0), 0);
	const totalHostedApps = customers.reduce(
		(sum, c) => sum + (c.applications?.length || 0) + (c.composeStacks?.length || 0),
		0,
	);

	const selectedCustomer = useMemo(
		() => customers.find((c) => c.id === selectedCustomerId) || null,
		[customers, selectedCustomerId],
	);

	const formatCurrency = (amount: number, curr = "TZS") => {
		return `${curr} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
	};

	return (
		<>
			<Head>
				<title>Customer Management - {brand.APP_NAME} Admin</title>
			</Head>
			<div className="space-y-8 pb-12">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Customer Accounts & Applications</h1>
						<p className="text-slate-400 text-sm mt-1">
							Inspect hosted applications, monitor billing and plans, inspect live URLs, and control customer account states.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
						>
							<RefreshCw className="w-3.5 h-3.5 mr-2" />
							Refresh
						</Button>
					</div>
				</div>

				{/* High-level Stats */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
							<Users className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Total Registered</div>
							<div className="text-xl font-bold text-white">{totalCustomers} Customers</div>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
							<CheckCircle2 className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Active Accounts</div>
							<div className="text-xl font-bold text-emerald-400">{activeCount} Active</div>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
							<Boxes className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Hosted Applications</div>
							<div className="text-xl font-bold text-indigo-300">{totalHostedApps} Deployed</div>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
							<CreditCard className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Total Collected</div>
							<div className="text-xl font-bold text-amber-300">{formatCurrency(totalRevenue)}</div>
						</div>
					</div>
				</div>

				{/* Search & Filters */}
				<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
					<div className="flex-1 flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
						<Search className="w-4 h-4 text-slate-500 ml-2 shrink-0" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search customer by name, email, plan, or role..."
							className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-slate-500"
						/>
						{search && (
							<button
								onClick={() => setSearch("")}
								className="text-xs text-slate-500 hover:text-slate-300 mr-2"
							>
								Clear
							</button>
						)}
					</div>

					<div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
						<button
							onClick={() => setStatusFilter("all")}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
								statusFilter === "all" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
							}`}
						>
							All ({totalCustomers})
						</button>
						<button
							onClick={() => setStatusFilter("active")}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
								statusFilter === "active" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"
							}`}
						>
							Active ({activeCount})
						</button>
						<button
							onClick={() => setStatusFilter("banned")}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
								statusFilter === "banned" ? "bg-slate-800 text-rose-400" : "text-slate-400 hover:text-slate-200"
							}`}
						>
							Deactivated ({totalCustomers - activeCount})
						</button>
					</div>
				</div>

				{/* Customers Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-sm">
					<div className="overflow-x-auto">
						{isLoading ? (
							<div className="text-slate-400 text-sm p-12 text-center flex flex-col items-center justify-center gap-2">
								<RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
								<span>Loading customer database...</span>
							</div>
						) : isError ? (
							<div className="p-8 text-center space-y-3">
								<div className="text-rose-400 text-sm font-semibold">
									Failed to load customer list: {error?.message || "Internal database query error"}
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => refetch()}
									className="border-slate-800 text-slate-300 hover:bg-slate-800"
								>
									<RefreshCw className="w-3.5 h-3.5 mr-2" />
									Retry Query
								</Button>
							</div>
						) : filtered.length === 0 ? (
							<div className="text-slate-500 text-sm p-12 text-center">
								No customers match the current criteria.
							</div>
						) : (
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
									<tr>
										<th className="px-5 py-3.5 font-medium">Customer</th>
										<th className="px-5 py-3.5 font-medium">Status</th>
										<th className="px-5 py-3.5 font-medium">Current Plan</th>
										<th className="px-5 py-3.5 font-medium">Total Paid</th>
										<th className="px-5 py-3.5 font-medium">Hosted Workloads</th>
										<th className="px-5 py-3.5 font-medium">Registered</th>
										<th className="px-5 py-3.5 font-medium text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60 text-slate-300">
									{filtered.map((cust) => {
										const totalApps = (cust.applications?.length || 0) + (cust.composeStacks?.length || 0);
										const fullName = `${cust.firstName} ${cust.lastName}`.trim() || "User";
										const isBanned = !!cust.banned;

										return (
											<tr
												key={cust.id}
												className="hover:bg-slate-800/25 transition-colors group"
											>
												{/* Customer Name & Email */}
												<td className="px-5 py-4">
													<div className="flex items-center gap-3">
														<div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs uppercase shrink-0">
															{fullName[0] || "U"}
														</div>
														<div className="min-w-0">
															<div className="font-semibold text-white truncate flex items-center gap-1.5">
																<span>{fullName}</span>
																{cust.isPlatformAdmin && (
																	<span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
																		ADMIN
																	</span>
																)}
															</div>
															<div className="text-slate-400 text-[11px] truncate">{cust.email}</div>
														</div>
													</div>
												</td>

												{/* Status */}
												<td className="px-5 py-4">
													{isBanned ? (
														<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
															<XCircle className="w-3 h-3" />
															Deactivated
														</span>
													) : (
														<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
															<CheckCircle2 className="w-3 h-3" />
															Active
														</span>
													)}
												</td>

												{/* Plan */}
												<td className="px-5 py-4">
													<div className="font-medium text-white">
														{cust.subscription?.planName || "Free Tier"}
													</div>
													<div className="text-slate-400 text-[10px] capitalize">
														{cust.subscription ? `${cust.subscription.billingCycle} • ${cust.subscription.status}` : "Standard Access"}
													</div>
												</td>

												{/* Total Paid */}
												<td className="px-5 py-4">
													<div className="font-semibold text-white">
														{formatCurrency(cust.totalAmountPaid, cust.currency)}
													</div>
													<div className="text-slate-400 text-[10px]">
														{cust.paymentCount} {cust.paymentCount === 1 ? "payment" : "payments"}
													</div>
												</td>

												{/* Hosted Workloads */}
												<td className="px-5 py-4">
													<div className="flex items-center gap-1.5">
														<span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-[11px]">
															{totalApps} {totalApps === 1 ? "Service" : "Services"}
														</span>
														{cust.databases?.length > 0 && (
															<span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 text-slate-400 border border-slate-800">
																+{cust.databases.length} DB
															</span>
														)}
													</div>
												</td>

												{/* Registered */}
												<td className="px-5 py-4 text-slate-400">
													{cust.createdAt ? new Date(cust.createdAt).toLocaleDateString() : "—"}
												</td>

												{/* Actions */}
												<td className="px-5 py-4 text-right">
													<div className="flex items-center justify-end gap-1.5">
														<Button
															variant="outline"
															size="sm"
															onClick={() => setSelectedCustomerId(cust.id)}
															className="h-7 text-xs border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
														>
															<ExternalLink className="w-3 h-3 mr-1" />
															Inspect & Manage
														</Button>

														{!cust.isPlatformAdmin && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() =>
																	setBanAction({
																		id: cust.id,
																		name: fullName,
																		banned: !isBanned,
																	})
																}
																title={isBanned ? "Enable Customer Account" : "Disable Customer Account"}
																className={`h-7 w-7 p-0 ${
																	isBanned
																		? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
																		: "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
																}`}
															>
																{isBanned ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
															</Button>
														)}

														{!cust.isPlatformAdmin && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() =>
																	setAccountToDelete({
																		id: cust.id,
																		name: fullName,
																		email: cust.email,
																	})
																}
																title="Delete Customer Account & Wipe Containers"
																className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
															>
																<Trash2 className="w-3.5 h-3.5" />
															</Button>
														)}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>
				</div>

				{/* Customer Inspection & Workloads Modal */}
				<Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomerId(null)}>
					<DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto bg-slate-950 border border-slate-800 text-white">
						{selectedCustomer && (
							<div className="space-y-6">
								<DialogHeader>
									<div className="flex items-center justify-between gap-4">
										<div>
											<DialogTitle className="text-xl font-bold flex items-center gap-2">
												<span>
													{`${selectedCustomer.firstName} ${selectedCustomer.lastName}`.trim() || "User Account"}
												</span>
												{selectedCustomer.isPlatformAdmin && (
													<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
														PLATFORM ADMIN
													</span>
												)}
												{selectedCustomer.banned && (
													<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
														DEACTIVATED
													</span>
												)}
											</DialogTitle>
											<DialogDescription className="text-slate-400 text-xs mt-1">
												{selectedCustomer.email} • ID: {selectedCustomer.id}
											</DialogDescription>
										</div>
									</div>
								</DialogHeader>

								{/* Account Summary Cards */}
								<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
									<div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
										<div className="text-[11px] text-slate-400 font-medium">Plan & Subscription</div>
										<div className="text-sm font-bold text-white mt-1">
											{selectedCustomer.subscription?.planName || "Free Tier"}
										</div>
										<div className="text-[11px] text-slate-500 capitalize">
											Status: {selectedCustomer.subscription?.status || "active"}
										</div>
									</div>

									<div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
										<div className="text-[11px] text-slate-400 font-medium">Total Paid</div>
										<div className="text-sm font-bold text-emerald-400 mt-1">
											{formatCurrency(selectedCustomer.totalAmountPaid, selectedCustomer.currency)}
										</div>
										<div className="text-[11px] text-slate-500">
											{selectedCustomer.paymentCount} completed invoices
										</div>
									</div>

									<div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
										<div className="text-[11px] text-slate-400 font-medium">Total Workloads</div>
										<div className="text-sm font-bold text-indigo-300 mt-1">
											{(selectedCustomer.applications?.length || 0) + (selectedCustomer.composeStacks?.length || 0)} Services
										</div>
										<div className="text-[11px] text-slate-500">
											{selectedCustomer.projectCount} Projects
										</div>
									</div>
								</div>

								{/* Hosted Applications */}
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<h3 className="text-sm font-bold text-white flex items-center gap-2">
											<Layers className="w-4 h-4 text-blue-400" />
											Hosted Applications ({selectedCustomer.applications?.length || 0})
										</h3>
										<span className="text-[11px] text-slate-400">Click URLs to inspect live app</span>
									</div>

									{selectedCustomer.applications?.length === 0 ? (
										<div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-500">
											No individual applications deployed.
										</div>
									) : (
										<div className="space-y-2">
											{selectedCustomer.applications?.map((app: any) => (
												<div
													key={app.applicationId}
													className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2 flex-wrap">
															<span className="font-semibold text-white text-xs">{app.name}</span>
															<span className="text-[10px] text-slate-400 font-mono">({app.appName})</span>
															<span
																className={`px-2 py-0.2 rounded-full text-[9px] font-bold uppercase ${
																	app.status === "running"
																		? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
																		: app.status === "error"
																		? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
																		: "bg-slate-800 text-slate-400 border border-slate-700"
																}`}
															>
																{app.status}
															</span>
														</div>

														{/* Primary Inspection URL */}
														<div className="mt-1.5 flex items-center gap-2">
															<a
																href={app.primaryUrl}
																target="_blank"
																rel="noopener noreferrer"
																className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline font-mono truncate max-w-md"
																title="Direct Inspection URL"
															>
																<Globe className="w-3 h-3 shrink-0" />
																<span className="truncate">{app.primaryUrl}</span>
																<ArrowUpRight className="w-3 h-3 shrink-0" />
															</a>
														</div>

														{app.domains?.length > 1 && (
															<div className="mt-1 text-[10px] text-slate-500 truncate">
																Additional domains: {app.domains.slice(1).map((d: any) => d.host).join(", ")}
															</div>
														)}
													</div>

													<div className="flex items-center gap-2 shrink-0">
														<a
															href={app.primaryUrl}
															target="_blank"
															rel="noopener noreferrer"
															className="px-2.5 py-1 rounded bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-500/20 text-xs font-medium flex items-center gap-1 transition-colors"
														>
															<ExternalLink className="w-3 h-3" />
															Inspect App
														</a>

														<Button
															variant="outline"
															size="sm"
															onClick={() =>
																setAppToDelete({
																	id: app.applicationId,
																	name: app.name,
																	type: "app",
																})
															}
															className="h-7 text-xs border-rose-900/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
														>
															<Trash2 className="w-3 h-3 mr-1" />
															Delete App
														</Button>
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								{/* Compose Stacks */}
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<h3 className="text-sm font-bold text-white flex items-center gap-2">
											<Boxes className="w-4 h-4 text-purple-400" />
											Compose Stacks ({selectedCustomer.composeStacks?.length || 0})
										</h3>
									</div>

									{selectedCustomer.composeStacks?.length === 0 ? (
										<div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-500">
											No compose stacks deployed.
										</div>
									) : (
										<div className="space-y-2">
											{selectedCustomer.composeStacks?.map((stack: any) => (
												<div
													key={stack.composeId}
													className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2 flex-wrap">
															<span className="font-semibold text-white text-xs">{stack.name}</span>
															<span className="text-[10px] text-slate-400 font-mono">({stack.appName})</span>
															<span className="px-1.5 py-0.2 rounded text-[9px] bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
																{stack.composeType}
															</span>
															<span
																className={`px-2 py-0.2 rounded-full text-[9px] font-bold uppercase ${
																	stack.status === "running"
																		? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
																		: "bg-slate-800 text-slate-400 border border-slate-700"
																}`}
															>
																{stack.status}
															</span>
														</div>

														<div className="mt-1.5 flex items-center gap-2">
															<a
																href={stack.primaryUrl}
																target="_blank"
																rel="noopener noreferrer"
																className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 underline font-mono truncate max-w-md"
																title="Direct Inspection URL"
															>
																<Globe className="w-3 h-3 shrink-0" />
																<span className="truncate">{stack.primaryUrl}</span>
																<ArrowUpRight className="w-3 h-3 shrink-0" />
															</a>
														</div>
													</div>

													<div className="flex items-center gap-2 shrink-0">
														<a
															href={stack.primaryUrl}
															target="_blank"
															rel="noopener noreferrer"
															className="px-2.5 py-1 rounded bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border border-purple-500/20 text-xs font-medium flex items-center gap-1 transition-colors"
														>
															<ExternalLink className="w-3 h-3" />
															Inspect Stack
														</a>

														<Button
															variant="outline"
															size="sm"
															onClick={() =>
																setAppToDelete({
																	id: stack.composeId,
																	name: stack.name,
																	type: "compose",
																})
															}
															className="h-7 text-xs border-rose-900/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
														>
															<Trash2 className="w-3 h-3 mr-1" />
															Delete Stack
														</Button>
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								{/* Managed Databases */}
								{selectedCustomer.databases?.length > 0 && (
									<div className="space-y-3">
										<h3 className="text-sm font-bold text-white flex items-center gap-2">
											<Database className="w-4 h-4 text-emerald-400" />
											Managed Databases ({selectedCustomer.databases.length})
										</h3>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											{selectedCustomer.databases.map((db: any) => (
												<div
													key={db.id}
													className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between"
												>
													<div>
														<div className="font-semibold text-white text-xs">{db.name}</div>
														<div className="text-[10px] text-slate-400 font-mono capitalize">
															{db.type} • {db.appName}
														</div>
													</div>
													<span className="px-2 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 border border-slate-700">
														{db.status || "active"}
													</span>
												</div>
											))}
										</div>
									</div>
								)}

								{/* Admin Actions & Account Danger Zone */}
								{!selectedCustomer.isPlatformAdmin && (
									<div className="pt-4 border-t border-slate-800 space-y-3">
										<h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
											Administrative Actions & Danger Zone
										</h4>

										<div className="p-4 rounded-xl bg-slate-900/90 border border-rose-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
											<div>
												<div className="font-bold text-white text-xs">
													{selectedCustomer.banned ? "Reactivate Account" : "Disable Customer Access"}
												</div>
												<div className="text-slate-400 text-xs mt-0.5">
													{selectedCustomer.banned
														? "Restore customer login and API access to the hosting platform."
														: "Immediately locks customer sessions and blocks further actions."}
												</div>
											</div>

											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													setBanAction({
														id: selectedCustomer.id,
														name: `${selectedCustomer.firstName} ${selectedCustomer.lastName}`.trim(),
														banned: !selectedCustomer.banned,
													})
												}
												className={
													selectedCustomer.banned
														? "border-emerald-600 text-emerald-400 hover:bg-emerald-500/10"
														: "border-amber-600 text-amber-400 hover:bg-amber-500/10"
												}
											>
												{selectedCustomer.banned ? (
													<>
														<Unlock className="w-3.5 h-3.5 mr-1.5" />
														Enable Account
													</>
												) : (
													<>
														<Lock className="w-3.5 h-3.5 mr-1.5" />
														Disable Account
													</>
												)}
											</Button>
										</div>

										<div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
											<div>
												<div className="font-bold text-rose-300 text-xs flex items-center gap-1.5">
													<AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
													Purge Account, All Containers & Named Volumes
												</div>
												<div className="text-slate-400 text-xs mt-0.5">
													Permanently terminates all Docker containers, drops storage volumes, cleans Traefik routes, and purges the account.
												</div>
											</div>

											<Button
												variant="destructive"
												size="sm"
												onClick={() =>
													setAccountToDelete({
														id: selectedCustomer.id,
														name: `${selectedCustomer.firstName} ${selectedCustomer.lastName}`.trim(),
														email: selectedCustomer.email,
													})
												}
												className="bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs shrink-0"
											>
												<Trash2 className="w-3.5 h-3.5 mr-1.5" />
												Delete Account & Purge All
											</Button>
										</div>
									</div>
								)}

								<DialogFooter>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setSelectedCustomerId(null)}
										className="border-slate-800 text-slate-300 hover:bg-slate-800"
									>
										Close
									</Button>
								</DialogFooter>
							</div>
						)}
					</DialogContent>
				</Dialog>

				{/* Disable / Enable Confirmation Dialog */}
				<AlertDialog open={!!banAction} onOpenChange={(open) => !open && setBanAction(null)}>
					<AlertDialogContent className="bg-slate-950 border border-slate-800 text-white">
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2">
								{banAction?.banned ? (
									<>
										<Lock className="w-5 h-5 text-amber-400" />
										Disable Customer Account?
									</>
								) : (
									<>
										<Unlock className="w-5 h-5 text-emerald-400" />
										Reactivate Customer Account?
									</>
								)}
							</AlertDialogTitle>
							<AlertDialogDescription className="text-slate-400 text-xs">
								{banAction?.banned
									? `Disabling ${banAction?.name}'s account will terminate their active sessions and block them from logging into the platform until re-enabled.`
									: `Reactivating ${banAction?.name}'s account will restore their ability to log in and manage their services.`}
							</AlertDialogDescription>
						</AlertDialogHeader>

						{banAction?.banned && (
							<div className="my-2">
								<label className="text-xs text-slate-400 mb-1 block">Reason for disabling (optional):</label>
								<input
									type="text"
									value={banReasonInput}
									onChange={(e) => setBanReasonInput(e.target.value)}
									placeholder="e.g. Terms violation, non-payment, suspicious activity..."
									className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-slate-700"
								/>
							</div>
						)}

						<AlertDialogFooter>
							<AlertDialogCancel
								onClick={() => setBanAction(null)}
								className="border-slate-800 text-slate-400 hover:bg-slate-900"
							>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									if (!banAction) return;
									toggleStatusMutation.mutate({
										userId: banAction.id,
										banned: banAction.banned,
										reason: banReasonInput || undefined,
									});
								}}
								disabled={toggleStatusMutation.isPending}
								className={
									banAction?.banned
										? "bg-amber-600 hover:bg-amber-700 text-white"
										: "bg-emerald-600 hover:bg-emerald-700 text-white"
								}
							>
								{toggleStatusMutation.isPending
									? "Updating..."
									: banAction?.banned
									? "Disable Account"
									: "Activate Account"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* Delete Individual Application Confirmation Dialog */}
				<AlertDialog open={!!appToDelete} onOpenChange={(open) => !open && setAppToDelete(null)}>
					<AlertDialogContent className="bg-slate-950 border border-slate-800 text-white">
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2 text-rose-400">
								<Trash2 className="w-5 h-5 text-rose-400" />
								Delete Customer Workload?
							</AlertDialogTitle>
							<AlertDialogDescription className="text-slate-400 text-xs">
								Are you sure you want to delete <strong className="text-white">{appToDelete?.name}</strong>?
								This will immediately stop and remove the Docker container, clean up all routing entries, and remove associated files.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel
								onClick={() => setAppToDelete(null)}
								className="border-slate-800 text-slate-400 hover:bg-slate-900"
							>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									if (!appToDelete) return;
									if (appToDelete.type === "app") {
										deleteAppMutation.mutate({ applicationId: appToDelete.id });
									} else {
										deleteComposeMutation.mutate({ composeId: appToDelete.id });
									}
								}}
								disabled={deleteAppMutation.isPending || deleteComposeMutation.isPending}
								className="bg-rose-600 hover:bg-rose-700 text-white"
							>
								{deleteAppMutation.isPending || deleteComposeMutation.isPending
									? "Deleting..."
									: "Delete Workload"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* Delete Full Account & Purge Confirmation Dialog */}
				<AlertDialog open={!!accountToDelete} onOpenChange={(open) => !open && setAccountToDelete(null)}>
					<AlertDialogContent className="bg-slate-950 border border-slate-800 text-white">
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2 text-rose-400">
								<AlertTriangle className="w-5 h-5 text-rose-400" />
								PERMANENT ACCOUNT & CONTAINER PURGE
							</AlertDialogTitle>
							<AlertDialogDescription className="text-slate-400 text-xs space-y-2">
								<p>
									You are about to permanently delete the account of{" "}
									<strong className="text-white">{accountToDelete?.name}</strong> ({accountToDelete?.email}).
								</p>
								<div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-300 font-mono text-[11px] space-y-1">
									<div>• ALL Docker containers will be stopped & removed</div>
									<div>• ALL Docker volumes and mounted persistent data will be PURGED</div>
									<div>• ALL Traefik domains & routes will be removed</div>
									<div>• ALL projects, databases, and subscriptions will be deleted</div>
								</div>
								<p className="text-rose-400 font-semibold">This action cannot be undone.</p>
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel
								onClick={() => setAccountToDelete(null)}
								className="border-slate-800 text-slate-400 hover:bg-slate-900"
							>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									if (!accountToDelete) return;
									deleteAccountMutation.mutate({ userId: accountToDelete.id });
								}}
								disabled={deleteAccountMutation.isPending}
								className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
							>
								{deleteAccountMutation.isPending ? "Purging Resources..." : "Yes, Purge Customer & Resources"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</>
	);
}

AdminCustomersPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

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

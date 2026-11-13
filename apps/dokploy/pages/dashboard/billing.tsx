import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	CreditCard,
	CheckCircle,
	AlertCircle,
	ArrowUpRight,
	Clock,
	Download,
	Receipt,
	Zap,
	Shield,
	Smartphone,
	Globe,
	RefreshCw,
	CheckCircle2,
	XCircle,
	Radio,
	Sparkles,
	Printer,
	FileText,
	Check,
	Server,
	Database,
	Layers,
	ShieldCheck,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";
import { appRouter } from "@/server/api/root";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { api } from "@/utils/api";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

function StatCard({
	label,
	value,
	delta,
}: {
	label: string;
	value: string;
	delta?: string;
}) {
	return (
		<div className="rounded-xl border bg-background p-5 min-h-[130px] flex flex-col justify-between shadow-sm">
			<span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
				{label}
			</span>
			<div className="flex flex-col gap-1">
				<span className="text-2xl font-bold tracking-tight text-foreground">{value}</span>
				{delta && (
					<span className="text-xs text-muted-foreground">{delta}</span>
				)}
			</div>
		</div>
	);
}

const OPERATORS = [
	{ id: "mpesa", name: "Vodacom M-Pesa", badgeColor: "bg-red-500" },
	{ id: "tigopesa", name: "Tigo Pesa", badgeColor: "bg-blue-500" },
	{ id: "airtel", name: "Airtel Money", badgeColor: "bg-rose-500" },
	{ id: "halopesa", name: "Halopesa", badgeColor: "bg-amber-500" },
] as const;

export default function BillingPage() {
	const utils = api.useUtils();
	const { data: user } = api.user.get.useQuery();
	const { data: sub, isLoading: subLoading, refetch: refetchSub } = api.subscription.getCurrent.useQuery();
	const { data: plans, isLoading: plansLoading } = api.subscription.getPlans.useQuery();
	const { data: invoices, isLoading: invoicesLoading, refetch: refetchInvoices } = api.subscription.getInvoices.useQuery();

	const [phone, setPhone] = useState("");
	const [selectedPlanId, setSelectedPlanId] = useState<string>("");
	const [paymentMethod, setPaymentMethod] = useState<"mpesa" | "tigopesa" | "airtel" | "halopesa">("mpesa");

	// Live authorization modal state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
	const [orderReference, setOrderReference] = useState<string | null>(null);
	const [orderAmount, setOrderAmount] = useState<number | null>(null);
	const [pollingStatus, setPollingStatus] = useState<"WAITING" | "SUCCESS" | "FAILED">("WAITING");
	const [countdown, setCountdown] = useState(60);

	// Printable invoice receipt state
	const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);

	const initiatePaymentMutation = api.subscription.initiateSonicPesaPayment.useMutation();
	const checkStatusMutation = api.subscription.checkSonicPesaStatus.useMutation();

	// Select initial plan once loaded
	useEffect(() => {
		if (plans && plans.length > 0 && !selectedPlanId) {
			const activePlan = plans.find((p) => p.id === sub?.planId) || plans.find((p) => Number(p.price) > 0) || plans[0];
			if (activePlan) {
				setSelectedPlanId(activePlan.id);
			}
		}
	}, [plans, sub, selectedPlanId]);

	// Polling effect when authorization is pending
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null;
		let timer: NodeJS.Timeout | null = null;

		if (isModalOpen && currentOrderId && pollingStatus === "WAITING") {
			interval = setInterval(async () => {
				try {
					const res = await checkStatusMutation.mutateAsync({ orderId: currentOrderId });
					if (res.isPaid || res.status === "SUCCESS") {
						setPollingStatus("SUCCESS");
						toast.success("Payment confirmed! Your subscription is now active.");
						utils.subscription.getCurrent.invalidate();
						utils.subscription.getInvoices.invalidate();
						if (interval) clearInterval(interval);
					} else if (["CANCELLED", "USERCANCELLED", "REJECTED", "FAILED"].includes(res.status)) {
						setPollingStatus("FAILED");
						toast.error(`Payment ${res.status.toLowerCase()}. Please try again.`);
						if (interval) clearInterval(interval);
					}
				} catch (e) {
					console.error("Status check error", e);
				}
			}, 3000);

			timer = setInterval(() => {
				setCountdown((prev) => {
					if (prev <= 1) {
						if (interval) clearInterval(interval);
						return 0;
					}
					return prev - 1;
				});
			}, 1000);
		}

		return () => {
			if (interval) clearInterval(interval);
			if (timer) clearInterval(timer);
		};
	}, [isModalOpen, currentOrderId, pollingStatus, utils, checkStatusMutation]);

	const handleSendUSSDPush = async () => {
		let cleanPhone = phone.trim().replace(/[\s\-\(\)]/g, "");
		if (cleanPhone.startsWith("+")) cleanPhone = cleanPhone.substring(1);
		if (cleanPhone.startsWith("0")) cleanPhone = "255" + cleanPhone.substring(1);
		if (!cleanPhone.startsWith("255") && cleanPhone.length === 9) {
			cleanPhone = "255" + cleanPhone;
		}

		if (!cleanPhone || cleanPhone.length < 10) {
			toast.error("Please enter a valid mobile money number (e.g. 07XXXXXXXX or 255XXXXXXXXX)");
			return;
		}

		const planToPay = plans?.find((p) => p.id === selectedPlanId);
		if (!planToPay) {
			toast.error("Please select a valid hosting plan.");
			return;
		}

		try {
			const res = await initiatePaymentMutation.mutateAsync({
				planId: planToPay.id,
				phone: cleanPhone,
			});

			setCurrentOrderId(res.orderId || null);
			setOrderReference(res.reference || null);
			setOrderAmount(res.amount ? Number(res.amount) : Number(planToPay.price));
			setPollingStatus("WAITING");
			setCountdown(60);
			setIsModalOpen(true);
			toast.success("Payment prompt dispatched to your phone! Please enter your PIN to authorize.");
		} catch (error: any) {
			toast.error(error.message || "Failed to initiate payment. Please check your phone number.");
		}
	};

	const formatPaymentProvider = (provider?: string | null) => {
		if (!provider) return "Mobile Money";
		const lower = provider.toLowerCase();
		if (lower === "sonicpesa") return "Mobile Money";
		if (lower === "mpesa") return "M-Pesa";
		if (lower === "tigopesa") return "Tigo Pesa";
		if (lower === "airtel" || lower === "airtelmoney") return "Airtel Money";
		if (lower === "halopesa") return "Halopesa";
		if (lower === "card") return "Debit / Credit Card";
		return "Mobile Money";
	};

	const activePlan = sub?.plan;
	const isSubActive = sub?.status === "active";
	const formattedPrice = activePlan ? `${Number(activePlan.price).toLocaleString()} ${activePlan.currency || "TZS"}` : "0 TZS";

	return (
		<>
			<Head>
				<title>Billing & Invoices - {brand.APP_NAME}</title>
			</Head>

			<BreadcrumbSidebar
				list={[
					{ name: "Home", href: "/dashboard/home" },
					{ name: "Billing", href: "/dashboard/billing" },
				]}
			/>

			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl min-h-[85vh]">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6 h-full">
						{/* Page Header */}
						<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b pb-5">
							<div>
								<h1 className="text-3xl font-semibold tracking-tight">Billing & Subscriptions</h1>
								<p className="text-sm text-muted-foreground mt-1">
									Manage your {brand.APP_NAME} subscription plan, pay invoices via Mobile Money (M-Pesa, Tigo Pesa, Airtel Money, Halopesa) or Card, and download official receipts.
								</p>
							</div>

							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										refetchSub();
										refetchInvoices();
										toast.success("Billing data refreshed");
									}}
									className="text-xs gap-1.5"
								>
									<RefreshCw className="size-3.5" />
									Refresh
								</Button>

								<Button
									size="sm"
									onClick={() => {
										const elem = document.getElementById("plan-selection-section");
										elem?.scrollIntoView({ behavior: "smooth" });
									}}
									className="text-xs gap-1.5"
								>
									<Sparkles className="size-3.5" /> Upgrade Plan
								</Button>
							</div>
						</div>

						{/* High-Level Overview Stat Cards */}
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<StatCard
								label="Current Plan"
								value={activePlan?.name || "Free Starter"}
								delta={isSubActive ? "Active & Healthy" : sub?.status?.toUpperCase() || "TRIAL"}
							/>
							<StatCard
								label="Recurring Amount"
								value={formattedPrice}
								delta={`Billed ${activePlan?.billingCycle || "monthly"}`}
							/>
							<StatCard
								label="Next Renewal"
								value={
									sub?.currentPeriodEnd
										? new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
												month: "short",
												day: "numeric",
												year: "numeric",
											})
										: "Active"
								}
								delta="Automatic status check"
							/>
							<StatCard
								label="Settled Invoices"
								value={String(invoices?.filter((i) => i.status === "paid").length ?? 0)}
								delta={`Total invoices: ${invoices?.length ?? 0}`}
							/>
						</div>

						{/* Active Subscription Summary Card */}
						<div className="rounded-xl border bg-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
							<div className="space-y-3">
								<div className="flex items-center gap-3">
									<Badge variant="secondary" className="px-3 py-1 text-xs font-semibold flex items-center gap-1.5">
										<Zap className="size-3.5" /> {activePlan?.name || "Free Starter"} Plan
									</Badge>
									<span
										className={`px-2.5 py-0.5 rounded-full text-xs font-medium uppercase border ${
											isSubActive
												? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
												: sub?.status === "trial"
													? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30"
													: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
										}`}
									>
										{sub?.status || "TRIAL"}
									</span>
								</div>

								<div>
									<h2 className="text-3xl font-bold tracking-tight text-foreground">
										{formattedPrice}{" "}
										<span className="text-muted-foreground text-sm font-normal">
											/ {activePlan?.billingCycle || "month"}
										</span>
									</h2>
									<p className="text-muted-foreground text-xs mt-1">
										{sub?.currentPeriodEnd
											? `Billing period valid until: ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
											: "No active expiration date"}
									</p>
								</div>

								<div className="flex flex-wrap gap-4 text-xs text-foreground">
									<span className="flex items-center gap-1.5">
										<CheckCircle className="size-3.5 text-emerald-500" />
										{activePlan?.resources?.find((r) => r.resourceKey === "max_applications")?.value ?? "Unlimited"} Application Slots
									</span>
									<span className="flex items-center gap-1.5">
										<CheckCircle className="size-3.5 text-emerald-500" />
										{activePlan?.resources?.find((r) => r.resourceKey === "max_databases")?.value ?? "Unlimited"} Managed Databases
									</span>
									<span className="flex items-center gap-1.5">
										<CheckCircle className="size-3.5 text-emerald-500" />
										{activePlan?.resources?.find((r) => r.resourceKey === "max_domains")?.value ?? "Unlimited"} Custom Domains
									</span>
								</div>
							</div>

							<div className="flex flex-col sm:flex-row gap-3 shrink-0">
								<Button
									size="sm"
									onClick={() => {
										const elem = document.getElementById("plan-selection-section");
										elem?.scrollIntoView({ behavior: "smooth" });
									}}
									className="gap-1.5 w-full sm:w-auto"
								>
									<Sparkles className="size-3.5" /> Change Plan / Pay Subscription
								</Button>
							</div>
						</div>

						{/* Plan Upgrade & Instant Mobile Payment Studio */}
						<div id="plan-selection-section" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
							{/* Left: Plan Selector & Payment Method */}
							<div className="lg:col-span-2 rounded-xl border bg-card p-6 space-y-6 shadow-sm">
								<div className="flex items-center justify-between border-b pb-4">
									<div>
										<h3 className="text-base font-semibold text-foreground flex items-center gap-2">
											<Smartphone className="size-4 text-emerald-500" />
											Instant Mobile Money & Card Payment
										</h3>
										<p className="text-xs text-muted-foreground mt-0.5">
											Pay securely using M-Pesa, Tigo Pesa, Airtel Money, or Halopesa with automated instant activation.
										</p>
									</div>
									<Badge variant="outline" className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
										Direct USSD Push
									</Badge>
								</div>

								{/* Step 1: Select Plan */}
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<label className="text-xs font-semibold text-foreground uppercase tracking-wider">
											Step 1: Choose Your Hosting Plan
										</label>
										<span className="text-xs text-muted-foreground">Select a tier</span>
									</div>

									<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
										{plans?.filter((p) => Number(p.price) > 0).map((p) => {
											const isSelected = selectedPlanId === p.id;
											return (
												<div
													key={p.id}
													onClick={() => setSelectedPlanId(p.id)}
													className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between gap-3 ${
														isSelected
															? "bg-accent border-primary ring-1 ring-primary/20 shadow-sm"
															: "bg-muted/30 border hover:border-foreground/30 hover:bg-muted/50"
													}`}
												>
													<div className="space-y-1">
														<div className="flex justify-between items-center">
															<span className="text-xs font-bold text-foreground">{p.name}</span>
															{isSelected ? (
																<CheckCircle2 className="size-4 text-primary" />
															) : (
																<div className="size-4 rounded-full border border-muted-foreground/40" />
															)}
														</div>
														<p className="text-lg font-bold text-foreground">
															{Number(p.price).toLocaleString()}{" "}
															<span className="text-[11px] text-muted-foreground font-normal">TZS / mo</span>
														</p>
														<p className="text-[11px] text-muted-foreground line-clamp-2">
															{p.description}
														</p>
													</div>

													<div className="pt-2 border-t text-[11px] text-muted-foreground space-y-0.5">
														<div className="flex items-center gap-1.5">
															<Server className="size-3 text-muted-foreground/70" />
															<span>{p.resources?.find((r) => r.resourceKey === "max_applications")?.value ?? "1"} Apps</span>
														</div>
														<div className="flex items-center gap-1.5">
															<Database className="size-3 text-muted-foreground/70" />
															<span>{p.resources?.find((r) => r.resourceKey === "max_databases")?.value ?? "1"} Databases</span>
														</div>
													</div>
												</div>
											);
										})}
									</div>
								</div>

								{/* Step 2: Select Operator */}
								<div className="space-y-3 pt-2">
									<div className="flex items-center justify-between">
										<label className="text-xs font-semibold text-foreground uppercase tracking-wider">
											Step 2: Select Mobile Money Operator
										</label>
										<span className="text-xs text-muted-foreground">Supported across Tanzania</span>
									</div>

									<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
										{OPERATORS.map((net) => {
											const isSelected = paymentMethod === net.id;
											return (
												<button
													key={net.id}
													type="button"
													onClick={() => setPaymentMethod(net.id as any)}
													className={`p-3 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-1.5 ${
														isSelected
															? "bg-accent border-primary ring-1 ring-primary/20 text-foreground font-medium shadow-sm"
															: "bg-muted/30 border text-muted-foreground hover:border-foreground/30 hover:bg-muted/50"
													}`}
												>
													<div className="flex items-center gap-2">
														<span className={`size-2 rounded-full ${net.badgeColor}`} />
														<span className="text-xs font-semibold">{net.name}</span>
													</div>
												</button>
											);
										})}
									</div>
								</div>

								{/* Step 3: Enter Phone Number */}
								<div className="space-y-3 pt-2">
									<label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
										Step 3: Enter Mobile Number for Instant USSD Authorization
									</label>

									<div className="flex flex-col sm:flex-row gap-3">
										<div className="flex-1 flex rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
											<div className="flex items-center gap-1.5 px-3.5 bg-muted border-r text-xs font-semibold text-muted-foreground select-none">
												<span>🇹🇿</span>
												<span>+255</span>
											</div>
											<input
												type="tel"
												value={phone}
												onChange={(e) => setPhone(e.target.value)}
												placeholder="712 345 678"
												className="flex-1 px-3.5 py-2.5 bg-transparent text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60"
											/>
										</div>

										<Button
											disabled={initiatePaymentMutation.isPending}
											onClick={handleSendUSSDPush}
											className="text-xs px-6 h-10 gap-2 shrink-0 font-medium"
										>
											{initiatePaymentMutation.isPending ? (
												<>
													<RefreshCw className="size-3.5 animate-spin" />
													<span>Dispatching Prompt...</span>
												</>
											) : (
												<>
													<Smartphone className="size-3.5" />
													<span>Send Payment Prompt to Phone</span>
												</>
											)}
										</Button>
									</div>

									<p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
										<ShieldCheck className="size-3.5 text-emerald-500 shrink-0" />
										<span>
											<strong>Secured Carrier Billing:</strong> An automatic and secure USSD PIN authorization prompt will appear on your phone to authorize payment.
										</span>
									</p>
								</div>
							</div>

							{/* Right: Order Summary & Entitlements */}
							<div className="rounded-xl border bg-card p-6 space-y-5 shadow-sm flex flex-col justify-between">
								<div className="space-y-4">
									<div className="flex items-center justify-between border-b pb-3">
										<h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
											<Receipt className="size-4 text-muted-foreground" /> Order Summary
										</h3>
										<Badge variant="outline" className="text-[10px] uppercase font-mono">
											TZS
										</Badge>
									</div>

									{(() => {
										const targetPlan = plans?.find((p) => p.id === (selectedPlanId || sub?.planId));
										return (
											<div className="space-y-3">
												<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
													<div className="flex justify-between items-center text-xs">
														<span className="font-semibold text-foreground">{targetPlan?.name || "Starter"}</span>
														<span className="font-mono font-bold text-foreground">
															{targetPlan ? Number(targetPlan.price).toLocaleString() : "0"} TZS
														</span>
													</div>
													<p className="text-[11px] text-muted-foreground">
														Billed {targetPlan?.billingCycle || "monthly"} • Instant provisioning
													</p>
												</div>

												<div className="space-y-2 pt-2 text-xs">
													<span className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider block">
														Included Plan Features
													</span>
													{targetPlan?.features?.map((f) => (
														<div key={f.id} className="flex items-center justify-between py-1 border-b text-xs">
															<span className="text-muted-foreground capitalize">{f.featureKey.replace(/_/g, " ")}</span>
															<span className={f.enabled ? "text-emerald-500 font-medium" : "text-muted-foreground"}>
																{f.enabled ? "Included" : "Not Included"}
															</span>
														</div>
													))}
												</div>
											</div>
										);
									})()}
								</div>

								<div className="pt-4 border-t text-xs space-y-2 text-muted-foreground">
									<div className="flex justify-between text-xs font-semibold text-foreground">
										<span>Total Due Today:</span>
										<span className="font-mono text-sm">
											{(() => {
												const targetPlan = plans?.find((p) => p.id === (selectedPlanId || sub?.planId));
												return targetPlan ? `${Number(targetPlan.price).toLocaleString()} TZS` : "0 TZS";
											})()}
										</span>
									</div>
									<p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
										🛡️ Immediate activation upon authorization. You can upgrade, downgrade, or cancel your subscription at any time.
									</p>
								</div>
							</div>
						</div>

						{/* Invoice History Table */}
						<div className="rounded-xl border bg-card overflow-hidden shadow-sm">
							<div className="p-5 border-b flex items-center justify-between">
								<div>
									<h3 className="text-base font-semibold text-foreground">Invoice & Payment Records</h3>
									<p className="text-xs text-muted-foreground mt-0.5">Past invoices, transactions, and printable payment receipts.</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										utils.subscription.getInvoices.invalidate();
										toast.success("Invoices refreshed");
									}}
									className="text-xs gap-1.5"
								>
									<RefreshCw className="size-3.5" /> Refresh Invoices
								</Button>
							</div>

							<div className="overflow-x-auto">
								<table className="w-full text-left text-xs">
									<thead className="bg-muted/50 text-muted-foreground border-b">
										<tr>
											<th className="px-5 py-3 font-medium">Invoice Number</th>
											<th className="px-5 py-3 font-medium">Billing Date</th>
											<th className="px-5 py-3 font-medium">Amount</th>
											<th className="px-5 py-3 font-medium">Payment Method</th>
											<th className="px-5 py-3 font-medium">Status</th>
											<th className="px-5 py-3 font-medium text-right">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-border text-foreground">
										{invoicesLoading ? (
											<tr>
												<td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
													<RefreshCw className="size-5 animate-spin mx-auto mb-2 text-muted-foreground" />
													Loading invoices...
												</td>
											</tr>
										) : invoices?.length === 0 ? (
											<tr>
												<td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
													No invoices generated yet.
												</td>
											</tr>
										) : (
											invoices?.map((inv) => {
												const latestPayment = inv.payments?.[0];
												const providerLabel = formatPaymentProvider(latestPayment?.provider);
												return (
													<tr key={inv.id} className="hover:bg-muted/50 transition-colors">
														<td className="px-5 py-3.5 font-mono font-medium text-foreground">{inv.invoiceNumber}</td>
														<td className="px-5 py-3.5">
															{new Date(inv.createdAt).toLocaleDateString("en-US", {
																month: "short",
																day: "numeric",
																year: "numeric",
															})}
														</td>
														<td className="px-5 py-3.5 font-semibold text-foreground">
															{Number(inv.amount).toLocaleString()} {inv.currency}
														</td>
														<td className="px-5 py-3.5 text-muted-foreground">
															{providerLabel}
															{latestPayment?.providerTransactionId ? (
																<span className="font-mono text-[11px] block text-muted-foreground/70">
																	Ref: {latestPayment.providerTransactionId}
																</span>
															) : null}
														</td>
														<td className="px-5 py-3.5">
															<span
																className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
																	inv.status === "paid"
																		? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
																		: inv.status === "open"
																			? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
																			: "bg-muted text-muted-foreground border"
																}`}
															>
																{inv.status}
															</span>
														</td>
														<td className="px-5 py-3.5 text-right">
															<Button
																variant="ghost"
																size="sm"
																onClick={() => setViewingInvoice(inv)}
																className="text-xs h-7 px-2.5 gap-1"
															>
																<Receipt className="size-3.5" /> View Receipt
															</Button>
														</td>
													</tr>
												);
											})
										)}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				</Card>
			</div>

			{/* Live Mobile Payment Authorization Dialog */}
			<Dialog open={isModalOpen} onOpenChange={(open) => !open && setIsModalOpen(false)}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="text-lg font-bold flex items-center gap-2">
							<Smartphone className="size-5 text-emerald-500" />
							Payment Authorization Prompt Sent
						</DialogTitle>
						<DialogDescription className="text-muted-foreground text-xs">
							Please check your handset for the USSD payment authorization prompt.
						</DialogDescription>
					</DialogHeader>

					<div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
						{pollingStatus === "WAITING" && (
							<>
								<div className="relative">
									<div className="size-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center animate-pulse">
										<Radio className="size-8 text-emerald-500 animate-spin" style={{ animationDuration: "3s" }} />
									</div>
								</div>
								<div className="space-y-1">
									<h4 className="text-base font-semibold text-foreground">Enter Your Mobile Money PIN</h4>
									<p className="text-xs text-muted-foreground">
										A payment prompt of{" "}
										<strong className="text-emerald-500 font-semibold">
											{orderAmount ? `${orderAmount.toLocaleString()} TZS` : ""}
										</strong>{" "}
										has been sent to <strong className="text-foreground">{phone}</strong>.
									</p>
								</div>
								<div className="text-xs font-mono text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-md border">
									Order: {currentOrderId} • Ref: {orderReference || "—"}
								</div>
								<div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
									<div
										className="bg-emerald-500 h-full transition-all duration-1000"
										style={{ width: `${Math.max(0, (countdown / 60) * 100)}%` }}
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									Waiting for authorization... Auto-expiring in {countdown}s
								</p>
							</>
						)}

						{pollingStatus === "SUCCESS" && (
							<>
								<div className="size-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
									<CheckCircle2 className="size-10 text-emerald-500" />
								</div>
								<div className="space-y-1">
									<h4 className="text-lg font-bold text-foreground">Payment Confirmed!</h4>
									<p className="text-xs text-muted-foreground">
										Your subscription has been activated immediately. Thank you for choosing {brand.APP_NAME}!
									</p>
								</div>
								<Button
									onClick={() => setIsModalOpen(false)}
									className="text-xs px-6 mt-2"
								>
									Continue to Dashboard
								</Button>
							</>
						)}

						{pollingStatus === "FAILED" && (
							<>
								<div className="size-16 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
									<XCircle className="size-10 text-red-500" />
								</div>
								<div className="space-y-1">
									<h4 className="text-lg font-bold text-foreground">Payment Incomplete</h4>
									<p className="text-xs text-muted-foreground">
										The payment was cancelled or timed out. Please try sending the prompt again.
									</p>
								</div>
								<Button
									onClick={() => setIsModalOpen(false)}
									variant="outline"
									className="text-xs px-6 mt-2"
								>
									Close & Retry
								</Button>
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>

			{/* Printable Official Receipt Dialog */}
			{viewingInvoice && (
				<Dialog open={!!viewingInvoice} onOpenChange={(open) => !open && setViewingInvoice(null)}>
					<DialogContent className="max-w-lg">
						<DialogHeader>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<div className="size-8 rounded-lg bg-muted flex items-center justify-center">
										<Receipt className="size-4 text-foreground" />
									</div>
									<div>
										<DialogTitle className="text-base font-semibold">
											Official Tax Invoice & Receipt
										</DialogTitle>
										<DialogDescription className="text-xs text-muted-foreground">
											Invoice #{viewingInvoice.invoiceNumber}
										</DialogDescription>
									</div>
								</div>
								<Badge
									variant="outline"
									className={
										viewingInvoice.status === "paid"
											? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
											: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
									}
								>
									{viewingInvoice.status?.toUpperCase()}
								</Badge>
							</div>
						</DialogHeader>

						<div className="space-y-4 py-3 text-xs">
							{/* Billed To & Provider */}
							<div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-muted/40 border">
								<div className="space-y-0.5">
									<span className="text-[10px] uppercase font-semibold text-muted-foreground">Billed To</span>
									<p className="font-semibold text-foreground">
										{(user as any)?.user?.firstName
											? `${(user as any).user.firstName} ${(user as any).user.lastName || ""}`.trim()
											: (user as any)?.user?.email || "Account Owner"}
									</p>
									<p className="text-muted-foreground">{(user as any)?.user?.email || ""}</p>
								</div>
								<div className="space-y-0.5 text-right">
									<span className="text-[10px] uppercase font-semibold text-muted-foreground">Issued By</span>
									<p className="font-semibold text-foreground">{brand.APP_NAME} Cloud</p>
									<p className="text-muted-foreground">Hosting & Infrastructure</p>
								</div>
							</div>

							{/* Metadata */}
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
								<div className="p-2.5 rounded-lg border bg-background space-y-0.5">
									<span className="text-muted-foreground text-[10px] uppercase">Issue Date</span>
									<p className="font-semibold text-foreground">
										{new Date(viewingInvoice.createdAt).toLocaleDateString("en-US", {
											month: "short",
											day: "numeric",
											year: "numeric",
										})}
									</p>
								</div>
								<div className="p-2.5 rounded-lg border bg-background space-y-0.5">
									<span className="text-muted-foreground text-[10px] uppercase">Payment Method</span>
									<p className="font-semibold text-foreground">
										{formatPaymentProvider(viewingInvoice.payments?.[0]?.provider)}
									</p>
								</div>
								<div className="p-2.5 rounded-lg border bg-background space-y-0.5">
									<span className="text-muted-foreground text-[10px] uppercase">Reference</span>
									<p className="font-mono text-[10px] text-foreground truncate">
										{viewingInvoice.payments?.[0]?.providerTransactionId || viewingInvoice.id}
									</p>
								</div>
							</div>

							{/* Line Items */}
							<div className="rounded-lg border overflow-hidden">
								<table className="w-full text-left text-xs">
									<thead className="bg-muted/50 border-b text-muted-foreground text-[11px]">
										<tr>
											<th className="p-2.5">Description</th>
											<th className="p-2.5 text-right">Amount</th>
										</tr>
									</thead>
									<tbody className="divide-y text-foreground">
										<tr>
											<td className="p-2.5">
												<span className="font-semibold block">{activePlan?.name || "Hosting Plan"} Subscription</span>
												<span className="text-[11px] text-muted-foreground">
													Cloud Hosting & Resource Allocation
												</span>
											</td>
											<td className="p-2.5 text-right font-mono font-semibold">
												{Number(viewingInvoice.amount).toLocaleString()} {viewingInvoice.currency}
											</td>
										</tr>
									</tbody>
									<tfoot className="border-t bg-muted/30 font-semibold">
										<tr>
											<td className="p-2.5">Total Paid</td>
											<td className="p-2.5 text-right font-mono">
												{Number(viewingInvoice.amount).toLocaleString()} {viewingInvoice.currency}
											</td>
										</tr>
									</tfoot>
								</table>
							</div>
						</div>

						<DialogFooter className="flex sm:justify-between items-center gap-2 pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => window.print()}
								className="text-xs gap-1.5"
							>
								<Printer className="size-3.5" /> Print / Save PDF
							</Button>
							<Button
								size="sm"
								onClick={() => setViewingInvoice(null)}
								className="text-xs"
							>
								Close
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

BillingPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Billing & Subscriptions">{page}</DashboardLayout>
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

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
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

export default function BillingPage() {
	const utils = api.useUtils();
	const { data: sub, isLoading: subLoading } = api.subscription.getCurrent.useQuery();
	const { data: plans } = api.subscription.getPlans.useQuery();
	const { data: invoices, isLoading: invoicesLoading } = api.subscription.getInvoices.useQuery();

	const [phone, setPhone] = useState("");
	const [selectedPlanId, setSelectedPlanId] = useState<string>("");
	const [paymentMethod, setPaymentMethod] = useState<"mpesa" | "tigopesa" | "airtel" | "halopesa">("mpesa");

	// USSD Push state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
	const [orderReference, setOrderReference] = useState<string | null>(null);
	const [orderAmount, setOrderAmount] = useState<number | null>(null);
	const [pollingStatus, setPollingStatus] = useState<"WAITING" | "SUCCESS" | "FAILED">("WAITING");
	const [countdown, setCountdown] = useState(60);

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

	// Polling effect when USSD Push is waiting
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
	}, [isModalOpen, currentOrderId, pollingStatus]);

	const handleSendUSSDPush = async () => {
		if (!phone || phone.trim().length < 8) {
			toast.error("Please enter a valid mobile money number (e.g. 07XXXXXXXX or 255XXXXXXXXX)");
			return;
		}

		const planToPay = plans?.find((p) => p.id === selectedPlanId);
		if (!planToPay) {
			toast.error("Please select a valid plan.");
			return;
		}

		try {
			const res = await initiatePaymentMutation.mutateAsync({
				planId: planToPay.id,
				phone: phone.trim(),
			});

			setCurrentOrderId(res.orderId || null);
			setOrderReference(res.reference || null);
			setOrderAmount(res.amount ? Number(res.amount) : Number(planToPay.price));
			setPollingStatus("WAITING");
			setCountdown(60);
			setIsModalOpen(true);
			toast.success("USSD Push prompt sent to your phone! Please enter your PIN to authorize.");
		} catch (error: any) {
			toast.error(error.message || "Failed to initiate payment. Please check your phone number.");
		}
	};

	const activePlan = sub?.plan;
	const isSubActive = sub?.status === "active";
	const formattedPrice = activePlan ? `${Number(activePlan.price).toLocaleString()} ${activePlan.currency || "TZS"}` : "0 TZS";

	return (
		<>
			<Head>
				<title>Billing & Invoices - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Page Header */}
				<div>
					<h1 className="text-2xl font-bold text-white tracking-tight">Billing & Subscriptions</h1>
					<p className="text-slate-400 text-sm mt-1">
						Manage your {brand.APP_NAME} subscription plan, pay invoices via SonicPesa Mobile Money (M-Pesa, Tigo, Airtel, Halopesa), and download receipts.
					</p>
				</div>

				{/* Active Subscription Banner */}
				<div className="rounded-xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 border border-indigo-500/30 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
					<div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
					<div className="space-y-3 relative z-10">
						<div className="flex items-center gap-3">
							<span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
								<Zap className="w-3.5 h-3.5" /> {activePlan?.name || "Free Starter"} Plan
							</span>
							<span
								className={`px-2.5 py-0.5 rounded-full text-xs font-medium uppercase border ${
									isSubActive
										? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
										: sub?.status === "trial"
											? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
											: "bg-amber-500/20 text-amber-400 border-amber-500/30"
								}`}
							>
								{sub?.status || "TRIAL"}
							</span>
						</div>
						<div>
							<h2 className="text-3xl font-extrabold text-white">
								{formattedPrice}{" "}
								<span className="text-slate-400 text-sm font-normal">
									/ {activePlan?.billingCycle || "month"}
								</span>
							</h2>
							<p className="text-slate-400 text-xs mt-1">
								{sub?.currentPeriodEnd
									? `Billing period valid until: ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
									: "No active expiration date"}
							</p>
						</div>
						<div className="flex flex-wrap gap-4 text-xs text-slate-300">
							<span className="flex items-center gap-1.5">
								<CheckCircle className="w-3.5 h-3.5 text-indigo-400" />
								{activePlan?.resources?.find((r) => r.resourceKey === "max_applications")?.value ?? "Unlimited"} Application Slots
							</span>
							<span className="flex items-center gap-1.5">
								<CheckCircle className="w-3.5 h-3.5 text-indigo-400" />
								{activePlan?.resources?.find((r) => r.resourceKey === "max_databases")?.value ?? "Unlimited"} Managed Databases
							</span>
							<span className="flex items-center gap-1.5">
								<CheckCircle className="w-3.5 h-3.5 text-indigo-400" />
								{activePlan?.resources?.find((r) => r.resourceKey === "max_domains")?.value ?? "Unlimited"} Custom Domains
							</span>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row gap-3 relative z-10 shrink-0">
						<Button
							onClick={() => {
								const elem = document.getElementById("payment-section");
								elem?.scrollIntoView({ behavior: "smooth" });
							}}
							className="bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-medium w-full sm:w-auto shadow-lg shadow-indigo-600/20"
						>
							<Sparkles className="w-3.5 h-3.5 mr-1.5" /> Pay / Upgrade Subscription
						</Button>
					</div>
				</div>

				{/* SonicPesa Mobile Money Payment Section */}
				<div id="payment-section" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Left: Payment Method Setup */}
					<div className="lg:col-span-2 rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
						<div className="flex items-center justify-between border-b border-slate-800 pb-4">
							<div>
								<h3 className="text-base font-semibold text-white flex items-center gap-2">
									<Smartphone className="w-4 h-4 text-emerald-400" /> SonicPesa Instant Mobile Money (Push USSD)
								</h3>
								<p className="text-xs text-slate-400 mt-0.5">
									Pay securely with M-Pesa, Tigo Pesa, Airtel Money, or Halopesa in Tanzania (TZS).
								</p>
							</div>
							<span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
								Direct USSD Push
							</span>
						</div>

						{/* Plan Selection */}
						<div className="space-y-2">
							<label className="text-xs font-medium text-slate-300 block">Select Target Plan</label>
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
								{plans?.filter((p) => Number(p.price) > 0).map((p) => (
									<button
										key={p.id}
										type="button"
										onClick={() => setSelectedPlanId(p.id)}
										className={`p-3 rounded-lg border text-left transition-all ${
											selectedPlanId === p.id
												? "bg-indigo-950/40 border-indigo-500 text-white shadow-sm"
												: "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
										}`}
									>
										<div className="flex justify-between items-center">
											<span className="text-xs font-bold text-white">{p.name}</span>
											{selectedPlanId === p.id && <CheckCircle className="w-3.5 h-3.5 text-indigo-400" />}
										</div>
										<p className="text-sm font-extrabold text-indigo-400 mt-1">
											{Number(p.price).toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">TZS</span>
										</p>
										<p className="text-[10px] text-slate-400 mt-0.5">{p.description}</p>
									</button>
								))}
							</div>
						</div>

						{/* Mobile Money Operator selection */}
						<div className="space-y-2 pt-2">
							<label className="text-xs font-medium text-slate-300 block">Mobile Network Operator</label>
							<div className="grid grid-cols-4 gap-2">
								{[
									{ id: "mpesa", name: "Vodacom M-Pesa", color: "text-red-400" },
									{ id: "tigopesa", name: "Tigo Pesa", color: "text-blue-400" },
									{ id: "airtel", name: "Airtel Money", color: "text-red-500" },
									{ id: "halopesa", name: "Halopesa", color: "text-amber-400" },
								].map((net) => (
									<button
										key={net.id}
										type="button"
										onClick={() => setPaymentMethod(net.id as any)}
										className={`p-2.5 rounded-lg border text-center transition-all ${
											paymentMethod === net.id
												? "bg-slate-800 border-indigo-500 text-white"
												: "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
										}`}
									>
										<p className="text-xs font-semibold">{net.name}</p>
									</button>
								))}
							</div>
						</div>

						{/* Phone Number Input Form */}
						<div className="space-y-3 pt-2">
							<label className="text-xs font-medium text-slate-300 block">
								Payer Mobile Phone Number (for USSD Push Prompt)
							</label>
							<div className="flex gap-2">
								<input
									type="tel"
									value={phone}
									onChange={(e) => setPhone(e.target.value)}
									placeholder="07XXXXXXXX or 2557XXXXXXXX"
									className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
								/>
								<Button
									disabled={initiatePaymentMutation.isPending}
									onClick={handleSendUSSDPush}
									className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-5 shadow-lg shadow-emerald-600/20"
								>
									{initiatePaymentMutation.isPending ? (
										<RefreshCw className="w-4 h-4 animate-spin" />
									) : (
										"Send USSD Prompt"
									)}
								</Button>
							</div>
							<p className="text-[11px] text-slate-500 flex items-center gap-1.5">
								<Shield className="w-3.5 h-3.5 text-emerald-400" /> SonicPesa API will trigger an automatic USSD PIN authorization screen on your mobile phone.
							</p>
						</div>
					</div>

					{/* Right: Plan Features & Summary */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<h3 className="text-base font-semibold text-white flex items-center gap-2">
							<Receipt className="w-4 h-4 text-indigo-400" /> Plan Entitlements
						</h3>

						<div className="space-y-3 text-xs">
							{plans
								?.find((p) => p.id === (selectedPlanId || sub?.planId))
								?.features?.map((f) => (
									<div key={f.id} className="flex items-center justify-between py-1 border-b border-slate-800/40">
										<span className="text-slate-400 capitalize">{f.featureKey.replace(/_/g, " ")}</span>
										<span className={f.enabled ? "text-emerald-400 font-medium" : "text-slate-500"}>
											{f.enabled ? "Enabled" : "Not Included"}
										</span>
									</div>
								))}
						</div>

						<div className="pt-4 border-t border-slate-800 text-xs space-y-2 text-slate-400">
							<p className="flex justify-between">
								<span>Selected Currency:</span> <strong className="text-slate-200">TZS (Tanzanian Shilling)</strong>
							</p>
							<p className="flex justify-between">
								<span>Payment Provider:</span> <strong className="text-slate-200">SonicPesa</strong>
							</p>
							<p className="flex justify-between">
								<span>Activation:</span> <strong className="text-emerald-400 font-bold">Instant Automatic</strong>
							</p>
						</div>
					</div>
				</div>

				{/* Invoice History Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800 flex items-center justify-between">
						<div>
							<h3 className="text-base font-semibold text-white">Invoice & Payment Records</h3>
							<p className="text-xs text-slate-400">Past invoices, transactions, and payment receipts.</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => utils.subscription.getInvoices.invalidate()}
							className="text-xs border-slate-700 text-slate-300"
						>
							<RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
						</Button>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
								<tr>
									<th className="px-6 py-3.5 font-medium">Invoice Number</th>
									<th className="px-6 py-3.5 font-medium">Billing Date</th>
									<th className="px-6 py-3.5 font-medium">Amount</th>
									<th className="px-6 py-3.5 font-medium">Provider / Reference</th>
									<th className="px-6 py-3.5 font-medium">Status</th>
									<th className="px-6 py-3.5 font-medium text-right">Payment Date</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/60 text-slate-300">
								{invoicesLoading ? (
									<tr>
										<td colSpan={6} className="px-6 py-8 text-center text-slate-400">
											<RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
											Loading invoices...
										</td>
									</tr>
								) : invoices?.length === 0 ? (
									<tr>
										<td colSpan={6} className="px-6 py-8 text-center text-slate-400">
											No invoices generated yet.
										</td>
									</tr>
								) : (
									invoices?.map((inv) => {
										const latestPayment = inv.payments?.[0];
										return (
											<tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
												<td className="px-6 py-4 font-mono font-medium text-white">{inv.invoiceNumber}</td>
												<td className="px-6 py-4">
													{new Date(inv.createdAt).toLocaleDateString("en-US", {
														month: "short",
														day: "numeric",
														year: "numeric",
													})}
												</td>
												<td className="px-6 py-4 font-semibold text-white">
													{Number(inv.amount).toLocaleString()} {inv.currency}
												</td>
												<td className="px-6 py-4 text-slate-400">
													{latestPayment?.provider || "SonicPesa"}{" "}
													{latestPayment?.providerTransactionId ? `(${latestPayment.providerTransactionId})` : ""}
												</td>
												<td className="px-6 py-4">
													<span
														className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
															inv.status === "paid"
																? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
																: inv.status === "open"
																	? "bg-amber-500/20 text-amber-400 border-amber-500/30"
																	: "bg-slate-800 text-slate-400 border-slate-700"
														}`}
													>
														{inv.status}
													</span>
												</td>
												<td className="px-6 py-4 text-right text-slate-400">
													{inv.paidAt
														? new Date(inv.paidAt).toLocaleDateString("en-US", {
																month: "short",
																day: "numeric",
																year: "numeric",
															})
														: "—"}
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

			{/* SonicPesa Live USSD Push Dialog */}
			<Dialog open={isModalOpen} onOpenChange={(open) => !open && setIsModalOpen(false)}>
				<DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
					<DialogHeader>
						<DialogTitle className="text-lg font-bold flex items-center gap-2">
							<Smartphone className="w-5 h-5 text-emerald-400" /> SonicPesa USSD Push Sent
						</DialogTitle>
						<DialogDescription className="text-slate-400 text-xs">
							Please check your mobile phone for the payment authorization prompt.
						</DialogDescription>
					</DialogHeader>

					<div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
						{pollingStatus === "WAITING" && (
							<>
								<div className="relative">
									<div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center animate-pulse">
										<Radio className="w-8 h-8 text-emerald-400 animate-spin" style={{ animationDuration: "3s" }} />
									</div>
								</div>
								<div className="space-y-1">
									<h4 className="text-base font-semibold text-white">Enter Your Mobile PIN</h4>
									<p className="text-xs text-slate-400">
										SonicPesa has dispatched a USSD prompt of{" "}
										<strong className="text-emerald-400">
											{orderAmount ? `${orderAmount.toLocaleString()} TZS` : ""}
										</strong>{" "}
										to <strong className="text-white">{phone}</strong>.
									</p>
								</div>
								<div className="text-xs font-mono text-slate-500 bg-slate-950 px-3 py-1.5 rounded-md border border-slate-800">
									Order: {currentOrderId} • Ref: {orderReference || "—"}
								</div>
								<p className="text-xs text-slate-500">
									Waiting for authorization... Auto-expiring in {countdown}s
								</p>
							</>
						)}

						{pollingStatus === "SUCCESS" && (
							<>
								<div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center">
									<CheckCircle2 className="w-10 h-10 text-emerald-400" />
								</div>
								<div className="space-y-1">
									<h4 className="text-lg font-bold text-white">Payment Confirmed!</h4>
									<p className="text-xs text-slate-300">
										Your plan has been activated immediately. Thank you for choosing {brand.APP_NAME}!
									</p>
								</div>
								<Button
									onClick={() => setIsModalOpen(false)}
									className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-6 mt-2"
								>
									Done
								</Button>
							</>
						)}

						{pollingStatus === "FAILED" && (
							<>
								<div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
									<XCircle className="w-10 h-10 text-red-400" />
								</div>
								<div className="space-y-1">
									<h4 className="text-lg font-bold text-white">Payment Incomplete</h4>
									<p className="text-xs text-slate-400">
										The payment was cancelled or timed out. Please try sending the prompt again.
									</p>
								</div>
								<Button
									onClick={() => setIsModalOpen(false)}
									className="bg-slate-800 hover:bg-slate-700 text-white text-xs px-6 mt-2"
								>
									Close
								</Button>
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

BillingPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

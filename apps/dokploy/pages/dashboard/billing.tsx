import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
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
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_INVOICES = [
	{ id: "INV-2026-009", date: "Sep 01, 2026", amount: "$29.00", status: "PAID", method: "M-Pesa / Tigo Pesa" },
	{ id: "INV-2026-008", date: "Aug 01, 2026", amount: "$29.00", status: "PAID", method: "M-Pesa / Tigo Pesa" },
	{ id: "INV-2026-007", date: "Jul 01, 2026", amount: "$29.00", status: "PAID", method: "Credit Card" },
];

export default function BillingPage() {
	const [loading, setLoading] = useState(false);
	const [selectedProvider, setSelectedProvider] = useState<"mpesa" | "card" | "tigopesa">("mpesa");
	const [phone, setPhone] = useState("");

	const handlePaymentInitiate = () => {
		if (selectedProvider !== "card" && !phone) {
			toast.error("Please enter a valid mobile money number");
			return;
		}
		setLoading(true);
		setTimeout(() => {
			setLoading(false);
			toast.success("Payment request initiated! Check your phone prompt to authorize.");
		}, 1200);
	};

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
						Manage your subscription plan, view invoices, and configure payment methods.
					</p>
				</div>

				{/* Active Subscription Banner */}
				<div className="rounded-xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 border border-indigo-500/30 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
					<div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
					<div className="space-y-3 relative z-10">
						<div className="flex items-center gap-3">
							<span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
								<Zap className="w-3.5 h-3.5" /> Pro Developer Plan
							</span>
							<span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
								ACTIVE
							</span>
						</div>
						<div>
							<h2 className="text-3xl font-extrabold text-white">$29.00 <span className="text-slate-400 text-sm font-normal">/ month</span></h2>
							<p className="text-slate-400 text-xs mt-1">Next billing date: October 01, 2026 (Auto-renews)</p>
						</div>
						<div className="flex flex-wrap gap-4 text-xs text-slate-300">
							<span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-indigo-400" /> 10 Active Applications</span>
							<span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-indigo-400" /> 4 Managed Databases</span>
							<span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-indigo-400" /> 4GB RAM Allocated</span>
						</div>
					</div>

					<div className="flex flex-col sm:flex-row gap-3 relative z-10 shrink-0">
						<Link href="/onboarding">
							<Button variant="outline" className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs w-full sm:w-auto">
								Change Plan
							</Button>
						</Link>
						<Button onClick={handlePaymentInitiate} className="bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-medium w-full sm:w-auto shadow-lg shadow-indigo-600/20">
							Pay Next Invoice Early
						</Button>
					</div>
				</div>

				{/* Quick Payment & Local Mobile Money Options */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Left: Payment Method Setup */}
					<div className="lg:col-span-2 rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
						<div className="flex items-center justify-between border-b border-slate-800 pb-4">
							<div>
								<h3 className="text-base font-semibold text-white flex items-center gap-2">
									<CreditCard className="w-4 h-4 text-indigo-400" /> Payment Methods & Mobile Money
								</h3>
								<p className="text-xs text-slate-400 mt-0.5">Pay conveniently with regional Mobile Money (M-Pesa, Tigo Pesa, Airtel) or Card.</p>
							</div>
						</div>

						{/* Provider selector tabs */}
						<div className="grid grid-cols-3 gap-3">
							<button
								type="button"
								onClick={() => setSelectedProvider("mpesa")}
								className={`p-3.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
									selectedProvider === "mpesa"
										? "bg-emerald-950/30 border-emerald-500/50 text-emerald-300"
										: "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<Smartphone className="w-5 h-5 text-emerald-400" />
									{selectedProvider === "mpesa" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
								</div>
								<div className="mt-2">
									<p className="text-xs font-bold text-white">M-Pesa / Tigo Pesa</p>
									<p className="text-[10px] text-slate-400">Mobile Money Instant Push</p>
								</div>
							</button>

							<button
								type="button"
								onClick={() => setSelectedProvider("card")}
								className={`p-3.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
									selectedProvider === "card"
										? "bg-indigo-950/30 border-indigo-500/50 text-indigo-300"
										: "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<CreditCard className="w-5 h-5 text-indigo-400" />
									{selectedProvider === "card" && <CheckCircle className="w-4 h-4 text-indigo-400" />}
								</div>
								<div className="mt-2">
									<p className="text-xs font-bold text-white">Credit / Debit Card</p>
									<p className="text-[10px] text-slate-400">Visa, MasterCard</p>
								</div>
							</button>

							<button
								type="button"
								onClick={() => setSelectedProvider("tigopesa")}
								className={`p-3.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
									selectedProvider === "tigopesa"
										? "bg-cyan-950/30 border-cyan-500/50 text-cyan-300"
										: "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<Globe className="w-5 h-5 text-cyan-400" />
									{selectedProvider === "tigopesa" && <CheckCircle className="w-4 h-4 text-cyan-400" />}
								</div>
								<div className="mt-2">
									<p className="text-xs font-bold text-white">Bank Transfer</p>
									<p className="text-[10px] text-slate-400">Wire / Direct Bank</p>
								</div>
							</button>
						</div>

						{/* Form according to provider */}
						{selectedProvider !== "card" ? (
							<div className="space-y-3 pt-2">
								<label className="text-xs font-medium text-slate-300 block">
									Mobile Phone Number (STK Push Prompt)
								</label>
								<div className="flex gap-2">
									<input
										type="tel"
										value={phone}
										onChange={(e) => setPhone(e.target.value)}
										placeholder="+255 7XX XXX XXX or 07XX XXX XXX"
										className="flex-1 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
									/>
									<Button
										disabled={loading}
										onClick={handlePaymentInitiate}
										className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-5"
									>
										{loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Send Push Prompt"}
									</Button>
								</div>
								<p className="text-[11px] text-slate-500 flex items-center gap-1">
									<Shield className="w-3 h-3 text-emerald-400" /> Encrypted direct mobile money prompt will be dispatched instantly to your mobile device.
								</p>
							</div>
						) : (
							<div className="space-y-3 pt-2">
								<p className="text-xs text-slate-300">
									Card payments are secured with 256-bit SSL encryption.
								</p>
								<div className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
									<div className="flex items-center gap-3">
										<CreditCard className="w-6 h-6 text-indigo-400" />
										<div>
											<p className="text-xs font-semibold text-white">•••• •••• •••• 4242</p>
											<p className="text-[10px] text-slate-400">Expires 12/28</p>
										</div>
									</div>
									<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
										Default
									</span>
								</div>
							</div>
						)}
					</div>

					{/* Right: Usage Quotas & Summary */}
					<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
						<h3 className="text-base font-semibold text-white flex items-center gap-2">
							<Receipt className="w-4 h-4 text-indigo-400" /> Current Cycle Quotas
						</h3>

						<div className="space-y-4">
							<div>
								<div className="flex justify-between text-xs mb-1">
									<span className="text-slate-400">Applications</span>
									<span className="text-slate-200 font-medium">3 / 10 Apps</span>
								</div>
								<div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
									<div className="h-full bg-indigo-500 rounded-full" style={{ width: "30%" }} />
								</div>
							</div>

							<div>
								<div className="flex justify-between text-xs mb-1">
									<span className="text-slate-400">RAM Quota</span>
									<span className="text-slate-200 font-medium">1.5GB / 4.0GB</span>
								</div>
								<div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
									<div className="h-full bg-cyan-500 rounded-full" style={{ width: "37.5%" }} />
								</div>
							</div>

							<div>
								<div className="flex justify-between text-xs mb-1">
									<span className="text-slate-400">Bandwidth (Monthly)</span>
									<span className="text-slate-200 font-medium">45GB / 500GB</span>
								</div>
								<div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
									<div className="h-full bg-emerald-500 rounded-full" style={{ width: "9%" }} />
								</div>
							</div>
						</div>

						<div className="pt-4 border-t border-slate-800 text-xs space-y-2 text-slate-400">
							<p className="flex justify-between">
								<span>Base Subscription:</span> <strong className="text-slate-200">$29.00</strong>
							</p>
							<p className="flex justify-between">
								<span>Custom Domains:</span> <strong className="text-slate-200">Included</strong>
							</p>
							<p className="flex justify-between">
								<span>SSL Certificates:</span> <strong className="text-slate-200">Free Auto-LE</strong>
							</p>
						</div>
					</div>
				</div>

				{/* Invoice History Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800 flex items-center justify-between">
						<div>
							<h3 className="text-base font-semibold text-white">Invoice History</h3>
							<p className="text-xs text-slate-400">Download past invoices and receipts for your accounting records.</p>
						</div>
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
								<tr>
									<th className="px-6 py-3.5 font-medium">Invoice ID</th>
									<th className="px-6 py-3.5 font-medium">Billing Date</th>
									<th className="px-6 py-3.5 font-medium">Amount</th>
									<th className="px-6 py-3.5 font-medium">Payment Method</th>
									<th className="px-6 py-3.5 font-medium">Status</th>
									<th className="px-6 py-3.5 font-medium text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/60 text-slate-300">
								{MOCK_INVOICES.map((inv) => (
									<tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
										<td className="px-6 py-4 font-mono font-medium text-white">{inv.id}</td>
										<td className="px-6 py-4">{inv.date}</td>
										<td className="px-6 py-4 font-semibold text-white">{inv.amount}</td>
										<td className="px-6 py-4 text-slate-400">{inv.method}</td>
										<td className="px-6 py-4">
											<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
												{inv.status}
											</span>
										</td>
										<td className="px-6 py-4 text-right">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => toast.success(`Downloading PDF receipt for ${inv.id}`)}
												className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40 text-xs h-7 gap-1"
											>
												<Download className="w-3.5 h-3.5" /> PDF Receipt
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}

BillingPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

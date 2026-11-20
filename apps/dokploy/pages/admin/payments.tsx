import Head from "next/head";
import { type ReactElement, useState, useEffect } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { toast } from "sonner";
import {
	CreditCard,
	ShieldCheck,
	Lock,
	CheckCircle,
	AlertCircle,
	Eye,
	EyeOff,
	Copy,
	Check,
	RefreshCw,
	Radio,
	DollarSign,
	ArrowUpRight,
	Smartphone,
	ExternalLink,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";

export default function AdminPaymentsPage() {
	const utils = api.useUtils();
	const { data: sonicSettings, isLoading: loadingSettings } = api.admin.getSonicPesaSettings.useQuery();
	const { data: payments, isLoading: loadingPayments, refetch: refetchPayments } = api.payment.adminList.useQuery({
		limit: 50,
		offset: 0,
	});

	const updateSettingsMutation = api.admin.updateSonicPesaSettings.useMutation();
	const testConnectionMutation = api.admin.testSonicPesaConnection.useMutation();
	const adminConfirmMutation = api.payment.adminConfirm.useMutation();

	// Form states
	const [enabled, setEnabled] = useState(true);
	const [mode, setMode] = useState<"live" | "sandbox">("live");
	const [apiKey, setApiKey] = useState("");
	const [apiSecret, setApiSecret] = useState("");
	const [baseUrl, setBaseUrl] = useState("https://api.sonicpesa.com/api/v1");

	const [showApiKey, setShowApiKey] = useState(false);
	const [showApiSecret, setShowApiSecret] = useState(false);
	const [copiedWebhook, setCopiedWebhook] = useState(false);

	const [testResult, setTestResult] = useState<{
		tested: boolean;
		success: boolean;
		message: string;
		latencyMs?: number;
	} | null>(null);

	// Sync fetched settings to form
	useEffect(() => {
		if (sonicSettings) {
			setEnabled(sonicSettings.enabled);
			setMode(sonicSettings.mode);
			setBaseUrl(sonicSettings.baseUrl || "https://api.sonicpesa.com/api/v1");
			if (sonicSettings.hasApiKey) {
				setApiKey(sonicSettings.maskedApiKey);
			}
			if (sonicSettings.hasApiSecret) {
				setApiSecret(sonicSettings.maskedApiSecret);
			}
		}
	}, [sonicSettings]);

	const webhookUrl = typeof window !== "undefined"
		? `${window.location.origin}/api/webhooks/sonicpesa`
		: `https://console.${brand.PLATFORM_SUBDOMAIN_BASE}/api/webhooks/sonicpesa`;

	const handleCopyWebhook = () => {
		navigator.clipboard.writeText(webhookUrl);
		setCopiedWebhook(true);
		toast.success("Webhook URL copied to clipboard!");
		setTimeout(() => setCopiedWebhook(false), 2000);
	};

	const handleSaveCredentials = async () => {
		try {
			await updateSettingsMutation.mutateAsync({
				enabled,
				mode,
				baseUrl: baseUrl.trim(),
				apiKey: apiKey.trim() || null,
				apiSecret: apiSecret.trim() || null,
			});
			await utils.admin.getSonicPesaSettings.invalidate();
			toast.success("SonicPesa gateway credentials securely saved!");
			setTestResult(null);
		} catch (err: any) {
			toast.error(err?.message || "Failed to update SonicPesa settings");
		}
	};

	const handleTestConnection = async () => {
		try {
			const res = await testConnectionMutation.mutateAsync({
				apiKey: apiKey.trim() || null,
				baseUrl: baseUrl.trim() || null,
				mode,
			});
			setTestResult({
				tested: true,
				success: res.success,
				message: res.message,
				latencyMs: res.latencyMs,
			});
			if (res.success) {
				toast.success(res.message);
			} else {
				toast.error(res.message);
			}
		} catch (err: any) {
			setTestResult({
				tested: true,
				success: false,
				message: err?.message || "Connection test failed",
			});
			toast.error(err?.message || "Connection test failed");
		}
	};

	const handleConfirmPayment = async (paymentId: string) => {
		try {
			await adminConfirmMutation.mutateAsync({
				paymentId,
				notes: "Manually verified and confirmed by platform administrator.",
			});
			toast.success("Payment marked as paid and subscription activated!");
			await refetchPayments();
		} catch (err: any) {
			toast.error(err?.message || "Failed to confirm payment");
		}
	};

	return (
		<>
			<Head>
				<title>Payment Gateways & SonicPesa - {brand.APP_NAME} Admin</title>
			</Head>

			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
								TANZANIA MOBILE MONEY & CARD RAILS
							</Badge>
						</div>
						<h1 className="text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2.5">
							<CreditCard className="w-6 h-6 text-emerald-400" />
							Payment Gateways & SonicPesa Setup
						</h1>
						<p className="text-slate-400 text-sm mt-0.5">
							Configure live API keys and webhook secrets for SonicPesa (M-Pesa, Tigo Pesa, Airtel Money, Halopesa) with hardware-grade security.
						</p>
					</div>

					<div className="flex items-center gap-3">
						<a
							href="https://dashboard.sonicpesa.com"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-600 transition-all"
						>
							SonicPesa Merchant Portal
							<ExternalLink className="w-3.5 h-3.5 opacity-60" />
						</a>
					</div>
				</div>

				{/* SonicPesa Gateway Settings Card */}
				<div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md p-6 sm:p-8 space-y-6 shadow-xl">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
						<div className="flex items-center gap-3">
							<div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
								<Smartphone className="w-6 h-6" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-lg font-bold text-white">SonicPesa Gateway Integration</h2>
									<Badge className={enabled ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "bg-slate-800 text-slate-400 border-slate-700"}>
										{enabled ? "ACTIVE" : "DISABLED"}
									</Badge>
									<Badge variant="outline" className="text-xs uppercase text-amber-400 border-amber-500/30">
										{mode} MODE
									</Badge>
								</div>
								<p className="text-xs text-slate-400 mt-0.5">
									Instant USSD push prompts for customer invoice settlements and automated subscription renewal.
								</p>
							</div>
						</div>

						{/* Gateway Toggle Switch */}
						<div className="flex items-center gap-3">
							<span className="text-xs font-medium text-slate-300">
								Gateway Status:
							</span>
							<button
								type="button"
								onClick={() => setEnabled(!enabled)}
								className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
									enabled ? "bg-emerald-500" : "bg-slate-700"
								}`}
							>
								<span
									className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
										enabled ? "translate-x-5" : "translate-x-0"
									}`}
								/>
							</button>
						</div>
					</div>

					{/* Form Fields */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* Operational Mode */}
						<div className="space-y-2">
							<label className="text-xs font-semibold text-slate-300 block">
								Operational Environment
							</label>
							<div className="grid grid-cols-2 gap-3">
								<button
									type="button"
									onClick={() => {
										setMode("live");
										if (baseUrl.includes("sandbox")) {
											setBaseUrl("https://api.sonicpesa.com/api/v1");
										}
									}}
									className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all text-left flex items-center justify-between ${
										mode === "live"
											? "border-emerald-500/60 bg-emerald-950/30 text-white shadow-sm"
											: "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
									}`}
								>
									<span>Production (Live USSD)</span>
									{mode === "live" && <Check className="w-4 h-4 text-emerald-400" />}
								</button>
								<button
									type="button"
									onClick={() => {
										setMode("sandbox");
										if (!baseUrl.includes("sandbox")) {
											setBaseUrl("https://sandbox.sonicpesa.com/api/v1");
										}
									}}
									className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all text-left flex items-center justify-between ${
										mode === "sandbox"
											? "border-amber-500/60 bg-amber-950/30 text-white shadow-sm"
											: "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
									}`}
								>
									<span>Sandbox (Test Mode)</span>
									{mode === "sandbox" && <Check className="w-4 h-4 text-amber-400" />}
								</button>
							</div>
							<p className="text-[11px] text-slate-500">
								Choose Live for production billing or Sandbox for staging mock test payments.
							</p>
						</div>

						{/* Base URL */}
						<div className="space-y-2">
							<label className="text-xs font-semibold text-slate-300 block">
								SonicPesa API Base URL
							</label>
							<Input
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder="https://api.sonicpesa.com/api/v1"
								className="bg-slate-950 border-slate-800 text-white font-mono text-xs focus:border-emerald-500"
							/>
							<p className="text-[11px] text-slate-500">
								Default API cluster endpoint URL for creating payment orders and checking status.
							</p>
						</div>

						{/* API Key */}
						<div className="space-y-2">
							<label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
								<span className="flex items-center gap-1.5">
									<Lock className="w-3.5 h-3.5 text-emerald-400" />
									SonicPesa API Key (X-API-KEY)
								</span>
								{sonicSettings?.hasApiKey && (
									<span className="text-[10px] text-emerald-400 font-medium">Configured in DB</span>
								)}
							</label>
							<div className="relative">
								<Input
									type={showApiKey ? "text" : "password"}
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder="Enter your SonicPesa API Key"
									className="bg-slate-950 border-slate-800 text-white font-mono text-xs pr-10 focus:border-emerald-500"
								/>
								<button
									type="button"
									onClick={() => setShowApiKey(!showApiKey)}
									className="absolute right-3 top-2.5 text-slate-400 hover:text-white transition-colors"
								>
									{showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
								</button>
							</div>
							<p className="text-[11px] text-slate-500">
								Secret authentication key used to authorize USSD payment push requests.
							</p>
						</div>

						{/* API Secret / Webhook Secret */}
						<div className="space-y-2">
							<label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
								<span className="flex items-center gap-1.5">
									<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
									SonicPesa API Secret (HMAC Webhook Secret)
								</span>
								{sonicSettings?.hasApiSecret && (
									<span className="text-[10px] text-emerald-400 font-medium">Configured in DB</span>
								)}
							</label>
							<div className="relative">
								<Input
									type={showApiSecret ? "text" : "password"}
									value={apiSecret}
									onChange={(e) => setApiSecret(e.target.value)}
									placeholder="Enter SonicPesa API Secret"
									className="bg-slate-950 border-slate-800 text-white font-mono text-xs pr-10 focus:border-emerald-500"
								/>
								<button
									type="button"
									onClick={() => setShowApiSecret(!showApiSecret)}
									className="absolute right-3 top-2.5 text-slate-400 hover:text-white transition-colors"
								>
									{showApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
								</button>
							</div>
							<p className="text-[11px] text-slate-500">
								Used for verifying incoming webhook signatures (<code className="text-slate-400">X-SonicPesa-Signature</code>) via HMAC SHA-256.
							</p>
						</div>
					</div>

					{/* Webhook Endpoint Box */}
					<div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-xs font-bold text-white flex items-center gap-1.5">
								<Radio className="w-3.5 h-3.5 text-emerald-400" />
								Your Platform Webhook Listener URL
							</span>
							<span className="text-[10px] text-slate-400">Copy to SonicPesa Merchant Dashboard</span>
						</div>
						<div className="flex items-center gap-2">
							<code className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-300 break-all select-all">
								{webhookUrl}
							</code>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={handleCopyWebhook}
								className="border-slate-700 hover:bg-slate-800 text-white shrink-0 text-xs gap-1.5"
							>
								{copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
								{copiedWebhook ? "Copied" : "Copy"}
							</Button>
						</div>
						<p className="text-[11px] text-slate-500">
							When customers approve their mobile money prompts, SonicPesa delivers real-time notifications to this endpoint to fulfill orders automatically.
						</p>
					</div>

					{/* Test Status Banner */}
					{testResult && (
						<div
							className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
								testResult.success
									? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
									: "bg-rose-950/30 border-rose-500/40 text-rose-300"
							}`}
						>
							{testResult.success ? (
								<CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
							) : (
								<AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
							)}
							<div>
								<div className="font-bold">
									{testResult.success ? "Connection Verified" : "Connection Failed"}
								</div>
								<div className="mt-0.5 leading-relaxed">{testResult.message}</div>
							</div>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
						<div className="flex items-center gap-2 text-xs text-slate-400">
							<ShieldCheck className="w-4 h-4 text-emerald-400" />
							<span>Secrets are stored encrypted in the database and never exposed to customers.</span>
						</div>

						<div className="flex items-center gap-3 w-full sm:w-auto justify-end">
							<Button
								type="button"
								variant="outline"
								onClick={handleTestConnection}
								disabled={testConnectionMutation.isPending || !apiKey}
								className="border-slate-700 hover:bg-slate-800 text-slate-200 text-xs gap-2"
							>
								{testConnectionMutation.isPending ? (
									<RefreshCw className="w-3.5 h-3.5 animate-spin" />
								) : (
									<Radio className="w-3.5 h-3.5 text-emerald-400" />
								)}
								Test SonicPesa Connection
							</Button>

							<Button
								type="button"
								onClick={handleSaveCredentials}
								disabled={updateSettingsMutation.isPending}
								className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-6 shadow-lg shadow-emerald-600/20"
							>
								{updateSettingsMutation.isPending ? "Saving..." : "Save Gateway Credentials"}
							</Button>
						</div>
					</div>
				</div>

				{/* Recent Payment Transactions Audit Table */}
				<div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5 shadow-xl">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
						<div>
							<h3 className="text-base font-bold text-white flex items-center gap-2">
								<DollarSign className="w-4 h-4 text-emerald-400" />
								Customer Payment Transactions & Mobile Money Settlements
							</h3>
							<p className="text-xs text-slate-400 mt-0.5">
								Audit trail of live mobile money push requests, settled invoices, and manual verification actions.
							</p>
						</div>

						<Button
							size="sm"
							variant="outline"
							onClick={() => refetchPayments()}
							className="border-slate-800 text-slate-300 text-xs gap-1.5 self-start sm:self-auto"
						>
							<RefreshCw className="w-3.5 h-3.5" />
							Refresh History
						</Button>
					</div>

					{loadingPayments ? (
						<div className="text-slate-400 text-sm py-12 text-center">
							Loading payment audit logs from PostgreSQL...
						</div>
					) : !payments || payments.length === 0 ? (
						<div className="text-slate-500 text-sm py-12 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
							No customer payment transactions recorded yet. When customers pay via SonicPesa or M-Pesa, transactions appear here in real-time.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
										<th className="pb-3 font-semibold">Date & Time</th>
										<th className="pb-3 font-semibold">Customer / Org</th>
										<th className="pb-3 font-semibold">Amount</th>
										<th className="pb-3 font-semibold">Provider & Reference</th>
										<th className="pb-3 font-semibold">Status</th>
										<th className="pb-3 font-semibold text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60">
									{payments.map((p) => (
										<tr key={p.id} className="hover:bg-slate-800/20 transition-colors">
											<td className="py-3 text-slate-400 font-mono">
												{new Date(p.createdAt).toLocaleString()}
											</td>
											<td className="py-3">
												<div className="font-semibold text-white">
													{p.organization?.name || "Organization"}
												</div>
												<div className="text-[11px] text-slate-500 font-mono">
													{p.payerIdentifier || "N/A"}
												</div>
											</td>
											<td className="py-3">
												<span className="font-bold text-white text-sm">
													{Number(p.amount).toLocaleString()} {p.currency}
												</span>
											</td>
											<td className="py-3 font-mono">
												<div className="text-slate-300 uppercase text-[11px] font-bold">
													{p.provider}
												</div>
												<div className="text-[10px] text-slate-500 truncate max-w-[180px]">
													{p.providerReference || p.providerTransactionId || "—"}
												</div>
											</td>
											<td className="py-3">
												{p.status === "succeeded" && (
													<Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
														SUCCEEDED
													</Badge>
												)}
												{p.status === "pending" && (
													<Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
														PENDING
													</Badge>
												)}
												{p.status === "failed" && (
													<Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">
														FAILED
													</Badge>
												)}
											</td>
											<td className="py-3 text-right">
												{p.status !== "succeeded" ? (
													<Button
														size="sm"
														variant="outline"
														onClick={() => handleConfirmPayment(p.id)}
														className="text-[11px] h-7 border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/40"
													>
														Mark as Paid
													</Button>
												) : (
													<span className="text-[11px] text-emerald-400 font-medium flex items-center justify-end gap-1">
														<CheckCircle className="w-3.5 h-3.5" /> Settled
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>
		</>
	);
}

AdminPaymentsPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

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


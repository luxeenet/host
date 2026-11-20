import Head from "next/head";
import { type ReactElement, useState, useEffect } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { toast } from "sonner";
import {
	Mail,
	Lock,
	CheckCircle,
	AlertCircle,
	Eye,
	EyeOff,
	Send,
	RefreshCw,
	Clock,
	Check,
	Sparkles,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";

export default function AdminNotificationsPage() {
	const utils = api.useUtils();
	const { data: smtpSettings } = api.admin.getSmtpSettings.useQuery();
	const { data: user } = api.user.get.useQuery();

	const updateSettingsMutation = api.admin.updateSmtpSettings.useMutation();
	const testConnectionMutation = api.admin.testSmtpConnection.useMutation();

	// Form states
	const [host, setHost] = useState("");
	const [port, setPort] = useState<number>(587);
	const [secure, setSecure] = useState<boolean>(false);
	const [userValue, setUserValue] = useState("");
	const [password, setPassword] = useState("");
	const [fromAddress, setFromAddress] = useState(brand.EMAIL_FROM || `notifications@${brand.PLATFORM_SUBDOMAIN_BASE}`);
	const [fromName, setFromName] = useState(brand.APP_NAME);
	const [showPassword, setShowPassword] = useState(false);

	// Test email states
	const [targetEmail, setTargetEmail] = useState("");
	const [testResult, setTestResult] = useState<{
		tested: boolean;
		success: boolean;
		message: string;
		latencyMs?: number;
	} | null>(null);

	// Sync fetched settings to form
	useEffect(() => {
		if (smtpSettings) {
			setHost(smtpSettings.host || "");
			setPort(smtpSettings.port || 587);
			setSecure(smtpSettings.secure ?? false);
			setUserValue(smtpSettings.user || "");
			setFromAddress(smtpSettings.from || brand.EMAIL_FROM || `notifications@${brand.PLATFORM_SUBDOMAIN_BASE}`);
			setFromName(smtpSettings.fromName || brand.APP_NAME);
			if (smtpSettings.hasPassword) {
				setPassword(smtpSettings.maskedPassword);
			}
		}
	}, [smtpSettings]);

	useEffect(() => {
		if (user && (user as any).email && !targetEmail) {
			setTargetEmail((user as any).email);
		}
	}, [user, targetEmail]);

	const handleSaveSmtp = async () => {
		try {
			await updateSettingsMutation.mutateAsync({
				host: host.trim() || null,
				port: Number(port) || 587,
				secure,
				user: userValue.trim() || null,
				pass: password.trim() || null,
				from: fromAddress.trim() || null,
				fromName: fromName.trim() || null,
			});
			await utils.admin.getSmtpSettings.invalidate();
			toast.success("SMTP relay configuration successfully saved!");
			setTestResult(null);
		} catch (err: any) {
			toast.error(err?.message || "Failed to update SMTP settings");
		}
	};

	const handleSendTestEmail = async () => {
		if (!targetEmail.trim()) {
			toast.error("Please enter a valid recipient email address for testing");
			return;
		}

		setTestResult(null);
		try {
			const res = await testConnectionMutation.mutateAsync({
				targetEmail: targetEmail.trim(),
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
				message: err?.message || "Failed to test SMTP connection",
			});
			toast.error(err?.message || "SMTP connection failed");
		}
	};

	const NOTIFICATION_CATALOG = [
		{
			title: "Account Email Verification",
			trigger: "New customer signs up or updates primary email address",
			template: "verify-email.tsx",
			status: "Active",
			category: "Onboarding",
		},
		{
			title: "Password Reset Requests",
			trigger: "User requests a secure password reset link",
			template: "auth.ts (HTML Engine)",
			status: "Active",
			category: "Security",
		},
		{
			title: "Organization Team Invitations",
			trigger: "Workspace administrator invites a collaborator or developer",
			template: "invitation.tsx",
			status: "Active",
			category: "Collaboration",
		},
		{
			title: "Subscription Invoices & Receipts",
			trigger: "Payment successfully settled via SonicPesa or card billing cycle",
			template: "invoice-notification.tsx",
			status: "Active",
			category: "Billing",
		},
		{
			title: "Payment Failure Alerts",
			trigger: "Recurring billing charge or mobile checkout attempt fails",
			template: "payment-failed.tsx",
			status: "Active",
			category: "Billing Risk",
		},
		{
			title: "Trial Period Expiration Warnings",
			trigger: "Dispatched 3 days and 1 day before trial period expires",
			template: "trial-expiring.tsx",
			status: "Active",
			category: "Lifecycle",
		},
		{
			title: "Billing Cycle & Suspension Notices",
			trigger: "Grace period, service pause, final termination notice, reactivation",
			template: "billing-cycle.ts",
			status: "Active",
			category: "Lifecycle",
		},
		{
			title: "Build & Deployment Alerts",
			trigger: "Application compilation finishes or encounters a build issue",
			template: "build-success.tsx / build-failed.tsx",
			status: "Active",
			category: "Operations",
		},
		{
			title: "Automated Backup Reports",
			trigger: "Scheduled database or persistent volume backup completes",
			template: "database-backup.tsx / volume-backup.tsx",
			status: "Active",
			category: "Data Integrity",
		},
	];

	return (
		<>
			<Head>
				<title>Email Delivery & SMTP - {brand.APP_NAME} Admin</title>
			</Head>

			<div className="space-y-8">
				{/* Top Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2">
							<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
								<Mail className="w-3 h-3 text-blue-400" />
								EMAIL DELIVERY ENGINE
							</span>
							<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
								TRANSACTIONAL NOTIFICATIONS
							</span>
						</div>
						<h1 className="text-2xl font-bold text-white tracking-tight mt-1.5">
							Platform Email Delivery & SMTP Relay
						</h1>
						<p className="text-slate-400 text-sm mt-0.5 max-w-2xl">
							Configure your transactional SMTP relay for all platform emails, customer verification, payment receipts, and automated operational alerts.
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Button
							variant="outline"
							size="sm"
							onClick={() => utils.admin.getSmtpSettings.invalidate()}
							className="border-slate-800 text-slate-300 hover:bg-slate-900 text-xs font-medium"
						>
							<RefreshCw className="w-3.5 h-3.5 mr-1.5" />
							Refresh
						</Button>
					</div>
				</div>

				{/* Active Status Overview Card */}
				<div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950 border border-slate-800 relative overflow-hidden">
					<div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-blue-500/10 to-transparent pointer-events-none" />
					<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
						<div className="flex items-start gap-4">
							<div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
								<Mail className="w-6 h-6 text-blue-400" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-base font-semibold text-white">Relay Status:</h2>
									{smtpSettings?.configured ? (
										<Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold px-2.5 py-0.5">
											<CheckCircle className="w-3 h-3 mr-1" />
											Configured & Operational
										</Badge>
									) : (
										<Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs font-semibold px-2.5 py-0.5">
											<AlertCircle className="w-3 h-3 mr-1" />
											Pending SMTP Credentials
										</Badge>
									)}
								</div>
								<p className="text-xs text-slate-400 mt-1">
									Sender: <span className="text-slate-200 font-mono">{smtpSettings?.from || brand.EMAIL_FROM || "Not Set"}</span> | Host:{" "}
									<span className="text-slate-200 font-mono">{smtpSettings?.host || "Not Set"}:{smtpSettings?.port || 587}</span>
								</p>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
							<div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800">
								<span className="text-slate-500 block text-[10px] uppercase font-semibold">Security Protocol</span>
								<span className="text-white font-medium">{secure ? "SSL / TLS (Port 465)" : "STARTTLS (Port 587)"}</span>
							</div>
							<div className="px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800">
								<span className="text-slate-500 block text-[10px] uppercase font-semibold">Authenticated User</span>
								<span className="text-white font-medium">{smtpSettings?.user ? smtpSettings.user : "Anonymous / None"}</span>
							</div>
						</div>
					</div>
				</div>

				{/* Two-Column Form & Live Test Section */}
				<div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
					{/* Left: Configuration Form (7 cols) */}
					<div className="lg:col-span-7 space-y-6">
						<div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
							<div className="border-b border-slate-800 pb-4">
								<h2 className="text-base font-semibold text-white flex items-center gap-2">
									<Lock className="w-4 h-4 text-blue-400" />
									SMTP Connection Settings
								</h2>
								<p className="text-xs text-slate-400 mt-0.5">
									Configure your custom mail relay (Resend, SendGrid, Mailgun, Amazon SES, or custom SMTP server).
								</p>
							</div>

							<div className="space-y-4">
								{/* Host & Port */}
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div className="md:col-span-2 space-y-1.5">
										<label className="text-xs font-semibold text-slate-300">
											SMTP Host <span className="text-red-400">*</span>
										</label>
										<Input
											placeholder="smtp.resend.com"
											value={host}
											onChange={(e) => setHost(e.target.value)}
											className="bg-slate-950/60 border-slate-800 text-white font-mono text-xs h-10"
										/>
									</div>

									<div className="space-y-1.5">
										<label className="text-xs font-semibold text-slate-300">
											Port <span className="text-red-400">*</span>
										</label>
										<Input
											type="number"
											placeholder="587"
											value={port}
											onChange={(e) => setPort(Number(e.target.value))}
											className="bg-slate-950/60 border-slate-800 text-white font-mono text-xs h-10"
										/>
									</div>
								</div>

								{/* SSL / TLS Option */}
								<div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80">
									<div>
										<span className="text-xs font-semibold text-white block">Direct SSL/TLS Connection</span>
										<span className="text-[11px] text-slate-400 block">
											Enable direct SSL/TLS (typically port 465). For port 587, leave unchecked for STARTTLS upgrade.
										</span>
									</div>
									<input
										type="checkbox"
										id="secure-toggle"
										checked={secure}
										onChange={(e) => setSecure(e.target.checked)}
										className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
									/>
								</div>

								{/* Username & Password */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="space-y-1.5">
										<label className="text-xs font-semibold text-slate-300">
											SMTP Username
										</label>
										<Input
											placeholder="resend / apiKey / user@domain.com"
											value={userValue}
											onChange={(e) => setUserValue(e.target.value)}
											className="bg-slate-950/60 border-slate-800 text-white text-xs h-10"
										/>
									</div>

									<div className="space-y-1.5">
										<div className="flex items-center justify-between">
											<label className="text-xs font-semibold text-slate-300">
												SMTP Password / API Key
											</label>
											{smtpSettings?.hasPassword && (
												<span className="text-[10px] text-emerald-400 flex items-center gap-1">
													<Check className="w-3 h-3" /> Password stored securely
												</span>
											)}
										</div>
										<div className="relative">
											<Input
												type={showPassword ? "text" : "password"}
												placeholder="••••••••••••••••"
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												className="bg-slate-950/60 border-slate-800 text-white font-mono text-xs h-10 pr-10"
											/>
											<button
												type="button"
												onClick={() => setShowPassword(!showPassword)}
												className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
											>
												{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
											</button>
										</div>
									</div>
								</div>

								{/* Sender "From" & From Name */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="space-y-1.5">
										<label className="text-xs font-semibold text-slate-300">
											From Sender Address <span className="text-red-400">*</span>
										</label>
										<Input
											placeholder={`notifications@${brand.PLATFORM_SUBDOMAIN_BASE}`}
											value={fromAddress}
											onChange={(e) => setFromAddress(e.target.value)}
											className="bg-slate-950/60 border-slate-800 text-white text-xs h-10"
										/>
										<span className="text-[10px] text-slate-500">Verified outgoing sender address.</span>
									</div>

									<div className="space-y-1.5">
										<label className="text-xs font-semibold text-slate-300">
											From Display Name
										</label>
										<Input
											placeholder={brand.APP_NAME}
											value={fromName}
											onChange={(e) => setFromName(e.target.value)}
											className="bg-slate-950/60 border-slate-800 text-white text-xs h-10"
										/>
										<span className="text-[10px] text-slate-500">Display name seen by email recipients.</span>
									</div>
								</div>
							</div>

							<div className="pt-2 flex items-center justify-between border-t border-slate-800">
								<span className="text-xs text-slate-500">Changes take effect immediately across all services.</span>
								<Button
									onClick={handleSaveSmtp}
									disabled={updateSettingsMutation.isPending}
									className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-6 h-10 shadow-lg shadow-blue-600/20"
								>
									{updateSettingsMutation.isPending ? (
										<>
											<RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
											Saving...
										</>
									) : (
										"Save SMTP Relay Configuration"
									)}
								</Button>
							</div>
						</div>
					</div>

					{/* Right: Live Test & Diagnostics (5 cols) */}
					<div className="lg:col-span-5 space-y-6">
						<div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
							<div>
								<h2 className="text-base font-semibold text-white flex items-center gap-2">
									<Send className="w-4 h-4 text-emerald-400" />
									Live Diagnostic Test
								</h2>
								<p className="text-xs text-slate-400 mt-0.5">
									Verify your SMTP credentials and delivery by sending a live, styled test notification.
								</p>
							</div>

							<div className="space-y-3">
								<label className="text-xs font-semibold text-slate-300">
									Recipient Test Email Address
								</label>
								<div className="flex gap-2">
									<Input
										type="email"
										placeholder="admin@example.com"
										value={targetEmail}
										onChange={(e) => setTargetEmail(e.target.value)}
										className="bg-slate-950/60 border-slate-800 text-white text-xs h-10"
									/>
									<Button
										onClick={handleSendTestEmail}
										disabled={testConnectionMutation.isPending || !targetEmail}
										className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shrink-0 px-4 h-10 shadow-lg shadow-emerald-600/20"
									>
										{testConnectionMutation.isPending ? (
											<RefreshCw className="w-3.5 h-3.5 animate-spin" />
										) : (
											<>
												<Send className="w-3.5 h-3.5 mr-1.5" />
												Test
											</>
										)}
									</Button>
								</div>
								<span className="text-[11px] text-slate-500 block">
									Dispatches a live HTML email formatted with {brand.APP_NAME} branding and verifies the SMTP handshake.
								</span>
							</div>

							{testResult && (
								<div
									className={`p-4 rounded-xl border ${
										testResult.success
											? "bg-emerald-950/30 border-emerald-500/40 text-emerald-200"
											: "bg-red-950/30 border-red-500/40 text-red-200"
									} text-xs space-y-2`}
								>
									<div className="flex items-center gap-2 font-semibold">
										{testResult.success ? (
											<CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
										) : (
											<AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
										)}
										<span>{testResult.success ? "Connection Verified!" : "Connection Failed"}</span>
									</div>
									<p className="text-slate-300 text-xs leading-relaxed">{testResult.message}</p>
									{testResult.latencyMs !== undefined && testResult.latencyMs > 0 && (
										<div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1">
											<Clock className="w-3.5 h-3.5" />
											Handshake Latency: <span className="font-mono text-white">{testResult.latencyMs}ms</span>
										</div>
									)}
								</div>
							)}

							{/* Quick Provider Help */}
							<div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs text-slate-400 space-y-2">
								<span className="text-white font-semibold block text-[11px] uppercase tracking-wider">
									Recommended SMTP Providers:
								</span>
								<ul className="space-y-1 text-[11px]">
									<li>
										<span className="text-slate-200 font-medium">Resend:</span> Host: <code className="text-blue-400">smtp.resend.com</code>, Port: 587, User: <code className="text-slate-300">resend</code>
									</li>
									<li>
										<span className="text-slate-200 font-medium">SendGrid:</span> Host: <code className="text-blue-400">smtp.sendgrid.net</code>, Port: 587, User: <code className="text-slate-300">apikey</code>
									</li>
									<li>
										<span className="text-slate-200 font-medium">Amazon SES:</span> Host: <code className="text-blue-400">email-smtp.*.amazonaws.com</code>, Port: 587
									</li>
								</ul>
							</div>
						</div>
					</div>
				</div>

				{/* System Transactional Notification Catalog */}
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
								<Sparkles className="w-4 h-4 text-amber-400" />
								System Notification Registry
							</h2>
							<p className="text-xs text-slate-400">
								All 9 platform transactional notifications are fully branded with {brand.APP_NAME} and automatically route through your active relay.
							</p>
						</div>
						<Badge className="bg-slate-800 text-slate-300 border-slate-700 text-xs">
							9 / 9 Templates Active
						</Badge>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{NOTIFICATION_CATALOG.map((item, idx) => (
							<div
								key={idx}
								className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition-all space-y-2.5"
							>
								<div className="flex items-center justify-between">
									<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
										{item.category}
									</span>
									<span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
										<CheckCircle className="w-3 h-3" />
										{item.status}
									</span>
								</div>
								<div>
									<h3 className="text-sm font-semibold text-white leading-tight">{item.title}</h3>
									<p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.trigger}</p>
								</div>
								<div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
									<span>{item.template}</span>
									<span className="text-slate-400 font-sans text-[10px]">HTML & PlainText</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

AdminNotificationsPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

export async function getServerSideProps(context: GetServerSidePropsContext) {
	const { user } = await validateRequest(context.req);
	if (!user) {
		return {
			redirect: {
				destination: "/login",
				permanent: false,
			},
		};
	}

	if (!user.isPlatformAdmin) {
		return {
			redirect: {
				destination: "/dashboard",
				permanent: false,
			},
		};
	}

	return {
		props: {},
	};
}

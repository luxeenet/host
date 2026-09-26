import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	User,
	Key,
	Shield,
	Mail,
	Lock,
	Copy,
	Check,
	RefreshCw,
	Plus,
	Trash2,
	Users,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

export default function AccountPage() {
	const [name, setName] = useState("Platform Developer");
	const [email, setEmail] = useState("dev@company.tld");
	const [apiKey, setApiKey] = useState("paas_live_9a8f7c6e5d4c3b2a1");
	const [copiedKey, setCopiedKey] = useState(false);
	const [generating, setGenerating] = useState(false);

	const handleCopyKey = () => {
		navigator.clipboard.writeText(apiKey);
		setCopiedKey(true);
		toast.success("API key copied to clipboard!");
		setTimeout(() => setCopiedKey(false), 2000);
	};

	const handleRegenerateKey = () => {
		setGenerating(true);
		setTimeout(() => {
			const newKey = "paas_live_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
			setApiKey(newKey);
			setGenerating(false);
			toast.success("New API key generated successfully!");
		}, 1000);
	};

	return (
		<>
			<Head>
				<title>Account & Security Settings - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8 max-w-4xl">
				{/* Page Header */}
				<div>
					<h1 className="text-2xl font-bold text-white tracking-tight">Account & Security</h1>
					<p className="text-slate-400 text-sm mt-1">
						Manage your profile, team access, API access keys, and security settings.
					</p>
				</div>

				{/* Profile Settings Card */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
					<div className="flex items-center gap-3 border-b border-slate-800 pb-4">
						<div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
							<User className="w-5 h-5 text-white" />
						</div>
						<div>
							<h3 className="text-base font-bold text-white">Profile Details</h3>
							<p className="text-xs text-slate-400">Your personal customer account details.</p>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label className="text-xs font-medium text-slate-300 block mb-1">Full Name</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
							/>
						</div>
						<div>
							<label className="text-xs font-medium text-slate-300 block mb-1">Email Address</label>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
							/>
						</div>
					</div>

					<div className="flex justify-end pt-2">
						<Button
							onClick={() => toast.success("Profile details updated!")}
							className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-5"
						>
							Save Profile
						</Button>
					</div>
				</div>

				{/* API Access Tokens Card */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
					<div className="flex items-center justify-between border-b border-slate-800 pb-4">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center shrink-0">
								<Key className="w-5 h-5 text-cyan-400" />
							</div>
							<div>
								<h3 className="text-base font-bold text-white">API Access Tokens</h3>
								<p className="text-xs text-slate-400">Use API keys for automated deployments & CI/CD workflows.</p>
							</div>
						</div>

						<Button
							disabled={generating}
							onClick={handleRegenerateKey}
							variant="outline"
							className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5"
						>
							{generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />}
							Roll Key
						</Button>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-medium text-slate-300 block">Production API Secret Key</label>
						<div className="flex items-center gap-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
							<code className="text-xs text-cyan-300 font-mono flex-1">{apiKey}</code>
							<button
								type="button"
								onClick={handleCopyKey}
								className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
							>
								{copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
							</button>
						</div>
					</div>
				</div>

				{/* Security & Password */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
					<div className="flex items-center gap-3 border-b border-slate-800 pb-4">
						<div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center shrink-0">
							<Shield className="w-5 h-5 text-emerald-400" />
						</div>
						<div>
							<h3 className="text-base font-bold text-white">Security & 2FA</h3>
							<p className="text-xs text-slate-400">Protect your account with Two-Factor Authentication.</p>
						</div>
					</div>

					<div className="flex items-center justify-between p-4 rounded-lg bg-slate-950 border border-slate-800">
						<div>
							<p className="text-xs font-bold text-white">Two-Factor Authentication (TOTP)</p>
							<p className="text-[11px] text-slate-400 mt-0.5">Add an extra layer of security using Google Authenticator or 1Password.</p>
						</div>
						<Button
							variant="outline"
							onClick={() => toast.info("2FA Setup QR code generated")}
							className="border-slate-800 text-emerald-400 hover:bg-slate-800 text-xs"
						>
							Enable 2FA
						</Button>
					</div>
				</div>
			</div>
		</>
	);
}

AccountPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

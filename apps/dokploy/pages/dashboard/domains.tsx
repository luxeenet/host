import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Globe,
	Plus,
	CheckCircle,
	AlertCircle,
	RefreshCw,
	Lock,
	ExternalLink,
	ShieldCheck,
	Trash2,
	Copy,
	Check,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_DOMAINS = [
	{
		id: "dom-01",
		domain: "api.mycompany.com",
		appName: "production-backend-api",
		sslStatus: "ISSUED",
		dnsVerified: true,
		createdAt: "3 days ago",
	},
	{
		id: "dom-02",
		domain: "app.mycompany.com",
		appName: "frontend-nextjs-app",
		sslStatus: "ISSUED",
		dnsVerified: true,
		createdAt: "5 days ago",
	},
];

export default function CustomDomainsPage() {
	const [domains, setDomains] = useState(MOCK_DOMAINS);
	const [showAddModal, setShowAddModal] = useState(false);
	const [newDomain, setNewDomain] = useState("");
	const [selectedApp, setSelectedApp] = useState("frontend-nextjs-app");
	const [isAdding, setIsAdding] = useState(false);
	const [copiedDns, setCopiedDns] = useState(false);

	const handleAddDomain = () => {
		if (!newDomain) {
			toast.error("Please enter a valid domain name");
			return;
		}
		setIsAdding(true);
		setTimeout(() => {
			const added = {
				id: `dom-${Date.now()}`,
				domain: newDomain.toLowerCase().trim(),
				appName: selectedApp,
				sslStatus: "PENDING_DNS",
				dnsVerified: false,
				createdAt: "Just now",
			};
			setDomains([added, ...domains]);
			setIsAdding(false);
			setShowAddModal(false);
			setNewDomain("");
			toast.success(`Domain ${newDomain} added! Please point your DNS CNAME record.`);
		}, 1200);
	};

	const copyRecord = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedDns(true);
		toast.success("DNS record copied to clipboard!");
		setTimeout(() => setCopiedDns(false), 2000);
	};

	return (
		<>
			<Head>
				<title>Custom Domains & Auto-SSL - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Custom Domains & Auto-SSL</h1>
						<p className="text-slate-400 text-sm mt-1">
							Attach your own custom domains with automated Let's Encrypt SSL certificates.
						</p>
					</div>

					<Button
						onClick={() => setShowAddModal(true)}
						className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-2 shrink-0 shadow-lg shadow-indigo-600/20"
					>
						<Plus className="w-4 h-4" /> Add Custom Domain
					</Button>
				</div>

				{/* DNS Instructions Banner */}
				<div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 space-y-4">
					<div className="flex items-center gap-3 border-b border-slate-800 pb-3">
						<div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center shrink-0">
							<Globe className="w-5 h-5 text-cyan-400" />
						</div>
						<div>
							<h3 className="text-sm font-bold text-white">DNS CNAME Routing Instructions</h3>
							<p className="text-xs text-slate-400">Point your domain's DNS record at your provider (Cloudflare, GoDaddy, Namecheap)</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
							<span className="text-slate-500 text-[10px] uppercase font-semibold">Record Type</span>
							<p className="text-white font-mono font-bold">CNAME Record</p>
						</div>
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
							<span className="text-slate-500 text-[10px] uppercase font-semibold">Host / Name</span>
							<p className="text-white font-mono font-bold">app (or @ for root)</p>
						</div>
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1 flex items-center justify-between">
							<div>
								<span className="text-slate-500 text-[10px] uppercase font-semibold">Target / Value</span>
								<p className="text-indigo-300 font-mono font-bold truncate">cname.{brand.PLATFORM_SUBDOMAIN_BASE}</p>
							</div>
							<button
								type="button"
								onClick={() => copyRecord(`cname.${brand.PLATFORM_SUBDOMAIN_BASE}`)}
								className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white shrink-0"
							>
								{copiedDns ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
							</button>
						</div>
					</div>
				</div>

				{/* Add Domain Modal Form */}
				{showAddModal && (
					<div className="p-6 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-4 shadow-2xl">
						<h3 className="text-base font-bold text-white flex items-center gap-2">
							<Plus className="w-4 h-4 text-indigo-400" /> Attach Custom Domain
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-medium text-slate-300 block mb-1">Domain Name</label>
								<input
									type="text"
									value={newDomain}
									onChange={(e) => setNewDomain(e.target.value)}
									placeholder="e.g. app.yourcompany.com"
									className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
								/>
							</div>
							<div>
								<label className="text-xs font-medium text-slate-300 block mb-1">Route to Application</label>
								<select
									value={selectedApp}
									onChange={(e) => setSelectedApp(e.target.value)}
									className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-indigo-500"
								>
									<option value="frontend-nextjs-app">frontend-nextjs-app</option>
									<option value="production-backend-api">production-backend-api</option>
								</select>
							</div>
						</div>
						<div className="flex justify-end gap-3 pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowAddModal(false)}
								className="border-slate-800 text-slate-300 text-xs"
							>
								Cancel
							</Button>
							<Button
								disabled={isAdding}
								onClick={handleAddDomain}
								className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-5"
							>
								{isAdding ? "Attaching Domain..." : "Attach Domain"}
							</Button>
						</div>
					</div>
				)}

				{/* Domains List */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800">
						<h3 className="text-base font-semibold text-white">Your Attached Custom Domains</h3>
						<p className="text-xs text-slate-400">All domains automatically provision Let's Encrypt TLS certificates.</p>
					</div>

					<div className="divide-y divide-slate-800/60 text-slate-300">
						{domains.map((dom) => (
							<div
								key={dom.id}
								className="p-5 hover:bg-slate-800/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
							>
								<div className="space-y-1">
									<div className="flex items-center gap-2.5">
										<Globe className="w-4 h-4 text-indigo-400 shrink-0" />
										<a
											href={`https://${dom.domain}`}
											target="_blank"
											rel="noopener noreferrer"
											className="text-sm font-bold text-white hover:text-indigo-300 flex items-center gap-1.5"
										>
											{dom.domain} <ExternalLink className="w-3 h-3 text-slate-500" />
										</a>
										<span
											className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
												dom.sslStatus === "ISSUED"
													? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
													: "bg-amber-500/20 text-amber-300 border border-amber-500/30"
											}`}
										>
											<ShieldCheck className="w-3 h-3" />
											{dom.sslStatus === "ISSUED" ? "SSL Active" : "Verifying DNS"}
										</span>
									</div>
									<p className="text-xs text-slate-400">
										Routed to <code className="text-indigo-300 font-mono">{dom.appName}</code> • Attached {dom.createdAt}
									</p>
								</div>

								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => toast.success(`DNS check executed for ${dom.domain}`)}
										className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
									>
										<RefreshCw className="w-3.5 h-3.5 text-indigo-400" /> Re-check DNS
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setDomains(domains.filter((d) => d.id !== dom.id));
											toast.success(`Domain ${dom.domain} detached.`);
										}}
										className="text-slate-500 hover:text-red-400 hover:bg-red-950/20 h-8 w-8 p-0"
									>
										<Trash2 className="w-4 h-4" />
									</Button>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

CustomDomainsPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

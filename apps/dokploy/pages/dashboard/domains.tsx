import Head from "next/head";
import Link from "next/link";
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
	Loader2,
	Star,
} from "lucide-react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { DialogAction } from "@/components/shared/dialog-action";
import { api } from "@/utils/api";

export default function CustomDomainsPage() {
	const { data: domains, refetch: refetchDomains, isLoading: isLoadingDomains } =
		api.domain.all.useQuery();
	const { data: projects } = api.project.all.useQuery();
	const { data: ip } = api.settings.getIp.useQuery();
	const { mutateAsync: createDomain, isPending: isAdding } =
		api.domain.create.useMutation();
	const { mutateAsync: deleteDomain } = api.domain.delete.useMutation();
	const { mutateAsync: setPrimaryDomain, isPending: isSettingPrimary } =
		api.domain.setPrimary.useMutation();
	const { mutateAsync: activateHttps, isPending: isActivating } =
		api.domain.activateHttps.useMutation();
	const { mutateAsync: validateDomain } =
		api.domain.validateDomain.useMutation();

	const [showAddModal, setShowAddModal] = useState(false);
	const [newDomain, setNewDomain] = useState("");
	const [selectedAppId, setSelectedAppId] = useState<string>("");
	const [copiedDns, setCopiedDns] = useState(false);
	const [checkingHost, setCheckingHost] = useState<string | null>(null);

	// Extract all user applications across projects
	const applicationsList = (projects || []).flatMap((p) =>
		(p.environments || []).flatMap((e) =>
			(e.applications || []).map((a) => ({
				applicationId: a.applicationId,
				name: a.name,
				projectId: p.projectId,
				environmentId: e.environmentId,
			})),
		),
	);

	const activeAppId = selectedAppId || applicationsList[0]?.applicationId || "";
	const serverIp = ip?.toString() || "";

	const handleAddDomain = async () => {
		const cleanDomain = newDomain.toLowerCase().trim();
		if (!cleanDomain) {
			toast.error("Please enter a valid domain name");
			return;
		}
		if (!activeAppId) {
			toast.error("Please select an application to route this domain to");
			return;
		}

		try {
			await createDomain({
				host: cleanDomain,
				domainType: "application",
				applicationId: activeAppId,
				https: false,
				certificateType: "none",
				port: 3000,
				path: "/",
			});
			await refetchDomains();
			setShowAddModal(false);
			setNewDomain("");
			toast.success(
				`Domain ${cleanDomain} attached! Please configure your DNS A record to point to ${serverIp || "this server"}.`,
			);
		} catch (error: any) {
			toast.error(error?.message || "Error attaching domain");
		}
	};

	const handleCheckDns = async (host: string) => {
		setCheckingHost(host);
		try {
			const res = await validateDomain({ domain: host });
			if (res.isValid) {
				toast.success(`DNS for ${host} is properly configured!`);
			} else {
				toast.error(
					res.error ||
						`DNS not pointing to server yet (${res.resolvedIp || "no records"}).`,
				);
			}
		} catch (err: any) {
			toast.error(err?.message || "Failed to validate DNS");
		} finally {
			setCheckingHost(null);
		}
	};

	const handleActivateHttps = async (domainId: string, host: string) => {
		try {
			const res = await activateHttps({ domainId });
			toast.success(res.message || `HTTPS activated for ${host}`);
			await refetchDomains();
		} catch (err: any) {
			toast.error(err?.message || "Failed to activate HTTPS");
		}
	};

	const handleSetPrimary = async (domainId: string, host: string) => {
		try {
			await setPrimaryDomain({ domainId });
			toast.success(`Domain ${host} is now the primary domain.`);
			await refetchDomains();
		} catch (err: any) {
			toast.error(err?.message || "Failed to set primary domain");
		}
	};

	const handleDeleteDomain = async (domainId: string, host: string) => {
		try {
			await deleteDomain({ domainId });
			toast.success(`Domain ${host} removed.`);
			await refetchDomains();
		} catch (err: any) {
			toast.error(err?.message || "Failed to delete domain");
		}
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
							<h3 className="text-sm font-bold text-white">DNS Routing Instructions</h3>
							<p className="text-xs text-slate-400">Point your domain's DNS record at your domain provider (Cloudflare, GoDaddy, Namecheap)</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
							<span className="text-slate-500 text-[10px] uppercase font-semibold">Record Type</span>
							<p className="text-white font-mono font-bold">A Record</p>
						</div>
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
							<span className="text-slate-500 text-[10px] uppercase font-semibold">Host / Name</span>
							<p className="text-white font-mono font-bold">@ (or subdomain name)</p>
						</div>
						<div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1 flex items-center justify-between">
							<div>
								<span className="text-slate-500 text-[10px] uppercase font-semibold">Target / Value</span>
								<p className="text-indigo-300 font-mono font-bold truncate">{serverIp || "Your Server IP"}</p>
							</div>
							<button
								type="button"
								onClick={() => copyRecord(serverIp)}
								disabled={!serverIp}
								className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white shrink-0 disabled:opacity-40"
							>
								{copiedDns ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
							</button>
						</div>
					</div>
					<p className="text-xs text-slate-400 pt-1">
						Tip: Subdomains can also use a CNAME pointing to your server's platform host. Once DNS propagation finishes, automatic Let's Encrypt TLS will be activated.
					</p>
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
									value={activeAppId}
									onChange={(e) => setSelectedAppId(e.target.value)}
									className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-indigo-500"
								>
									{applicationsList.length === 0 ? (
										<option value="">No applications found</option>
									) : (
										applicationsList.map((app) => (
											<option key={app.applicationId} value={app.applicationId}>
												{app.name}
											</option>
										))
									)}
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
								disabled={isAdding || !activeAppId}
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
						<p className="text-xs text-slate-400">All domains automatically provision Let's Encrypt TLS certificates once DNS points to the server.</p>
					</div>

					{isLoadingDomains ? (
						<div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
							<Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
							Loading domains...
						</div>
					) : !domains || domains.length === 0 ? (
						<div className="p-12 text-center text-slate-400 text-sm">
							No domains attached yet. Click &quot;Add Custom Domain&quot; above to connect your first domain.
						</div>
					) : (
						<div className="divide-y divide-slate-800/60 text-slate-300">
							{domains.map((dom) => (
								<div
									key={dom.domainId}
									className="p-5 hover:bg-slate-800/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
								>
									<div className="space-y-1">
										<div className="flex items-center gap-2.5 flex-wrap">
											<Globe className="w-4 h-4 text-indigo-400 shrink-0" />
											<a
												href={`${dom.https ? "https" : "http"}://${dom.host}${dom.path || ""}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-sm font-bold text-white hover:text-indigo-300 flex items-center gap-1.5"
											>
												{dom.host} <ExternalLink className="w-3 h-3 text-slate-500" />
											</a>
											{dom.isPrimary && (
												<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
													<Star className="w-3 h-3 fill-indigo-400 text-indigo-400" />
													Primary
												</span>
											)}
											<span
												className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
													dom.https
														? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
														: "bg-amber-500/20 text-amber-300 border border-amber-500/30"
												}`}
											>
												<ShieldCheck className="w-3 h-3" />
												{dom.https ? "SSL Active" : "HTTP Only"}
											</span>
										</div>
										<p className="text-xs text-slate-400">
											Routed to{" "}
											{dom.applicationId && dom.projectId && dom.environmentId ? (
												<Link
													href={`/dashboard/project/${dom.projectId}/environment/${dom.environmentId}/services/application/${dom.applicationId}`}
													className="text-indigo-300 font-mono hover:underline"
												>
													{dom.appName || dom.serviceName}
												</Link>
											) : (
												<code className="text-indigo-300 font-mono">{dom.appName || dom.serviceName}</code>
											)}
											{" "}• Port {dom.port || 3000} • Created {new Date(dom.createdAt).toLocaleDateString()}
										</p>
									</div>

									<div className="flex items-center gap-2 flex-wrap">
										{!dom.isPrimary && (
											<Button
												variant="outline"
												size="sm"
												disabled={isSettingPrimary}
												onClick={() => handleSetPrimary(dom.domainId, dom.host)}
												className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
											>
												<Star className="w-3.5 h-3.5 text-amber-400" /> Set as Primary
											</Button>
										)}
										{!dom.https && (
											<Button
												variant="outline"
												size="sm"
												disabled={isActivating}
												onClick={() => handleActivateHttps(dom.domainId, dom.host)}
												className="border-emerald-800/60 text-emerald-400 hover:bg-emerald-950/20 text-xs gap-1.5 h-8"
											>
												<ShieldCheck className="w-3.5 h-3.5" /> Activate HTTPS
											</Button>
										)}
										<Button
											variant="outline"
											size="sm"
											disabled={checkingHost === dom.host}
											onClick={() => handleCheckDns(dom.host)}
											className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
										>
											{checkingHost === dom.host ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
											) : (
												<RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
											)}
											Re-check DNS
										</Button>
										<DialogAction
											title={`Remove domain ${dom.host}?`}
											description="Are you sure you want to remove this domain? Web traffic will stop routing to your application and the SSL certificate will be removed."
											type="destructive"
											onClick={() => handleDeleteDomain(dom.domainId, dom.host)}
										>
											<Button
												variant="ghost"
												size="sm"
												className="text-slate-500 hover:text-red-400 hover:bg-red-950/20 h-8 w-8 p-0"
											>
												<Trash2 className="w-4 h-4" />
											</Button>
										</DialogAction>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</>
	);
}

CustomDomainsPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Custom Domains">{page}</DashboardLayout>
);

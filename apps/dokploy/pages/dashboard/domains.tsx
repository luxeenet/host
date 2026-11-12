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
	Cloud,
} from "lucide-react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { DialogAction } from "@/components/shared/dialog-action";
import { DnsHelperModal } from "@/components/dashboard/application/domains/dns-helper-modal";
import { api } from "@/utils/api";

export default function CustomDomainsPage() {
	const { data: auth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean((auth as any)?.user?.isPlatformAdmin || (auth as any)?.isPlatformAdmin);
	const { data: domains, refetch: refetchDomains, isLoading: isLoadingDomains } =
		api.domain.all.useQuery();
	const { data: projects } = api.project.all.useQuery();
	const { data: ip } = api.settings.getIp.useQuery();
	const { mutateAsync: createDomain, isPending: isAdding } =
		api.domain.create.useMutation();
	const { mutateAsync: deleteDomain } = api.domain.delete.useMutation();
	const { mutateAsync: setPrimaryDomain, isPending: isSettingPrimary } =
		api.domain.setPrimary.useMutation();
	const { mutateAsync: validateDomain } =
		api.domain.validateDomain.useMutation();
	const { mutateAsync: activateHttps, isPending: isActivating } =
		api.domain.activateHttps.useMutation();
	const { mutateAsync: recheckCloudflare, isPending: isRecheckingCf } =
		api.domain.recheckCloudflareStatus.useMutation();
	const { mutateAsync: retryCloudflare, isPending: isRetryingCf } =
		api.domain.retryCloudflareProvisioning.useMutation();

	const handleRecheckCf = async (domainId: string, host: string) => {
		try {
			const res = await recheckCloudflare({ domainId });
			toast.success(`Domain status updated: ${res.lifecycle.stageName}`);
			await refetchDomains();
		} catch (err: any) {
			toast.error(err?.message || "Failed to refresh domain status");
		}
	};

	const handleRetryCf = async (domainId: string, host: string) => {
		try {
			const res = await retryCloudflare({ domainId });
			toast.success(`SSL provisioning retried: ${res.lifecycle.stageName}`);
			await refetchDomains();
		} catch (err: any) {
			toast.error(err?.message || "Failed to retry SSL provisioning");
		}
	};

	const getCloudflareStageBadge = (dom: any) => {
		if (!dom.cfHostnameId && !dom.cfStatus) return null;
		if (dom.cfStatus === "active" && dom.cfSslStatus === "active") {
			return (
				<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
					<Lock className="w-3 h-3 text-emerald-400" />
					Secure and active
				</span>
			);
		}
		if (dom.cfStatus === "error") {
			return (
				<span
					className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30"
					title={dom.cfLastError || "Configuration error"}
				>
					<AlertCircle className="w-3 h-3 text-red-400" />
					Configuration Issue
				</span>
			);
		}
		if (dom.cfStatus === "active" && dom.cfSslStatus !== "active") {
			return (
				<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30">
					<Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
					SSL Provisioning
				</span>
			);
		}
		return (
			<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
				<RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
				Verifying DNS
			</span>
		);
	};

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

	const { data: routingTargetData } = api.domain.getRoutingTarget.useQuery(
		{ applicationId: activeAppId || undefined },
		{},
	);
	const assignedTarget = routingTargetData?.target || "hatdot.cloud";

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
				`Domain ${cleanDomain} attached! Create a CNAME record pointing to ${assignedTarget}.`,
			);
		} catch (error: any) {
			toast.error(error?.message || "Error attaching domain");
		}
	};

	const handleCheckDns = async (host: string, applicationId?: string | null, composeId?: string | null) => {
		setCheckingHost(host);
		try {
			const res = await validateDomain({ domain: host, applicationId, composeId });
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
				<title>
					{`Custom Domains & Edge SSL - ${brand.APP_NAME}`}
				</title>
			</Head>

			<BreadcrumbSidebar
				list={[
					{ name: "Home", href: "/dashboard/home" },
					{ name: "Domains", href: "/dashboard/domains" },
				]}
			/>

			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl min-h-[85vh]">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6 h-full">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight">
							Custom Domains
						</h1>
						<p className="text-sm text-muted-foreground mt-1">
							Attach your custom domains with automated HatDot edge SSL, DDoS protection, and global high-speed routing.
						</p>
					</div>

					<Button
						onClick={() => setShowAddModal(true)}
						size="sm" className="gap-2 shrink-0"
					>
						<Plus className="w-4 h-4" /> Add Custom Domain
					</Button>
				</div>

				{isPlatformAdmin && (
					<div className="rounded-xl bg-cyan-950/20 border border-cyan-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center shrink-0">
								<Cloud className="w-4 h-4 text-cyan-400" />
							</div>
							<div>
								<h4 className="text-xs font-bold text-foreground">Platform Admin: Cloudflare for SaaS Configuration</h4>
								<p className="text-[11px] text-muted-foreground">
									Manage Cloudflare Custom Hostnames, Zone ID, CNAME target ({assignedTarget}), Fallback Origin, and edge SSL automation.
								</p>
							</div>
						</div>
						<Link href="/dashboard/settings/server#cloudflare-saas">
							<Button
								variant="outline"
								size="sm"
								className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/40 text-xs gap-1.5 shrink-0"
							>
								<Cloud className="w-3.5 h-3.5 text-cyan-400" /> Configure Cloudflare for SaaS
							</Button>
						</Link>
					</div>
				)}
				{/* DNS Instructions Banner - Provider-Managed CNAME Target */}
				<div className="rounded-xl border bg-card p-5 space-y-4">
					<div className="flex items-center gap-3 border-b pb-3">
						<div className="size-10 rounded-xl border bg-muted flex items-center justify-center shrink-0">
							<Globe className="size-5 text-muted-foreground" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-foreground">Connect Your Domain</h3>
							<p className="text-xs text-muted-foreground">
								Create this DNS record with your domain registrar or DNS provider (such as GoDaddy, Namecheap, Route 53) to route requests to HatDot.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
						<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
							<span className="text-muted-foreground text-[10px] uppercase font-semibold">Record Type</span>
							<p className="text-foreground font-mono font-bold">CNAME</p>
						</div>
						<div className="p-3 rounded-lg bg-muted/40 border space-y-1">
							<span className="text-muted-foreground text-[10px] uppercase font-semibold">Host / Name</span>
							<p className="text-foreground font-mono font-bold">www (or chosen subdomain)</p>
						</div>
						<div className="p-3 rounded-lg bg-muted/40 border space-y-1 flex items-center justify-between">
							<div className="overflow-hidden pr-2">
								<span className="text-muted-foreground text-[10px] uppercase font-semibold">Target / Hostname</span>
								<p className="text-foreground font-semibold font-mono font-bold truncate">{assignedTarget}</p>
							</div>
							<button
								type="button"
								onClick={() => copyRecord(assignedTarget)}
								className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
							>
								{copiedDns ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
							</button>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-[11px] text-muted-foreground">
						<div className="p-2.5 rounded-lg bg-muted/40 border space-y-0.5">
							<span className="text-foreground font-semibold block flex items-center gap-1.5">
								<Globe className="w-3.5 h-3.5 text-foreground font-semibold" />
								Apex / Root Domains (@)
							</span>
							<p>
								Root domains require a DNS provider with CNAME Flattening or ALIAS/ANAME support (e.g. Route 53, Namecheap, DNSimple). Alternatively, use a <code className="text-foreground font-semibold">www</code> CNAME.
							</p>
						</div>
						<div className="p-2.5 rounded-lg bg-muted/40 border space-y-0.5">
							<span className="text-foreground font-semibold block flex items-center gap-1.5">
								<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
								Edge SSL & Routing
							</span>
							<p>
								HatDot automatically validates your DNS, issues an edge SSL certificate, and secures incoming traffic with zero manual setup.
							</p>
						</div>
					</div>

					<p className="text-xs text-muted-foreground pt-1 flex items-center gap-1.5">
						<Lock className="w-3.5 h-3.5 text-emerald-400" />
						HatDot will verify the domain and automatically configure HTTPS once DNS propagation completes.
					</p>
				</div>

				{/* Add Domain Modal Form */}
				{showAddModal && (
					<div className="p-6 rounded-xl bg-card border space-y-4 shadow-sm">
						<h3 className="text-base font-bold text-foreground flex items-center gap-2">
							<Plus className="w-4 h-4 text-foreground font-semibold" /> Attach Custom Domain
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-medium text-foreground block mb-1">Domain Name</label>
								<input
									type="text"
									value={newDomain}
									onChange={(e) => setNewDomain(e.target.value)}
									placeholder="e.g. app.yourcompany.com"
									className="w-full px-3.5 py-2 rounded-lg bg-background border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
								/>
							</div>
							<div>
								<label className="text-xs font-medium text-foreground block mb-1">Route to Application</label>
								<select
									value={activeAppId}
									onChange={(e) => setSelectedAppId(e.target.value)}
									className="w-full px-3 py-2 rounded-lg bg-background border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
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

						<div className="p-3 rounded-lg bg-muted/40 border text-xs flex items-center justify-between">
							<div>
								<span className="text-muted-foreground font-semibold block">DNS CNAME Target for this App:</span>
								<span className="text-foreground font-semibold font-mono font-bold">{assignedTarget}</span>
							</div>
							<button
								type="button"
								onClick={() => copyRecord(assignedTarget)}
								className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
							>
								{copiedDns ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
							</button>
						</div>
						<div className="flex justify-end gap-3 pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowAddModal(false)}
								className="border text-foreground text-xs"
							>
								Cancel
							</Button>
							<Button
								disabled={isAdding || !activeAppId}
								onClick={handleAddDomain}
								className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-5"
							>
								{isAdding ? "Attaching Domain..." : "Attach Domain"}
							</Button>
						</div>
					</div>
				)}

				{/* Domains List */}
				<div className="rounded-xl border bg-card overflow-hidden">
					<div className="p-5 border-b">
						<h3 className="text-base font-semibold text-foreground">Your Attached Custom Domains</h3>
						<p className="text-xs text-muted-foreground">
							{routingTargetData?.isCloudflareSaas
								? "Domains are routed and secured at HatDot's edge with automatic TLS once DNS records are verified."
								: "All domains automatically provision Let's Encrypt TLS certificates once DNS points to the server."}
						</p>
					</div>

					{isLoadingDomains ? (
						<div className="p-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
							<Loader2 className="w-4 h-4 animate-spin text-foreground font-semibold" />
							Loading domains...
						</div>
					) : !domains || domains.length === 0 ? (
						<div className="p-12 text-center text-muted-foreground text-sm">
							No domains attached yet. Click &quot;Add Custom Domain&quot; above to connect your first domain.
						</div>
					) : (
						<div className="divide-y divide-border text-foreground">
							{domains.map((dom) => (
								<div
									key={dom.domainId}
									className="p-5 hover:bg-muted/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
								>
									<div className="space-y-1">
										<div className="flex items-center gap-2.5 flex-wrap">
											<Globe className="w-4 h-4 text-foreground font-semibold shrink-0" />
											<a
												href={`${dom.https ? "https" : "http"}://${dom.host}${dom.path || ""}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-sm font-bold text-foreground hover:text-foreground font-semibold flex items-center gap-1.5"
											>
												{dom.host} <ExternalLink className="w-3 h-3 text-muted-foreground" />
											</a>
											{dom.isPrimary && (
												<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-secondary text-secondary-foreground border">
													<Star className="w-3 h-3 fill-foreground text-foreground" />
													Primary
												</span>
											)}
											{Boolean(dom.cfHostnameId || dom.cfStatus) ? (
												<>
													{getCloudflareStageBadge(dom)}
													{dom.cfStatus === "active" && dom.cfSslStatus === "active" && dom.https && (
														<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
															<ShieldCheck className="w-3 h-3" />
															Edge SSL Active
														</span>
													)}
												</>
											) : (
												<>
													<span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border">
														Let&apos;s Encrypt
													</span>
													<span
														className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
															dom.https && dom.certificateType === "letsencrypt"
																? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
																: "bg-amber-500/20 text-amber-300 border border-amber-500/30"
														}`}
													>
														<ShieldCheck className="w-3 h-3" />
														{dom.https && dom.certificateType === "letsencrypt" ? "SSL Active" : "HTTP Only"}
													</span>
												</>
											)}
										</div>
										<p className="text-xs text-muted-foreground">
											Routed to{" "}
											{dom.applicationId && dom.projectId && dom.environmentId ? (
												<Link
													href={`/dashboard/project/${dom.projectId}/environment/${dom.environmentId}/services/application/${dom.applicationId}`}
													className="text-foreground font-semibold font-mono hover:underline"
												>
													{dom.appName || dom.serviceName}
												</Link>
											) : (
												<code className="text-foreground font-semibold font-mono">{dom.appName || dom.serviceName}</code>
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
												className="border text-foreground hover:bg-muted text-xs gap-1.5 h-8"
											>
												<Star className="w-3.5 h-3.5 text-amber-400" /> Set as Primary
											</Button>
										)}
										{dom.cfStatus === "error" && (
											<Button
												variant="outline"
												size="sm"
												disabled={isRetryingCf}
												onClick={() => handleRetryCf(dom.domainId, dom.host)}
												className="border-amber-800/60 text-amber-400 hover:bg-amber-950/20 text-xs gap-1.5 h-8"
											>
												<RefreshCw className={`w-3.5 h-3.5 ${isRetryingCf ? "animate-spin" : ""}`} /> Retry
											</Button>
										)}
										{routingTargetData?.isCloudflareSaas && !dom.cfHostnameId && !dom.cfStatus && (
											<Button
												variant="outline"
												size="sm"
												disabled={isRetryingCf}
												onClick={() => handleRetryCf(dom.domainId, dom.host)}
												className="border-cyan-800/60 text-cyan-400 hover:bg-cyan-950/20 text-xs gap-1.5 h-8"
												title="Upgrade to HatDot Managed Edge SSL"
											>
												<ShieldCheck className={`w-3.5 h-3.5 ${isRetryingCf ? "animate-spin" : ""}`} /> Upgrade to Edge SSL
											</Button>
										)}
										{(dom.cfHostnameId || dom.cfStatus) && (
											<Button
												variant="outline"
												size="sm"
												disabled={isRecheckingCf}
												onClick={() => handleRecheckCf(dom.domainId, dom.host)}
												className="border-cyan-800/60 text-cyan-400 hover:bg-cyan-950/20 text-xs gap-1.5 h-8"
											>
												<RefreshCw className={`w-3.5 h-3.5 ${isRecheckingCf ? "animate-spin" : ""}`} /> Sync Status
											</Button>
										)}
										{!dom.https && !dom.cfHostnameId && !dom.cfStatus && (
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
											onClick={() => handleCheckDns(dom.host, dom.applicationId, dom.composeId)}
											className="border text-foreground hover:bg-muted text-xs gap-1.5 h-8"
										>
											{checkingHost === dom.host ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin text-foreground font-semibold" />
											) : (
												<RefreshCw className="w-3.5 h-3.5 text-foreground font-semibold" />
											)}
											Check DNS
										</Button>
										<DnsHelperModal
											domain={{
												domainId: dom.domainId,
												host: dom.host,
												https: dom.https,
												path: dom.path || undefined,
											}}
											applicationId={dom.applicationId || undefined}
											composeId={dom.composeId || undefined}
										/>
										<DialogAction
											title={`Remove domain ${dom.host}?`}
											description="Are you sure you want to remove this domain? Web traffic will stop routing to your application and the SSL certificate will be removed."
											type="destructive"
											onClick={() => handleDeleteDomain(dom.domainId, dom.host)}
										>
											<Button
												variant="ghost"
												size="sm"
												className="text-muted-foreground hover:text-red-400 hover:bg-red-950/20 h-8 w-8 p-0"
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
				</Card>
			</div>
		</>
	);
}

CustomDomainsPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Custom Domains">{page}</DashboardLayout>
);

import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Globe,
	Plus,
	CheckCircle2,
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
	MoreVertical,
	Server,
} from "lucide-react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { DialogAction } from "@/components/shared/dialog-action";
import { DnsHelperModal } from "@/components/dashboard/application/domains/dns-helper-modal";
import { api } from "@/utils/api";

export default function CustomDomainsPage() {
	const { data: auth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean(
		(auth as any)?.user?.isPlatformAdmin || (auth as any)?.isPlatformAdmin,
	);
	const {
		data: domains,
		refetch: refetchDomains,
		isLoading: isLoadingDomains,
	} = api.domain.all.useQuery();
	const { data: projects } = api.project.all.useQuery();
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

	const getDomainStatusBadge = (dom: any) => {
		if (dom.cfHostnameId || dom.cfStatus) {
			if (dom.cfStatus === "active" && dom.cfSslStatus === "active" && dom.https) {
				return (
					<Badge variant="green" className="gap-1 text-[11px]">
						<ShieldCheck className="size-3" />
						Secure & Active
					</Badge>
				);
			}
			if (dom.cfStatus === "error" || dom.cfSslStatus === "error") {
				return (
					<Badge
						variant="destructive"
						className="gap-1 text-[11px]"
						title={dom.cfLastError || "Configuration error"}
					>
						<AlertCircle className="size-3" />
						Configuration Issue
					</Badge>
				);
			}
			if (dom.cfStatus === "active" && dom.cfSslStatus !== "active") {
				return (
					<Badge variant="yellow" className="gap-1 text-[11px]">
						<Loader2 className="size-3 animate-spin" />
						SSL Provisioning
					</Badge>
				);
			}
			return (
				<Badge variant="yellow" className="gap-1 text-[11px]">
					<RefreshCw className="size-3 animate-spin" />
					Verifying DNS
				</Badge>
			);
		}

		if (dom.https && dom.certificateType === "letsencrypt") {
			return (
				<Badge variant="green" className="gap-1 text-[11px]">
					<ShieldCheck className="size-3" />
					SSL Active
				</Badge>
			);
		}

		return (
			<Badge variant="outline" className="text-[11px]">
				HTTP Only
			</Badge>
		);
	};

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
				`Domain ${cleanDomain} attached! Point a CNAME record to ${assignedTarget}.`,
			);
		} catch (error: any) {
			toast.error(error?.message || "Error attaching domain");
		}
	};

	const handleCheckDns = async (
		host: string,
		applicationId?: string | null,
		composeId?: string | null,
	) => {
		setCheckingHost(host);
		try {
			const res = await validateDomain({
				domain: host,
				applicationId,
				composeId,
			});
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
				<title>{`Custom Domains & Edge SSL - ${brand.APP_NAME}`}</title>
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
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<div className="flex items-center gap-2.5">
									<h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
										Custom Domains
									</h1>
									<Badge variant="outline" className="text-xs">
										Edge Network
									</Badge>
								</div>
								<p className="text-sm text-muted-foreground mt-1">
									Manage custom domains with automated Edge SSL certificates and global high-speed routing.
								</p>
							</div>

							<Button
								onClick={() => setShowAddModal(true)}
								size="sm"
								className="gap-2 shrink-0"
							>
								<Plus className="size-4" /> Add Custom Domain
							</Button>
						</div>

						{/* Platform Admin: Cloudflare for SaaS Configuration */}
						{isPlatformAdmin && (
							<Card className="bg-muted/40 border">
								<CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
									<div className="flex items-center gap-3">
										<div className="size-9 rounded-lg bg-background border flex items-center justify-center shrink-0">
											<Cloud className="size-4 text-primary" />
										</div>
										<div>
											<h4 className="text-xs font-semibold text-foreground">
												Platform Admin: Cloudflare for SaaS Configuration
											</h4>
											<p className="text-[11px] text-muted-foreground">
												CNAME target: <code className="font-mono text-foreground font-semibold">{assignedTarget}</code> • Manage Custom Hostnames and edge SSL automation.
											</p>
										</div>
									</div>
									<Link href="/dashboard/settings/cloudflare-saas">
										<Button
											variant="outline"
											size="sm"
											className="text-xs gap-1.5 shrink-0"
										>
											<Cloud className="size-3.5" /> Configure Cloudflare
										</Button>
									</Link>
								</CardContent>
							</Card>
						)}

						{/* DNS Target Quick-Reference Card */}
						<Card className="bg-card border">
							<CardContent className="p-4 sm:p-5 space-y-3">
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
									<div className="flex items-center gap-3">
										<div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
											<Globe className="size-4 text-foreground" />
										</div>
										<div>
											<h3 className="text-sm font-semibold text-foreground">
												Global DNS Routing Target
											</h3>
											<p className="text-xs text-muted-foreground">
												Point your domain or subdomain CNAME record to route traffic to HatDot.
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2 self-start sm:self-auto">
										<Badge variant="outline" className="font-mono text-xs">
											CNAME
										</Badge>
										<div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-muted font-mono text-xs font-semibold text-foreground border">
											<span>{assignedTarget}</span>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-6 text-muted-foreground hover:text-foreground"
												onClick={() => copyRecord(assignedTarget)}
												title="Copy CNAME target"
											>
												{copiedDns ? (
													<Check className="size-3 text-primary" />
												) : (
													<Copy className="size-3" />
												)}
											</Button>
										</div>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t text-xs text-muted-foreground">
									<div className="flex items-start gap-2">
										<Globe className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
										<span>
											<strong className="text-foreground">Subdomains & Apex:</strong> Use <code className="font-mono text-foreground font-semibold">@</code> or subdomain (e.g. <code className="font-mono text-foreground">app</code>) as Host. For root domains, ensure your DNS provider supports CNAME Flattening or ALIAS.
										</span>
									</div>
									<div className="flex items-start gap-2">
										<ShieldCheck className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
										<span>
											<strong className="text-foreground">Automated Edge SSL:</strong> HTTPS certificates are automatically issued and secured once DNS propagation completes.
										</span>
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Add Domain Modal */}
						<Dialog open={showAddModal} onOpenChange={setShowAddModal}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader>
									<DialogTitle className="flex items-center gap-2">
										<Globe className="size-5 text-primary" />
										Attach Custom Domain
									</DialogTitle>
									<DialogDescription>
										Connect a custom domain to route incoming web traffic to an application.
									</DialogDescription>
								</DialogHeader>

								<div className="space-y-4 py-2">
									<div className="space-y-1.5">
										<Label htmlFor="domain-name" className="text-xs font-medium">
											Domain Name
										</Label>
										<Input
											id="domain-name"
											type="text"
											value={newDomain}
											onChange={(e) => setNewDomain(e.target.value)}
											placeholder="e.g. app.yourcompany.com"
											className="font-mono text-sm"
										/>
									</div>

									<div className="space-y-1.5">
										<Label htmlFor="route-app" className="text-xs font-medium">
											Route to Application
										</Label>
										<Select
											value={activeAppId}
											onValueChange={(val) => setSelectedAppId(val)}
										>
											<SelectTrigger id="route-app" className="w-full">
												<SelectValue placeholder="Select an application" />
											</SelectTrigger>
											<SelectContent>
												{applicationsList.length === 0 ? (
													<SelectItem value="none" disabled>
														No applications found
													</SelectItem>
												) : (
													applicationsList.map((app) => (
														<SelectItem
															key={app.applicationId}
															value={app.applicationId}
														>
															{app.name}
														</SelectItem>
													))
												)}
											</SelectContent>
										</Select>
									</div>

									<div className="p-3 rounded-lg bg-muted border text-xs space-y-1.5">
										<div className="flex items-center justify-between text-muted-foreground">
											<span>DNS CNAME Target</span>
											<Badge variant="outline" className="text-[10px] font-mono">
												CNAME
											</Badge>
										</div>
										<div className="flex items-center justify-between">
											<span className="font-mono font-semibold text-foreground">
												{assignedTarget}
											</span>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-7"
												onClick={() => copyRecord(assignedTarget)}
											>
												{copiedDns ? (
													<Check className="size-3.5 text-primary" />
												) : (
													<Copy className="size-3.5" />
												)}
											</Button>
										</div>
									</div>
								</div>

								<DialogFooter className="gap-2 sm:gap-0">
									<Button
										variant="outline"
										onClick={() => setShowAddModal(false)}
									>
										Cancel
									</Button>
									<Button
										disabled={isAdding || !activeAppId || !newDomain.trim()}
										onClick={handleAddDomain}
									>
										{isAdding ? (
											<>
												<Loader2 className="size-4 animate-spin mr-2" /> Attaching...
											</>
										) : (
											"Attach Domain"
										)}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						{/* Domains List */}
						<Card className="bg-card border overflow-hidden">
							<CardHeader className="p-4 sm:p-5 border-b flex flex-row items-center justify-between gap-4">
								<div>
									<CardTitle className="text-base font-semibold">
										Attached Domains
									</CardTitle>
									<CardDescription className="text-xs">
										Domains routed through the platform edge with automated SSL.
									</CardDescription>
								</div>
								<Badge variant="secondary" className="text-xs">
									{domains?.length || 0}{" "}
									{domains?.length === 1 ? "domain" : "domains"}
								</Badge>
							</CardHeader>

							<CardContent className="p-0">
								{isLoadingDomains ? (
									<div className="p-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
										<Loader2 className="size-4 animate-spin" />
										Loading domains...
									</div>
								) : !domains || domains.length === 0 ? (
									<div className="p-12 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-2">
										<Globe className="size-8 text-muted-foreground" />
										<p>No custom domains attached yet.</p>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setShowAddModal(true)}
											className="mt-2 text-xs gap-1.5"
										>
											<Plus className="size-3.5" /> Attach Your First Domain
										</Button>
									</div>
								) : (
									<div className="divide-y divide-border">
										{domains.map((dom) => (
											<div
												key={dom.domainId}
												className="p-4 sm:p-5 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
											>
												<div className="space-y-1.5 min-w-0">
													<div className="flex items-center gap-2 flex-wrap">
														<Globe className="size-4 text-foreground shrink-0" />
														<a
															href={`${dom.https ? "https" : "http"}://${dom.host}${dom.path || ""}`}
															target="_blank"
															rel="noopener noreferrer"
															className="text-sm font-semibold text-foreground hover:underline flex items-center gap-1.5"
														>
															{dom.host}
															<ExternalLink className="size-3 text-muted-foreground" />
														</a>

														{dom.isPrimary && (
															<Badge
																variant="secondary"
																className="gap-1 text-[11px]"
															>
																<Star className="size-3 fill-foreground" />
																Primary
															</Badge>
														)}

														{getDomainStatusBadge(dom)}

														<Badge
															variant="outline"
															className="text-[10px] font-mono"
														>
															{dom.cfHostnameId || dom.cfStatus
																? "Edge SSL"
																: "Let's Encrypt"}
														</Badge>
													</div>

													<p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
														<span>Routed to</span>
														{dom.applicationId &&
														dom.projectId &&
														dom.environmentId ? (
															<Link
																href={`/dashboard/project/${dom.projectId}/environment/${dom.environmentId}/services/application/${dom.applicationId}`}
																className="text-foreground font-mono font-medium hover:underline inline-flex items-center gap-1"
															>
																<Server className="size-3 text-muted-foreground" />
																{dom.appName || dom.serviceName}
															</Link>
														) : (
															<span className="text-foreground font-mono inline-flex items-center gap-1">
																<Server className="size-3 text-muted-foreground" />
																{dom.appName || dom.serviceName}
															</span>
														)}
														<span>• Created {new Date(dom.createdAt).toLocaleDateString()}</span>
													</p>
												</div>

												{/* Row Actions */}
												<div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
													<Button
														variant="outline"
														size="sm"
														disabled={checkingHost === dom.host}
														onClick={() =>
															handleCheckDns(
																dom.host,
																dom.applicationId,
																dom.composeId,
															)
														}
														className="text-xs gap-1.5 h-8"
													>
														<RefreshCw
															className={`size-3.5 ${checkingHost === dom.host ? "animate-spin" : ""}`}
														/>
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

													{(!dom.isPrimary ||
														dom.cfStatus === "error" ||
														dom.cfHostnameId ||
														dom.cfStatus ||
														(!dom.https &&
															!dom.cfHostnameId &&
															!dom.cfStatus)) && (
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button
																	variant="ghost"
																	size="icon"
																	className="size-8"
																>
																	<MoreVertical className="size-4" />
																	<span className="sr-only">More options</span>
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end" className="w-48">
																{!dom.isPrimary && (
																	<DropdownMenuItem
																		disabled={isSettingPrimary}
																		onClick={() =>
																			handleSetPrimary(dom.domainId, dom.host)
																		}
																		className="text-xs cursor-pointer gap-2"
																	>
																		<Star className="size-3.5" />
																		Set as Primary
																	</DropdownMenuItem>
																)}
																{(dom.cfHostnameId || dom.cfStatus) && (
																	<DropdownMenuItem
																		disabled={isRecheckingCf}
																		onClick={() =>
																			handleRecheckCf(dom.domainId, dom.host)
																		}
																		className="text-xs cursor-pointer gap-2"
																	>
																		<RefreshCw className="size-3.5" />
																		Sync SSL Status
																	</DropdownMenuItem>
																)}
																{dom.cfStatus === "error" && (
																	<DropdownMenuItem
																		disabled={isRetryingCf}
																		onClick={() =>
																			handleRetryCf(dom.domainId, dom.host)
																		}
																		className="text-xs cursor-pointer gap-2"
																	>
																		<RefreshCw className="size-3.5" />
																		Retry Provisioning
																	</DropdownMenuItem>
																)}
																{!dom.https &&
																	!dom.cfHostnameId &&
																	!dom.cfStatus && (
																		<DropdownMenuItem
																			disabled={isActivating}
																			onClick={() =>
																				handleActivateHttps(
																					dom.domainId,
																					dom.host,
																				)
																			}
																			className="text-xs cursor-pointer gap-2"
																		>
																			<ShieldCheck className="size-3.5" />
																			Activate HTTPS
																		</DropdownMenuItem>
																	)}
															</DropdownMenuContent>
														</DropdownMenu>
													)}

													<DialogAction
														title={`Remove domain ${dom.host}?`}
														description="Are you sure you want to remove this domain? Web traffic will stop routing to your application and the SSL certificate will be removed."
														type="destructive"
														onClick={() =>
															handleDeleteDomain(dom.domainId, dom.host)
														}
													>
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-muted-foreground hover:text-destructive"
															title="Delete Domain"
														>
															<Trash2 className="size-4" />
														</Button>
													</DialogAction>
												</div>
											</div>
										))}
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				</Card>
			</div>
		</>
	);
}

CustomDomainsPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Custom Domains">{page}</DashboardLayout>
);

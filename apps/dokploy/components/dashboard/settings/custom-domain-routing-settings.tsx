import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
	Globe,
	Shield,
	Cloud,
	Lock,
	CheckCircle2,
	AlertTriangle,
	RefreshCw,
	Save,
	Copy,
	Check,
	Key,
	Eye,
	EyeOff,
	Server,
	Layers,
	Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

export const CustomDomainRoutingSettings = () => {
	const { data, refetch, isFetching } =
		api.admin.getRoutingSettings.useQuery();
	const { mutateAsync: updateSettings, isPending: isSaving } =
		api.admin.updateRoutingSettings.useMutation();

	// Cloudflare for SaaS settings
	const {
		data: cfSaasData,
		refetch: refetchCfSaas,
		isFetching: isFetchingCfSaas,
	} = api.admin.getCloudflareSaasSettings.useQuery();
	const { mutateAsync: updateCfSaas, isPending: isSavingCfSaas } =
		api.admin.updateCloudflareSaasSettings.useMutation();
	const { mutateAsync: testCfConnection, isPending: isTestingCf } =
		api.admin.testCloudflareSaasConnection.useMutation();
	const { mutateAsync: syncAllCf, isPending: isSyncingAll } =
		api.admin.syncAllCloudflareHostnames.useMutation();

	const [customTarget, setCustomTarget] = useState("");
	const [cnameEnabled, setCnameEnabled] = useState(true);
	const [allowDirectIp, setAllowDirectIp] = useState(false);
	const [cfProxyEnabled, setCfProxyEnabled] = useState(false);
	const [cfStrictSsl, setCfStrictSsl] = useState(true);
	const [copiedTarget, setCopiedTarget] = useState(false);

	// Cloudflare for SaaS form state
	const [cfSaasEnabled, setCfSaasEnabled] = useState(false);
	const [cfApiToken, setCfApiToken] = useState("");
	const [showToken, setShowToken] = useState(false);
	const [cfZoneId, setCfZoneId] = useState("");
	const [cfCnameTarget, setCfCnameTarget] = useState("");
	const [cfFallbackOrigin, setCfFallbackOrigin] = useState("");
	const [cfDefaultSslMethod, setCfDefaultSslMethod] = useState<"http" | "txt" | "cname">("http");
	const [cfAutoProvision, setCfAutoProvision] = useState(true);
	const [testResult, setTestResult] = useState<{
		success: boolean;
		zoneName?: string;
		fallbackOrigin?: string | null;
		fallbackOriginStatus?: string | null;
		message: string;
		error?: string;
	} | null>(null);

	useEffect(() => {
		if (data) {
			setCustomTarget(data.cnameTarget || "");
			setCnameEnabled(data.cnameEnabled);
			setAllowDirectIp(data.allowDirectIp);
			setCfProxyEnabled(data.cloudflareProxyEnabled);
			setCfStrictSsl(data.cloudflareStrictSsl);
		}
	}, [data]);

	useEffect(() => {
		if (cfSaasData) {
			setCfSaasEnabled(cfSaasData.enabled);
			setCfZoneId(cfSaasData.zoneId || "");
			setCfCnameTarget(cfSaasData.cnameTarget || "");
			setCfFallbackOrigin(cfSaasData.fallbackOrigin || "");
			setCfDefaultSslMethod(cfSaasData.defaultSslMethod || "http");
			setCfAutoProvision(cfSaasData.autoProvision);
		}
	}, [cfSaasData]);

	const handleSaveRouting = async () => {
		try {
			await updateSettings({
				cnameTarget: customTarget.trim() || null,
				cnameEnabled,
				allowDirectIp,
				cloudflareProxyEnabled: cfProxyEnabled,
				cloudflareStrictSsl: cfStrictSsl,
			});
			await refetch();
			toast.success("Custom domain routing settings updated successfully.");
		} catch (error: any) {
			toast.error(error?.message || "Failed to update routing settings.");
		}
	};

	const handleSaveCloudflareSaas = async () => {
		try {
			await updateCfSaas({
				enabled: cfSaasEnabled,
				apiToken: cfApiToken.trim().length > 0 ? cfApiToken.trim() : undefined,
				zoneId: cfZoneId.trim() || null,
				cnameTarget: cfCnameTarget.trim() || null,
				fallbackOrigin: cfFallbackOrigin.trim() || null,
				defaultSslMethod: cfDefaultSslMethod,
				autoProvision: cfAutoProvision,
			});
			setCfApiToken("");
			await refetchCfSaas();
			toast.success("Cloudflare for SaaS configuration saved successfully.");
		} catch (error: any) {
			toast.error(error?.message || "Failed to save Cloudflare for SaaS settings.");
		}
	};

	const handleTestConnection = async () => {
		try {
			setTestResult(null);
			const res = await testCfConnection({
				apiToken: cfApiToken.trim().length > 0 ? cfApiToken.trim() : null,
				zoneId: cfZoneId.trim() || null,
			});
			setTestResult(res);
			if (res.success) {
				toast.success(res.message);
			} else {
				toast.error(res.error || "Connection test failed.");
			}
		} catch (err: any) {
			const msg = err?.message || "Cloudflare test failed";
			setTestResult({
				success: false,
				message: "Connection test failed.",
				error: msg,
			});
			toast.error(msg);
		}
	};

	const handleSyncAllHostnames = async () => {
		try {
			const res = await syncAllCf();
			toast.success(
				`Reconciliation complete: ${res.processed} hostnames checked, ${res.updated} updated.`,
			);
		} catch (err: any) {
			toast.error(err?.message || "Reconciliation failed.");
		}
	};

	const copyTarget = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedTarget(true);
		toast.success("Target hostname copied to clipboard.");
		setTimeout(() => setCopiedTarget(false), 2000);
	};

	const status = data?.targetStatus;
	const isProxied = status?.isProxied;
	const resolves = status?.resolves;

	return (
		<div className="space-y-6">
			{/* Cloudflare for SaaS Configuration Card */}
			<Card className="h-full bg-sidebar p-2.5 rounded-xl mx-auto w-full border border-border shadow-sm">
				<CardHeader className="p-4 pb-2">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div className="space-y-1">
							<CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
								<Cloud className="size-5 text-cyan-400" />
								Cloudflare for SaaS — Custom Hostnames & SSL
							</CardTitle>
							<CardDescription className="text-xs text-muted-foreground">
								Automatically provision Cloudflare Custom Hostnames and manage SSL certificates for customer domains.
							</CardDescription>
						</div>

						<div className="flex items-center gap-2 flex-wrap">
							<Button
								variant="outline"
								size="sm"
								className="h-8 text-xs gap-1.5"
								disabled={isTestingCf}
								onClick={handleTestConnection}
							>
								<Activity className={`size-3.5 ${isTestingCf ? "animate-spin" : ""}`} />
								Test Connection
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-8 text-xs gap-1.5"
								disabled={isSyncingAll}
								onClick={handleSyncAllHostnames}
							>
								<RefreshCw className={`size-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
								Sync Hostnames
							</Button>
							<Button
								size="sm"
								className="h-8 text-xs gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white"
								disabled={isSavingCfSaas}
								onClick={handleSaveCloudflareSaas}
							>
								<Save className="size-3.5" />
								Save Cloudflare Settings
							</Button>
						</div>
					</div>
				</CardHeader>

				<CardContent className="p-4 pt-2 space-y-4">
					{/* Status & Diagnostic Banner */}
					{testResult && (
						<div
							className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
								testResult.success
									? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
									: "bg-red-950/20 border-red-500/30 text-red-300"
							}`}
						>
							{testResult.success ? (
								<CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" />
							) : (
								<AlertTriangle className="size-4 shrink-0 text-red-400 mt-0.5" />
							)}
							<div className="space-y-1">
								<p className="font-semibold">{testResult.message}</p>
								{testResult.zoneName && (
									<p className="text-[11px] opacity-90">
										Zone: <span className="font-mono">{testResult.zoneName}</span> • Fallback Origin:{" "}
										<span className="font-mono">
											{testResult.fallbackOrigin || "Not configured"} ({testResult.fallbackOriginStatus || "unknown"})
										</span>
									</p>
								)}
								{testResult.error && (
									<p className="text-[11px] opacity-90 font-mono">{testResult.error}</p>
								)}
							</div>
						</div>
					)}

					{/* Enable Cloudflare for SaaS Switch */}
					<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
						<div className="space-y-1 pr-2">
							<div className="flex items-center gap-1.5">
								<Cloud className="size-4 text-cyan-400" />
								<span className="text-xs font-semibold text-foreground">
									Enable Cloudflare for SaaS Integration
								</span>
								{cfSaasData?.enabled && (
									<Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] ml-1">
										Enabled
									</Badge>
								)}
							</div>
							<p className="text-[11px] text-muted-foreground leading-relaxed">
								When enabled, adding a custom domain will automatically register it as a Cloudflare Custom Hostname and track SSL issuance.
							</p>
						</div>
						<Switch
							checked={cfSaasEnabled}
							onCheckedChange={setCfSaasEnabled}
							className="mt-0.5"
						/>
					</div>

					{/* Credentials Form */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* API Token Input */}
						<div className="space-y-1.5 p-3 rounded-lg bg-background/50 border border-border/80">
							<div className="flex items-center justify-between">
								<label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
									<Key className="size-3.5 text-indigo-400" />
									Cloudflare API Token
								</label>
								{cfSaasData?.hasApiToken && (
									<Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
										Configured ({cfSaasData.maskedApiToken})
									</Badge>
								)}
							</div>
							<p className="text-[10px] text-muted-foreground">
								Scoped token with <span className="font-mono">Zone.Custom Hostnames: Edit</span> and{" "}
								<span className="font-mono">Zone: Read</span> permissions.
							</p>
							<div className="relative">
								<Input
									type={showToken ? "text" : "password"}
									value={cfApiToken}
									onChange={(e) => setCfApiToken(e.target.value)}
									placeholder={cfSaasData?.hasApiToken ? "Enter new token to overwrite" : "e.g. c7a9B4..."}
									className="text-xs font-mono h-9 pr-8"
								/>
								<button
									type="button"
									onClick={() => setShowToken(!showToken)}
									className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
								>
									{showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
								</button>
							</div>
						</div>

						{/* Zone ID Input */}
						<div className="space-y-1.5 p-3 rounded-lg bg-background/50 border border-border/80">
							<label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
								<Layers className="size-3.5 text-cyan-400" />
								Cloudflare Zone ID
							</label>
							<p className="text-[10px] text-muted-foreground">
								Zone ID of your apex platform domain (e.g. hatdot.cloud zone in Cloudflare dashboard).
							</p>
							<Input
								value={cfZoneId}
								onChange={(e) => setCfZoneId(e.target.value)}
								placeholder="e.g. 023e105f4ecef8ad9ca31a8372d0c353"
								className="text-xs font-mono h-9"
							/>
						</div>

						{/* Customer CNAME Target */}
						<div className="space-y-1.5 p-3 rounded-lg bg-background/50 border border-border/80">
							<label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
								<Globe className="size-3.5 text-indigo-400" />
								Customer CNAME Target
							</label>
							<p className="text-[10px] text-muted-foreground">
								The platform hostname customers point their custom domains to (e.g. cname.hatdot.cloud).
							</p>
							<Input
								value={cfCnameTarget}
								onChange={(e) => setCfCnameTarget(e.target.value)}
								placeholder="e.g. cname.hatdot.cloud"
								className="text-xs font-mono h-9"
							/>
						</div>

						{/* Fallback Origin Hostname */}
						<div className="space-y-1.5 p-3 rounded-lg bg-background/50 border border-border/80">
							<div className="flex items-center justify-between">
								<label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
									<Server className="size-3.5 text-emerald-400" />
									Fallback Origin Hostname
								</label>
								{cfSaasData?.fallbackOriginStatus && (
									<Badge
										variant="outline"
										className={`text-[10px] capitalize ${
											cfSaasData.fallbackOriginStatus === "active"
												? "text-emerald-400 border-emerald-500/30"
												: "text-amber-400 border-amber-500/30"
										}`}
									>
										Status: {cfSaasData.fallbackOriginStatus}
									</Badge>
								)}
							</div>
							<p className="text-[10px] text-muted-foreground">
								The Cloudflare for SaaS Fallback Origin pointing to your ingress (e.g. fallback.hatdot.cloud).
							</p>
							<Input
								value={cfFallbackOrigin}
								onChange={(e) => setCfFallbackOrigin(e.target.value)}
								placeholder="e.g. fallback.hatdot.cloud"
								className="text-xs font-mono h-9"
							/>
						</div>
					</div>

					{/* Automation & Validation Settings */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Default SSL Method */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 space-y-2">
							<label className="text-xs font-semibold text-foreground block">
								Default SSL Validation Method
							</label>
							<p className="text-[11px] text-muted-foreground">
								Verification method requested when provisioning Custom Hostname certificates.
							</p>
							<Select
								value={cfDefaultSslMethod}
								onValueChange={(val: "http" | "txt" | "cname") => setCfDefaultSslMethod(val)}
							>
								<SelectTrigger className="h-9 text-xs">
									<SelectValue placeholder="Select validation method" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="http">HTTP (Automatic DCV via CNAME)</SelectItem>
									<SelectItem value="txt">TXT Record Challenge</SelectItem>
									<SelectItem value="cname">CNAME Delegation</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Toggle: Auto Provision */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
							<div className="space-y-1 pr-2">
								<span className="text-xs font-semibold text-foreground block">
									Automatic Provisioning
								</span>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Immediately register the hostname with Cloudflare whenever a customer adds a domain.
								</p>
							</div>
							<Switch
								checked={cfAutoProvision}
								onCheckedChange={setCfAutoProvision}
								className="mt-0.5"
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Custom Domain CNAME Routing Card */}
			<Card className="h-full bg-sidebar p-2.5 rounded-xl mx-auto w-full border border-border">
				<CardHeader className="p-4 pb-2">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div className="space-y-1">
							<CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
								<Globe className="size-5 text-indigo-500" />
								Provider-Managed CNAME & Ingress Architecture
							</CardTitle>
							<CardDescription className="text-xs text-muted-foreground">
								Configure provider-managed DNS targets for customer custom domains and shield origin server IP.
							</CardDescription>
						</div>

						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-8 text-xs gap-1.5"
								disabled={isFetching}
								onClick={() => refetch()}
							>
								<RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
								Check Status
							</Button>
							<Button
								size="sm"
								className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
								disabled={isSaving}
								onClick={handleSaveRouting}
							>
								<Save className="size-3.5" />
								Save Settings
							</Button>
						</div>
					</div>
				</CardHeader>

				<CardContent className="p-4 pt-2 space-y-6">
					{/* Public Custom-Domain Target Hostname */}
					<div className="space-y-3 p-3.5 rounded-lg bg-background/50 border border-border/80">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
							<div>
								<label className="text-xs font-semibold text-foreground block">
									Public Custom-Domain Target Hostname
								</label>
								<p className="text-[11px] text-muted-foreground">
									Customers point their custom domain CNAME records to this target. Leave blank to default to application platform hostname (e.g. app.hatdot.cloud).
								</p>
							</div>

							{data?.effectiveTarget && (
								<div className="flex items-center gap-2">
									<Badge
										variant="outline"
										className="font-mono text-xs py-0.5 px-2 bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
									>
										{data.effectiveTarget}
									</Badge>
									<Button
										variant="ghost"
										size="icon"
										className="size-7"
										onClick={() => copyTarget(data.effectiveTarget)}
									>
										{copiedTarget ? (
											<Check className="size-3.5 text-emerald-400" />
										) : (
											<Copy className="size-3.5 text-muted-foreground" />
										)}
									</Button>
								</div>
							)}
						</div>

						<div className="flex gap-2">
							<Input
								value={customTarget}
								onChange={(e) => setCustomTarget(e.target.value)}
								placeholder="e.g. cname.hatdot.cloud (or blank for app.hatdot.cloud)"
								className="text-xs font-mono h-9"
							/>
						</div>

						{/* Target Reachability Diagnostics */}
						{status && (
							<div className="pt-2 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
								<div className="flex items-center gap-2">
									{resolves ? (
										<span className="flex items-center gap-1.5 text-emerald-500 text-xs font-medium">
											<CheckCircle2 className="size-3.5" />
											Target resolves in DNS ({status.resolvedIps.length} address
											{status.resolvedIps.length === 1 ? "" : "es"})
										</span>
									) : (
										<span className="flex items-center gap-1.5 text-amber-500 text-xs font-medium">
											<AlertTriangle className="size-3.5" />
											Target does not resolve in DNS yet
										</span>
									)}
									{status.resolvedIps.length > 0 && (
										<span className="text-[11px] font-mono text-muted-foreground">
											[{status.resolvedIps.join(", ")}]
										</span>
									)}
								</div>

								<div>
									{isProxied ? (
										<Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[11px] flex items-center gap-1">
											<Cloud className="size-3" />
											Proxied via Cloudflare Edge
										</Badge>
									) : (
										<Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[11px] flex items-center gap-1">
											<Shield className="size-3" />
											Direct Origin DNS
										</Badge>
									)}
								</div>
							</div>
						)}
					</div>

					{/* Feature Toggles */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Toggle: Provider-Managed CNAME Targets */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
							<div className="space-y-1 pr-2">
								<div className="flex items-center gap-1.5">
									<Globe className="size-4 text-indigo-400" />
									<span className="text-xs font-semibold text-foreground">
										Provider-Managed CNAME Targets
									</span>
								</div>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Provides customers with a platform hostname as the CNAME target instead of displaying origin server IP.
								</p>
							</div>
							<Switch
								checked={cnameEnabled}
								onCheckedChange={setCnameEnabled}
								className="mt-0.5"
							/>
						</div>

						{/* Toggle: Allow Direct-IP Disclosure */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
							<div className="space-y-1 pr-2">
								<div className="flex items-center gap-1.5">
									<Shield className="size-4 text-emerald-400" />
									<span className="text-xs font-semibold text-foreground">
										Allow Direct-IP Disclosure
									</span>
								</div>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									When disabled (recommended), the server origin IP is strictly redacted from customer-facing instructions, API responses, and errors.
								</p>
							</div>
							<Switch
								checked={allowDirectIp}
								onCheckedChange={setAllowDirectIp}
								className="mt-0.5"
							/>
						</div>

						{/* Toggle: Cloudflare Edge Proxy */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
							<div className="space-y-1 pr-2">
								<div className="flex items-center gap-1.5">
									<Cloud className="size-4 text-cyan-400" />
									<span className="text-xs font-semibold text-foreground">
										Cloudflare Proxy Integration
									</span>
								</div>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Enables Cloudflare-aware DNS instructions with proxy recommendations and edge SSL configuration guidance.
								</p>
							</div>
							<Switch
								checked={cfProxyEnabled}
								onCheckedChange={setCfProxyEnabled}
								className="mt-0.5"
							/>
						</div>

						{/* Toggle: Enforce Strict SSL */}
						<div className="p-3.5 rounded-lg bg-background/50 border border-border/80 flex items-start justify-between gap-3">
							<div className="space-y-1 pr-2">
								<div className="flex items-center gap-1.5">
									<Lock className="size-4 text-amber-400" />
									<span className="text-xs font-semibold text-foreground">
										Cloudflare Strict SSL Mode
									</span>
								</div>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Recommends Cloudflare Full (Strict) SSL mode so end-to-end TLS is encrypted between edge and Traefik origin.
								</p>
							</div>
							<Switch
								checked={cfStrictSsl}
								onCheckedChange={setCfStrictSsl}
								className="mt-0.5"
							/>
						</div>
					</div>

					{/* Routing Architecture & TLS Readiness Notice */}
					<div className="p-3.5 rounded-lg bg-muted/20 border border-border/60 text-xs space-y-2">
						<div className="flex items-center gap-2 font-medium text-foreground">
							<Lock className="size-4 text-emerald-400" />
							Production Traefik Routing & Ingress Integration
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1">
							<div className="p-2 rounded bg-background/70 border border-border/50">
								<span className="text-slate-500 block uppercase text-[9px] font-bold">Host Routing</span>
								<span className="text-foreground font-mono">Host(`domain.com`)</span>
								<p className="text-[10px] mt-0.5">Original Host header preserved end-to-end</p>
							</div>
							<div className="p-2 rounded bg-background/70 border border-border/50">
								<span className="text-slate-500 block uppercase text-[9px] font-bold">Cloudflare for SaaS</span>
								<span className="text-foreground font-mono">Edge SSL Termination</span>
								<p className="text-[10px] mt-0.5">Automated DV certs at Cloudflare edge</p>
							</div>
							<div className="p-2 rounded bg-background/70 border border-border/50">
								<span className="text-slate-500 block uppercase text-[9px] font-bold">Fallback Origin</span>
								<span className="text-foreground font-mono">
									{cfSaasData?.fallbackOrigin || "fallback.hatdot.cloud"}
								</span>
								<p className="text-[10px] mt-0.5">Points traffic directly to Traefik ingress</p>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};

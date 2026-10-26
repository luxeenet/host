import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
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
	ExternalLink,
	Copy,
	Check,
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
import { api } from "@/utils/api";

export const CustomDomainRoutingSettings = () => {
	const { data, refetch, isFetching } =
		api.admin.getRoutingSettings.useQuery();
	const { mutateAsync: updateSettings, isPending: isSaving } =
		api.admin.updateRoutingSettings.useMutation();

	const [customTarget, setCustomTarget] = useState("");
	const [cnameEnabled, setCnameEnabled] = useState(true);
	const [allowDirectIp, setAllowDirectIp] = useState(false);
	const [cfProxyEnabled, setCfProxyEnabled] = useState(false);
	const [cfStrictSsl, setCfStrictSsl] = useState(true);
	const [copiedTarget, setCopiedTarget] = useState(false);

	useEffect(() => {
		if (data) {
			setCustomTarget(data.cnameTarget || "");
			setCnameEnabled(data.cnameEnabled);
			setAllowDirectIp(data.allowDirectIp);
			setCfProxyEnabled(data.cloudflareProxyEnabled);
			setCfStrictSsl(data.cloudflareStrictSsl);
		}
	}, [data]);

	const handleSave = async () => {
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
		<Card className="h-full bg-sidebar p-2.5 rounded-xl mx-auto w-full border border-border">
			<CardHeader className="p-4 pb-2">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div className="space-y-1">
						<CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
							<Globe className="size-5 text-indigo-500" />
							Custom Domain CNAME Targets & Routing
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
							onClick={handleSave}
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
						Production Traefik Routing & TLS Architecture
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1">
						<div className="p-2 rounded bg-background/70 border border-border/50">
							<span className="text-slate-500 block uppercase text-[9px] font-bold">Host Routing</span>
							<span className="text-foreground font-mono">Host(`domain.com`)</span>
							<p className="text-[10px] mt-0.5">Original HTTP Host preserved end-to-end</p>
						</div>
						<div className="p-2 rounded bg-background/70 border border-border/50">
							<span className="text-slate-500 block uppercase text-[9px] font-bold">TLS Automation</span>
							<span className="text-foreground font-mono">Let's Encrypt (ACME)</span>
							<p className="text-[10px] mt-0.5">Automated HTTP-01 cert issuance & renewal</p>
						</div>
						<div className="p-2 rounded bg-background/70 border border-border/50">
							<span className="text-slate-500 block uppercase text-[9px] font-bold">Wildcard DNS</span>
							<span className="text-foreground font-mono">{data?.tlsReadiness.wildcardSupported ? "Active" : "Detected"}</span>
							<p className="text-[10px] mt-0.5">Platform wildcard covers assigned hostnames</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
};

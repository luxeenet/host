import { useState } from "react";
import {
	Copy,
	Check,
	HelpCircle,
	Server,
	Globe,
	Cloud,
	Lock,
	CheckCircle2,
	AlertCircle,
	RefreshCw,
	Loader2,
	ShieldCheck,
	FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";

interface Props {
	domain: {
		domainId?: string;
		host: string;
		https: boolean;
		path?: string;
	};
	serverIp?: string;
	applicationId?: string;
	composeId?: string;
}

export const DnsHelperModal = ({ domain, serverIp, applicationId, composeId }: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);

	const {
		data: dnsInfo,
		isFetching,
		refetch,
	} = api.domain.dnsInstructions.useQuery(
		{
			host: domain.host,
			applicationId: applicationId || null,
			composeId: composeId || null,
		},
		{ enabled: isOpen, refetchOnWindowFocus: false },
	);

	const { mutateAsync: recheckCloudflare, isPending: isRechecking } =
		api.domain.recheckCloudflareStatus.useMutation();

	const handleRefresh = async () => {
		try {
			if (domain.domainId) {
				await recheckCloudflare({ domainId: domain.domainId });
			}
			await refetch();
			toast.success("DNS and SSL verification status refreshed.");
		} catch (err: any) {
			await refetch();
			toast.info("Refreshed DNS check.");
		}
	};

	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text);
		setCopied(label);
		toast.success(`Copied ${label} to clipboard!`);
		setTimeout(() => setCopied(null), 2000);
	};

	const cfSaas = dnsInfo?.cloudflareSaas;
	const isCfActive = Boolean(cfSaas?.isActive);

	const recordType = dnsInfo?.recordType || "CNAME";
	const recordName =
		dnsInfo?.recordName ||
		(domain.host.split(".").length > 2 ? domain.host.split(".")[0] || "@" : "@");
	const recordTarget =
		dnsInfo?.recordValue ||
		dnsInfo?.target ||
		dnsInfo?.cnameTarget ||
		"cname.hatdot.cloud";

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="group hover:bg-indigo-500/10 h-8 w-8"
					title="DNS & SSL Configuration Guide"
				>
					<HelpCircle className="size-4 text-muted-foreground group-hover:text-indigo-400" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<div className="flex items-center justify-between pr-4">
						<DialogTitle className="flex items-center gap-2 text-base">
							<Globe className="size-5 text-indigo-500" />
							Connect Domain — DNS & SSL Configuration
						</DialogTitle>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs gap-1"
							disabled={isFetching || isRechecking}
							onClick={handleRefresh}
						>
							{isFetching || isRechecking ? (
								<Loader2 className="size-3 animate-spin" />
							) : (
								<RefreshCw className="size-3" />
							)}
							Re-check Status
						</Button>
					</div>
					<DialogDescription className="text-xs">
						{isCfActive
							? "Cloudflare for SaaS manages edge SSL and traffic routing for your domain."
							: "Configure DNS records at your domain registrar (Cloudflare, GoDaddy, Namecheap) pointing to HatDot."}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 text-xs pt-1">
					{/* Cloudflare for SaaS 4-Step Lifecycle Progression */}
					{isCfActive && cfSaas && (
						<div className="rounded-lg border bg-muted/40 p-3 space-y-3">
							<div className="flex items-center justify-between">
								<span className="font-semibold text-xs flex items-center gap-1.5 text-foreground">
									<Cloud className="size-4 text-cyan-400" />
									Domain Lifecycle Status
								</span>
								<Badge
									variant="outline"
									className={`text-[11px] font-medium capitalize ${
										cfSaas.status === "active"
											? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
											: cfSaas.status === "error"
											? "bg-red-500/10 text-red-400 border-red-500/30"
											: "bg-amber-500/10 text-amber-300 border-amber-500/30"
									}`}
								>
									{cfSaas.stageName}
								</Badge>
							</div>

							{/* 4-Step Visual Stepper */}
							<div className="grid grid-cols-4 gap-1.5 pt-1">
								{[
									{ step: 1, label: "DNS Config" },
									{ step: 2, label: "Ownership" },
									{ step: 3, label: "SSL Issuance" },
									{ step: 4, label: "Active HTTPS" },
								].map((item) => {
									const isCompleted = cfSaas.stageStep > item.step || cfSaas.status === "active";
									const isCurrent = cfSaas.stageStep === item.step && cfSaas.status !== "active";

									return (
										<div
											key={item.step}
											className={`p-2 rounded-md border text-center transition-colors ${
												isCompleted
													? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
													: isCurrent
													? "bg-amber-950/30 border-amber-500/40 text-amber-200"
													: "bg-muted/30 border-border/40 text-muted-foreground opacity-60"
											}`}
										>
											<div className="flex items-center justify-center gap-1 text-[10px] font-bold">
												{isCompleted ? (
													<CheckCircle2 className="size-3 text-emerald-400" />
												) : (
													<span>Step {item.step}</span>
												)}
											</div>
											<span className="text-[10px] block truncate mt-0.5">{item.label}</span>
										</div>
									);
								})}
							</div>

							<div className="text-[11px] text-muted-foreground flex items-center justify-between pt-1">
								<span>{cfSaas.customerActionRequired}</span>
								{cfSaas.lastSyncAt && (
									<span className="text-[10px] opacity-75">
										Synced: {new Date(cfSaas.lastSyncAt).toLocaleTimeString()}
									</span>
								)}
							</div>
						</div>
					)}

					{/* Standard Status Banner if not using Cloudflare for SaaS */}
					{!isCfActive && dnsInfo && (
						<div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
							<div className="flex items-center gap-2">
								{dnsInfo.verified ? (
									<Badge
										variant="outline"
										className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1.5"
									>
										<CheckCircle2 className="size-3.5" />
										DNS Configured Correctly
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="bg-amber-500/10 text-amber-300 border-amber-500/20 flex items-center gap-1.5"
									>
										<AlertCircle className="size-3.5" />
										Pending DNS Verification
									</Badge>
								)}
							</div>
							<span className="text-muted-foreground text-[11px] truncate max-w-xs">
								{dnsInfo.message}
							</span>
						</div>
					)}

					{/* Required DNS Records */}
					<div className="rounded-lg border p-4 bg-background space-y-3">
						<div className="flex items-center justify-between">
							<h3 className="font-semibold text-foreground text-xs flex items-center gap-1.5">
								<Server className="size-4 text-indigo-400" />
								Required DNS Records
							</h3>
							<span className="text-[11px] text-muted-foreground">
								Add to your domain's DNS management
							</span>
						</div>

						{/* If Cloudflare SaaS returned structured records */}
						{isCfActive && cfSaas?.records && cfSaas.records.length > 0 ? (
							<div className="space-y-2.5">
								{cfSaas.records.map((rec, idx) => (
									<div
										key={idx}
										className="p-3 rounded-lg bg-muted/40 border border-border/80 space-y-2 font-mono text-xs"
									>
										<div className="flex items-center justify-between font-sans">
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="font-mono text-xs font-bold uppercase">
													{rec.type}
												</Badge>
												<span className="text-xs font-semibold text-foreground font-sans">
													{rec.purpose}
												</span>
											</div>
											<Badge
												variant="secondary"
												className={`text-[10px] capitalize font-sans ${
													rec.status === "active" || rec.status === "verified"
														? "text-emerald-400"
														: "text-amber-400"
												}`}
											>
												{rec.status}
											</Badge>
										</div>

										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-xs">
											<div className="p-2 rounded bg-background border flex items-center justify-between">
												<div className="overflow-hidden pr-2">
													<span className="text-muted-foreground block text-[9px] uppercase font-sans font-medium">
														Name / Host
													</span>
													<span className="font-bold text-foreground truncate block">
														{rec.name}
													</span>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="size-6 text-muted-foreground hover:text-foreground shrink-0"
													onClick={() => copyToClipboard(rec.name, "Name")}
												>
													{copied === "Name" ? (
														<Check className="size-3 text-emerald-500" />
													) : (
														<Copy className="size-3" />
													)}
												</Button>
											</div>

											<div className="p-2 rounded bg-background border flex items-center justify-between">
												<div className="overflow-hidden pr-2">
													<span className="text-muted-foreground block text-[9px] uppercase font-sans font-medium">
														Target / Value
													</span>
													<span className="font-bold text-indigo-400 truncate block">
														{rec.value}
													</span>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="size-6 text-muted-foreground hover:text-foreground shrink-0"
													onClick={() => copyToClipboard(rec.value, "Value")}
												>
													{copied === "Value" ? (
														<Check className="size-3 text-emerald-500" />
													) : (
														<Copy className="size-3" />
													)}
												</Button>
											</div>
										</div>

										<p className="text-[10px] text-muted-foreground font-sans">{rec.description}</p>
									</div>
								))}
							</div>
						) : (
							/* Standard CNAME Record Display */
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs">
								<div className="p-2.5 rounded-md bg-muted/50 border space-y-1">
									<span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium">
										Record Type
									</span>
									<span className="font-bold text-foreground">{recordType}</span>
								</div>

								<div className="p-2.5 rounded-md bg-muted/50 border space-y-1 flex items-center justify-between">
									<div>
										<span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium">
											Name / Host
										</span>
										<span className="font-bold text-foreground">{recordName}</span>
									</div>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 text-muted-foreground hover:text-foreground"
										onClick={() => copyToClipboard(recordName, "Name")}
									>
										{copied === "Name" ? (
											<Check className="size-3 text-emerald-500" />
										) : (
											<Copy className="size-3" />
										)}
									</Button>
								</div>

								<div className="p-2.5 rounded-md bg-muted/50 border space-y-1 flex items-center justify-between">
									<div className="overflow-hidden pr-1">
										<span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium">
											Target / Hostname
										</span>
										<span className="font-bold text-indigo-400 truncate block">
											{recordTarget}
										</span>
									</div>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 text-muted-foreground hover:text-foreground shrink-0"
										onClick={() => copyToClipboard(recordTarget, "Target")}
									>
										{copied === "Target" ? (
											<Check className="size-3 text-emerald-500" />
										) : (
											<Copy className="size-3" />
										)}
									</Button>
								</div>
							</div>
						)}
					</div>

					{/* Apex Domain Guidance */}
					{dnsInfo?.apexGuidance && (
						<div className="p-3 rounded-lg border bg-amber-950/20 border-amber-500/20 space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-amber-400 text-xs">
								<AlertCircle className="size-3.5" />
								Apex / Root Domain Notice
							</div>
							<p className="text-[11px] text-amber-200/80 leading-relaxed">
								{dnsInfo.apexGuidance.note}
							</p>
						</div>
					)}

					{/* Cloudflare Guidance (for customers who manage DNS in Cloudflare) */}
					{dnsInfo?.cloudflareGuidance && (
						<div className="p-3 rounded-lg border bg-cyan-950/20 border-cyan-500/20 space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-cyan-400 text-xs">
								<Cloud className="size-3.5" />
								Managing DNS in Cloudflare
							</div>
							<p className="text-[11px] text-cyan-200/80 leading-relaxed">
								{isCfActive
									? "Because HatDot uses Cloudflare for SaaS, you can set your CNAME record to Proxied (Orange Cloud) or DNS-Only (Grey Cloud). Edge certificates will be provisioned automatically."
									: dnsInfo.cloudflareGuidance.initialSetupNote}
							</p>
						</div>
					)}

					{/* HTTPS & Verification Note */}
					<div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
						<Lock className="size-3 text-emerald-400" />
						{isCfActive
							? "Cloudflare for SaaS automatically provisions and renews SSL certificates as soon as required DNS verification completes."
							: "HatDot will automatically verify the domain and configure HTTPS once DNS propagation completes."}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};

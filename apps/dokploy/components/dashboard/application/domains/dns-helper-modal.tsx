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
} from "lucide-react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
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
		host: string;
		https: boolean;
		path?: string;
	};
	serverIp?: string;
}

export const DnsHelperModal = ({ domain, serverIp }: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);

	const {
		data: dnsInfo,
		isLoading,
		isFetching,
		refetch,
	} = api.domain.dnsInstructions.useQuery(
		{ host: domain.host },
		{ enabled: isOpen, refetchOnWindowFocus: false },
	);

	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text);
		setCopied(label);
		toast.success(`Copied ${label} to clipboard!`);
		setTimeout(() => setCopied(null), 2000);
	};

	const recordType = dnsInfo?.recordType || "CNAME";
	const recordName =
		dnsInfo?.recordName ||
		(domain.host.split(".").length > 2 ? domain.host.split(".")[0] || "@" : "@");
	const recordTarget =
		dnsInfo?.recordValue ||
		dnsInfo?.target ||
		dnsInfo?.cnameTarget ||
		"hatdot.cloud";

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon" className="group" title="DNS Configuration Guide">
					<HelpCircle className="size-4 text-muted-foreground group-hover:text-foreground" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<div className="flex items-center justify-between pr-4">
						<DialogTitle className="flex items-center gap-2 text-base">
							<Globe className="size-5 text-indigo-500" />
							Connect Your Domain — DNS Configuration
						</DialogTitle>
						{dnsInfo && (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs gap-1"
								disabled={isFetching}
								onClick={() => refetch()}
							>
								{isFetching ? (
									<Loader2 className="size-3 animate-spin" />
								) : (
									<RefreshCw className="size-3" />
								)}
								Check DNS
							</Button>
						)}
					</div>
					<DialogDescription className="text-xs">
						Create a DNS record with your domain provider (Cloudflare, GoDaddy, Namecheap) pointing to HatDot.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 text-xs">
					{/* Status Banner */}
					{dnsInfo && (
						<div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40">
							<div className="flex items-center gap-2">
								{dnsInfo.verified ? (
									<Badge
										variant="outline"
										className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 flex items-center gap-1.5"
									>
										<CheckCircle2 className="size-3.5" />
										DNS Configured Correctly
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="bg-amber-500/10 text-amber-500 border-amber-500/20 flex items-center gap-1.5"
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

					{/* Required DNS Record Box */}
					<div className="rounded-lg border p-4 bg-background space-y-3">
						<div className="flex items-center justify-between">
							<h3 className="font-semibold text-foreground text-xs flex items-center gap-1.5">
								<Server className="size-4 text-indigo-400" />
								Required DNS Record
							</h3>
							<span className="text-[11px] text-muted-foreground">
								Target: Provider-Managed Hostname
							</span>
						</div>

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
					</div>

					{/* Cloudflare Guidance */}
					{dnsInfo?.cloudflareGuidance && (
						<div className="p-3 rounded-lg border bg-cyan-950/20 border-cyan-500/20 space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-cyan-400 text-xs">
								<Cloud className="size-3.5" />
								Cloudflare Proxy Setting
							</div>
							<p className="text-[11px] text-cyan-200/80 leading-relaxed">
								{dnsInfo.cloudflareGuidance.initialSetupNote}
							</p>
						</div>
					)}

					{/* Apex Domain Guidance */}
					{dnsInfo?.apexGuidance && (
						<div className="p-3 rounded-lg border bg-amber-950/20 border-amber-500/20 space-y-1">
							<div className="flex items-center gap-1.5 font-semibold text-amber-400 text-xs">
								<AlertCircle className="size-3.5" />
								Apex Domain Notice
							</div>
							<p className="text-[11px] text-amber-200/80 leading-relaxed">
								{dnsInfo.apexGuidance.note}
							</p>
						</div>
					)}

					{/* HTTPS & Verification note */}
					<div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
						<Lock className="size-3 text-emerald-400" />
						HatDot will automatically verify the domain and issue a Let's Encrypt TLS certificate once the DNS record propagates.
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};

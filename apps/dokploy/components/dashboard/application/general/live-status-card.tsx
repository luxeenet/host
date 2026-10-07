import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Globe,
	Loader2,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { api } from "@/utils/api";

interface Props {
	applicationId: string;
}

export const LiveStatusCard = ({ applicationId }: Props) => {
	const [expanded, setExpanded] = useState(false);
	const {
		data: status,
		isLoading,
		isFetching,
		refetch,
	} = api.application.verifyLiveUrl.useQuery(
		{ applicationId },
		{
			enabled: !!applicationId,
			refetchOnWindowFocus: false,
		},
	);

	if (isLoading) {
		return (
			<Card className="bg-background border-border">
				<CardHeader className="py-4">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>Checking public test URL reachability...</span>
					</div>
				</CardHeader>
			</Card>
		);
	}

	if (!status) return null;

	const { isLive, testUrl, checks, statusCode, responseTimeMs, message, details } = status;

	return (
		<Card className="bg-background border-border">
			<CardHeader className="py-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						{isLive ? (
							<ShieldCheck className="size-5 text-emerald-500" />
						) : (
							<ShieldAlert className="size-5 text-amber-500" />
						)}
						<div>
							<CardTitle className="text-base flex items-center gap-2">
								{isLive ? "Application is Live" : "Public URL Status"}
								{isLive ? (
									<Badge
										variant="outline"
										className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs flex items-center gap-1"
									>
										<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
										Live & Responding
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs"
									>
										Checking Reachability
									</Badge>
								)}
							</CardTitle>
							<CardDescription className="text-xs mt-0.5">
								{message}
							</CardDescription>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							className="h-8 text-xs flex items-center gap-1 text-muted-foreground"
							onClick={() => refetch()}
							disabled={isFetching}
						>
							<RefreshCw
								className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
							/>
							<span>Verify URL</span>
						</Button>
						{details && (
							<Button
								variant="ghost"
								size="sm"
								className="h-8 px-2"
								onClick={() => setExpanded(!expanded)}
							>
								{expanded ? (
									<ChevronUp className="size-4 text-muted-foreground" />
								) : (
									<ChevronDown className="size-4 text-muted-foreground" />
								)}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>

			<CardContent className="pt-0 pb-4 space-y-3">
				{/* Public URL row */}
				<div className="flex items-center justify-between p-2.5 rounded-md bg-muted/40 border border-border/60">
					<div className="flex items-center gap-2 min-w-0">
						<Globe className="size-4 text-muted-foreground shrink-0" />
						<span className="text-xs font-medium text-muted-foreground">
							Public URL:
						</span>
						<Link
							href={testUrl}
							target="_blank"
							rel="noreferrer"
							className="text-xs font-mono text-primary truncate hover:underline flex items-center gap-1"
						>
							<span>{testUrl}</span>
							<ExternalLink className="size-3 shrink-0" />
						</Link>
					</div>

					{responseTimeMs && (
						<div className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 pl-2">
							<Zap className="size-3 text-amber-500" />
							<span>{responseTimeMs}ms</span>
						</div>
					)}
				</div>

				{/* 4 Health indicators */}
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
					<div className="flex items-center gap-1.5 text-xs">
						{checks.deploymentHealthy ? (
							<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
						) : (
							<AlertCircle className="size-3.5 text-destructive shrink-0" />
						)}
						<span className="text-muted-foreground">
							{checks.deploymentHealthy ? "Deployment healthy" : "Deploying / Idle"}
						</span>
					</div>

					<div className="flex items-center gap-1.5 text-xs">
						{checks.dnsResolves ? (
							<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
						) : (
							<AlertCircle className="size-3.5 text-amber-500 shrink-0" />
						)}
						<span className="text-muted-foreground">
							{checks.dnsResolves ? "DNS reachable" : "DNS resolving"}
						</span>
					</div>

					<div className="flex items-center gap-1.5 text-xs">
						{checks.appResponding ? (
							<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
						) : (
							<AlertCircle className="size-3.5 text-amber-500 shrink-0" />
						)}
						<span className="text-muted-foreground">
							{checks.appResponding
								? `Responding (${statusCode ?? "200"})`
								: "Waiting for response"}
						</span>
					</div>

					<div className="flex items-center gap-1.5 text-xs">
						{checks.httpsActive ? (
							<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
						) : (
							<AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
						)}
						<span className="text-muted-foreground">
							{checks.httpsActive ? "HTTPS active" : "HTTP active"}
						</span>
					</div>
				</div>

				{/* Expanded details */}
				{expanded && details && (
					<div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
						<span className="font-semibold block mb-0.5">Diagnostic Details:</span>
						<span>{details}</span>
					</div>
				)}
			</CardContent>
		</Card>
	);
};

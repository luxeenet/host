import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Loader2,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
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

export const DeploymentPreflightCard = ({ applicationId }: Props) => {
	const [expanded, setExpanded] = useState(true);
	const {
		data: report,
		isLoading,
		isFetching,
		refetch,
	} = api.application.preflightCheck.useQuery(
		{ applicationId },
		{
			enabled: !!applicationId,
			refetchOnWindowFocus: false,
		},
	);

	if (isLoading) {
		return (
			<Card className="bg-background">
				<CardHeader className="py-4">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>Validating application deployment readiness...</span>
					</div>
				</CardHeader>
			</Card>
		);
	}

	if (!report) return null;

	const hasFailure = report.items.some((i) => i.status === "fail");
	const hasWarnings = report.items.some((i) => i.status === "warn");

	return (
		<Card className="bg-background">
			<CardHeader className="py-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{hasFailure ? (
							<ShieldAlert className="size-5 text-destructive" />
						) : (
							<ShieldCheck className="size-5 text-emerald-500" />
						)}
						<div>
							<CardTitle className="text-base flex items-center gap-2">
								Deployment Readiness Check
								{hasFailure ? (
									<Badge variant="destructive" className="text-xs">
										Action Required
									</Badge>
								) : hasWarnings ? (
									<Badge
										variant="outline"
										className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs"
									>
										Ready with Warnings
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs"
									>
										✓ Ready to Deploy
									</Badge>
								)}
							</CardTitle>
							<CardDescription className="text-xs mt-0.5">
								{report.summary}
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
							<span>Check Again</span>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 px-2"
							onClick={() => setExpanded(!expanded)}
						>
							{expanded ? (
								<ChevronUp className="size-4" />
							) : (
								<ChevronDown className="size-4" />
							)}
						</Button>
					</div>
				</div>
			</CardHeader>

			{expanded && (
				<CardContent className="pt-0 pb-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t">
						{report.items.map((item) => {
							const isPass = item.status === "pass";
							const isWarn = item.status === "warn";
							const isFail = item.status === "fail";

							return (
								<div
									key={item.id}
									className={`p-2.5 rounded-lg border text-xs flex flex-col gap-1 transition-all ${
										isFail
											? "bg-destructive/5 border-destructive/30 text-destructive"
											: isWarn
												? "bg-amber-500/5 border-amber-500/20"
												: "bg-muted/20 border-border"
									}`}
								>
									<div className="flex items-center justify-between font-medium">
										<span className="flex items-center gap-1.5">
											{isPass && (
												<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
											)}
											{isWarn && (
												<AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
											)}
											{isFail && (
												<AlertCircle className="size-3.5 text-destructive shrink-0" />
											)}
											<span className="text-foreground">{item.title}</span>
										</span>
									</div>

									<p className="text-muted-foreground text-[11px] pl-5 leading-tight">
										{item.summary}
									</p>

									{item.fixSuggestion && (
										<div className="mt-1 ml-5 p-1.5 rounded bg-background/80 border text-[11px] text-foreground font-sans">
											<span className="font-semibold text-primary">
												Suggested Action:{" "}
											</span>
											{item.fixSuggestion}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</CardContent>
			)}
		</Card>
	);
};

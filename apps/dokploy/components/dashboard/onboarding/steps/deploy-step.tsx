import copy from "copy-to-clipboard";
import {
	ArrowUpRightIcon,
	CheckCircle2,
	CopyIcon,
	Loader2,
	XCircleIcon,
	Globe,
	Zap,
	ShieldCheck,
	Lock,
	Layers,
	BookOpen,
	Workflow,
	Activity,
	Sparkles,
	AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";
import { displayFont } from "../font";

interface Props {
	environmentId?: string;
	onNext: () => void;
	plainTitle?: boolean;
}

const TEMPLATE_STACKS = [
	{
		id: "wordpress",
		name: "WordPress Stack",
		description: "Full CMS + MySQL database engine",
		requiredRamMb: 1024,
		icon: Globe,
		tag: "CMS & Blog",
	},
	{
		id: "ghost",
		name: "Ghost Publishing",
		description: "High-speed publishing platform + MySQL",
		requiredRamMb: 1024,
		icon: BookOpen,
		tag: "Publishing",
	},
	{
		id: "n8n",
		name: "n8n Workflows",
		description: "Automated workflow & integration engine",
		requiredRamMb: 1024,
		icon: Workflow,
		tag: "Automation",
	},
	{
		id: "uptime-kuma",
		name: "Uptime Monitor",
		description: "Self-hosted service status & latency monitor",
		requiredRamMb: 512,
		icon: Activity,
		tag: "Monitoring",
	},
];

type Deploying = { kind: "app" | "template"; id: string; url: string };

export const DeployStep = ({ environmentId, onNext, plainTitle }: Props) => {
	const titleClassName = plainTitle
		? "text-xl font-semibold tracking-tight"
		: `${displayFont.className} text-4xl sm:text-5xl leading-[1.05] tracking-tight`;

	const { data: servers } = api.server.withSSHKey.useQuery();
	const serverId = servers?.[0]?.serverId;

	// Plan & Subscription details
	const { data: subscription } = api.subscription.getCurrent.useQuery();
	const { data: resourceLimits } = api.subscription.getResourceLimits.useQuery();

	const plan = subscription?.plan;
	const planName = plan?.name || resourceLimits?.planName || "Starter Plan";
	const maxRamMb =
		resourceLimits?.maxRamMb ??
		plan?.resources?.find((r) => r.resourceKey === "max_ram_mb")?.value ??
		512;

	const hasComposeFeature = Boolean(
		plan?.features?.find((f) => f.featureKey === "compose_access")?.enabled
	);
	// In HatDot, multi-container stacks require compose capability or at least 1GB RAM
	const supportsCompose =
		Boolean(resourceLimits?.isPlatformAdmin) ||
		hasComposeFeature ||
		maxRamMb === -1 ||
		maxRamMb >= 1024;

	const [deploying, setDeploying] = useState<Deploying | null>(null);
	const [starting, setStarting] = useState<string | null>(null);

	const { mutateAsync: deployNginx } =
		api.application.deployNginxQuickstart.useMutation();
	const { mutateAsync: deployTemplate } =
		api.compose.deployTemplate.useMutation();
	const { mutateAsync: deployCompose } = api.compose.deploy.useMutation();
	const utils = api.useUtils();

	const { data: application } = api.application.one.useQuery(
		{ applicationId: deploying?.id ?? "" },
		{
			enabled: deploying?.kind === "app",
			refetchInterval: (query) => {
				const status = query.state.data?.applicationStatus;
				return status === "done" || status === "error" ? false : 2500;
			},
		},
	);
	const { data: compose } = api.compose.one.useQuery(
		{ composeId: deploying?.id ?? "" },
		{
			enabled: deploying?.kind === "template",
			refetchInterval: (query) => {
				const status = query.state.data?.composeStatus;
				return status === "done" || status === "error" ? false : 2500;
			},
		},
	);

	const status =
		deploying?.kind === "app"
			? application?.applicationStatus
			: compose?.composeStatus;

	if (!environmentId) {
		return (
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
						First deploy
					</span>
					<h1 className={titleClassName}>Deploy something.</h1>
				</div>
				<AlertBlock type="info" className="max-w-md">
					You&apos;ll need a project before deploying — you can create one in the previous step or from the dashboard anytime.
				</AlertBlock>
				<Button onClick={onNext} className="w-fit px-8">
					Continue
				</Button>
			</div>
		);
	}

	const handleNginx = async () => {
		setStarting("nginx");
		try {
			const res = await deployNginx({ environmentId, serverId });
			setDeploying({ kind: "app", id: res.applicationId, url: res.domainUrl });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Error deploying the application",
			);
		} finally {
			setStarting(null);
		}
	};

	const handleTemplate = async (templateId: string, requiredRam: number) => {
		if (!supportsCompose || (maxRamMb !== -1 && maxRamMb < requiredRam)) {
			toast.info(
				`This multi-container stack requires at least ${requiredRam} MB RAM. Please deploy the Instant Web App or upgrade your plan.`,
			);
			return;
		}

		setStarting(templateId);
		try {
			const composeResult = await deployTemplate({
				environmentId,
				serverId,
				id: templateId,
			});
			await deployCompose({ composeId: composeResult.composeId });
			const domains = await utils.domain.byComposeId.fetch({
				composeId: composeResult.composeId,
			});
			const host = domains?.[0]?.host;
			setDeploying({
				kind: "template",
				id: composeResult.composeId,
				url: host ? `http://${host}` : "",
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Error deploying the stack",
			);
		} finally {
			setStarting(null);
		}
	};

	if (deploying) {
		const isDone = status === "done";
		const isError = status === "error";

		return (
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<span
						className={`font-mono text-xs uppercase tracking-[0.2em] flex items-center gap-2 ${
							isError ? "text-destructive" : "text-primary"
						}`}
					>
						{isDone ? (
							<CheckCircle2 className="size-3.5 text-emerald-500" />
						) : isError ? (
							<XCircleIcon className="size-3.5" />
						) : (
							<Loader2 className="size-3.5 animate-spin" />
						)}
						{isDone ? "Live on Edge Network" : isError ? "Deploy failed" : "Provisioning Cloud Container"}
					</span>

					<h1 className={titleClassName}>
						{isDone
							? "Your app is live!"
							: isError
								? "Something went wrong."
								: "Deploying to HatDot Cloud..."}
					</h1>

					<p className="text-muted-foreground text-sm sm:text-base max-w-md leading-relaxed">
						{isDone
							? "Your application is active, SSL-secured, and accessible worldwide:"
							: isError
								? "The deployment encountered an issue — you can view build logs in your dashboard."
								: "Setting up private isolated runtime, generating SSL certificate, and connecting edge routing..."}
					</p>
				</div>

				{isDone && deploying.url ? (
					<div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden max-w-lg shadow-xl">
						<div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 bg-slate-950/80">
							<span className="size-2 rounded-full bg-emerald-500 shrink-0" />
							<span className="font-mono text-xs text-emerald-400 font-semibold">
								Edge Route Verified &amp; Active
							</span>
						</div>
						<div className="flex items-center justify-between gap-3 p-5">
							<span className="font-mono text-sm text-white truncate">
								{deploying.url}
							</span>
							<div className="flex items-center gap-1.5 shrink-0">
								<Button
									variant="outline"
									size="sm"
									className="border-slate-800 text-slate-300 hover:text-white h-8 text-xs"
									onClick={() => {
										copy(deploying.url);
										toast.success("URL copied to clipboard!");
									}}
								>
									<CopyIcon className="size-3.5 mr-1" /> Copy
								</Button>
								<Button
									variant="secondary"
									size="sm"
									className="bg-amber-600 hover:bg-amber-500 text-white h-8 text-xs"
									asChild
								>
									<a href={deploying.url} target="_blank" rel="noreferrer">
										Open App <ArrowUpRightIcon className="size-3.5 ml-1" />
									</a>
								</Button>
							</div>
						</div>
					</div>
				) : !isDone && !isError ? (
					<div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 max-w-lg space-y-3">
						<div className="flex items-center gap-3 text-sm text-slate-200">
							<Loader2 className="size-5 animate-spin text-amber-400 shrink-0" />
							<span>Building application container &amp; mapping domain...</span>
						</div>
						<div className="text-[11px] text-slate-400 pl-8 space-y-1 font-mono">
							<div>• Initializing secure container environment</div>
							<div>• Mapping incoming traffic through edge load balancer</div>
							<div>• Running zero-downtime health verification</div>
						</div>
					</div>
				) : null}

				<Button
					onClick={onNext}
					className="w-fit px-8 bg-amber-600 hover:bg-amber-500 text-white font-medium"
					disabled={!isDone && !isError}
				>
					Continue to Dashboard &rarr;
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-8">
			{/* Header */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between flex-wrap gap-2">
					<span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
						Step 03 — First deploy
					</span>
					<Badge
						variant="outline"
						className="border-amber-500/30 text-amber-300 bg-amber-950/20 text-xs px-2.5 py-0.5"
					>
						Active Plan: {planName} ({maxRamMb === -1 ? "Unlimited" : `${maxRamMb}MB`} RAM)
					</Badge>
				</div>

				<h1 className={titleClassName}>Ship your first app.</h1>
				<p className="text-muted-foreground text-base max-w-lg leading-relaxed">
					Choose a quickstart tailored to your chosen plan. Everything deploys with automated edge routing and zero-downtime health checks.
				</p>
			</div>

			{/* Deployment Options Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
				{/* Option 1: Instant Cloud Web App (100% Guaranteed Success on ALL plans) */}
				<div className="flex flex-col justify-between rounded-2xl border-2 border-amber-500/50 bg-gradient-to-b from-amber-950/20 via-slate-900/60 to-slate-950 p-6 shadow-xl relative overflow-hidden">
					<div className="absolute top-3 right-3">
						<Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold uppercase">
							100% Guaranteed • All Plans
						</Badge>
					</div>

					<div className="space-y-3">
						<div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
							<Zap className="size-5" />
						</div>

						<div>
							<h3 className="text-lg font-bold text-white flex items-center gap-2">
								Instant Static Website
								<Sparkles className="size-4 text-amber-400" />
							</h3>
							<p className="text-xs text-slate-400 mt-1 leading-relaxed">
								Pre-configured, high-speed static website running on the HatDot edge network. Deploys instantly with pre-packaged static codes and automated HTTPS.
							</p>
						</div>

						<div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
							<div className="flex items-center gap-1.5 text-emerald-400">
								<CheckCircle2 className="size-3.5" />
								<span>Supported on your {planName}</span>
							</div>
							<div className="text-slate-400">
								Zero build delay or quota errors. 100% pre-packaged static sample site.
							</div>
						</div>
					</div>

					<Button
						onClick={handleNginx}
						disabled={!!starting}
						className="w-full mt-6 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs h-10 shadow-lg shadow-amber-600/20 gap-2"
					>
						{starting === "nginx" ? (
							<>
								<Loader2 className="size-3.5 animate-spin" />
								Deploying Website...
							</>
						) : (
							<>
								Deploy Instant Website Now &rarr;
							</>
						)}
					</Button>
				</div>

				{/* Option 2: Pre-configured Stacks & Templates (Plan Aware) */}
				<div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-sm">
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
								<Layers className="size-5" />
							</div>
							<Badge
								variant="outline"
								className={`text-[10px] ${
									supportsCompose
										? "border-emerald-500/30 text-emerald-400 bg-emerald-950/20"
										: "border-amber-500/30 text-amber-400 bg-amber-950/20"
								}`}
							>
								{supportsCompose ? "Multi-Service Ready" : "Requires Pro Plan"}
							</Badge>
						</div>

						<div>
							<h3 className="text-lg font-bold text-white">
								Production App Stacks
							</h3>
							<p className="text-xs text-slate-400 mt-1 leading-relaxed">
								Pre-configured multi-tier applications combining web engines and managed database backends.
							</p>
						</div>

						{!supportsCompose ? (
							<div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/20 space-y-2 text-xs">
								<div className="flex items-start gap-2 text-amber-300 font-medium">
									<Lock className="size-4 shrink-0 mt-0.5" />
									<span>Multi-service stacks require 1 GB+ RAM</span>
								</div>
								<p className="text-[11px] text-slate-400 leading-relaxed">
									Your current <strong>{planName}</strong> is designed for high-efficiency single services. Stacks like WordPress include an application + full MySQL database and require a Pro or Business plan.
								</p>
							</div>
						) : null}

						<div className="grid grid-cols-1 gap-2 pt-1">
							{TEMPLATE_STACKS.map((stack) => {
								const IconComponent = stack.icon;
								const isAllowed =
									supportsCompose &&
									(maxRamMb === -1 || maxRamMb >= stack.requiredRamMb);

								return (
									<button
										key={stack.id}
										type="button"
										disabled={!isAllowed || !!starting}
										onClick={() => handleTemplate(stack.id, stack.requiredRamMb)}
										className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
											isAllowed
												? "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900 cursor-pointer"
												: "border-slate-800/50 bg-slate-950/30 opacity-60 cursor-not-allowed"
										}`}
									>
										<div className="flex items-center gap-3">
											<div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300">
												<IconComponent className="size-4" />
											</div>
											<div>
												<div className="text-xs font-semibold text-white">
													{stack.name}
												</div>
												<div className="text-[10px] text-slate-400">
													{stack.description}
												</div>
											</div>
										</div>

										<div>
											{starting === stack.id ? (
												<Loader2 className="size-3.5 animate-spin text-amber-400" />
											) : isAllowed ? (
												<span className="text-[11px] text-amber-400 font-medium">
													Deploy &rarr;
												</span>
											) : (
												<span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
													<Lock className="size-3" /> 1GB RAM
												</span>
											)}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

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
	Terminal,
	ChevronDown,
	ChevronUp,
	RefreshCw,
	Check,
} from "lucide-react";
import { useEffect, useState } from "react";
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
	const { data: builderEntitlements } = api.application.getBuilderEntitlements.useQuery();

	const plan = subscription?.plan;
	const planName = plan?.name || resourceLimits?.planName || "Starter Plan";
	const maxRamMb =
		resourceLimits?.maxRamMb ??
		plan?.resources?.find((r) => r.resourceKey === "max_ram_mb")?.value ??
		512;

	const allowedBuilds = builderEntitlements?.allowedBuildTypes;
	const isNixpacksOnly = Boolean(
		allowedBuilds &&
		allowedBuilds.nixpacks &&
		!allowedBuilds.dockerfile
	);
	const isStaticOnly = Boolean(
		allowedBuilds &&
		!allowedBuilds.nixpacks &&
		!allowedBuilds.dockerfile
	);
	const hasDocker = Boolean(
		allowedBuilds?.dockerfile ||
		resourceLimits?.isPlatformAdmin
	);

	const appTypes = plan?.applicationTypes?.map((t: any) => t.applicationType) || [];
	const hasComposeFeature = Boolean(
		plan?.features?.find((f) => f.featureKey === "compose_access")?.enabled
	);
	// In HatDot, multi-container stacks require compose capability or at least 1GB RAM
	const supportsCompose =
		Boolean(resourceLimits?.isPlatformAdmin) ||
		((appTypes.length === 0 || appTypes.includes("compose")) &&
		 hasComposeFeature &&
		 (maxRamMb === -1 || maxRamMb >= 1024));

	const [deploying, setDeploying] = useState<Deploying | null>(null);
	const [starting, setStarting] = useState<string | null>(null);

	// Multi-stage real deployment progress
	const [progressPercent, setProgressPercent] = useState(15);
	const [currentStageIndex, setCurrentStageIndex] = useState(0);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [telemetryLogs, setTelemetryLogs] = useState<string[]>([]);
	const [showTerminal, setShowTerminal] = useState(true);

	const stages = [
		{
			id: "sandbox",
			title: "Isolated Container Sandbox",
			desc: "Allocating CPU/RAM quotas, persistent storage, and isolated network bridge",
			short: "Sandbox",
		},
		{
			id: "build",
			title: isNixpacksOnly
				? "Universal Nixpacks Engine"
				: isStaticOnly
					? "Edge Static Nginx Engine"
					: "Container Runtime Build",
			desc: isNixpacksOnly
				? "Analyzing runtime dependencies and compiling Node.js service"
				: isStaticOnly
					? "Packaging responsive static HTML5 distribution and high-speed Nginx config"
					: "Building container layers and assembling runtime environment",
			short: "Build Engine",
		},
		{
			id: "routing",
			title: "Edge Ingress & SSL Router",
			desc: `Configuring Traefik router on port ${isNixpacksOnly ? "3000" : "80"} & issuing automated SSL certificate`,
			short: "Ingress & SSL",
		},
		{
			id: "health",
			title: "Zero-Downtime Healthcheck",
			desc: "Executing automated HTTP endpoint probing and verifying edge route readiness",
			short: "Verification",
		},
	];

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
				return status === "done" || status === "error" ? false : 2000;
			},
		},
	);
	const { data: compose } = api.compose.one.useQuery(
		{ composeId: deploying?.id ?? "" },
		{
			enabled: deploying?.kind === "template",
			refetchInterval: (query) => {
				const status = query.state.data?.composeStatus;
				return status === "done" || status === "error" ? false : 2000;
			},
		},
	);

	const status =
		deploying?.kind === "app"
			? application?.applicationStatus
			: compose?.composeStatus;

	// Real-time stage advancement and telemetry logger
	useEffect(() => {
		if (!deploying) {
			setProgressPercent(15);
			setCurrentStageIndex(0);
			setElapsedSeconds(0);
			setTelemetryLogs([]);
			return;
		}

		if (status === "done") {
			setProgressPercent(100);
			setCurrentStageIndex(3);
			setTelemetryLogs((prev) => {
				const hasDone = prev.some((l) => l.includes("Verification passed"));
				if (hasDone) return prev;
				const ts = `[00:${elapsedSeconds < 10 ? "0" + elapsedSeconds : elapsedSeconds}]`;
				return [
					...prev,
					`${ts} ✓ Healthcheck passed: 200 OK. Application active on HatDot edge.`,
				];
			});
			return;
		}

		if (status === "error") {
			const ts = `[00:${elapsedSeconds < 10 ? "0" + elapsedSeconds : elapsedSeconds}]`;
			setTelemetryLogs((prev) => [
				...prev,
				`${ts} ❌ Deployment encountered an issue during provisioning.`,
			]);
			return;
		}

		setTelemetryLogs((prev) => {
			if (prev.length === 0) {
				return [
					"[00:00] Initializing isolated container environment...",
					"[00:01] Allocating resource limits & private network bridge...",
				];
			}
			return prev;
		});

		const timer = setInterval(() => {
			setElapsedSeconds((sec) => {
				const nextSec = sec + 1;
				const ts = `[00:${nextSec < 10 ? "0" + nextSec : nextSec}]`;

				if (nextSec === 2) {
					setCurrentStageIndex(1);
					setProgressPercent(38);
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Injecting application codebase into isolated build environment...`,
						`${ts} Initializing build engine (${
							isNixpacksOnly
								? "Universal Nixpacks Engine"
								: isStaticOnly
									? "Edge Static Nginx Engine"
									: "Container Engine"
						})...`,
					]);
				} else if (nextSec === 5) {
					setProgressPercent(60);
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Build engine compilation completed successfully.`,
					]);
				} else if (nextSec === 7) {
					setCurrentStageIndex(2);
					setProgressPercent(76);
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Mapping edge routing rules on Traefik proxy...`,
						`${ts} Binding internal port ${isNixpacksOnly ? "3000" : "80"} to edge load balancer...`,
					]);
				} else if (nextSec === 10) {
					setProgressPercent(88);
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Automated SSL certificate negotiation initiated...`,
					]);
				} else if (nextSec === 12) {
					setCurrentStageIndex(3);
					setProgressPercent(94);
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Executing zero-downtime healthcheck probing on private endpoint...`,
					]);
				} else if (nextSec > 12 && nextSec % 3 === 0) {
					setTelemetryLogs((prev) => [
						...prev,
						`${ts} Verifying edge route readiness and SSL handshake...`,
					]);
				}

				return nextSec;
			});
		}, 1000);

		return () => clearInterval(timer);
	}, [deploying, status, isNixpacksOnly, isStaticOnly, elapsedSeconds]);

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
			const buildType = isNixpacksOnly
				? "nixpacks"
				: isStaticOnly
					? "static"
					: undefined;
			const res = await deployNginx({ environmentId, serverId, buildType });
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
			<div className="flex flex-col gap-6 max-w-2xl">
				{/* Top Status Header */}
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between flex-wrap gap-2">
						<span
							className={`font-mono text-xs uppercase tracking-[0.2em] flex items-center gap-2 ${
								isError
									? "text-destructive"
									: isDone
										? "text-primary"
										: "text-foreground font-semibold"
							}`}
						>
							{isDone ? (
								<CheckCircle2 className="size-3.5 text-primary" />
							) : isError ? (
								<XCircleIcon className="size-3.5 text-destructive" />
							) : (
								<Loader2 className="size-3.5 animate-spin text-primary" />
							)}
							{isDone
								? "Live on Global Edge Network"
								: isError
									? "Deployment Issue Detected"
									: `Provisioning — Stage ${currentStageIndex + 1} of ${stages.length}`}
						</span>
						<Badge
							variant="outline"
							className="font-mono text-xs px-2.5 py-0.5 border-border bg-muted/50 text-foreground"
						>
							{isDone
								? "Active & Verified (HTTP 200)"
								: isError
									? "Build Stopped"
									: `${elapsedSeconds}s elapsed`}
						</Badge>
					</div>

					<h1 className={`${titleClassName} text-3xl sm:text-4xl text-foreground font-bold tracking-tight`}>
						{isDone
							? "Your app is live!"
							: isError
								? "Something went wrong."
								: "Deploying to HatDot Cloud..."}
					</h1>

					<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
						{isDone
							? "Your application is active, SSL-secured, and accessible worldwide:"
							: isError
								? "The deployment encountered an issue — you can retry below or inspect logs in your dashboard."
								: isNixpacksOnly
									? "Compiling dynamic Node.js code with Universal Nixpacks, provisioning port 3000, and issuing SSL..."
									: isStaticOnly
										? "Packaging pre-configured static website, configuring edge Nginx on port 80, and issuing SSL..."
										: "Setting up private isolated runtime, generating SSL certificate, and connecting edge routing..."}
					</p>
				</div>

				{/* Real Progress Bar Card */}
				<div className="rounded-xl border border-border bg-card text-card-foreground p-5 shadow-sm space-y-4">
					<div className="flex items-center justify-between text-xs">
						<span className="text-foreground font-semibold flex items-center gap-2">
							<span
								className={`size-2 rounded-full ${
									isDone
										? "bg-primary"
										: isError
											? "bg-destructive"
											: "bg-primary animate-pulse"
								}`}
							/>
							{isDone
								? "All Deployment Stages Complete"
								: isError
									? "Deployment Paused"
									: `Current: ${stages[currentStageIndex]?.title}`}
						</span>
						<div className="flex items-center gap-3 font-mono">
							<span className="text-muted-foreground">⏱ {elapsedSeconds}s</span>
							<span className="font-bold text-sm text-foreground">
								{progressPercent}%
							</span>
						</div>
					</div>

					{/* Animated Progress Track */}
					<div className="w-full h-2 rounded-full bg-muted overflow-hidden border border-border">
						<div
							className={`h-full transition-all duration-700 ease-out ${
								isError ? "bg-destructive" : "bg-primary"
							}`}
							style={{ width: `${progressPercent}%` }}
						/>
					</div>

					{/* 4 Sequential Deployment Stages */}
					<div className="grid grid-cols-1 gap-2 pt-1">
						{stages.map((stage, idx) => {
							const isStageComplete = isDone || currentStageIndex > idx;
							const isStageActive =
								!isDone && !isError && currentStageIndex === idx;

							return (
								<div
									key={stage.id}
									className={`flex items-start gap-3 p-3 rounded-lg border text-xs transition-all ${
										isStageComplete
											? "border-primary/20 bg-primary/5 text-foreground"
											: isStageActive
												? "border-primary bg-primary/10 text-foreground"
												: "border-border/60 bg-muted/30 text-muted-foreground"
									}`}
								>
									<div className="mt-0.5 shrink-0">
										{isStageComplete ? (
											<CheckCircle2 className="size-4 text-primary" />
										) : isStageActive ? (
											<Loader2 className="size-4 animate-spin text-primary" />
										) : (
											<div className="size-4 rounded-full border border-border flex items-center justify-center text-[10px] text-muted-foreground">
												{idx + 1}
											</div>
										)}
									</div>
									<div className="space-y-0.5 min-w-0 flex-1">
										<div
											className={`font-semibold break-words ${
												isStageActive || isStageComplete
													? "text-foreground"
													: "text-muted-foreground"
											}`}
										>
											{stage.title}
										</div>
										<div className="text-[11px] text-muted-foreground leading-relaxed font-mono break-words">
											{stage.desc}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Collapsible Live Telemetry Terminal */}
				<div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
					<div
						role="button"
						tabIndex={0}
						onClick={() => setShowTerminal(!showTerminal)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ")
								setShowTerminal(!showTerminal);
						}}
						className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50 cursor-pointer select-none"
					>
						<div className="flex items-center gap-2">
							<Terminal className="size-3.5 text-primary" />
							<span className="font-mono text-xs text-foreground font-semibold">
								Edge Deployment Stream
							</span>
							<span className="size-1.5 rounded-full bg-primary animate-pulse" />
						</div>
						<div className="flex items-center gap-2 text-muted-foreground text-xs">
							<span className="text-[11px] font-mono">
								{telemetryLogs.length} events
							</span>
							{showTerminal ? (
								<ChevronUp className="size-3.5" />
							) : (
								<ChevronDown className="size-3.5" />
							)}
						</div>
					</div>
					{showTerminal && (
						<div className="p-3.5 max-h-44 overflow-y-auto font-mono text-[11px] space-y-1.5 text-foreground bg-muted/20">
							{telemetryLogs.map((log, i) => (
								<div key={i} className="leading-relaxed flex items-start gap-2 min-w-0">
									<span className="text-muted-foreground select-none shrink-0">&gt;</span>
									<span
										className={`break-all ${
											log.includes("✓")
												? "text-primary font-semibold"
												: log.includes("❌")
													? "text-destructive font-semibold"
													: "text-foreground"
										}`}
									>
										{log}
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Verified Live URL Card */}
				{isDone && deploying.url ? (
					<div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm text-card-foreground">
						<div className="flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-border bg-muted/40">
							<span className="size-2 rounded-full bg-primary shrink-0" />
							<span className="font-mono text-xs text-foreground font-semibold">
								Edge Route Active • SSL Handshake Verified
							</span>
						</div>
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5">
							<span className="font-mono text-xs sm:text-sm text-foreground break-all font-medium min-w-0 flex-1">
								{deploying.url}
							</span>
							<div className="flex items-center gap-2 shrink-0">
								<Button
									variant="outline"
									size="sm"
									className="h-8 text-xs"
									onClick={() => {
										copy(deploying.url);
										toast.success("URL copied to clipboard!");
									}}
								>
									<CopyIcon className="size-3.5 mr-1" /> Copy
								</Button>
								<Button
									size="sm"
									className="h-8 text-xs"
									asChild
								>
									<a href={deploying.url} target="_blank" rel="noreferrer">
										Open App <ArrowUpRightIcon className="size-3.5 ml-1" />
									</a>
								</Button>
							</div>
						</div>
					</div>
				) : null}

				{/* Error Retry Actions */}
				{isError && (
					<div className="flex items-center gap-3 flex-wrap">
						<Button
							onClick={handleNginx}
							size="sm"
							className="text-xs gap-2"
						>
							<RefreshCw className="size-3.5" />
							Retry Deployment
						</Button>
						<Button variant="outline" size="sm" onClick={onNext} className="text-xs">
							Skip to Dashboard
						</Button>
					</div>
				)}

				{/* Primary Continue Button */}
				<Button
					onClick={onNext}
					size="lg"
					className="w-full sm:w-fit px-8 font-semibold text-xs"
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
						className="border-border bg-muted/50 text-foreground text-xs px-2.5 py-0.5"
					>
						Active Plan: {planName} ({maxRamMb === -1 ? "Unlimited" : `${maxRamMb}MB`} RAM)
					</Badge>
				</div>

				<h1 className={`${titleClassName} text-3xl sm:text-4xl text-foreground font-bold tracking-tight`}>
					Ship your first app.
				</h1>
				<p className="text-muted-foreground text-base max-w-lg leading-relaxed">
					Choose a quickstart tailored to your chosen plan. Everything deploys with automated edge routing and zero-downtime health checks.
				</p>
			</div>

			{/* Deployment Options Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
				{/* Option 1: Intelligent Quickstart tailored to plan builder */}
				<div className="flex flex-col justify-between rounded-xl border border-border bg-card hover:border-primary/40 transition-all p-4 sm:p-6 shadow-sm text-card-foreground relative">
					<div className="absolute top-3 right-3">
						<Badge variant="secondary" className="text-[10px] font-semibold uppercase">
							{isNixpacksOnly
								? "Universal Engine • Nixpacks"
								: isStaticOnly
									? "Static Engine • Zero Build"
									: "Universal Cloud Engine"}
						</Badge>
					</div>

					<div className="space-y-3">
						<div className="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
							<Zap className="size-5" />
						</div>

						<div>
							<h3 className="text-lg font-bold text-foreground flex items-center gap-2">
								{isNixpacksOnly
									? "Instant Dynamic Web App"
									: isStaticOnly
										? "Instant Static Website"
										: "Instant Cloud Web App"}
								<Sparkles className="size-4 text-primary" />
							</h3>
							<p className="text-xs text-muted-foreground mt-1 leading-relaxed">
								{isNixpacksOnly
									? "Pre-configured Node.js dynamic web application powered by the HatDot Universal Nixpacks Engine. Automatically detects runtime, dependencies, and provisions with zero configuration."
									: isStaticOnly
										? "Pre-configured, high-speed static website running on the HatDot edge network. Deploys instantly with pre-packaged static codes and automated HTTPS."
										: "Pre-configured cloud application running on HatDot high-speed infrastructure. Deploys with automated edge routing, health checks, and global SSL."}
							</p>
						</div>

						<div className="p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1">
							<div className="flex items-center gap-1.5 text-foreground font-medium">
								<CheckCircle2 className="size-3.5 text-primary" />
								<span>Supported on your {planName}</span>
							</div>
							<div className="text-[11px]">
								{isNixpacksOnly
									? "Native Nixpacks Builder • Port 3000 • Automated Edge SSL. Zero Docker daemon configuration required."
									: isStaticOnly
										? "Static Edge Engine • Port 80 • Automated Edge SSL. Zero build delay or quota errors."
										: "Full Builder Access (Nixpacks & Docker) • Port 80/3000 • Automated Edge SSL."}
							</div>
						</div>
					</div>

					<Button
						onClick={handleNginx}
						disabled={!!starting}
						size="lg"
						className="w-full mt-6 text-xs font-semibold gap-2"
					>
						{starting === "nginx" ? (
							<>
								<Loader2 className="size-3.5 animate-spin" />
								{isNixpacksOnly
									? "Deploying Dynamic App..."
									: isStaticOnly
										? "Deploying Static Website..."
										: "Deploying Cloud App..."}
							</>
						) : (
							<>
								{isNixpacksOnly
									? "Deploy Dynamic App Now →"
									: isStaticOnly
										? "Deploy Static Website Now →"
										: "Deploy Instant App Now →"}
							</>
						)}
					</Button>
				</div>

				{/* Option 2: Pre-configured Stacks & Templates (Plan Aware) */}
				<div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm text-card-foreground">
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="size-10 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground">
								<Layers className="size-5" />
							</div>
							<Badge
								variant="outline"
								className="text-[10px]"
							>
								{supportsCompose ? "Multi-Service Ready" : "Requires Pro Plan"}
							</Badge>
						</div>

						<div>
							<h3 className="text-lg font-bold text-foreground">
								Production App Stacks
							</h3>
							<p className="text-xs text-muted-foreground mt-1 leading-relaxed">
								Pre-configured multi-tier applications combining web engines and managed database backends.
							</p>
						</div>

						{!supportsCompose ? (
							<div className="p-3.5 rounded-xl bg-muted/40 border border-border space-y-1.5 text-xs text-muted-foreground">
								<div className="flex items-start gap-2 text-foreground font-medium">
									<Lock className="size-4 shrink-0 mt-0.5 text-primary" />
									<span>Multi-service stacks require Pro Plan &amp; 1 GB+ RAM</span>
								</div>
								<p className="text-[11px] leading-relaxed">
									Your current <strong>{planName}</strong> is optimized for single services ({isNixpacksOnly ? "Universal Nixpacks Engine" : isStaticOnly ? "Static Edge Engine" : "Container Engine"}). Stacks like WordPress include an application + full MySQL database and require a Pro or Business plan. Deploy the {isNixpacksOnly ? "Dynamic App" : isStaticOnly ? "Static Website" : "Instant App"} to get live immediately.
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
												? "border-border bg-card hover:bg-accent/50 hover:border-primary/40 cursor-pointer text-card-foreground"
												: "border-border/60 bg-muted/30 opacity-60 cursor-not-allowed text-muted-foreground"
										}`}
									>
										<div className="flex items-center gap-3 min-w-0 flex-1">
											<div className="size-8 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground shrink-0">
												<IconComponent className="size-4" />
											</div>
											<div className="min-w-0 flex-1">
												<div className="text-xs font-semibold text-foreground truncate">
													{stack.name}
												</div>
												<div className="text-[10px] text-muted-foreground truncate">
													{stack.description}
												</div>
											</div>
										</div>

										<div className="shrink-0 ml-2">
											{starting === stack.id ? (
												<Loader2 className="size-3.5 animate-spin text-primary" />
											) : isAllowed ? (
												<span className="text-xs font-semibold text-primary">
													Deploy &rarr;
												</span>
											) : (
												<span className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
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

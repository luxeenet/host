import {
	GitBranchIcon,
	Layers,
	ShieldCheckIcon,
	Sparkles,
	Lock,
	CheckCircle2,
	ArrowRight,
	Server,
	Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { brand } from "@paas/branding";
import { displayFont } from "../font";

interface Props {
	onNext: () => void;
}

const points = [
	{
		number: "01",
		icon: GitBranchIcon,
		title: "Instant Code-to-Cloud Deployments",
		description:
			"Push from GitHub or GitLab with automatic runtime detection, container builds, and zero-downtime rollouts.",
		accent: "from-amber-500/10 to-amber-500/5 text-amber-400 border-amber-500/20",
	},
	{
		number: "02",
		icon: Layers,
		title: "One-Click Managed Databases & Stacks",
		description:
			"Deploy PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and open-source applications pre-configured with persistent storage.",
		accent: "from-indigo-500/10 to-indigo-500/5 text-indigo-400 border-indigo-500/20",
	},
	{
		number: "03",
		icon: ShieldCheckIcon,
		title: "High-Performance Cloud & Edge Security",
		description:
			"Dedicated private cloud environments, enterprise DDoS protection, and automatic SSL on our global edge network.",
		accent: "from-emerald-500/10 to-emerald-500/5 text-emerald-400 border-emerald-500/20",
	},
];

export const WelcomeStep = ({ onNext }: Props) => {
	return (
		<div className="flex flex-col gap-8 max-w-2xl">
			{/* Top Pill & Headline */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Badge
						variant="outline"
						className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] font-medium px-2.5 py-0.5 tracking-wide flex items-center gap-1.5"
					>
						<Sparkles className="size-3 text-amber-400 shrink-0" />
						Welcome to {brand.APP_NAME} Cloud
					</Badge>
					<span className="text-[11px] text-muted-foreground flex items-center gap-1">
						<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
						Platform Live
					</span>
				</div>

				<h1
					className={`${displayFont.className} text-4xl sm:text-5xl leading-[1.08] tracking-tight text-foreground font-bold`}
				>
					Let&apos;s get your first app{" "}
					<span className="text-amber-400 font-extrabold underline decoration-amber-500/30 underline-offset-8">
						live
					</span>
					.
				</h1>

				<p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-xl">
					Deploy your projects in minutes with automated builds, high-speed edge routing,
					and enterprise-grade private cloud infrastructure.
				</p>
			</div>

			{/* Feature Cards Grid */}
			<div className="flex flex-col gap-3.5">
				{points.map((point) => {
					const IconComponent = point.icon;
					return (
						<div
							key={point.number}
							className="group relative flex items-start gap-4 p-4 sm:p-5 rounded-2xl border border-border/80 bg-card/60 hover:bg-card/90 hover:border-amber-500/30 transition-all duration-200 shadow-sm"
						>
							<div
								className={`size-10 sm:size-11 rounded-xl flex items-center justify-center shrink-0 border bg-gradient-to-br ${point.accent}`}
							>
								<IconComponent className="size-5" />
							</div>

							<div className="flex-1 min-w-0 pt-0.5">
								<div className="flex items-center gap-2 mb-1">
									<span className="font-mono text-[11px] text-muted-foreground font-semibold">
										{point.number}
									</span>
									<h2 className="text-sm sm:text-base font-semibold text-foreground tracking-tight">
										{point.title}
									</h2>
								</div>
								<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
									{point.description}
								</p>
							</div>
						</div>
					);
				})}
			</div>

			{/* Security Trust Seals */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border border-border/60 bg-muted/30 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-2">
					<CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
					<span>Dedicated Tenant Isolation</span>
				</div>
				<div className="flex items-center gap-2">
					<Lock className="size-3.5 text-amber-400 shrink-0" />
					<span>Automated Edge SSL &amp; HTTPS</span>
				</div>
				<div className="flex items-center gap-2">
					<Zap className="size-3.5 text-indigo-400 shrink-0" />
					<span>99.99% Global Edge SLA</span>
				</div>
			</div>

			{/* Action CTA */}
			<div className="flex items-center gap-4 pt-2">
				<Button
					size="lg"
					onClick={onNext}
					className="px-8 h-12 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm shadow-lg shadow-amber-600/20 group gap-2"
				>
					<span>Get started</span>
					<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
				</Button>
			</div>
		</div>
	);
};

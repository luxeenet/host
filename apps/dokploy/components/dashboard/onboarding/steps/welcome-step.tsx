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
	},
	{
		number: "02",
		icon: Layers,
		title: "One-Click Managed Databases & Stacks",
		description:
			"Deploy PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and open-source applications pre-configured with persistent storage.",
	},
	{
		number: "03",
		icon: ShieldCheckIcon,
		title: "High-Performance Cloud & Edge Security",
		description:
			"Dedicated private cloud environments, enterprise DDoS protection, and automatic SSL on our global edge network.",
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
						className="border-border bg-muted/50 text-foreground text-xs font-medium px-2.5 py-0.5 tracking-wide flex items-center gap-1.5"
					>
						<Sparkles className="size-3 text-primary shrink-0" />
						Welcome to {brand.APP_NAME} Cloud
					</Badge>
					<span className="text-xs text-muted-foreground flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
						Platform Ready
					</span>
				</div>

				<h1
					className={`${displayFont.className} text-3xl sm:text-4xl leading-tight tracking-tight text-foreground font-bold`}
				>
					Let&apos;s get your first app{" "}
					<span className="text-primary font-bold">
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
			<div className="flex flex-col gap-3">
				{points.map((point) => {
					const IconComponent = point.icon;
					return (
						<div
							key={point.number}
							className="group relative flex items-start gap-4 p-4 sm:p-5 rounded-xl border border-border bg-card hover:border-primary/40 transition-all duration-200 shadow-sm text-card-foreground"
						>
							<div
								className="size-10 sm:size-11 rounded-lg flex items-center justify-center shrink-0 border border-border bg-muted text-foreground"
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
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<CheckCircle2 className="size-3.5 text-primary shrink-0" />
					<span>Dedicated Tenant Isolation</span>
				</div>
				<div className="flex items-center gap-2">
					<Lock className="size-3.5 text-primary shrink-0" />
					<span>Automated Edge SSL &amp; HTTPS</span>
				</div>
				<div className="flex items-center gap-2">
					<Zap className="size-3.5 text-primary shrink-0" />
					<span>99.99% Global Edge SLA</span>
				</div>
			</div>

			{/* Action CTA */}
			<div className="flex items-center gap-4 pt-2">
				<Button
					size="lg"
					onClick={onNext}
					className="px-8 h-11 text-xs font-semibold gap-2"
				>
					<span>Get started</span>
					<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
				</Button>
			</div>
		</div>
	);
};

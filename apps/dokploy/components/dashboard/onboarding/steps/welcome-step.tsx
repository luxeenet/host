import { GitBranchIcon, PuzzleIcon, ShieldCheckIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@paas/branding";
import { displayFont } from "../font";

interface Props {
	onNext: () => void;
}

const points = [
	{
		icon: GitBranchIcon,
		title: "Instant Git & Container Deployments",
		description:
			"Push from GitHub, GitLab, Docker, or Nixpacks with zero-downtime automated rollouts.",
	},
	{
		icon: PuzzleIcon,
		title: "One-Click Managed Databases & Templates",
		description:
			"Deploy PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and open-source applications pre-configured.",
	},
	{
		icon: ShieldCheckIcon,
		title: "High-Performance Cloud & Edge Security",
		description:
			"Fully isolated tenant environments, enterprise DDoS protection, and automatic SSL on the edge network.",
	},
];

export const WelcomeStep = ({ onNext }: Props) => {
	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-col gap-3">
				<span className="font-mono text-xs uppercase tracking-[0.2em] text-primary flex items-center gap-1.5">
					<Sparkles className="size-3 text-primary" />
					Welcome to {brand.APP_NAME}
				</span>
				<h1
					className={`${displayFont.className} text-4xl sm:text-5xl leading-[1.05] tracking-tight text-foreground`}
				>
					Let's get your first app <em className="not-italic text-primary">live</em>.
				</h1>
				<p className="text-muted-foreground text-base sm:text-lg max-w-lg leading-relaxed">
					Deploy your projects in minutes with automated builds, high-speed edge routing,
					and fully isolated cloud infrastructure.
				</p>
			</div>

			<dl className="flex flex-col divide-y divide-border border-y border-border">
				{points.map((point, index) => (
					<div key={point.title} className="flex gap-6 py-5">
						<dt className="font-mono text-xs text-muted-foreground pt-1 shrink-0 w-6">
							{String(index + 1).padStart(2, "0")}
						</dt>
						<dd className="flex flex-col gap-1">
							<span className="font-semibold text-foreground flex items-center gap-2">
								<point.icon className="size-4 text-primary" />
								{point.title}
							</span>
							<span className="text-sm text-muted-foreground">
								{point.description}
							</span>
						</dd>
					</div>
				))}
			</dl>

			<Button size="lg" onClick={onNext} className="w-fit px-8 h-11 font-semibold">
				Get started →
			</Button>
		</div>
	);
};

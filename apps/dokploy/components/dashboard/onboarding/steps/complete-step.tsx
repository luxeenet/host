import {
	BookIcon,
	DatabaseIcon,
	GitMergeIcon,
	GlobeIcon,
	UsersIcon,
	CheckCircle2,
	ArrowRight,
	Sparkles,
	ShieldCheck,
	Lock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import ConfettiExplosion from "react-confetti-explosion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { brand } from "@paas/branding";
import { displayFont } from "../font";

interface Props {
	projectId?: string;
	environmentId?: string;
	onFinish: () => void | Promise<void>;
}

const features = [
	{
		number: "01",
		icon: DatabaseIcon,
		title: "One-Click Managed Databases",
		description: "Deploy PostgreSQL, MySQL, Redis, MongoDB & MariaDB with automated backups.",
	},
	{
		number: "02",
		icon: GlobeIcon,
		title: "Custom Domains & Free SSL",
		description: "Attach your brand domains with instant Let's Encrypt certificates and edge DDoS defense.",
	},
	{
		number: "03",
		icon: GitMergeIcon,
		title: "Git-Powered CI/CD",
		description: "Connect GitHub or GitLab for automatic build pipelines on every branch push.",
	},
	{
		number: "04",
		icon: UsersIcon,
		title: "Team Access Control",
		description: "Invite engineers and collaborators with fine-grained role permissions.",
	},
];

export const CompleteStep = ({ projectId, environmentId, onFinish }: Props) => {
	const router = useRouter();
	const [showConfetti, setShowConfetti] = useState(false);
	const [isFinishing, setIsFinishing] = useState(false);

	useEffect(() => {
		setShowConfetti(true);
	}, []);

	const projectHref =
		projectId && environmentId
			? `/dashboard/project/${projectId}/environment/${environmentId}`
			: "/dashboard/projects";
	const cleanHref = environmentId ? `/dashboard/env/${environmentId}` : "/dashboard/projects";

	const handleFinish = async () => {
		setIsFinishing(true);
		await onFinish();
		router.push(projectHref, cleanHref);
	};

	return (
		<div className="flex flex-col gap-8 max-w-xl">
			<div className="fixed inset-x-0 top-0 flex justify-center pointer-events-none">
				{showConfetti && (
					<ConfettiExplosion
						duration={3200}
						force={0.4}
						particleCount={180}
						width={1400}
						zIndex={70}
					/>
				)}
			</div>

			{/* Header */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Badge
						variant="outline"
						className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium px-2.5 py-0.5 tracking-wide flex items-center gap-1.5"
					>
						<CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
						Setup Complete • Environment Active
					</Badge>
				</div>

				<h1
					className={`${displayFont.className} text-4xl sm:text-5xl leading-[1.08] tracking-tight text-foreground font-bold`}
				>
					You&apos;re live on {brand.APP_NAME}!
				</h1>

				<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
					Your cloud workspace is initialized and ready. Here is what you can build and configure next:
				</p>
			</div>

			{/* Features Grid */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{features.map((feature) => {
					const IconComponent = feature.icon;
					return (
						<div
							key={feature.title}
							className="p-4 rounded-2xl border border-border/80 bg-card/60 hover:bg-card/90 transition-all flex flex-col justify-between"
						>
							<div>
								<div className="flex items-center justify-between mb-2">
									<div className="size-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
										<IconComponent className="size-4" />
									</div>
									<span className="font-mono text-[10px] text-muted-foreground font-semibold">
										{feature.number}
									</span>
								</div>
								<h3 className="text-xs font-semibold text-foreground mb-1">
									{feature.title}
								</h3>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									{feature.description}
								</p>
							</div>
						</div>
					);
				})}
			</div>

			{/* Enterprise Trust Confirmation */}
			<div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 text-[11px] text-muted-foreground flex items-center justify-between">
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-4 text-emerald-400 shrink-0" />
					<span>Dedicated Private Cloud • Encrypted at Rest &amp; Transit</span>
				</div>
				<span className="text-emerald-400 font-semibold font-mono text-[10px]">
					99.99% SLA
				</span>
			</div>

			{/* Primary CTA */}
			<div className="flex items-center gap-3 pt-2">
				<Button
					size="lg"
					className="px-8 h-12 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg shadow-amber-600/20 group gap-2"
					isLoading={isFinishing}
					onClick={handleFinish}
				>
					<span>Open Dashboard Console</span>
					<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
				</Button>
			</div>
		</div>
	);
};

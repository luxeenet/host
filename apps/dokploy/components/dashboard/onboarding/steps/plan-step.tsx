import {
	ArrowRightIcon,
	CheckIcon,
	Zap,
	Server,
	Code,
	Building,
	ShieldCheck,
	Cpu,
	HardDrive,
	Activity,
	Layers,
	Globe,
	Sparkles,
} from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api } from "@/utils/api";
import { formatCurrency } from "@paas/branding";
import { displayFont } from "../font";
import { cn } from "@/lib/utils";

const PLAN_ICONS: Record<string, React.ReactElement> = {
	starter: <Zap className="size-5 text-amber-500" />,
	basic: <Server className="size-5 text-blue-500" />,
	developer: <Code className="size-5 text-indigo-500" />,
	standard: <Layers className="size-5 text-violet-500" />,
	pro: <Sparkles className="size-5 text-purple-500" />,
	business: <Building className="size-5 text-emerald-500" />,
	enterprise: <ShieldCheck className="size-5 text-cyan-500" />,
};

interface Props {
	onNext: () => void;
}

export const PlanStep = ({ onNext }: Props) => {
	const router = useRouter();
	const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
	const [subscribing, setSubscribing] = useState(false);

	const { data: plans, isLoading } = api.plan.list.useQuery();
	const utils = api.useUtils();

	// Check if a plan was chosen on the landing page
	useEffect(() => {
		if (plans && plans.length > 0 && !selectedPlanId) {
			const stored =
				(typeof window !== "undefined"
					? localStorage.getItem("hatdot_selected_plan") ||
					  localStorage.getItem("hatdot_selected_plan_slug")
					: null);
			if (stored) {
				const matched = plans.find((p) => p.id === stored || p.slug === stored);
				if (matched) {
					setSelectedPlanId(matched.id);
				}
			}
		}
	}, [plans, selectedPlanId]);

	const subscribeMutation = api.subscription.create.useMutation({
		onSuccess: async (result: any) => {
			if (typeof window !== "undefined") {
				localStorage.removeItem("hatdot_selected_plan");
				localStorage.removeItem("hatdot_selected_plan_slug");
			}
			await Promise.all([
				utils.project.onboardingStatus.invalidate(),
				utils.subscription.getCurrent.invalidate(),
			]);
			if (result?.status === "pending_payment") {
				toast.info("Payment required to activate this plan. Proceeding to checkout...");
				router.push(`/checkout?planId=${result.planId}`);
			} else {
				toast.success("Plan activated! Welcome aboard 🎉");
				onNext();
			}
		},
		onError: (err) => {
			toast.error(err.message || "Failed to activate plan");
			setSubscribing(false);
		},
	});

	const handleSubscribe = async (planId: string) => {
		const targetPlan = plans?.find((p) => p.id === planId);
		if (targetPlan && Number(targetPlan.price) > 0 && targetPlan.trialDays === 0) {
			if (typeof window !== "undefined") {
				localStorage.removeItem("hatdot_selected_plan");
				localStorage.removeItem("hatdot_selected_plan_slug");
			}
			router.push(`/checkout?planId=${encodeURIComponent(targetPlan.id)}`);
			return;
		}

		setSelectedPlanId(planId);
		setSubscribing(true);
		subscribeMutation.mutate({ planId });
	};

	const getCpuValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
	) => {
		const r = resources?.find((item) => item.resourceKey === "max_cpu_millicores");
		if (!r) return "1 vCPU";
		if (r.value === -1) return "Dedicated vCPU";
		const cores = r.value / 1000;
		return cores >= 1 ? `${cores} vCPU${cores > 1 ? "s" : ""}` : `${r.value}m CPU`;
	};

	const getRamValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
	) => {
		const r = resources?.find((item) => item.resourceKey === "max_ram_mb");
		if (!r) return "512 MB";
		if (r.value === -1) return "Unlimited RAM";
		if (r.value >= 1024) return `${r.value / 1024} GB RAM`;
		return `${r.value} MB RAM`;
	};

	const getStorageValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
	) => {
		const r = resources?.find((item) => item.resourceKey === "max_storage_gb");
		if (!r) return "5 GB";
		if (r.value === -1) return "Unlimited SSD";
		return `${r.value} GB NVMe SSD`;
	};

	const getResourceValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
		key: string,
	) => {
		const r = resources?.find((item) => item.resourceKey === key);
		if (!r) return null;
		return r.value === -1 ? "Unlimited" : `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
	};

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Badge
						variant="outline"
						className="border-primary/30 bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5 tracking-wide flex items-center gap-1.5"
					>
						<Sparkles className="size-3 shrink-0" />
						Mandatory Step
					</Badge>
					<span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
						Cloud Package Selection
					</span>
				</div>
				<h1
					className={`${displayFont.className} text-3xl sm:text-4xl leading-[1.1] tracking-tight text-foreground font-bold`}
				>
					Select the compute package for your workspace.
				</h1>
				<p className="text-muted-foreground text-sm sm:text-base max-w-lg leading-relaxed">
					Choose a package to unlock your deployment environment. Start with a 14-day free trial on any tier — cancel anytime.
				</p>
			</div>

			{isLoading ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="h-80 rounded-2xl bg-muted/60 border border-border" />
					))}
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{plans?.map((plan) => {
						const isSelected = selectedPlanId === plan.id;
						const isFeatured = plan.isFeatured;

						return (
							<div
								key={plan.id}
								onClick={() => setSelectedPlanId(plan.id)}
								className={cn(
									"relative flex flex-col justify-between rounded-2xl border p-5 bg-card text-card-foreground shadow-sm transition-all cursor-pointer",
									isSelected
										? "border-primary ring-2 ring-primary/40 bg-primary/[0.03] shadow-md scale-[1.01]"
										: "border-border hover:border-primary/50",
								)}
							>
								{isFeatured && (
									<div className="absolute -top-3 right-4">
										<Badge className="text-[10px] bg-primary text-primary-foreground font-bold">
											Popular
										</Badge>
									</div>
								)}

								<div>
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-2.5">
											<div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
												{PLAN_ICONS[plan.slug] ?? <Zap className="size-4 text-primary" />}
											</div>
											<div>
												<span className="font-bold text-foreground text-base leading-tight block">
													{plan.name}
												</span>
												{plan.trialDays > 0 ? (
													<span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
														{plan.trialDays}-day free trial
													</span>
												) : Number(plan.price) === 0 ? (
													<span className="text-[11px] text-muted-foreground">
														Free forever
													</span>
												) : (
													<span className="text-[11px] text-muted-foreground">
														Production grade
													</span>
												)}
											</div>
										</div>
									</div>

									<p className="text-xs text-muted-foreground mb-3 min-h-[32px] leading-relaxed">
										{plan.description}
									</p>

									<div className="mb-3">
										{Number(plan.price) === 0 ? (
											<span className="text-2xl font-extrabold text-foreground">Free</span>
										) : (
											<div className="flex items-baseline gap-1">
												<span className="text-2xl font-extrabold text-foreground">
													{formatCurrency(Number(plan.price), plan.currency)}
												</span>
												<span className="text-xs text-muted-foreground">
													/{plan.billingCycle === "yearly" ? "yr" : "mo"}
												</span>
											</div>
										)}
									</div>

									<Separator className="mb-3" />

									{/* Compute specs */}
									<div className="grid grid-cols-2 gap-1.5 mb-3 text-[11px]">
										<div className="p-1.5 rounded-lg bg-muted/40 border border-border/50 flex items-center gap-1.5">
											<Cpu className="size-3.5 text-primary shrink-0" />
											<span className="font-semibold text-foreground truncate">
												{getCpuValue(plan.resources)}
											</span>
										</div>
										<div className="p-1.5 rounded-lg bg-muted/40 border border-border/50 flex items-center gap-1.5">
											<Server className="size-3.5 text-primary shrink-0" />
											<span className="font-semibold text-foreground truncate">
												{getRamValue(plan.resources)}
											</span>
										</div>
										<div className="p-1.5 rounded-lg bg-muted/40 border border-border/50 flex items-center gap-1.5">
											<HardDrive className="size-3.5 text-primary shrink-0" />
											<span className="font-semibold text-foreground truncate">
												{getStorageValue(plan.resources)}
											</span>
										</div>
										<div className="p-1.5 rounded-lg bg-muted/40 border border-border/50 flex items-center gap-1.5">
											<Layers className="size-3.5 text-primary shrink-0" />
											<span className="font-semibold text-foreground truncate">
												{getResourceValue(plan.resources, "max_applications") ?? "Unlimited"} Apps
											</span>
										</div>
									</div>

									<ul className="flex flex-col gap-1.5 text-xs text-muted-foreground mb-5">
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>Automatic Edge SSL & Isolated Runtime</span>
										</li>
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>Zero-downtime Continuous Deployments</span>
										</li>
									</ul>
								</div>

								<Button
									isLoading={subscribing && selectedPlanId === plan.id}
									disabled={subscribing}
									onClick={(e) => {
										e.stopPropagation();
										handleSubscribe(plan.id);
									}}
									className="w-full font-semibold"
									variant={isSelected ? "default" : "outline"}
								>
									{plan.trialDays > 0 ? (
										<span className="flex items-center justify-center gap-1.5">
											Start {plan.trialDays}-Day Free Trial
											<ArrowRightIcon className="size-3.5" />
										</span>
									) : Number(plan.price) === 0 ? (
										"Activate Free Package"
									) : (
										"Pay & Activate Package"
									)}
								</Button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

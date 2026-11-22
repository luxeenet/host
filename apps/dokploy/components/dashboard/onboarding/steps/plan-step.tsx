import { ArrowRightIcon, CheckIcon, Zap, Server, Code, Building, ShieldCheck } from "lucide-react";
import { useRouter } from "next/router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";
import { formatCurrency } from "@paas/branding";
import { displayFont } from "../font";
import { cn } from "@/lib/utils";

const PLAN_ICONS: Record<string, React.ReactElement> = {
	starter: <Zap className="size-5" />,
	basic: <Server className="size-5" />,
	developer: <Code className="size-5" />,
	pro: <Code className="size-5" />,
	business: <Building className="size-5" />,
	enterprise: <ShieldCheck className="size-5" />,
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

	const subscribeMutation = api.subscription.create.useMutation({
		onSuccess: async (result: any) => {
			await Promise.all([
				utils.project.onboardingStatus.invalidate(),
				utils.subscription.getCurrent.invalidate(),
			]);
			if (result?.status === "pending_payment") {
				toast.info("Payment required to activate this plan. Redirecting to billing...");
				router.push(`/dashboard/billing?planId=${result.planId}&pay=true`);
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
		setSelectedPlanId(planId);
		setSubscribing(true);
		subscribeMutation.mutate({ planId });
	};

	const getResourceValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
		key: string,
	) => {
		const r = resources.find((item) => item.resourceKey === key);
		if (!r) return null;
		return r.value === -1 ? "Unlimited" : `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
	};

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-3">
				<span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
					Billing & Plan
				</span>
				<h1
					className={`${displayFont.className} text-4xl sm:text-5xl leading-[1.05] tracking-tight`}
				>
					Start free, upgrade when ready.
				</h1>
				<p className="text-muted-foreground text-base sm:text-lg max-w-lg leading-relaxed">
					Choose a plan for your cloud workspace. Start with a 14-day free trial on any tier — no
					credit card required.
				</p>
			</div>

			{isLoading ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
					{[1, 2].map((i) => (
						<div key={i} className="h-72 rounded-2xl bg-muted border border-border" />
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
								className={cn(
									"flex flex-col justify-between rounded-2xl border p-6 bg-card text-card-foreground shadow-sm transition-all",
									isSelected
										? "border-primary ring-2 ring-primary/20"
										: "border-border hover:border-primary/40",
								)}
							>
								<div>
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-2.5">
											<div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
												{PLAN_ICONS[plan.slug] ?? <Zap className="size-4" />}
											</div>
											<span className="font-bold text-foreground text-base">
												{plan.name}
											</span>
										</div>
										{isFeatured && (
											<Badge className="text-[10px] bg-primary text-primary-foreground">
												Popular
											</Badge>
										)}
									</div>

									<p className="text-xs text-muted-foreground mb-4 min-h-[32px]">
										{plan.description}
									</p>

									<div className="mb-4">
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
										{plan.trialDays > 0 && (
											<span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block mt-0.5">
												{plan.trialDays}-day free trial included
											</span>
										)}
									</div>

									<ul className="flex flex-col gap-2 text-xs text-muted-foreground mb-6">
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>
												Apps: {getResourceValue(plan.resources, "max_applications") ?? "Unlimited"}
											</span>
										</li>
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>
												Databases: {getResourceValue(plan.resources, "max_databases") ?? "Unlimited"}
											</span>
										</li>
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>
												RAM: {getResourceValue(plan.resources, "max_ram_mb") ?? "Unlimited"}
											</span>
										</li>
										<li className="flex items-center gap-2">
											<CheckIcon className="size-3.5 text-emerald-500 shrink-0" />
											<span>Automatic Edge SSL & DDoS Protection</span>
										</li>
									</ul>
								</div>

								<Button
									isLoading={subscribing && selectedPlanId === plan.id}
									disabled={subscribing}
									onClick={() => handleSubscribe(plan.id)}
									className="w-full"
								>
									{plan.trialDays > 0 ? (
										<span className="flex items-center gap-1.5">
											Start {plan.trialDays}-day trial
											<ArrowRightIcon className="size-3.5" />
										</span>
									) : Number(plan.price) === 0 ? (
										"Activate Free Plan"
									) : (
										"Pay & Activate Plan"
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

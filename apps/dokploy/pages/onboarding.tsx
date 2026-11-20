import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	CheckCircle,
	Zap,
	Server,
	Code,
	Building,
	ShieldCheck,
	Check,
	Layers,
	Cpu,
	Globe,
	Clock,
	Database,
	Lock,
	LogOut,
	HelpCircle,
	Sparkles,
} from "lucide-react";
import { api } from "@/utils/api";
import { brand, formatCurrency } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/shared/logo";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";

const PLAN_ICONS: Record<string, ReactElement> = {
	starter: <Zap className="size-5" />,
	basic: <Server className="size-5" />,
	developer: <Code className="size-5" />,
	standard: <Layers className="size-5" />,
	pro: <Code className="size-5" />,
	business: <Building className="size-5" />,
	enterprise: <ShieldCheck className="size-5" />,
};

const PLAN_GRADIENTS: Record<string, string> = {
	starter: "from-blue-600 to-cyan-600",
	basic: "from-indigo-600 to-blue-600",
	developer: "from-violet-600 to-indigo-600",
	standard: "from-violet-600 to-indigo-600",
	pro: "from-purple-600 to-pink-600",
	business: "from-amber-600 to-orange-600",
	enterprise: "from-emerald-600 to-teal-600",
};

export default function OnboardingPage() {
	const router = useRouter();
	const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
	const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
	const [subscribing, setSubscribing] = useState(false);

	const { data: rawPlans, isLoading } = api.plan.list.useQuery();
	const utils = api.useUtils();

	const plans = useMemo(() => {
		if (!rawPlans) return [];
		// Filter by selected billing cycle if plan variants exist, otherwise return all
		const cycleMatches = rawPlans.filter((p) => p.billingCycle === billingCycle);
		if (cycleMatches.length > 0) return cycleMatches;
		return rawPlans;
	}, [rawPlans, billingCycle]);

	// Auto-select featured or first plan if none selected
	useMemo(() => {
		if (!selectedPlanId && plans.length > 0) {
			const featured = plans.find((p) => p.isFeatured) ?? plans[0];
			if (featured) setSelectedPlanId(featured.id);
		}
	}, [plans, selectedPlanId]);

	const selectedPlan = useMemo(() => {
		return plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;
	}, [plans, selectedPlanId]);

	const subscribeMutation = api.subscription.create.useMutation({
		onSuccess: async () => {
			toast.success("Subscription activated! Welcome aboard 🎉");
			await Promise.all([
				utils.subscription.getCurrent.invalidate(),
				utils.project.onboardingStatus.invalidate(),
			]);
			await router.push("/dashboard/home");
		},
		onError: (err) => {
			toast.error(err.message || "Failed to activate plan. Please try again.");
			setSubscribing(false);
		},
	});

	const handleSelectPlan = async () => {
		if (!selectedPlanId) {
			toast.error("Please select a plan to continue.");
			return;
		}
		setSubscribing(true);
		subscribeMutation.mutate({ planId: selectedPlanId });
	};

	const handleSignOut = async () => {
		try {
			await authClient.signOut();
			router.push("/");
		} catch {
			router.push("/");
		}
	};

	const getResourceValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
		key: string,
	) => {
		const r = resources.find((item) => item.resourceKey === key);
		if (!r) return null;
		return r.value === -1 ? "Unlimited" : `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
	};

	const isFeatureEnabled = (
		features: { featureKey: string; enabled: boolean }[],
		key: string,
	) => features.find((f) => f.featureKey === key)?.enabled ?? false;

	return (
		<>
			<Head>
				<title>Choose Your Cloud Plan — {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Select your hosting plan and deploy applications on ${brand.APP_NAME}.`}
				/>
			</Head>

			<div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
				{/* Top Navigation */}
				<header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Logo className="size-8" />
						<span className="text-lg font-bold tracking-tight text-foreground">
							{brand.APP_NAME}
						</span>
						<Separator orientation="vertical" className="h-4 hidden sm:block" />
						<span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1.5 font-medium">
							<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
							Cloud Setup
						</span>
					</div>

					<div className="flex items-center gap-3">
						<a
							href={`mailto:${brand.SUPPORT_EMAIL}`}
							className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 font-medium transition-colors"
						>
							<HelpCircle className="size-3.5" />
							Support
						</a>
						<Button
							variant="ghost"
							size="sm"
							onClick={handleSignOut}
							className="text-xs text-muted-foreground hover:text-foreground h-8"
						>
							<LogOut className="size-3.5 mr-1" />
							Sign out
						</Button>
					</div>
				</header>

				{/* Main Content */}
				<main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
					{/* Header */}
					<div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14 space-y-3">
						<div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary">
							<Sparkles className="size-3.5 text-primary" />
							<span>Step 1 of 2: Pick Your Hosting Plan</span>
						</div>
						<h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
							Choose the plan that fits your growth
						</h1>
						<p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
							Deploy with zero-downtime rollouts, automated edge SSL, and isolated tenant
							compute. Start with a 14-day free trial on any tier — cancel anytime.
						</p>

						{/* Billing Period Selector */}
						<div className="pt-4 flex items-center justify-center">
							<div className="inline-flex items-center rounded-xl bg-muted p-1 border border-border">
								<button
									type="button"
									onClick={() => setBillingCycle("monthly")}
									className={cn(
										"px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
										billingCycle === "monthly"
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									Monthly Billing
								</button>
								<button
									type="button"
									onClick={() => setBillingCycle("yearly")}
									className={cn(
										"px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5",
										billingCycle === "yearly"
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<span>Yearly Billing</span>
									<span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] px-1.5 py-0.5 font-bold">
										Save 20%
									</span>
								</button>
							</div>
						</div>
					</div>

					{/* Plans Grid */}
					{isLoading ? (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-pulse">
							{[1, 2, 3, 4].map((i) => (
								<div key={i} className="h-96 rounded-2xl bg-muted/60 border border-border" />
							))}
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch">
							{plans.map((plan) => {
								const isSelected = selectedPlanId === plan.id;
								const isFeatured = plan.isFeatured;
								const gradient =
									PLAN_GRADIENTS[plan.slug] ?? "from-primary to-primary/80";

								return (
									<div
										key={plan.id}
										onClick={() => setSelectedPlanId(plan.id)}
										className={cn(
											"relative flex flex-col justify-between rounded-2xl border p-6 cursor-pointer transition-all duration-200 select-none",
											"bg-card text-card-foreground shadow-sm hover:shadow-md",
											isSelected
												? "border-primary ring-2 ring-primary/25 shadow-lg scale-[1.01]"
												: "border-border hover:border-primary/50",
										)}
									>
										{/* Featured Badge */}
										{isFeatured && (
											<div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
												<Badge className="bg-primary text-primary-foreground border-0 text-[11px] font-semibold px-3 py-0.5 shadow-sm">
													Most Popular
												</Badge>
											</div>
										)}

										<div>
											{/* Header */}
											<div className="flex items-center gap-3 mb-4">
												<div
													className={cn(
														"size-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 shadow-inner",
														gradient,
													)}
												>
													{PLAN_ICONS[plan.slug] ?? <Zap className="size-5" />}
												</div>
												<div>
													<h3 className="font-bold text-foreground text-lg leading-tight">
														{plan.name}
													</h3>
													{plan.trialDays > 0 ? (
														<span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
															{plan.trialDays}-day free trial
														</span>
													) : Number(plan.price) === 0 ? (
														<span className="text-xs text-muted-foreground">
															Free forever
														</span>
													) : (
														<span className="text-xs text-muted-foreground">
															Full cloud access
														</span>
													)}
												</div>
											</div>

											{/* Price */}
											<div className="mb-4">
												{Number(plan.price) === 0 ? (
													<div className="text-3xl font-extrabold tracking-tight text-foreground">
														Free
													</div>
												) : (
													<div className="flex items-baseline gap-1">
														<span className="text-3xl font-extrabold tracking-tight text-foreground">
															{formatCurrency(Number(plan.price), plan.currency)}
														</span>
														<span className="text-muted-foreground text-sm font-medium">
															/{plan.billingCycle === "yearly" ? "yr" : "mo"}
														</span>
													</div>
												)}
											</div>

											<p className="text-muted-foreground text-xs leading-relaxed mb-5 min-h-[36px]">
												{plan.description}
											</p>

											<Separator className="mb-4" />

											{/* Quotas breakdown */}
											<div className="space-y-2.5 mb-5 text-xs">
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground flex items-center gap-1.5">
														<Layers className="size-3.5" />
														Applications
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue(plan.resources, "max_applications") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground flex items-center gap-1.5">
														<Database className="size-3.5" />
														Databases
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue(plan.resources, "max_databases") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground flex items-center gap-1.5">
														<Globe className="size-3.5" />
														Custom Domains
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue(plan.resources, "max_domains") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground flex items-center gap-1.5">
														<Cpu className="size-3.5" />
														RAM Limit
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue(plan.resources, "max_ram_mb") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground flex items-center gap-1.5">
														<Clock className="size-3.5" />
														Build Minutes
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue(plan.resources, "build_minutes_per_month") ?? "Unlimited"}
													</span>
												</div>
											</div>

											<Separator className="mb-4" />

											{/* Included feature pills */}
											<div className="space-y-2 mb-6 text-xs text-muted-foreground">
												<div className="flex items-center gap-2">
													<Check className="size-3.5 text-emerald-500 shrink-0" />
													<span>Automatic Edge SSL & HTTPS</span>
												</div>
												<div className="flex items-center gap-2">
													<Check className="size-3.5 text-emerald-500 shrink-0" />
													<span>Zero-downtime Rollouts</span>
												</div>
												<div className="flex items-center gap-2">
													<Check className="size-3.5 text-emerald-500 shrink-0" />
													<span>Dedicated Resource Security</span>
												</div>
												{isFeatureEnabled(plan.features, "backups") && (
													<div className="flex items-center gap-2">
														<Check className="size-3.5 text-emerald-500 shrink-0" />
														<span>Automated Database Backups</span>
													</div>
												)}
												{isFeatureEnabled(plan.features, "team_members") && (
													<div className="flex items-center gap-2">
														<Check className="size-3.5 text-emerald-500 shrink-0" />
														<span>Team Collaboration & RBAC</span>
													</div>
												)}
											</div>
										</div>

										{/* Card Button */}
										<Button
											type="button"
											variant={isSelected ? "default" : "outline"}
											className={cn(
												"w-full font-semibold transition-all h-10",
												isSelected && "shadow-sm",
											)}
										>
											{isSelected ? (
												<span className="flex items-center gap-1.5">
													<CheckCircle className="size-4" />
													Selected
												</span>
											) : (
												`Select ${plan.name}`
											)}
										</Button>
									</div>
								);
							})}
						</div>
					)}
				</main>

				{/* Sticky Bottom Action Bar */}
				<footer className="sticky bottom-0 z-30 w-full border-t border-border bg-background/95 backdrop-blur-md px-4 sm:px-8 py-4 shadow-lg">
					<div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-4 text-sm">
							<div className="hidden sm:flex size-10 rounded-full bg-primary/10 border border-primary/20 items-center justify-center text-primary shrink-0">
								<Lock className="size-4" />
							</div>
							<div>
								{selectedPlan ? (
									<div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
										<span className="font-bold text-foreground">
											Selected: {selectedPlan.name} Plan
										</span>
										<span className="text-muted-foreground text-xs hidden sm:inline">•</span>
										<span className="text-muted-foreground text-xs">
											{Number(selectedPlan.price) === 0
												? "Free Forever"
												: `${formatCurrency(Number(selectedPlan.price), selectedPlan.currency)}/${selectedPlan.billingCycle === "yearly" ? "yr" : "mo"}`}
											{selectedPlan.trialDays > 0 &&
												` (${selectedPlan.trialDays}-day free trial)`}
										</span>
									</div>
								) : (
									<span className="text-muted-foreground text-xs">
										Choose a plan to get started
									</span>
								)}
								<p className="text-xs text-muted-foreground">
									No setup fees • Instant cloud workspace provisioning • Cancel anytime
								</p>
							</div>
						</div>

						<div className="flex items-center gap-3 w-full sm:w-auto">
							<Button
								onClick={handleSelectPlan}
								disabled={!selectedPlanId || subscribing}
								isLoading={subscribing}
								size="lg"
								className="w-full sm:w-auto min-w-[240px] font-semibold h-11 text-sm shadow-md"
							>
								{selectedPlan?.trialDays && selectedPlan.trialDays > 0
									? `Start ${selectedPlan.trialDays}-Day Free Trial →`
									: Number(selectedPlan?.price) === 0
										? "Activate Free Starter Plan →"
										: "Continue to Workspace →"}
							</Button>
						</div>
					</div>
				</footer>
			</div>
		</>
	);
}

OnboardingPage.getLayout = (page: ReactElement) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { session } = await validateRequest(ctx.req);
	if (!session) {
		return { redirect: { destination: "/signup", permanent: false } };
	}

	// Security: If user/org already has an active subscription, redirect directly to dashboard
	try {
		const orgId = session.activeOrganizationId;
		if (orgId) {
			const { PlanEntitlementService } = await import(
				"@dokploy/server/services/plan-entitlement"
			);
			const planSnapshot = await PlanEntitlementService.getPlanSnapshot(orgId);
			if (planSnapshot) {
				return {
					redirect: { destination: "/dashboard/home", permanent: false },
				};
			}
		}
	} catch (err) {
		console.error("[onboarding.getServerSideProps] error checking active plan:", err);
	}

	return { props: {} };
}

import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useMemo, useState } from "react";
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
	HardDrive,
	Activity,
	CheckCircle2,
	ArrowRight,
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
	starter: <Zap className="size-5 text-amber-500" />,
	basic: <Server className="size-5 text-blue-500" />,
	developer: <Code className="size-5 text-indigo-500" />,
	standard: <Layers className="size-5 text-violet-500" />,
	pro: <Sparkles className="size-5 text-purple-500" />,
	business: <Building className="size-5 text-emerald-500" />,
	enterprise: <ShieldCheck className="size-5 text-cyan-500" />,
};

export default function OnboardingPage() {
	const router = useRouter();
	const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
	const [isPreselectedFromLanding, setIsPreselectedFromLanding] = useState(false);
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

	// Auto-select tracked plan from landing page (via query or localStorage) ONLY if user actually chose one
	useEffect(() => {
		if (rawPlans && rawPlans.length > 0 && !selectedPlanId) {
			const trackedPlanId =
				(router.query.plan ? String(router.query.plan) : null) ||
				(typeof window !== "undefined"
					? localStorage.getItem("hatdot_selected_plan") ||
					  localStorage.getItem("hatdot_selected_plan_slug")
					: null);

			if (trackedPlanId) {
				const matched = rawPlans.find(
					(p) => p.id === trackedPlanId || p.slug === trackedPlanId,
				);
				if (matched) {
					setSelectedPlanId(matched.id);
					setIsPreselectedFromLanding(true);
					if (matched.billingCycle) {
						setBillingCycle(matched.billingCycle as any);
					}
					return;
				}
			}

			// If no tracked plan exists, keep selectedPlanId as null.
			// The user MUST explicitly select a package.
		}
	}, [rawPlans, router.query.plan, selectedPlanId]);

	const selectedPlan = useMemo(() => {
		if (!selectedPlanId) return null;
		return plans.find((p) => p.id === selectedPlanId) ?? rawPlans?.find((p) => p.id === selectedPlanId) ?? null;
	}, [plans, rawPlans, selectedPlanId]);

	const subscribeMutation = api.subscription.create.useMutation({
		onSuccess: async (result: any) => {
			if (typeof window !== "undefined") {
				localStorage.removeItem("hatdot_selected_plan");
				localStorage.removeItem("hatdot_selected_plan_slug");
			}
			await Promise.all([
				utils.subscription.getCurrent.invalidate(),
				utils.project.onboardingStatus.invalidate(),
			]);
			if (result?.status === "pending_payment") {
				toast.info(
					"Payment required to activate your plan. Proceeding to checkout...",
				);
				await router.push(`/checkout?planId=${encodeURIComponent(result.planId)}`);
			} else {
				toast.success("Package activated successfully! Welcome aboard 🎉");
				await router.push("/dashboard/home");
			}
		},
		onError: (err) => {
			toast.error(err.message || "Failed to activate plan. Please try again.");
			setSubscribing(false);
		},
	});

	const handleSelectPlan = async () => {
		if (!selectedPlanId || !selectedPlan) {
			toast.error("Please select a package to continue.");
			return;
		}

		// If plan requires payment with 0 trial days, route directly to checkout page
		if (Number(selectedPlan.price) > 0 && selectedPlan.trialDays === 0) {
			if (typeof window !== "undefined") {
				localStorage.removeItem("hatdot_selected_plan");
				localStorage.removeItem("hatdot_selected_plan_slug");
			}
			await router.push(`/checkout?planId=${encodeURIComponent(selectedPlan.id)}`);
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
		const r = resources?.find((item) => item.resourceKey === key);
		if (!r) return null;
		return r.value === -1 ? "Unlimited" : `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
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

	const getBandwidthValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
	) => {
		const r = resources?.find((item) => item.resourceKey === "max_bandwidth_gb");
		if (!r) return "20 GB";
		if (r.value === -1) return "Unlimited";
		return `${r.value} GB Bandwidth`;
	};

	const isFeatureEnabled = (
		features: { featureKey: string; enabled: boolean }[],
		key: string,
	) => features?.find((f) => f.featureKey === key)?.enabled ?? false;

	return (
		<>
			<Head>
				<title>Choose Your Cloud Package — {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Select your cloud hosting package and deploy applications on ${brand.APP_NAME}.`}
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
				<main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
					{/* Header */}
					<div className="text-center max-w-3xl mx-auto mb-8 sm:mb-12 space-y-3">
						<div className="flex items-center justify-center gap-2 mb-2">
							<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
								<CheckCircle className="size-3" /> Step 1: Account Created
							</span>
							<span className="text-muted-foreground text-xs font-bold">→</span>
							<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/25">
								<Sparkles className="size-3 text-primary animate-pulse" />
								Step 2 of 2: Choose Cloud Package (Required)
							</span>
						</div>

						<h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
							Select the package that powers your stack
						</h1>
						<p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
							Every package includes dedicated vCPU & RAM limits, automated edge SSL,
							and isolated container runtime. Select your package below to unlock your workspace.
						</p>

						{/* Billing Period Selector */}
						<div className="pt-3 flex items-center justify-center">
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
								const isFromLandingThisPlan = isPreselectedFromLanding && isSelected;

								return (
									<div
										key={plan.id}
										onClick={() => {
											setSelectedPlanId(plan.id);
											setIsPreselectedFromLanding(false);
										}}
										className={cn(
											"relative flex flex-col justify-between rounded-2xl border p-6 cursor-pointer transition-all duration-200 select-none",
											"bg-card text-card-foreground shadow-sm hover:shadow-md",
											isSelected
												? "border-primary ring-2 ring-primary/40 shadow-xl shadow-primary/10 bg-primary/[0.03] scale-[1.01]"
												: "border-border hover:border-primary/50",
										)}
									>
										{/* Badges */}
										<div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 whitespace-nowrap">
											{isFromLandingThisPlan ? (
												<Badge className="bg-primary text-primary-foreground border-0 text-[10px] font-bold px-2.5 py-0.5 shadow-sm flex items-center gap-1">
													<Sparkles className="size-3" />
													Selected from Landing Page
												</Badge>
											) : isFeatured ? (
												<Badge className="bg-primary text-primary-foreground border-0 text-[10px] font-bold px-2.5 py-0.5 shadow-sm">
													Most Popular
												</Badge>
											) : null}
										</div>

										<div>
											{/* Header */}
											<div className="flex items-center gap-3 mb-4">
												<div
													className="size-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"
												>
													{PLAN_ICONS[plan.slug] ?? <Zap className="size-5 text-primary" />}
												</div>
												<div>
													<h3 className="font-bold text-foreground text-lg leading-tight">
														{plan.name}
													</h3>
													{plan.trialDays > 0 ? (
														<span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
															{plan.trialDays}-day free trial
														</span>
													) : Number(plan.price) === 0 ? (
														<span className="text-xs text-muted-foreground font-medium">
															Free forever
														</span>
													) : (
														<span className="text-xs text-muted-foreground font-medium">
															Production grade
														</span>
													)}
												</div>
											</div>

											{/* Price */}
											<div className="mb-3">
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

											<p className="text-muted-foreground text-xs leading-relaxed mb-4 min-h-[32px]">
												{plan.description}
											</p>

											<Separator className="mb-3" />

											{/* Compute & Hardware Quotas */}
											<div className="space-y-2 mb-4 text-xs">
												<div className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40 border border-border/50">
													<span className="text-muted-foreground flex items-center gap-1.5 font-medium">
														<Cpu className="size-3.5 text-primary" />
														Compute (vCPU)
													</span>
													<span className="font-bold text-foreground">
														{getCpuValue(plan.resources)}
													</span>
												</div>
												<div className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40 border border-border/50">
													<span className="text-muted-foreground flex items-center gap-1.5 font-medium">
														<Server className="size-3.5 text-primary" />
														Memory (RAM)
													</span>
													<span className="font-bold text-foreground">
														{getRamValue(plan.resources)}
													</span>
												</div>
												<div className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40 border border-border/50">
													<span className="text-muted-foreground flex items-center gap-1.5 font-medium">
														<HardDrive className="size-3.5 text-primary" />
														Storage (SSD)
													</span>
													<span className="font-bold text-foreground">
														{getStorageValue(plan.resources)}
													</span>
												</div>
												<div className="flex items-center justify-between p-1.5 rounded-lg bg-muted/40 border border-border/50">
													<span className="text-muted-foreground flex items-center gap-1.5 font-medium">
														<Activity className="size-3.5 text-primary" />
														Bandwidth
													</span>
													<span className="font-bold text-foreground">
														{getBandwidthValue(plan.resources)}
													</span>
												</div>
											</div>

											{/* Applications & Databases */}
											<div className="space-y-2 mb-4 text-xs">
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
											</div>

											<Separator className="mb-3" />

											{/* Included feature pills */}
											<div className="space-y-1.5 mb-6 text-xs text-muted-foreground">
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
													<span>Strict Hardware Isolation</span>
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
													Package Selected
												</span>
											) : (
												`Select ${plan.name} Package`
											)}
										</Button>
									</div>
								);
							})}
						</div>
					)}
				</main>

				{/* Sticky Bottom Action Bar */}
				<footer className="sticky bottom-0 z-30 w-full border-t border-border bg-background/95 backdrop-blur-md px-4 sm:px-8 py-3.5 sm:py-4 shadow-lg">
					<div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
						<div className="flex items-center gap-4 text-sm">
							<div className={cn(
								"hidden sm:flex size-10 rounded-full items-center justify-center shrink-0 border",
								selectedPlan
									? "bg-primary/10 border-primary/20 text-primary"
									: "bg-amber-500/10 border-amber-500/20 text-amber-500",
							)}>
								{selectedPlan ? <CheckCircle2 className="size-5" /> : <Lock className="size-4" />}
							</div>
							<div>
								{selectedPlan ? (
									<div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
										<span className="font-bold text-foreground">
											Selected Package: {selectedPlan.name}
										</span>
										<span className="text-muted-foreground text-xs hidden sm:inline">•</span>
										<span className="text-muted-foreground text-xs font-medium">
											{Number(selectedPlan.price) === 0
												? "Free Forever"
												: `${formatCurrency(Number(selectedPlan.price), selectedPlan.currency)}/${selectedPlan.billingCycle === "yearly" ? "yr" : "mo"}`}
											{selectedPlan.trialDays > 0 &&
												` (${selectedPlan.trialDays}-day free trial)`}
										</span>
									</div>
								) : (
									<span className="text-amber-500 font-medium text-xs sm:text-sm">
										Package selection is mandatory. Please select a cloud package above.
									</span>
								)}
								<p className="text-xs text-muted-foreground">
									{selectedPlan
										? selectedPlan.trialDays > 0
											? `${selectedPlan.trialDays}-day free trial included • No setup fees • Cancel anytime`
											: Number(selectedPlan.price) === 0
												? "Free forever starter package • Instant private cloud provisioning"
												: "Production tier • Instant activation with secure mobile money or card"
										: "You must choose a package to continue with setup and unlock your cloud workspace"}
								</p>
							</div>
						</div>

						<div className="flex items-center gap-3 w-full sm:w-auto">
							<Button
								onClick={handleSelectPlan}
								disabled={!selectedPlanId || subscribing}
								isLoading={subscribing}
								size="lg"
								className="w-full sm:w-auto sm:min-w-[260px] font-semibold h-auto min-h-11 py-2.5 px-5 text-xs sm:text-sm shadow-md whitespace-normal leading-snug text-center"
							>
								{!selectedPlan ? (
									"Choose a Package to Continue"
								) : selectedPlan.trialDays > 0 ? (
									<span className="flex items-center justify-center gap-1.5">
										Start {selectedPlan.trialDays}-Day Free Trial
										<ArrowRight className="size-4" />
									</span>
								) : Number(selectedPlan.price) === 0 ? (
									<span className="flex items-center justify-center gap-1.5">
										Activate Free {selectedPlan.name} Package
										<ArrowRight className="size-4" />
									</span>
								) : (
									<span className="flex items-center justify-center gap-1.5">
										Pay & Activate {selectedPlan.name} Package
										<ArrowRight className="size-4" />
									</span>
								)}
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

			// If user has a pending_payment subscription, send them directly to billing to pay!
			const { db } = await import("@dokploy/server/db");
			const { subscriptions } = await import("@dokploy/server/db/schema");
			const { eq, desc } = await import("drizzle-orm");
			const sub = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.organizationId, orgId),
				orderBy: [desc(subscriptions.createdAt)],
			});
			if (sub?.status === "pending_payment") {
				return {
					redirect: {
						destination: `/checkout?planId=${sub.planId}`,
						permanent: false,
					},
				};
			}
		}
	} catch (err) {
		console.error("[onboarding.getServerSideProps] error checking active plan:", err);
	}

	return { props: {} };
}

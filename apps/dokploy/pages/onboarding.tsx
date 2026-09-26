import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, Zap, Server, Code, Building } from "lucide-react";
import { api } from "@/utils/api";
import { brand, formatCurrency } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";

const PLAN_ICONS: Record<string, ReactElement> = {
	starter: <Zap className="w-5 h-5" />,
	basic: <Server className="w-5 h-5" />,
	developer: <Code className="w-5 h-5" />,
	business: <Building className="w-5 h-5" />,
	enterprise: <Building className="w-5 h-5" />,
};

const PLAN_COLORS: Record<string, string> = {
	starter: "from-slate-600 to-slate-500",
	basic: "from-blue-600 to-blue-500",
	developer: "from-indigo-600 to-violet-600",
	business: "from-cyan-600 to-teal-500",
	enterprise: "from-amber-600 to-orange-500",
};

export default function OnboardingPage() {
	const router = useRouter();
	const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
	const [subscribing, setSubscribing] = useState(false);

	const { data: plans, isLoading } = api.plan.list.useQuery();
	const subscribeMutation = api.subscription.create.useMutation({
		onSuccess: async () => {
			toast.success("Subscription created! Welcome aboard 🎉");
			await router.push("/dashboard");
		},
		onError: (err) => {
			toast.error(err.message);
			setSubscribing(false);
		},
	});

	const handleSelectPlan = async () => {
		if (!selectedPlanId) {
			toast.error("Please select a plan first.");
			return;
		}
		setSubscribing(true);
		subscribeMutation.mutate({ planId: selectedPlanId });
	};

	const getResourceValue = (
		resources: { resourceKey: string; value: number; unit?: string | null }[],
		key: string,
	) => {
		const r = resources.find((r) => r.resourceKey === key);
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
				<title>Choose Your Plan — {brand.APP_NAME}</title>
				<meta name="description" content={`Select the perfect hosting plan on ${brand.APP_NAME}.`} />
			</Head>

			<div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 py-12 px-4">
				{/* Background decorations */}
				<div className="absolute inset-0 pointer-events-none overflow-hidden">
					<div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-indigo-500/8 blur-3xl" />
				</div>

				<div className="relative max-w-6xl mx-auto">
					{/* Header */}
					<div className="text-center mb-12">
						<div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-4">
							<CheckCircle className="w-4 h-4 text-indigo-400" />
							<span className="text-indigo-300 text-sm font-medium">Account created successfully</span>
						</div>
						<h1 className="text-4xl font-bold text-white mb-3">
							Choose your plan
						</h1>
						<p className="text-slate-400 text-lg max-w-2xl mx-auto">
							Start with a 14-day free trial. No credit card required.
							Cancel anytime.
						</p>
					</div>

					{/* Plans grid */}
					{isLoading ? (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-[400px] rounded-2xl bg-slate-800/50" />
							))}
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
							{plans?.map((plan) => {
								const isSelected = selectedPlanId === plan.id;
								const isFeatured = plan.isFeatured;
								const colorClass = PLAN_COLORS[plan.slug] ?? "from-slate-600 to-slate-500";

								return (
									<div
										key={plan.id}
										onClick={() => setSelectedPlanId(plan.id)}
										className={cn(
											"relative rounded-2xl border cursor-pointer transition-all duration-300 group",
											"bg-slate-900/70 backdrop-blur-sm",
											isSelected
												? "border-indigo-500 ring-2 ring-indigo-500/30 scale-[1.02]"
												: "border-slate-800 hover:border-slate-700 hover:scale-[1.01]",
											isFeatured && !isSelected && "border-indigo-500/40",
										)}
									>
										{isFeatured && (
											<div className="absolute -top-3 left-1/2 -translate-x-1/2">
												<Badge className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-0 text-xs px-3 py-0.5">
													Most Popular
												</Badge>
											</div>
										)}

										<div className="p-6">
											{/* Plan header */}
											<div className="flex items-center gap-3 mb-4">
												<div className={cn(
													"w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white",
													colorClass,
												)}>
													{PLAN_ICONS[plan.slug] ?? <Zap className="w-5 h-5" />}
												</div>
												<div>
													<h3 className="font-semibold text-white text-lg">{plan.name}</h3>
													{plan.trialDays > 0 && (
														<span className="text-xs text-emerald-400">{plan.trialDays}-day free trial</span>
													)}
												</div>
											</div>

											{/* Price */}
											<div className="mb-4">
												{Number(plan.price) === 0 ? (
													<div className="text-3xl font-bold text-white">Free</div>
												) : (
													<div className="flex items-baseline gap-1">
														<span className="text-3xl font-bold text-white">
															{formatCurrency(Number(plan.price), plan.currency)}
														</span>
														<span className="text-slate-400 text-sm">/{plan.billingCycle === "yearly" ? "yr" : "mo"}</span>
													</div>
												)}
											</div>

											<p className="text-slate-400 text-sm mb-5 leading-relaxed">{plan.description}</p>

											{/* Key limits */}
											<div className="space-y-2 mb-5">
												{[
													{ key: "max_applications", label: "Applications" },
													{ key: "max_databases", label: "Databases" },
													{ key: "max_domains", label: "Custom Domains" },
													{ key: "max_ram_mb", label: "RAM" },
													{ key: "build_minutes_per_month", label: "Build Minutes" },
												].map(({ key, label }) => {
													const val = getResourceValue(plan.resources, key);
													if (!val) return null;
													return (
														<div key={key} className="flex items-center justify-between text-sm">
															<span className="text-slate-500">{label}</span>
															<span className={cn(
																"font-medium",
																val === "Unlimited" ? "text-emerald-400" : "text-slate-300",
															)}>
																{val}
															</span>
														</div>
													);
												})}
											</div>

											{/* Feature chips */}
											<div className="flex flex-wrap gap-1.5 mb-5">
												{[
													{ key: "ssl", label: "SSL" },
													{ key: "custom_domains", label: "Custom Domains" },
													{ key: "automatic_deployments", label: "Auto Deploy" },
													{ key: "databases", label: "Databases" },
													{ key: "backups", label: "Backups" },
													{ key: "team_members", label: "Team" },
												]
													.filter(({ key }) => isFeatureEnabled(plan.features, key))
													.map(({ key, label }) => (
														<span
															key={key}
															className="text-xs bg-slate-800 text-slate-300 rounded-full px-2 py-0.5 border border-slate-700"
														>
															✓ {label}
														</span>
													))}
											</div>

											{/* Selection indicator */}
											<div className={cn(
												"flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all",
												isSelected
													? "bg-indigo-600 text-white"
													: "bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200",
											)}>
												{isSelected ? (
													<>
														<CheckCircle className="w-4 h-4" />
														Selected
													</>
												) : (
													"Select Plan"
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}

					{/* CTA */}
					<div className="mt-10 flex justify-center">
						<Button
							onClick={handleSelectPlan}
							disabled={!selectedPlanId || subscribing}
							size="lg"
							className="bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold h-12 px-10 text-base transition-all duration-200 shadow-lg shadow-indigo-500/25"
						>
							{subscribing ? (
								<span className="flex items-center gap-2">
									<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
									</svg>
									Setting up workspace...
								</span>
							) : (
								"Continue with Selected Plan →"
							)}
						</Button>
					</div>

					<p className="text-center mt-4 text-sm text-slate-500">
						Need a custom plan?{" "}
						<a href={`mailto:${brand.SUPPORT_EMAIL}`} className="text-indigo-400 hover:underline">
							Contact us
						</a>
					</p>
				</div>
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
	return { props: {} };
}

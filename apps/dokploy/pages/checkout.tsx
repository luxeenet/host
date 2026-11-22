import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	CreditCard,
	CheckCircle,
	AlertCircle,
	Clock,
	Zap,
	Shield,
	Smartphone,
	RefreshCw,
	CheckCircle2,
	XCircle,
	Sparkles,
	Check,
	Server,
	Database,
	Layers,
	ShieldCheck,
	Lock,
	ArrowRight,
	LogOut,
	ChevronRight,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { brand, formatCurrency } from "@paas/branding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/shared/logo";
import { api } from "@/utils/api";
import { authClient } from "@/lib/auth-client";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

const OPERATORS = [
	{
		id: "mpesa",
		name: "Vodacom M-Pesa",
		badgeColor: "bg-red-500",
		prefix: "074, 075, 076",
	},
	{
		id: "tigopesa",
		name: "Tigo Pesa",
		badgeColor: "bg-blue-500",
		prefix: "065, 067, 071",
	},
	{
		id: "airtel",
		name: "Airtel Money",
		badgeColor: "bg-rose-500",
		prefix: "068, 069, 078",
	},
	{
		id: "halopesa",
		name: "Halopesa",
		badgeColor: "bg-amber-500",
		prefix: "061, 062",
	},
] as const;

export default function CheckoutPage() {
	const router = useRouter();
	const utils = api.useUtils();

	const { data: user } = api.user.get.useQuery();
	const { data: plans, isLoading: plansLoading } = api.subscription.getPlans.useQuery();
	const { data: sub } = api.subscription.getCurrent.useQuery();

	const [selectedPlanId, setSelectedPlanId] = useState<string>("");
	const [paymentMethod, setPaymentMethod] = useState<"mobile_money" | "card">("mobile_money");
	const [operator, setOperator] = useState<"mpesa" | "tigopesa" | "airtel" | "halopesa">("mpesa");
	const [phone, setPhone] = useState("");
	const [buyerName, setBuyerName] = useState("");
	const [changePlanDialogOpen, setChangePlanDialogOpen] = useState(false);

	// USSD Authorization Modal States
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
	const [orderReference, setOrderReference] = useState<string | null>(null);
	const [orderAmount, setOrderAmount] = useState<number | null>(null);
	const [pollingStatus, setPollingStatus] = useState<"WAITING" | "SUCCESS" | "FAILED">("WAITING");
	const [countdown, setCountdown] = useState(60);

	const initiatePaymentMutation = api.subscription.initiateSonicPesaPayment.useMutation();
	const checkStatusMutation = api.subscription.checkSonicPesaStatus.useMutation();
	const subscribeMutation = api.subscription.create.useMutation();

	// Pre-fill user data
	useEffect(() => {
		if (user && !buyerName) {
			setBuyerName((user as any).name || (user as any).firstName || "");
		}
	}, [user, buyerName]);

	// Auto-select initial plan from query, localStorage, or pending sub
	useEffect(() => {
		if (plans && plans.length > 0 && !selectedPlanId) {
			const queryPlan =
				(router.query.planId ? String(router.query.planId) : null) ||
				(router.query.plan ? String(router.query.plan) : null) ||
				(typeof window !== "undefined"
					? localStorage.getItem("hatdot_selected_plan") ||
					  localStorage.getItem("hatdot_selected_plan_slug")
					: null);

			let matched = queryPlan
				? plans.find((p) => p.id === queryPlan || p.slug === queryPlan)
				: null;

			if (!matched && sub?.planId) {
				matched = plans.find((p) => p.id === sub.planId) ?? null;
			}

			if (!matched) {
				matched = plans.find((p) => p.isFeatured) || plans.find((p) => Number(p.price) > 0) || plans[0];
			}

			if (matched) {
				setSelectedPlanId(matched.id);
			}
		}
	}, [plans, router.query, selectedPlanId, sub]);

	const selectedPlan = useMemo(() => {
		return plans?.find((p) => p.id === selectedPlanId) ?? null;
	}, [plans, selectedPlanId]);

	// Polling effect for USSD authorization
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null;
		let timer: NodeJS.Timeout | null = null;

		if (isModalOpen && currentOrderId && pollingStatus === "WAITING") {
			interval = setInterval(async () => {
				try {
					const res = await checkStatusMutation.mutateAsync({ orderId: currentOrderId });
					if (res.isPaid || res.status === "SUCCESS") {
						setPollingStatus("SUCCESS");
						toast.success("Payment confirmed! Your cloud workspace is activated.");
						await Promise.all([
							utils.subscription.getCurrent.invalidate(),
							utils.project.onboardingStatus.invalidate(),
						]);
						if (interval) clearInterval(interval);
						setTimeout(() => {
							router.push("/dashboard/home");
						}, 1400);
					} else if (["CANCELLED", "USERCANCELLED", "REJECTED", "FAILED"].includes(res.status)) {
						setPollingStatus("FAILED");
						toast.error(`Payment ${res.status.toLowerCase()}. Please try again.`);
						if (interval) clearInterval(interval);
					}
				} catch (e) {
					console.error("Payment status poll error", e);
				}
			}, 2500);

			timer = setInterval(() => {
				setCountdown((prev) => {
					if (prev <= 1) {
						if (interval) clearInterval(interval);
						return 0;
					}
					return prev - 1;
				});
			}, 1000);
		}

		return () => {
			if (interval) clearInterval(interval);
			if (timer) clearInterval(timer);
		};
	}, [isModalOpen, currentOrderId, pollingStatus, utils, checkStatusMutation, router]);

	const handlePayAndActivate = async () => {
		if (!selectedPlan) {
			toast.error("Please choose a valid subscription plan.");
			return;
		}

		// Handle free or free trial activation
		if (Number(selectedPlan.price) === 0 || selectedPlan.trialDays > 0) {
			try {
				const res: any = await subscribeMutation.mutateAsync({ planId: selectedPlan.id });
				await Promise.all([
					utils.subscription.getCurrent.invalidate(),
					utils.project.onboardingStatus.invalidate(),
				]);
				if (res?.status === "pending_payment") {
					toast.info("Payment required for this tier. Please authorize payment below.");
				} else {
					toast.success("Subscription activated! Welcome aboard 🎉");
					router.push("/dashboard/home");
					return;
				}
			} catch (err: any) {
				toast.error(err?.message || "Failed to activate subscription.");
				return;
			}
		}

		// Validate phone number for Mobile Money
		let cleanPhone = phone.trim().replace(/[\s\-\(\)]/g, "");
		if (cleanPhone.startsWith("+")) cleanPhone = cleanPhone.substring(1);
		if (cleanPhone.startsWith("0")) cleanPhone = "255" + cleanPhone.substring(1);
		if (!cleanPhone.startsWith("255") && cleanPhone.length === 9) {
			cleanPhone = "255" + cleanPhone;
		}

		if (!cleanPhone || cleanPhone.length < 10) {
			toast.error("Please enter a valid mobile number (e.g. 07XXXXXXXX or 255XXXXXXXXX)");
			return;
		}

		try {
			const res = await initiatePaymentMutation.mutateAsync({
				planId: selectedPlan.id,
				phone: cleanPhone,
				buyerName: buyerName.trim() || undefined,
			});

			setCurrentOrderId(res.orderId || null);
			setOrderReference(res.reference || null);
			setOrderAmount(res.amount ? Number(res.amount) : Number(selectedPlan.price));
			setPollingStatus("WAITING");
			setCountdown(60);
			setIsModalOpen(true);
			toast.success("Payment prompt dispatched! Enter your PIN on your phone to authorize.");
		} catch (error: any) {
			toast.error(error.message || "Failed to initiate payment. Please check your phone number.");
		}
	};

	const handleSignOut = async () => {
		try {
			await authClient.signOut();
			router.push("/");
		} catch {
			router.push("/");
		}
	};

	const getResourceValue = (key: string) => {
		if (!selectedPlan?.resources) return null;
		const r = selectedPlan.resources.find((item) => item.resourceKey === key);
		if (!r) return null;
		return r.value === -1 ? "Unlimited" : `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
	};

	return (
		<>
			<Head>
				<title>Complete Subscription Checkout — {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Complete your payment to activate your cloud workspace on ${brand.APP_NAME}.`}
				/>
			</Head>

			<div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
				{/* Top Bar */}
				<header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Link href="/" className="flex items-center gap-2.5">
							<Logo className="size-8" />
							<span className="text-lg font-bold tracking-tight text-foreground">
								{brand.APP_NAME}
							</span>
						</Link>
						<Separator orientation="vertical" className="h-4 hidden sm:block" />
						<div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
							<Lock className="size-3.5 text-emerald-500" />
							<span>Encrypted Checkout</span>
						</div>
					</div>

					<div className="flex items-center gap-3">
						<div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
							<span>Signed in as:</span>
							<span className="font-semibold text-foreground">
								{(user as any)?.email || "Customer"}
							</span>
						</div>
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

				{/* Main Checkout Area */}
				<main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
					{/* Breadcrumb & Title */}
					<div className="mb-8">
						<div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
							<Link href="/onboarding" className="hover:text-foreground transition-colors">
								Hosting Plans
							</Link>
							<ChevronRight className="size-3.5" />
							<span className="text-foreground font-medium">Checkout & Activation</span>
						</div>
						<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
							Activate Your Cloud Workspace
						</h1>
						<p className="text-sm text-muted-foreground mt-1">
							Complete payment to provision your dedicated container resources, edge SSL, and deployment pipeline.
						</p>
					</div>

					{plansLoading ? (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-pulse">
							<div className="lg:col-span-2 h-96 rounded-2xl bg-muted/50 border border-border" />
							<div className="h-96 rounded-2xl bg-muted/50 border border-border" />
						</div>
					) : (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
							{/* Left 2 Cols: Payment Methods & Phone Form */}
							<div className="lg:col-span-2 space-y-6">
								{/* Step 1: Select Payment Gateway */}
								<Card className="border-border bg-card">
									<CardHeader className="pb-4">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<div className="size-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center">
													1
												</div>
												<CardTitle className="text-base font-semibold">
													Choose Payment Method
												</CardTitle>
											</div>
											<Badge variant="outline" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
												Instant Automated USSD
											</Badge>
										</div>
										<CardDescription className="text-xs">
											Choose how you would like to settle your subscription. Direct mobile money is settled in real-time.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-4">
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
											{/* Mobile Money Option */}
											<div
												onClick={() => setPaymentMethod("mobile_money")}
												className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${
													paymentMethod === "mobile_money"
														? "bg-accent border-primary ring-1 ring-primary/20 shadow-sm"
														: "bg-muted/30 border-border hover:border-foreground/30 hover:bg-muted/50"
												}`}
											>
												<div className="size-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
													<Smartphone className="size-5" />
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center justify-between">
														<span className="text-sm font-bold text-foreground">Mobile Money</span>
														{paymentMethod === "mobile_money" && (
															<CheckCircle2 className="size-4 text-primary" />
														)}
													</div>
													<p className="text-xs text-muted-foreground mt-0.5">
														M-Pesa, Tigo Pesa, Airtel Money, Halopesa
													</p>
													<span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block mt-1">
														Direct USSD prompt to phone
													</span>
												</div>
											</div>

											{/* Card Option */}
											<div
												onClick={() => setPaymentMethod("card")}
												className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 ${
													paymentMethod === "card"
														? "bg-accent border-primary ring-1 ring-primary/20 shadow-sm"
														: "bg-muted/30 border-border hover:border-foreground/30 hover:bg-muted/50"
												}`}
											>
												<div className="size-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
													<CreditCard className="size-5" />
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center justify-between">
														<span className="text-sm font-bold text-foreground">Debit / Credit Card</span>
														{paymentMethod === "card" && (
															<CheckCircle2 className="size-4 text-primary" />
														)}
													</div>
													<p className="text-xs text-muted-foreground mt-0.5">
														Visa, Mastercard, UnionPay
													</p>
													<span className="text-[11px] text-muted-foreground font-medium block mt-1">
														Secured by SonicPesa
													</span>
												</div>
											</div>
										</div>

										{/* Operator Selector for Mobile Money */}
										{paymentMethod === "mobile_money" && (
											<div className="pt-2 space-y-2.5">
												<label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
													Select Mobile Operator
												</label>
												<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
													{OPERATORS.map((op) => {
														const isOpSelected = operator === op.id;
														return (
															<div
																key={op.id}
																onClick={() => setOperator(op.id as any)}
																className={`p-3 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center gap-1.5 ${
																	isOpSelected
																		? "bg-primary/10 border-primary ring-1 ring-primary/20 font-bold"
																		: "bg-muted/20 border-border hover:bg-muted/40"
																}`}
															>
																<div className={`size-2.5 rounded-full ${op.badgeColor}`} />
																<span className="text-xs text-foreground font-semibold leading-tight">
																	{op.name}
																</span>
																<span className="text-[10px] text-muted-foreground font-mono">
																	{op.prefix}
																</span>
															</div>
														);
													})}
												</div>
											</div>
										)}
									</CardContent>
								</Card>

								{/* Step 2: Payer Details & Authorize */}
								<Card className="border-border bg-card">
									<CardHeader className="pb-4">
										<div className="flex items-center gap-2">
											<div className="size-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center">
												2
											</div>
											<CardTitle className="text-base font-semibold">
												Payment & Account Details
											</CardTitle>
										</div>
										<CardDescription className="text-xs">
											Enter the mobile money number that will receive the USSD authorization prompt.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-4">
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
											<div className="space-y-1.5">
												<label className="text-xs font-semibold text-foreground">
													Full Name
												</label>
												<Input
													value={buyerName}
													onChange={(e) => setBuyerName(e.target.value)}
													placeholder="John Doe"
													className="h-10 text-xs bg-background"
												/>
											</div>
											<div className="space-y-1.5">
												<label className="text-xs font-semibold text-foreground">
													Registered Email
												</label>
												<Input
													value={(user as any)?.email || ""}
													disabled
													className="h-10 text-xs bg-muted text-muted-foreground"
												/>
											</div>
										</div>

										<div className="space-y-1.5">
											<label className="text-xs font-semibold text-foreground flex items-center justify-between">
												<span>
													{paymentMethod === "mobile_money"
														? "Mobile Money Phone Number"
														: "Billing Contact Phone"}
												</span>
												<span className="text-[11px] text-muted-foreground font-normal">
													Format: 07XXXXXXXX or 255XXXXXXXXX
												</span>
											</label>
											<div className="relative">
												<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
													<Smartphone className="size-4" />
												</div>
												<Input
													type="tel"
													value={phone}
													onChange={(e) => setPhone(e.target.value)}
													placeholder="07XXXXXXXX"
													className="h-11 pl-9 text-sm font-mono tracking-wide bg-background"
												/>
											</div>
											<p className="text-[11px] text-muted-foreground">
												A push notification will be sent to this phone. Enter your PIN on your phone to complete payment.
											</p>
										</div>

										{/* Payment Execution CTA */}
										<div className="pt-3 space-y-3">
											<Button
												size="lg"
												onClick={handlePayAndActivate}
												disabled={
													initiatePaymentMutation.isPending ||
													subscribeMutation.isPending ||
													!selectedPlan
												}
												isLoading={
													initiatePaymentMutation.isPending || subscribeMutation.isPending
												}
												className="w-full h-12 text-sm font-semibold shadow-md gap-2"
											>
												{Number(selectedPlan?.price) === 0 ||
												(selectedPlan?.trialDays && selectedPlan.trialDays > 0) ? (
													<>
														<span>
															Activate {selectedPlan?.name || "Plan"}{" "}
															{selectedPlan?.trialDays ? `(${selectedPlan.trialDays}-Day Free Trial)` : ""}
														</span>
														<ArrowRight className="size-4" />
													</>
												) : (
													<>
														<Lock className="size-4 text-emerald-400" />
														<span>
															Pay{" "}
															{selectedPlan
																? formatCurrency(
																		Number(selectedPlan.price),
																		selectedPlan.currency,
																  )
																: ""}{" "}
															& Activate Cloud Workspace →
														</span>
													</>
												)}
											</Button>

											{/* Security trust badges */}
											<div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground pt-1">
												<span className="flex items-center gap-1">
													<ShieldCheck className="size-3.5 text-emerald-500" />
													256-Bit SSL Encrypted
												</span>
												<span>•</span>
												<span className="flex items-center gap-1">
													<Zap className="size-3.5 text-amber-500" />
													Instant Auto-Activation
												</span>
												<span>•</span>
												<span className="flex items-center gap-1">
													<CheckCircle className="size-3.5 text-blue-500" />
													Official Receipt & Invoice
												</span>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>

							{/* Right 1 Col: Plan Breakdown & Order Summary */}
							<div className="space-y-4">
								<Card className="border-border bg-card shadow-sm sticky top-20">
									<CardHeader className="pb-3 border-b">
										<div className="flex items-center justify-between">
											<Badge variant="outline" className="text-xs uppercase tracking-wider font-semibold">
												Order Summary
											</Badge>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setChangePlanDialogOpen(true)}
												className="h-7 px-2 text-xs text-primary hover:text-primary font-medium"
											>
												Change Plan
											</Button>
										</div>
										<div className="pt-2">
											<h3 className="text-xl font-bold text-foreground">
												{selectedPlan?.name || "Selected Plan"}
											</h3>
											<p className="text-xs text-muted-foreground mt-0.5">
												{selectedPlan?.description}
											</p>
										</div>
									</CardHeader>
									<CardContent className="space-y-4 pt-4">
										{/* Price Banner */}
										<div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-baseline justify-between">
											<span className="text-xs text-muted-foreground font-medium">
												Billing Period:
											</span>
											<div className="text-right">
												<span className="text-xl font-extrabold text-foreground">
													{selectedPlan
														? formatCurrency(
																Number(selectedPlan.price),
																selectedPlan.currency,
														  )
														: "0 TZS"}
												</span>
												<span className="text-xs text-muted-foreground">
													{" "}/ {selectedPlan?.billingCycle === "yearly" ? "yr" : "mo"}
												</span>
											</div>
										</div>

										{/* Trial Notice */}
										{selectedPlan?.trialDays && selectedPlan.trialDays > 0 ? (
											<div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
												<CheckCircle2 className="size-4 shrink-0" />
												<span>Includes {selectedPlan.trialDays} days free trial before first charge.</span>
											</div>
										) : Number(selectedPlan?.price) === 0 ? (
											<div className="p-3 rounded-lg bg-muted border border-border text-xs flex items-center gap-2 text-muted-foreground">
												<Zap className="size-4 text-primary shrink-0" />
												<span>Free forever plan with instant cloud provisioning.</span>
											</div>
										) : (
											<div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
												<AlertCircle className="size-4 shrink-0" />
												<span>0-day free trial. Payment is required upfront to activate dashboard access.</span>
											</div>
										)}

										{/* Included Cloud Resources */}
										<div className="space-y-2 pt-1 border-t">
											<span className="text-xs font-semibold text-foreground block">
												Included Cloud Quotas:
											</span>
											<div className="space-y-1.5 text-xs text-muted-foreground">
												<div className="flex items-center justify-between">
													<span className="flex items-center gap-1.5">
														<Server className="size-3.5 text-primary" />
														Application Slots
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue("max_applications") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="flex items-center gap-1.5">
														<Database className="size-3.5 text-primary" />
														Database Containers
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue("max_databases") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="flex items-center gap-1.5">
														<Zap className="size-3.5 text-primary" />
														RAM Allocation
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue("max_ram_mb") ?? "Unlimited"}
													</span>
												</div>
												<div className="flex items-center justify-between">
													<span className="flex items-center gap-1.5">
														<Layers className="size-3.5 text-primary" />
														Custom Domains & Edge SSL
													</span>
													<span className="font-semibold text-foreground">
														{getResourceValue("max_domains") ?? "Unlimited"}
													</span>
												</div>
											</div>
										</div>

										{/* Price Summary Breakdown */}
										<div className="pt-3 border-t space-y-2 text-xs">
											<div className="flex justify-between text-muted-foreground">
												<span>Subscription Plan</span>
												<span>
													{selectedPlan
														? formatCurrency(
																Number(selectedPlan.price),
																selectedPlan.currency,
														  )
														: "0 TZS"}
												</span>
											</div>
											<div className="flex justify-between text-muted-foreground">
												<span>Container Setup & Edge Routing</span>
												<span className="text-emerald-500 font-medium">Free</span>
											</div>
											<div className="flex justify-between text-muted-foreground">
												<span>VAT / Processing Fees</span>
												<span>Included</span>
											</div>
											<Separator className="my-1" />
											<div className="flex justify-between text-sm font-bold text-foreground pt-1">
												<span>Total Due Today</span>
												<span className="text-primary text-base">
													{selectedPlan
														? formatCurrency(
																Number(selectedPlan.price),
																selectedPlan.currency,
														  )
														: "0 TZS"}
												</span>
											</div>
										</div>
									</CardContent>
								</Card>
							</div>
						</div>
					)}
				</main>

				{/* Footer */}
				<footer className="border-t border-border bg-background py-6 px-4 text-center text-xs text-muted-foreground">
					<p>{brand.COPYRIGHT} • All payments securely processed with instant service provisioning.</p>
				</footer>
			</div>

			{/* Change Plan Dialog */}
			<Dialog open={changePlanDialogOpen} onOpenChange={setChangePlanDialogOpen}>
				<DialogContent className="max-w-3xl">
					<DialogHeader>
						<DialogTitle>Switch Subscription Plan</DialogTitle>
						<DialogDescription>
							Select a different hosting tier for your cloud workspace.
						</DialogDescription>
					</DialogHeader>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto p-1">
						{plans?.map((p) => {
							const isCurrent = p.id === selectedPlanId;
							return (
								<div
									key={p.id}
									onClick={() => {
										setSelectedPlanId(p.id);
										setChangePlanDialogOpen(false);
										toast.success(`Switched to ${p.name} plan`);
									}}
									className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between gap-3 ${
										isCurrent
											? "bg-accent border-primary ring-1 ring-primary/20"
											: "bg-muted/20 border-border hover:border-foreground/30 hover:bg-muted/40"
									}`}
								>
									<div>
										<div className="flex items-center justify-between">
											<span className="text-sm font-bold text-foreground">{p.name}</span>
											{p.isFeatured && (
												<Badge className="text-[10px] bg-primary text-primary-foreground">
													Popular
												</Badge>
											)}
										</div>
										<p className="text-xs font-semibold text-primary mt-1">
											{Number(p.price) === 0 ? "Free" : formatCurrency(Number(p.price), p.currency)}
											{Number(p.price) > 0 && (
												<span className="text-[10px] text-muted-foreground font-normal">
													/{p.billingCycle === "yearly" ? "yr" : "mo"}
												</span>
											)}
										</p>
										<p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
											{p.description}
										</p>
									</div>

									<Button
										size="sm"
										variant={isCurrent ? "default" : "outline"}
										className="w-full text-xs h-8"
									>
										{isCurrent ? "Selected" : "Select Tier"}
									</Button>
								</div>
							);
						})}
					</div>
				</DialogContent>
			</Dialog>

			{/* Interactive USSD Authorization Modal */}
			<Dialog open={isModalOpen} onOpenChange={(open) => {
				if (!open && pollingStatus === "SUCCESS") {
					router.push("/dashboard/home");
				}
				setIsModalOpen(open);
			}}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Smartphone className="size-5 text-emerald-500 animate-pulse" />
							Authorize Payment on Your Phone
						</DialogTitle>
						<DialogDescription>
							A secure USSD payment prompt has been sent directly to your phone.
						</DialogDescription>
					</DialogHeader>

					<div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
						{pollingStatus === "WAITING" && (
							<>
								<div className="relative">
									<div className="size-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center animate-pulse">
										<Smartphone className="size-8 text-emerald-500" />
									</div>
									<div className="absolute -top-1 -right-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow">
										{countdown}s
									</div>
								</div>

								<div className="space-y-1">
									<h4 className="text-base font-bold text-foreground">
										Enter PIN on {phone}
									</h4>
									<p className="text-xs text-muted-foreground max-w-xs">
										Check your phone screen for the {OPERATORS.find((o) => o.id === operator)?.name || "Mobile Money"} prompt of{" "}
										<strong className="text-foreground">
											{orderAmount ? formatCurrency(orderAmount, selectedPlan?.currency || "TZS") : ""}
										</strong>{" "}
										and enter your PIN to authorize.
									</p>
								</div>

								<div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
									<RefreshCw className="size-3 animate-spin" />
									<span>Awaiting live payment confirmation ({countdown}s)...</span>
								</div>
							</>
						)}

						{pollingStatus === "SUCCESS" && (
							<>
								<div className="size-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
									<CheckCircle2 className="size-9 text-emerald-500" />
								</div>
								<div className="space-y-1">
									<h4 className="text-base font-bold text-foreground">
										Payment Confirmed!
									</h4>
									<p className="text-xs text-muted-foreground">
										Your subscription is active. Launching your cloud workspace...
									</p>
								</div>
							</>
						)}

						{pollingStatus === "FAILED" && (
							<>
								<div className="size-16 rounded-full bg-destructive/15 border border-destructive/30 flex items-center justify-center">
									<XCircle className="size-9 text-destructive" />
								</div>
								<div className="space-y-1">
									<h4 className="text-base font-bold text-destructive">
										Payment Was Not Completed
									</h4>
									<p className="text-xs text-muted-foreground">
										The transaction timed out or was cancelled. Please check your balance and try again.
									</p>
								</div>
							</>
						)}
					</div>

					<DialogFooter className="flex-col sm:flex-row gap-2">
						{pollingStatus === "SUCCESS" ? (
							<Button
								onClick={() => router.push("/dashboard/home")}
								className="w-full"
							>
								Open Cloud Dashboard →
							</Button>
						) : (
							<Button
								variant="outline"
								onClick={() => setIsModalOpen(false)}
								className="w-full text-xs"
							>
								{pollingStatus === "FAILED" ? "Close & Try Again" : "Cancel"}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

CheckoutPage.getLayout = (page: ReactElement) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { session } = await validateRequest(ctx.req);
	if (!session) {
		const planParam = ctx.query.planId || ctx.query.plan;
		const query = planParam ? `?plan=${encodeURIComponent(String(planParam))}` : "";
		return { redirect: { destination: `/signup${query}`, permanent: false } };
	}

	// If customer already has an active subscription, take them straight to dashboard
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
	} catch (e) {
		console.error("Checkout getServerSideProps snapshot check error", e);
	}

	return { props: {} };
}

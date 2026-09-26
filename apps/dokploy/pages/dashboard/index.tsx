import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import {
	Activity,
	ArrowRight,
	Cloud,
	CreditCard,
	Database,
	Globe,
	HeadphonesIcon,
	LayoutDashboard,
	Plus,
	Server,
	Settings,
	TrendingUp,
	Users,
	Zap,
} from "lucide-react";
import { api } from "@/utils/api";
import { brand, formatCurrency } from "@paas/branding";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";

const STATUS_COLORS = {
	done: "bg-emerald-500",
	error: "bg-red-500",
	running: "bg-amber-500 animate-pulse",
	cancelled: "bg-slate-500",
} as const;

const SUBSCRIPTION_STATUS_CONFIG = {
	trial: { label: "Trial", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
	active: { label: "Active", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
	past_due: { label: "Past Due", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
	grace_period: { label: "Grace Period", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
	suspended: { label: "Suspended", color: "bg-red-500/20 text-red-300 border-red-500/30" },
	cancelled: { label: "Cancelled", color: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
	trial_expired: { label: "Trial Expired", color: "bg-red-500/20 text-red-300 border-red-500/30" },
} as const;

export default function CustomerDashboardPage() {
	const { data: subscription } = api.subscription.getCurrent.useQuery();
	const { data: projects } = api.project.all.useQuery();
	const { data: tickets } = api.support.list.useQuery({ limit: 3 });

	const subStatus = subscription?.status ?? "trial";
	const statusConfig = SUBSCRIPTION_STATUS_CONFIG[subStatus as keyof typeof SUBSCRIPTION_STATUS_CONFIG]
		?? SUBSCRIPTION_STATUS_CONFIG.trial;

	const planName = subscription?.plan?.name ?? "No Plan";
	const planPrice = subscription?.plan
		? formatCurrency(Number(subscription.plan.price), subscription.plan.currency)
		: "—";

	const trialDaysLeft = subscription?.trialEndsAt
		? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86400000))
		: null;

	const totalProjects = projects?.length ?? 0;
	const totalApps = projects?.reduce(
		(sum, p) => sum + ((p as any).applications?.length ?? 0),
		0,
	) ?? 0;

	return (
		<>
			<Head>
				<title>Dashboard — {brand.APP_NAME}</title>
			</Head>

			<div className="space-y-6">
				{/* ── Trial banner ───────────────────────────────── */}
				{subStatus === "trial" && trialDaysLeft !== null && trialDaysLeft <= 7 && (
					<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Zap className="w-5 h-5 text-amber-400 shrink-0" />
							<div>
								<p className="text-amber-300 font-medium text-sm">
									{trialDaysLeft === 0
										? "Your trial expires today!"
										: `Your trial expires in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`}
								</p>
								<p className="text-amber-400/70 text-xs mt-0.5">
									Upgrade now to keep your deployments running.
								</p>
							</div>
						</div>
						<Link href="/dashboard/billing">
							<Button size="sm" className="bg-amber-600 hover:bg-amber-500 text-white border-0 shrink-0">
								Upgrade Now
							</Button>
						</Link>
					</div>
				)}

				{/* ── Page header ────────────────────────────────── */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold text-white">Dashboard</h1>
						<p className="text-slate-400 text-sm mt-1">
							Welcome back. Here's what's happening with your apps.
						</p>
					</div>
					<Link href="/dashboard/projects/new">
						<Button className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2">
							<Plus className="w-4 h-4" />
							New Project
						</Button>
					</Link>
				</div>

				{/* ── Stats ──────────────────────────────────────── */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					{[
						{
							label: "Projects",
							value: totalProjects,
							icon: <Server className="w-5 h-5 text-indigo-400" />,
							href: "/dashboard/projects",
							bg: "bg-indigo-500/10",
						},
						{
							label: "Applications",
							value: totalApps,
							icon: <Cloud className="w-5 h-5 text-cyan-400" />,
							href: "/dashboard/projects",
							bg: "bg-cyan-500/10",
						},
						{
							label: "Open Tickets",
							value: tickets?.filter((t) => t.status === "open" || t.status === "pending_staff").length ?? 0,
							icon: <HeadphonesIcon className="w-5 h-5 text-violet-400" />,
							href: "/dashboard/support",
							bg: "bg-violet-500/10",
						},
						{
							label: "Plan",
							value: planName,
							icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
							href: "/dashboard/billing",
							bg: "bg-emerald-500/10",
						},
					].map(({ label, value, icon, href, bg }) => (
						<Link key={label} href={href}>
							<Card className="bg-slate-900/70 border-slate-800 hover:border-slate-700 transition-all group cursor-pointer">
								<CardContent className="p-5">
									<div className="flex items-start justify-between">
										<div>
											<p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
											<p className="text-2xl font-bold text-white mt-1.5">{value}</p>
										</div>
										<div className={cn("p-2.5 rounded-xl", bg)}>
											{icon}
										</div>
									</div>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
					{/* ── Subscription card ───────────────────────── */}
					<Card className="bg-slate-900/70 border-slate-800 lg:col-span-1">
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-white text-base">Subscription</CardTitle>
								<Badge className={cn("border text-xs", statusConfig.color)}>
									{statusConfig.label}
								</Badge>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div>
								<p className="text-3xl font-bold text-white">{planName}</p>
								<p className="text-slate-400 text-sm mt-1">
									{planPrice}{subscription?.plan?.billingCycle ? `/${subscription.plan.billingCycle === "yearly" ? "yr" : "mo"}` : ""}
								</p>
							</div>

							{trialDaysLeft !== null && (
								<div>
									<div className="flex justify-between text-xs text-slate-400 mb-1.5">
										<span>Trial period</span>
										<span>{trialDaysLeft} days left</span>
									</div>
									<Progress
										value={trialDaysLeft}
										max={subscription?.plan?.trialDays ?? 14}
										className="h-1.5 bg-slate-800"
									/>
								</div>
							)}

							{subscription?.currentPeriodEnd && subStatus === "active" && (
								<p className="text-slate-400 text-xs">
									Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
								</p>
							)}

							<div className="pt-2 space-y-2">
								<Link href="/dashboard/billing" className="block">
									<Button variant="outline" size="sm" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 gap-2">
										<CreditCard className="w-4 h-4" />
										Manage Billing
									</Button>
								</Link>
								{subStatus === "trial" && (
									<Link href="/onboarding" className="block">
										<Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white gap-2">
											<Zap className="w-4 h-4" />
											Upgrade Plan
										</Button>
									</Link>
								)}
							</div>
						</CardContent>
					</Card>

					{/* ── Recent projects ─────────────────────────── */}
					<Card className="bg-slate-900/70 border-slate-800 lg:col-span-2">
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-white text-base">Recent Projects</CardTitle>
								<Link href="/dashboard/projects">
									<Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1 h-7 px-2 text-xs">
										View all
										<ArrowRight className="w-3 h-3" />
									</Button>
								</Link>
							</div>
						</CardHeader>
						<CardContent>
							{!projects || projects.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-10 text-center">
									<div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mb-3">
										<Server className="w-6 h-6 text-slate-500" />
									</div>
									<p className="text-slate-300 font-medium text-sm">No projects yet</p>
									<p className="text-slate-500 text-xs mt-1 mb-4">
										Deploy your first app in under 2 minutes
									</p>
									<Link href="/dashboard/projects/new">
										<Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white gap-2">
											<Plus className="w-3.5 h-3.5" />
											Create Project
										</Button>
									</Link>
								</div>
							) : (
								<div className="space-y-3">
									{projects.slice(0, 5).map((project) => (
										<Link
											key={project.projectId}
											href={`/dashboard/projects/${project.projectId}`}
											className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-all group"
										>
											<div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shrink-0">
												<span className="text-white font-bold text-xs">
													{project.name.charAt(0).toUpperCase()}
												</span>
											</div>
											<div className="flex-1 min-w-0">
												<p className="text-white text-sm font-medium truncate">{project.name}</p>
												<p className="text-slate-500 text-xs truncate">{project.description || "No description"}</p>
											</div>
											<ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
										</Link>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				{/* ── Quick Actions ────────────────────────────── */}
				<div>
					<h2 className="text-base font-semibold text-white mb-3">Quick Actions</h2>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{[
							{ label: "Deploy App", icon: <Cloud className="w-5 h-5" />, href: "/dashboard/projects/new", color: "text-indigo-400" },
							{ label: "Add Database", icon: <Database className="w-5 h-5" />, href: "/dashboard/databases", color: "text-cyan-400" },
							{ label: "Add Domain", icon: <Globe className="w-5 h-5" />, href: "/dashboard/domains", color: "text-emerald-400" },
							{ label: "Get Support", icon: <HeadphonesIcon className="w-5 h-5" />, href: "/dashboard/support", color: "text-violet-400" },
						].map(({ label, icon, href, color }) => (
							<Link key={label} href={href}>
								<Card className="bg-slate-900/70 border-slate-800 hover:border-slate-700 transition-all cursor-pointer group">
									<CardContent className="p-4 flex flex-col items-center justify-center gap-2 text-center">
										<div className={cn("transition-transform group-hover:scale-110", color)}>
											{icon}
										</div>
										<span className="text-slate-300 text-sm font-medium group-hover:text-white transition-colors">
											{label}
										</span>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

CustomerDashboardPage.getLayout = (page: ReactElement) => (
	<CustomerLayout>{page}</CustomerLayout>
);

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { session } = await validateRequest(ctx.req);
	if (!session) {
		return { redirect: { destination: "/", permanent: false } };
	}
	return { props: {} };
}

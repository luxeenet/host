import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Activity,
	ArrowRight,
	Bot,
	Boxes,
	Building,
	Check,
	CheckCircle,
	ChevronRight,
	Clock,
	Cloud,
	Code,
	Copy,
	Cpu,
	Database,
	ExternalLink,
	GitBranch,
	Globe,
	HardDrive,
	HelpCircle,
	Layers,
	LayoutTemplate,
	Lock,
	Menu,
	Network,
	RefreshCw,
	Rocket,
	Server,
	Shield,
	ShieldCheck,
	Sparkles,
	Terminal,
	Users,
	X,
	Zap,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { brand } from "@paas/branding";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { ModeToggle } from "@/components/ui/modeToggle";
import { cn } from "@/lib/utils";

export default function LandingPage() {
	const [activeTab, setActiveTab] = useState<string>("apps-db");
	const [copied, setCopied] = useState(false);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

	const installCmd = "curl -sSL https://get.hatdot.cloud/install.sh | sh";

	const handleCopy = () => {
		navigator.clipboard.writeText(installCmd);
		setCopied(true);
		toast.success("Command copied to clipboard!");
		setTimeout(() => setCopied(false), 2500);
	};

	return (
		<>
			<Head>
				<title>{brand.APP_NAME} — {brand.TAGLINE}</title>
				<meta
					name="description"
					content={`Deploy and manage modern applications, databases, and multi-service cloud stacks on high-performance cloud infrastructure with ${brand.APP_NAME}.`}
				/>
				<meta property="og:title" content={`${brand.APP_NAME} — ${brand.TAGLINE}`} />
				<meta
					property="og:description"
					content={`Next-generation developer PaaS. Deploy Git repositories, web services, and managed databases with zero-downtime rollouts and automatic edge SSL.`}
				/>
				<meta property="og:type" content="website" />
			</Head>

			<div className="min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
				{/* Top Announcement Bar */}
				<div className="border-b border-border/40 bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
					<span className="inline-flex size-2 rounded-full bg-emerald-500 animate-pulse" />
					<span>
						<strong className="font-semibold text-foreground">Next-Gen Cloud Platform:</strong>{" "}
						Start your 14-day free trial on any tier — no credit card required.
					</span>
					<Link
						href="/signup"
						className="hidden sm:inline-flex items-center gap-1 font-semibold text-primary hover:underline ml-1"
					>
						Claim Free Trial <ArrowRight className="size-3" />
					</Link>
				</div>

				{/* Header / Navigation Bar */}
				<header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
					<div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 h-16">
						{/* Logo */}
						<Link href="/" className="flex items-center gap-2.5 group">
							<Logo className="size-8 transition-transform group-hover:scale-105" />
							<span className="text-xl font-extrabold tracking-tight text-foreground">
								{brand.APP_NAME}
							</span>
						</Link>

						{/* Desktop Navigation Links */}
						<nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
							<a href="#features" className="hover:text-foreground transition-colors">
								Features
							</a>
							<a href="#ecosystem" className="hover:text-foreground transition-colors">
								Platform
							</a>
							<a href="#stats" className="hover:text-foreground transition-colors">
								Stats
							</a>
							<a href="#why-hatdot" className="hover:text-foreground transition-colors">
								Why {brand.APP_NAME}
							</a>
							<a href="#pricing" className="hover:text-foreground transition-colors">
								Pricing
							</a>
							<a href="#faq" className="hover:text-foreground transition-colors">
								FAQ
							</a>
						</nav>

						{/* Right Actions */}
						<div className="hidden md:flex items-center gap-3">
							<ModeToggle />
							<Button variant="ghost" size="sm" asChild className="text-sm font-medium">
								<Link href="/login">Sign in</Link>
							</Button>
							<Button size="sm" asChild className="text-sm font-semibold shadow-sm">
								<Link href="/signup">
									Start Free Trial <ArrowRight className="size-3.5 ml-1" />
								</Link>
							</Button>
						</div>

						{/* Mobile Hamburger Button */}
						<div className="flex md:hidden items-center gap-2">
							<ModeToggle />
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
								aria-label="Toggle menu"
							>
								{mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
							</Button>
						</div>
					</div>

					{/* Mobile Menu Dropdown */}
					{mobileMenuOpen && (
						<div className="md:hidden border-b border-border bg-background px-4 py-5 space-y-4 shadow-xl">
							<nav className="flex flex-col space-y-3 text-sm font-medium">
								<a
									href="#features"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									Features
								</a>
								<a
									href="#ecosystem"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									Platform
								</a>
								<a
									href="#stats"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									Stats
								</a>
								<a
									href="#why-hatdot"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									Why {brand.APP_NAME}
								</a>
								<a
									href="#pricing"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									Pricing
								</a>
								<a
									href="#faq"
									onClick={() => setMobileMenuOpen(false)}
									className="px-2 py-1.5 rounded-lg hover:bg-muted"
								>
									FAQ
								</a>
							</nav>
							<Separator />
							<div className="flex flex-col gap-2 pt-1">
								<Button variant="outline" asChild className="w-full justify-center">
									<Link href="/login">Sign in</Link>
								</Button>
								<Button asChild className="w-full justify-center">
									<Link href="/signup">Start Free Trial →</Link>
								</Button>
							</div>
						</div>
					)}
				</header>

				{/* ─── 1. HERO SECTION ────────────────────────────────────────── */}
				<section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-32">
					{/* Background ambient lighting */}
					<div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
						<div className="size-[640px] rounded-full bg-primary/10 blur-[130px]" />
						<div className="absolute top-1/3 -right-24 size-[400px] rounded-full bg-blue-500/8 blur-[100px]" />
					</div>

					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
						{/* Top Pill */}
						<div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary mb-6 shadow-sm hover:border-primary/40 transition-colors">
							<Sparkles className="size-3.5 text-primary" />
							<span>Next-Gen Cloud Orchestration Engine</span>
							<ChevronRight className="size-3 opacity-70" />
						</div>

						{/* Main Heading */}
						<h1 className="mx-auto max-w-4xl text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-foreground leading-[1.08]">
							Simplify{" "}
							<span className="relative inline-block text-primary whitespace-nowrap">
								<svg
									aria-hidden="true"
									viewBox="0 0 418 42"
									className="absolute left-0 top-3/4 h-[0.52em] w-full fill-primary/30 -z-10"
									preserveAspectRatio="none"
								>
									<path d="M203.371.916c-26.013-2.078-76.686 1.963-124.73 9.946L67.3 12.749C35.421 18.062 18.2 21.766 6.004 25.934 1.244 27.561.828 27.778.874 28.61c.07 1.214.828 1.121 9.595-1.176 9.072-2.377 17.15-3.92 39.246-7.496C123.565 7.986 157.869 4.492 195.942 5.046c7.461.108 19.25 1.696 19.17 2.582-.107 1.183-7.874 4.31-25.75 10.366-21.992 7.45-35.43 12.534-36.701 13.884-2.173 2.308-.202 4.407 4.442 4.734 2.654.187 3.263.157 15.593-.78 35.401-2.686 57.944-3.488 88.365-3.143 46.327.526 75.721 2.23 130.788 7.584 19.787 1.924 20.814 1.98 24.557 1.332l.066-.011c1.201-.203 1.53-1.825.399-2.335-2.911-1.31-4.893-1.604-22.048-3.261-57.509-5.556-87.871-7.36-132.059-7.842-23.239-.254-33.617-.116-50.627.674-11.629.54-42.371 2.494-46.696 2.967-2.359.259 8.133-3.625 26.504-9.81 23.239-7.825 27.934-10.149 28.304-14.005.417-4.348-3.529-6-16.878-7.066Z" />
								</svg>
								<span className="relative">Application & Database</span>
							</span>{" "}
							Deployments
						</h1>

						{/* Subheading */}
						<p className="mx-auto mt-6 max-w-2xl text-base sm:text-xl text-muted-foreground leading-relaxed">
							Deploy modern web services, managed databases, and connected multi-service
							stacks on high-performance cloud infrastructure with automated edge SSL and zero downtime.
						</p>

						{/* CTAs */}
						<div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
							<Button size="lg" asChild className="h-12 px-8 text-base font-semibold shadow-lg">
								<Link href="/signup">
									Start 14-Day Free Trial <ArrowRight className="size-4 ml-1.5" />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild className="h-12 px-8 text-base font-medium">
								<Link href="/login">Sign in to Console</Link>
							</Button>
						</div>

						{/* Quick CLI snippet */}
						<div className="mt-8 flex items-center justify-center">
							<div
								onClick={handleCopy}
								className="group flex items-center gap-3 rounded-xl border border-border bg-card/80 backdrop-blur-sm px-4 py-2.5 font-mono text-xs sm:text-sm text-muted-foreground shadow-sm hover:border-primary/50 cursor-pointer transition-all"
							>
								<Terminal className="size-4 text-primary shrink-0" />
								<span className="select-all text-foreground">{installCmd}</span>
								<button
									type="button"
									className="ml-2 text-muted-foreground group-hover:text-foreground transition-colors"
									aria-label="Copy install command"
								>
									{copied ? (
										<Check className="size-4 text-emerald-500" />
									) : (
										<Copy className="size-4" />
									)}
								</button>
							</div>
						</div>

						{/* Hero Dashboard Graphic / Interactive Mockup */}
						<div className="mt-14 sm:mt-18 relative mx-auto max-w-5xl rounded-2xl border border-border bg-card/90 shadow-2xl backdrop-blur-md overflow-hidden text-left">
							{/* Window Chrome Header */}
							<div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-3">
								<div className="flex items-center gap-2">
									<div className="size-3 rounded-full bg-red-500/80" />
									<div className="size-3 rounded-full bg-amber-500/80" />
									<div className="size-3 rounded-full bg-emerald-500/80" />
								</div>
								<div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 text-xs text-muted-foreground font-mono">
									<Lock className="size-3 text-emerald-500" />
									<span>https://console.{brand.PLATFORM_SUBDOMAIN_BASE}/project/production</span>
								</div>
								<div className="flex items-center gap-2 text-xs font-medium text-emerald-500">
									<span className="size-2 rounded-full bg-emerald-500 animate-ping" />
									Live Environment
								</div>
							</div>

							{/* Mock Dashboard View */}
							<div className="p-5 sm:p-7 space-y-6">
								{/* Service Banner */}
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border/80 bg-background/50 p-4">
									<div className="flex items-center gap-3.5">
										<div className="size-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center font-bold">
											<Rocket className="size-5" />
										</div>
										<div>
											<div className="flex items-center gap-2">
												<h3 className="font-bold text-foreground text-base">web-api-production</h3>
												<Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[11px] font-semibold">
													Active • Zero Downtime
												</Badge>
											</div>
											<p className="text-xs text-muted-foreground mt-0.5">
												Port: 3000 • Smart Engine Builder • Connected to GitHub (main)
											</p>
										</div>
									</div>

									<div className="flex items-center gap-2 self-start sm:self-auto">
										<a
											href="#"
											onClick={(e) => e.preventDefault()}
											className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-muted transition-colors"
										>
											<Globe className="size-3.5" />
											https://api.my-app.{brand.PLATFORM_SUBDOMAIN_BASE}
											<ExternalLink className="size-3 opacity-60" />
										</a>
									</div>
								</div>

								{/* Metrics Row */}
								<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
									<div className="rounded-xl border border-border bg-background/40 p-3.5">
										<span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
											<Cpu className="size-3 text-primary" /> CPU Usage
										</span>
										<div className="mt-1 flex items-baseline gap-1">
											<span className="text-xl sm:text-2xl font-bold text-foreground">12.4%</span>
											<span className="text-[10px] text-emerald-500 font-semibold">Healthy</span>
										</div>
									</div>

									<div className="rounded-xl border border-border bg-background/40 p-3.5">
										<span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
											<Layers className="size-3 text-primary" /> RAM Allocation
										</span>
										<div className="mt-1 flex items-baseline gap-1">
											<span className="text-xl sm:text-2xl font-bold text-foreground">384 MB</span>
											<span className="text-[10px] text-muted-foreground">/ 2 GB</span>
										</div>
									</div>

									<div className="rounded-xl border border-border bg-background/40 p-3.5">
										<span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
											<ShieldCheck className="size-3 text-emerald-500" /> SSL / Edge
										</span>
										<div className="mt-1 flex items-baseline gap-1">
											<span className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
												Let's Encrypt
											</span>
											<span className="text-[10px] text-muted-foreground">Auto</span>
										</div>
									</div>

									<div className="rounded-xl border border-border bg-background/40 p-3.5">
										<span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
											<Activity className="size-3 text-primary" /> Availability
										</span>
										<div className="mt-1 flex items-baseline gap-1">
											<span className="text-xl sm:text-2xl font-bold text-foreground">99.99%</span>
											<span className="text-[10px] text-emerald-500 font-semibold">0ms rollouts</span>
										</div>
									</div>
								</div>

								{/* Terminal Build Stream snippet */}
								<div className="rounded-xl border border-border bg-zinc-950 p-4 font-mono text-xs text-zinc-300 space-y-1.5 shadow-inner">
									<div className="text-zinc-500 flex items-center justify-between pb-1 border-b border-zinc-800">
										<span>DEPLOYMENT LOGS • STREAMING</span>
										<span className="text-[10px] text-emerald-400">RELEASE #42 • PASS</span>
									</div>
									<p className="text-emerald-400">✓ [git] Fetched main branch commit 7c72ce6 (latest)</p>
									<p className="text-zinc-400">ℹ [builder] Auto-detected Node.js / TypeScript environment via Smart Engine</p>
									<p className="text-zinc-400">✓ [engine] Optimized production application release in 14.2s</p>
									<p className="text-zinc-400">✓ [edge] Updated global routing rules with zero-downtime healthcheck</p>
									<p className="text-emerald-400 font-semibold">
										🚀 [active] Service live at https://api.my-app.{brand.PLATFORM_SUBDOMAIN_BASE} (TLS 1.3 Active)
									</p>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* ─── 2. BENTO FEATURES GRID ─────────────────────────────────── */}
				<section id="features" className="py-20 sm:py-28 border-t border-border/60 bg-muted/20">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Enterprise Cloud Architecture
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Powerful Deployment Tailored to You
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Unlock seamless cloud deployments, enterprise security boundaries, and automated
								database management — all with {brand.APP_NAME}’s developer-first features.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							{/* Card 1 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Rocket className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Flexible Application Deployment
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Deploy any application with automatic runtime detection, static builds, and
										instant zero-configuration compilation.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Auto-Detect Runtime <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 2 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Boxes className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Multi-Service Cloud Stacks
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Deploy complex multi-service architectures and worker microservices seamlessly with unified
										stack specification files.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Multi-Service Spec <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 3 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Database className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Managed Databases & Backups
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Deploy PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and LibSQL with one click and automated
										S3/R2 backups.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Automated Snapshots <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 4 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Globe className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Edge Network & Auto SSL
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Attach custom domains with automated Let's Encrypt certificates, edge caching, and DDoS
										mitigation.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Zero-Config HTTPS <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 5 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Shield className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Enterprise Cloud Security
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Every customer environment runs in dedicated private security boundaries with hard CPU/RAM caps
										and zero interference.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Guaranteed Quotas <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 6 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Users className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Granular RBAC & Teams
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Collaborate with teammates using role-based permissions, private organization boundaries, SSO, and
										comprehensive audit logs.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Team Workspaces <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 7 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<Activity className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										Live Telemetry & Alerts
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Monitor CPU, RAM, disk, and network throughput in real-time, receiving proactive notifications
										when limits approach.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									Real-Time Metrics <ArrowRight className="size-3" />
								</div>
							</div>

							{/* Card 8 */}
							<div className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md hover:border-primary/50 transition-all flex flex-col justify-between">
								<div className="space-y-3">
									<div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
										<LayoutTemplate className="size-5" />
									</div>
									<h3 className="text-lg font-bold text-foreground">
										One-Click Templates
									</h3>
									<p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
										Deploy popular tools like Supabase, Cal.com, WordPress, PocketBase, and Ghost in seconds with
										pre-configured blueprints.
									</p>
								</div>
								<div className="mt-5 pt-3 border-t border-border/60 text-xs font-semibold text-primary flex items-center gap-1">
									40+ Blueprints <ArrowRight className="size-3" />
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* ─── 3. INTERACTIVE ECOSYSTEM TABS ─────────────────────────── */}
				<section id="ecosystem" className="py-20 sm:py-28 border-t border-border/60">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Comprehensive Control
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Control Your Entire Digital Ecosystem
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Simplify your project and data management, ensure robust monitoring, and secure your
								backups — all without the hassle over low-level infrastructure details.
							</p>
						</div>

						{/* Tabs Header */}
						<div className="flex overflow-x-auto pb-3 gap-2 justify-start sm:justify-center border-b border-border/80">
							{[
								{ id: "apps-db", label: "Applications & Databases", icon: Layers },
								{ id: "compose", label: "Multi-Service Stacks", icon: Boxes },
								{ id: "security", label: "Security & Boundaries", icon: ShieldCheck },
								{ id: "logs", label: "Live Logs", icon: Terminal },
								{ id: "monitoring", label: "Monitoring", icon: Activity },
								{ id: "backups", label: "Backups", icon: HardDrive },
								{ id: "edge", label: "Edge Proxy", icon: Globe },
							].map((tab) => {
								const Icon = tab.icon;
								const isCurrent = activeTab === tab.id;
								return (
									<button
										key={tab.id}
										type="button"
										onClick={() => setActiveTab(tab.id)}
										className={cn(
											"flex items-center gap-2 whitespace-nowrap px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all",
											isCurrent
												? "bg-primary text-primary-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground hover:bg-muted/60",
										)}
									>
										<Icon className="size-4" />
										{tab.label}
									</button>
								);
							})}
						</div>

						{/* Tab Content Display */}
						<div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-10 shadow-lg">
							{activeTab === "apps-db" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Managed Services
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Centralize Applications & Databases in One View
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Seamlessly deploy web applications, microservices, and databases in a unified project space.
											Configure environment variables, attach persistent volumes, and wire databases to
											applications with automatic connection string generation.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Direct Git auto-deploy on every push</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Postgres, MySQL, Mongo, MariaDB, Redis, and LibSQL</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Zero downtime rolling updates with automated rollback safety</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-2 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>APPLICATION DETAILS</span>
											<span className="text-emerald-400">ACTIVE</span>
										</div>
										<p className="text-zinc-400">Name: <span className="text-white">my-nextjs-service</span></p>
										<p className="text-zinc-400">Branch: <span className="text-white">refs/heads/main</span></p>
										<p className="text-zinc-400">Builder: <span className="text-emerald-400">smart-engine</span></p>
										<p className="text-zinc-400">Attached DB: <span className="text-primary">postgres-primary</span></p>
										<p className="text-zinc-400">Internal URL: <span className="text-zinc-300">http://web-svc:3000</span></p>
										<p className="text-zinc-400">Edge Domain: <span className="text-emerald-400">https://my-nextjs-service.{brand.PLATFORM_SUBDOMAIN_BASE}</span></p>
									</div>
								</div>
							)}

							{activeTab === "compose" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Multi-Service Orchestration
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Connected Multi-Service Stacks
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Bring your multi-service configuration files without rewriting them. {brand.APP_NAME} automatically
											handles private networking, persistent storage, secret injection, and multi-service health checking.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Full standard multi-service syntax & environment substitution</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Per-service routing, ports, and external domain binding</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Automated perimeter security between customer environments</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-1 shadow-inner">
										<div className="text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
											<span>STACK-SPECIFICATION.YML</span>
										</div>
										<p className="text-blue-400">services:</p>
										<p className="text-blue-400 ml-4">web:</p>
										<p className="text-zinc-400 ml-8">build: <span className="text-emerald-400">./web</span></p>
										<p className="text-zinc-400 ml-8">ports: <span className="text-white">["3000:3000"]</span></p>
										<p className="text-zinc-400 ml-8">environment:</p>
										<p className="text-zinc-400 ml-12">- DATABASE_URL=postgres://user:pass@db:5432/main</p>
										<p className="text-blue-400 ml-4">cache:</p>
										<p className="text-zinc-400 ml-8">service: <span className="text-emerald-400">cache-layer:v2</span></p>
									</div>
								</div>
							)}

							{activeTab === "security" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Security First
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Enterprise Security & Resource Boundaries
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Every customer runs inside dedicated, hardware-backed resource perimeters. No customer can observe
											or interfere with another customer's processes, RAM, storage, or internal network endpoints.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Hardware-backed CPU & memory resource guarantees</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Cross-organization database connection rejection</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Encrypted credentials & environment secrets at rest</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-2 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>SECURITY POLICY STATUS</span>
											<span className="text-emerald-400">ENFORCED</span>
										</div>
										<p className="text-zinc-400">Security Boundary: <span className="text-white">zone_7c72ce612</span></p>
										<p className="text-zinc-400">Dedicated Perimeter: <span className="text-white">cloud_mesh_secure</span></p>
										<p className="text-zinc-400">Cross-Tenant Egress: <span className="text-rose-400">DENIED (DROP)</span></p>
										<p className="text-zinc-400">Memory Cap: <span className="text-emerald-400">4096 MB HARD LIMIT</span></p>
										<p className="text-zinc-400">CPU Allocation: <span className="text-emerald-400">2.0 Dedicated vCPU</span></p>
									</div>
								</div>
							)}

							{activeTab === "logs" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Observability
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Real-Time Streaming Logs & Output
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Watch application standard output and error streams in real-time right in your browser. Filter by
											service, search keywords, and track deployment stages line-by-line.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Zero-delay WebSocket log streaming</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Historical build logs stored and exportable</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Crash diagnostics and automatic restart tracking</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-1.5 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>SERVICE LOG STREAM • STDOUT</span>
											<span className="text-emerald-400">LIVE</span>
										</div>
										<p className="text-zinc-500">14:02:11.231 [server] Listening on port 3000</p>
										<p className="text-zinc-300">14:02:12.890 [http] GET /api/v1/health 200 OK (2.1ms)</p>
										<p className="text-zinc-300">14:02:15.112 [db] Postgres connection pool initialized (5 conns)</p>
										<p className="text-emerald-400">14:02:18.001 [ready] Ready for traffic on edge network</p>
									</div>
								</div>
							)}

							{activeTab === "monitoring" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Telemetry
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Instant Metric Gauges & Thresholds
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Track CPU percentage, memory consumption, storage growth, and network bandwidth over time.
											Set automated email and webhook notifications whenever utilization crosses your targets.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Per-service CPU & RAM consumption breakdown</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Storage volume capacity indicators</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Custom alerting thresholds and webhook integrations</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-3 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>METRICS TELEMETRY</span>
											<span className="text-emerald-400">ONLINE</span>
										</div>
										<div>
											<div className="flex justify-between text-zinc-400 mb-1">
												<span>CPU Utilization</span>
												<span>14.2%</span>
											</div>
											<div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
												<div className="h-full bg-primary w-[14%]" />
											</div>
										</div>
										<div>
											<div className="flex justify-between text-zinc-400 mb-1">
												<span>Memory (512 MB / 2048 MB)</span>
												<span>25.0%</span>
											</div>
											<div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
												<div className="h-full bg-emerald-500 w-[25%]" />
											</div>
										</div>
										<div>
											<div className="flex justify-between text-zinc-400 mb-1">
												<span>Disk Storage (1.2 GB / 20 GB)</span>
												<span>6.0%</span>
											</div>
											<div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
												<div className="h-full bg-blue-500 w-[6%]" />
											</div>
										</div>
									</div>
								</div>
							)}

							{activeTab === "backups" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Data Protection
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											Automated S3-Compatible Backups
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Never lose a byte of mission-critical customer data. Schedule recurring database dumps and
											volume archives sent directly to AWS S3, Cloudflare R2, MinIO, or custom storage endpoints.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Automated hourly, daily, or weekly schedules via cron</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>One-click point-in-time restore</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Client-side compression and retention policies</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-2 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>BACKUP JOBS</span>
											<span className="text-emerald-400">3 SUCCESS</span>
										</div>
										<p className="text-zinc-300">✓ postgres-backup-2026-11-17.sql.gz (14.2 MB) • S3</p>
										<p className="text-zinc-300">✓ redis-dump-2026-11-17.rdb (3.1 MB) • Cloudflare R2</p>
										<p className="text-zinc-300">✓ mysql-prod-2026-11-16.sql.gz (42.0 MB) • S3</p>
										<p className="text-emerald-400 mt-2">Next scheduled run: Today at 00:00 UTC</p>
									</div>
								</div>
							)}

							{activeTab === "edge" && (
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
									<div className="space-y-4">
										<Badge className="bg-primary/10 text-primary border-primary/20">
											Global Traffic
										</Badge>
										<h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
											High-Speed Edge Routing & SSL
										</h3>
										<p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
											Route incoming traffic cleanly through our intelligent reverse proxy layer. Custom domains
											receive automated TLS certificates with HTTP-to-HTTPS redirects and edge proxying.
										</p>
										<ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Automatic Let's Encrypt TLS renewal</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Intelligent path-based and subdomain routing</span>
											</li>
											<li className="flex items-center gap-2">
												<CheckCircle className="size-4 text-emerald-500 shrink-0" />
												<span>Built-in rate limiting and origin IP cloaking</span>
											</li>
										</ul>
									</div>
									<div className="rounded-xl border border-border bg-zinc-950 p-5 font-mono text-xs text-zinc-300 space-y-2 shadow-inner">
										<div className="text-zinc-500 flex justify-between border-b border-zinc-800 pb-2">
											<span>EDGE ROUTING STATUS</span>
											<span className="text-emerald-400">PROXIED</span>
										</div>
										<p className="text-zinc-400">Target Host: <span className="text-white">api.example.com</span></p>
										<p className="text-zinc-400">Origin IP: <span className="text-zinc-500">[REDACTED] (Edge Cloaked)</span></p>
										<p className="text-zinc-400">TLS Cert: <span className="text-emerald-400">Let's Encrypt Authority X3 (Valid)</span></p>
										<p className="text-zinc-400">HTTP/2 & HTTP/3: <span className="text-emerald-400">ENABLED</span></p>
										<p className="text-zinc-400">Edge Proxy: <span className="text-primary">ACTIVE (Proxied)</span></p>
									</div>
								</div>
							)}
						</div>
					</div>
				</section>

				{/* ─── 4. STATS SECTION ───────────────────────────────────────── */}
				<section id="stats" className="py-20 sm:py-28 border-t border-border/60 bg-muted/20">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Performance Benchmarks
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Stats You Didn't Ask For (But Secretly Love to See)
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Real numbers behind our high-performance cloud platform and global edge network.
							</p>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
							<div className="rounded-3xl border border-border bg-card p-8 text-center space-y-2 shadow-sm">
								<span className="text-4xl sm:text-5xl font-extrabold text-foreground tracking-tight">
									99.99%
								</span>
								<p className="text-sm font-semibold text-primary">Edge Uptime</p>
								<p className="text-xs text-muted-foreground">
									Continuous health checks and automated instant recovery.
								</p>
							</div>

							<div className="rounded-3xl border border-border bg-card p-8 text-center space-y-2 shadow-sm">
								<span className="text-4xl sm:text-5xl font-extrabold text-foreground tracking-tight">
									&lt; 25s
								</span>
								<p className="text-sm font-semibold text-primary">Average Build Time</p>
								<p className="text-xs text-muted-foreground">
									From git commit push to active live traffic.
								</p>
							</div>

							<div className="rounded-3xl border border-border bg-card p-8 text-center space-y-2 shadow-sm">
								<span className="text-4xl sm:text-5xl font-extrabold text-foreground tracking-tight">
									100%
								</span>
								<p className="text-sm font-semibold text-primary">Resource Security</p>
								<p className="text-xs text-muted-foreground">
									Hardware-governed network and memory boundary enforcement.
								</p>
							</div>

							<div className="rounded-3xl border border-border bg-card p-8 text-center space-y-2 shadow-sm">
								<span className="text-4xl sm:text-5xl font-extrabold text-foreground tracking-tight">
									0 ms
								</span>
								<p className="text-sm font-semibold text-primary">Downtime on Rollouts</p>
								<p className="text-xs text-muted-foreground">
									New release is verified healthy before switching traffic.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* ─── 5. WHY DEVELOPERS LOVE HATDOT ──────────────────────────── */}
				<section id="why-hatdot" className="py-20 sm:py-28 border-t border-border/60">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Why Developers Choose {brand.APP_NAME}
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Built for Developers, Optimized for Growth
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Forget complex Kubernetes configurations and surprise cloud bills. Experience clean, predictable
								cloud hosting that just works.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<div className="rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm">
								<div className="flex items-center gap-1 text-amber-500">
									{"★".repeat(5)}
								</div>
								<p className="text-sm text-foreground italic leading-relaxed">
									"{brand.APP_NAME} completely replaced our painful manual server setups. We push code, and in under 30
									seconds our API is live with HTTPS and full monitoring."
								</p>
								<div className="pt-2 border-t border-border/60 flex items-center gap-3">
									<div className="size-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
										AK
									</div>
									<div>
										<p className="text-xs font-bold text-foreground">Alex K.</p>
										<p className="text-[11px] text-muted-foreground">Full-Stack Engineer</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm">
								<div className="flex items-center gap-1 text-amber-500">
									{"★".repeat(5)}
								</div>
								<p className="text-sm text-foreground italic leading-relaxed">
									"The multi-service stack deployment is first-class. We deployed our web app, Redis queue, and
									Postgres database together seamlessly without any headache."
								</p>
								<div className="pt-2 border-t border-border/60 flex items-center gap-3">
									<div className="size-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
										SM
									</div>
									<div>
										<p className="text-xs font-bold text-foreground">Sarah M.</p>
										<p className="text-[11px] text-muted-foreground">Lead Architect</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm">
								<div className="flex items-center gap-1 text-amber-500">
									{"★".repeat(5)}
								</div>
								<p className="text-sm text-foreground italic leading-relaxed">
									"Supporting local payment methods like M-Pesa along with international credit cards made {brand.APP_NAME}{" "}
									the obvious choice for our team across East Africa."
								</p>
								<div className="pt-2 border-t border-border/60 flex items-center gap-3">
									<div className="size-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
										DB
									</div>
									<div>
										<p className="text-xs font-bold text-foreground">David B.</p>
										<p className="text-[11px] text-muted-foreground">Startup Founder</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* ─── 6. PRICING PREVIEW ─────────────────────────────────────── */}
				<section id="pricing" className="py-20 sm:py-28 border-t border-border/60 bg-muted/20">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Transparent Plans
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Simple, Predictable Cloud Pricing
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Every plan comes with dedicated resource boundaries, automatic SSL, and zero surprise bandwidth fees.
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
							{/* Starter */}
							<div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between shadow-sm">
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<h3 className="font-bold text-lg text-foreground">Starter</h3>
										<Badge variant="outline" className="text-xs">Free</Badge>
									</div>
									<div className="text-3xl font-extrabold text-foreground">
										Free <span className="text-xs text-muted-foreground font-normal">forever</span>
									</div>
									<p className="text-xs text-muted-foreground">
										For testing and deploying your first small web service.
									</p>
									<Separator />
									<ul className="space-y-2 text-xs text-muted-foreground">
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>1 Active Application</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>1 Custom Domain</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>512 MB RAM limit</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Automatic Edge SSL</span>
										</li>
									</ul>
								</div>
								<Button variant="outline" asChild className="w-full mt-6">
									<Link href="/signup">Get Started</Link>
								</Button>
							</div>

							{/* Basic */}
							<div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between shadow-sm">
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<h3 className="font-bold text-lg text-foreground">Basic</h3>
										<span className="text-xs text-emerald-500 font-semibold">14-Day Trial</span>
									</div>
									<div className="text-3xl font-extrabold text-foreground">
										$10 <span className="text-xs text-muted-foreground font-normal">/ month</span>
									</div>
									<p className="text-xs text-muted-foreground">
										Ideal for personal projects and growing web apps.
									</p>
									<Separator />
									<ul className="space-y-2 text-xs text-muted-foreground">
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>3 Active Applications</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>1 Managed Database</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>1024 MB RAM limit</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Daily Backups</span>
										</li>
									</ul>
								</div>
								<Button variant="outline" asChild className="w-full mt-6">
									<Link href="/signup">Start Free Trial</Link>
								</Button>
							</div>

							{/* Developer (Featured) */}
							<div className="rounded-2xl border-2 border-primary bg-card p-6 flex flex-col justify-between shadow-xl relative scale-[1.02]">
								<div className="absolute -top-3 left-1/2 -translate-x-1/2">
									<Badge className="bg-primary text-primary-foreground text-[10px] font-bold px-3 py-0.5">
										MOST POPULAR
									</Badge>
								</div>
								<div className="space-y-4">
									<div className="flex items-center justify-between mt-1">
										<h3 className="font-bold text-lg text-foreground">Developer</h3>
										<span className="text-xs text-emerald-500 font-semibold">14-Day Trial</span>
									</div>
									<div className="text-3xl font-extrabold text-foreground">
										$25 <span className="text-xs text-muted-foreground font-normal">/ month</span>
									</div>
									<p className="text-xs text-muted-foreground">
										For production applications requiring power and scale.
									</p>
									<Separator />
									<ul className="space-y-2 text-xs text-muted-foreground">
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>10 Active Applications</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>5 Managed Databases</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>4096 MB RAM limit</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Hourly Backups & S3 Export</span>
										</li>
									</ul>
								</div>
								<Button asChild className="w-full mt-6 font-semibold shadow-md">
									<Link href="/signup">Start 14-Day Free Trial →</Link>
								</Button>
							</div>

							{/* Business */}
							<div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between shadow-sm">
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<h3 className="font-bold text-lg text-foreground">Business</h3>
										<span className="text-xs text-emerald-500 font-semibold">14-Day Trial</span>
									</div>
									<div className="text-3xl font-extrabold text-foreground">
										$60 <span className="text-xs text-muted-foreground font-normal">/ month</span>
									</div>
									<p className="text-xs text-muted-foreground">
										For growing companies, teams, and high-traffic APIs.
									</p>
									<Separator />
									<ul className="space-y-2 text-xs text-muted-foreground">
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Unlimited Applications</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Unlimited Databases</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>16 GB RAM Limit</span>
										</li>
										<li className="flex items-center gap-2">
											<Check className="size-3.5 text-emerald-500 shrink-0" />
											<span>Priority 24/7 SLA Support</span>
										</li>
									</ul>
								</div>
								<Button variant="outline" asChild className="w-full mt-6">
									<Link href="/signup">Start Free Trial</Link>
								</Button>
							</div>
						</div>
					</div>
				</section>

				{/* ─── 7. FREQUENTLY ASKED QUESTIONS ─────────────────────────── */}
				<section id="faq" className="py-20 sm:py-28 border-t border-border/60">
					<div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
						<div className="text-center mb-14 space-y-3">
							<span className="text-xs font-bold uppercase tracking-widest text-primary">
								Got Questions?
							</span>
							<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
								Frequently Asked Questions
							</h2>
							<p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
								Everything you need to know about {brand.APP_NAME} Cloud and our deployment engine.
							</p>
						</div>

						<Accordion type="single" collapsible className="w-full space-y-3">
							<AccordionItem value="item-1" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									What is {brand.APP_NAME}?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									{brand.APP_NAME} is an enterprise-grade Platform as a Service (PaaS) that lets developers and teams
									deploy applications, managed databases, and multi-service stacks with zero configuration.
									We provide automatic edge SSL, dedicated resource security, live telemetry, and zero-downtime rollouts.
								</AccordionContent>
							</AccordionItem>

							<AccordionItem value="item-2" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									How does application deployment work?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									Simply connect your GitHub or GitLab repository, select a branch, or provide your application
									specification. Our automated builder detects your stack, optimizes your production release, attaches
									high-speed edge routing, and launches your app with a production URL in seconds.
								</AccordionContent>
							</AccordionItem>

							<AccordionItem value="item-3" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									How are databases managed and backed up?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									Databases (PostgreSQL, MySQL, MariaDB, MongoDB, Redis, and LibSQL) run inside dedicated, persistent
									cloud environments. You can configure automatic cron-based snapshot backups sent to AWS S3,
									compatible S3 storage, MinIO, or download backups directly from the portal.
								</AccordionContent>
							</AccordionItem>

							<AccordionItem value="item-4" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									What payment methods do you accept?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									We support both local African mobile money solutions (Vodacom M-Pesa, Tigo Pesa, Airtel Money,
									Halopesa) and international credit/debit cards (Visa, Mastercard, American Express).
								</AccordionContent>
							</AccordionItem>

							<AccordionItem value="item-5" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									Do I need a credit card for the free trial?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									No. You can sign up and start your 14-day free trial on any tier without entering credit card or payment
									details. You only enter payment details if you decide to keep running your services after the trial.
								</AccordionContent>
							</AccordionItem>

							<AccordionItem value="item-6" className="border rounded-2xl px-5 bg-card">
								<AccordionTrigger className="text-left font-semibold text-base py-4 hover:no-underline">
									Can I connect my own custom domains?
								</AccordionTrigger>
								<AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4">
									Yes! You can connect as many custom domains as your plan allows. {brand.APP_NAME} automatically provisions and
									renews Let's Encrypt TLS certificates and routes traffic seamlessly via our edge proxy network.
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>
				</section>

				{/* ─── 8. FINAL CTA BANNER ─────────────────────────────────────── */}
				<section className="py-20 sm:py-28 border-t border-border/60 relative overflow-hidden bg-gradient-to-b from-card to-background">
					<div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center space-y-6">
						<div className="inline-flex size-14 rounded-2xl bg-primary/10 text-primary items-center justify-center mx-auto shadow-inner">
							<Rocket className="size-7" />
						</div>
						<h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
							Unlock Your Cloud Deployment Potential with {brand.APP_NAME}
						</h2>
						<p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
							Skip running complex infrastructure scripts yourself. {brand.APP_NAME} provides a high-performance,
							enterprise-ready cloud platform ready to ship your ideas.
						</p>
						<div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
							<Button size="lg" asChild className="h-12 px-8 text-base font-semibold shadow-xl">
								<Link href="/signup">
									Start 14-Day Free Trial <ArrowRight className="size-4 ml-1.5" />
								</Link>
							</Button>
							<Button size="lg" variant="outline" asChild className="h-12 px-8 text-base font-medium">
								<Link href="/login">Sign in to Console</Link>
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Instant provisioning • Dedicated resource boundaries • Cancel anytime
						</p>
					</div>
				</section>

				{/* ─── 9. FOOTER ──────────────────────────────────────────────── */}
				<footer className="border-t border-border bg-card/40 py-14 px-4 sm:px-6 lg:px-8 text-xs text-muted-foreground">
					<div className="mx-auto max-w-7xl grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
						{/* Brand Column */}
						<div className="col-span-2 space-y-3">
							<Link href="/" className="flex items-center gap-2">
								<Logo className="size-6" />
								<span className="font-bold text-foreground text-base">{brand.APP_NAME}</span>
							</Link>
							<p className="text-xs max-w-sm leading-relaxed text-muted-foreground">
								Next-generation Cloud Platform for developers and enterprises. Ship faster with zero-downtime
								rollouts and managed infrastructure.
							</p>
							<p className="text-[11px] text-muted-foreground">
								Support: <a href={`mailto:${brand.SUPPORT_EMAIL}`} className="hover:text-foreground underline">{brand.SUPPORT_EMAIL}</a>
							</p>
						</div>

						{/* Product Column */}
						<div className="space-y-2.5">
							<p className="font-bold text-foreground text-xs uppercase tracking-wider">Product</p>
							<ul className="space-y-1.5">
								<li><a href="#features" className="hover:text-foreground transition-colors">Applications</a></li>
								<li><a href="#features" className="hover:text-foreground transition-colors">Databases</a></li>
								<li><a href="#features" className="hover:text-foreground transition-colors">Multi-Service Stacks</a></li>
								<li><a href="#features" className="hover:text-foreground transition-colors">Edge Proxy</a></li>
								<li><a href="#features" className="hover:text-foreground transition-colors">Monitoring</a></li>
							</ul>
						</div>

						{/* Platform Column */}
						<div className="space-y-2.5">
							<p className="font-bold text-foreground text-xs uppercase tracking-wider">Platform</p>
							<ul className="space-y-1.5">
								<li><a href="#ecosystem" className="hover:text-foreground transition-colors">Security & Guarantees</a></li>
								<li><a href="#stats" className="hover:text-foreground transition-colors">Uptime & Stats</a></li>
								<li><a href="#why-hatdot" className="hover:text-foreground transition-colors">Why {brand.APP_NAME}</a></li>
								<li><Link href="/signup" className="hover:text-foreground transition-colors">Free Trial</Link></li>
							</ul>
						</div>

						{/* Legal & Account */}
						<div className="space-y-2.5">
							<p className="font-bold text-foreground text-xs uppercase tracking-wider">Account</p>
							<ul className="space-y-1.5">
								<li><Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link></li>
								<li><Link href="/signup" className="hover:text-foreground transition-colors">Create Account</Link></li>
								<li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
								<li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
							</ul>
						</div>
					</div>

					<div className="mx-auto max-w-7xl pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
						<p>© {new Date().getFullYear()} {brand.COMPANY_NAME}. All rights reserved.</p>
						<p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
							<span className="size-1.5 rounded-full bg-emerald-500" />
							All cloud systems operational
						</p>
					</div>
				</footer>
			</div>
		</>
	);
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
	try {
		const { user } = await validateRequest(context.req);
		if (user) {
			return {
				redirect: {
					permanent: false,
					destination: "/dashboard/home",
				},
			};
		}
	} catch {}

	return {
		props: {},
	};
}

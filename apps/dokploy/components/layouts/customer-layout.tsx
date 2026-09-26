import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useState } from "react";
import {
	Activity,
	ChevronRight,
	Cloud,
	CreditCard,
	Database,
	Globe,
	HeadphonesIcon,
	LayoutDashboard,
	LogOut,
	Menu,
	Settings,
	User,
	X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const NAV_ITEMS = [
	{ label: "Overview", icon: LayoutDashboard, href: "/dashboard" },
	{ label: "Projects", icon: Cloud, href: "/dashboard/projects" },
	{ label: "Databases", icon: Database, href: "/dashboard/databases" },
	{ label: "Domains", icon: Globe, href: "/dashboard/domains" },
	{ label: "Usage", icon: Activity, href: "/dashboard/usage" },
	{ label: "Billing", icon: CreditCard, href: "/dashboard/billing" },
	{ label: "Support", icon: HeadphonesIcon, href: "/dashboard/support" },
	{ label: "Account", icon: Settings, href: "/dashboard/account" },
];

interface CustomerLayoutProps {
	children: ReactNode;
}

export function CustomerLayout({ children }: CustomerLayoutProps) {
	const router = useRouter();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const { data: user } = api.user.get.useQuery();

	const handleSignOut = async () => {
		await authClient.signOut();
		await router.push("/");
	};

	const SidebarContent = () => (
		<div className="flex flex-col h-full">
			{/* Logo */}
			<div className="p-5 border-b border-slate-800">
				<Link href="/dashboard" className="flex items-center gap-2.5">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shrink-0">
						<svg viewBox="0 0 24 24" className="w-4 h-4 text-white fill-current">
							<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
						</svg>
					</div>
					<span className="text-white font-bold text-base">{brand.APP_NAME}</span>
				</Link>
			</div>

			{/* Navigation */}
			<nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
				{NAV_ITEMS.map(({ label, icon: Icon, href }) => {
					const isActive =
						href === "/dashboard"
							? router.pathname === "/dashboard"
							: router.pathname.startsWith(href);

					return (
						<Link
							key={href}
							href={href}
							onClick={() => setSidebarOpen(false)}
							className={cn(
								"flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
								isActive
									? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/20"
									: "text-slate-400 hover:text-white hover:bg-slate-800",
							)}
						>
							<Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300")} />
							{label}
							{isActive && <ChevronRight className="ml-auto w-3 h-3 text-indigo-400" />}
						</Link>
					);
				})}
			</nav>

			{/* User footer */}
			<div className="p-3 border-t border-slate-800">
				<div className="flex items-center gap-3 p-2.5 rounded-lg mb-1">
					<div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
						<User className="w-4 h-4 text-white" />
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-white text-xs font-medium truncate">
							{(user as any)?.name ?? "Customer"}
						</p>
						<p className="text-slate-500 text-xs truncate">
							{(user as any)?.email ?? ""}
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleSignOut}
					className="w-full justify-start gap-2 text-slate-400 hover:text-white hover:bg-slate-800 text-xs"
				>
					<LogOut className="w-3.5 h-3.5" />
					Sign out
				</Button>
			</div>
		</div>
	);

	return (
		<div className="min-h-screen bg-slate-950 flex">
			{/* ── Desktop Sidebar ─────────────────────────── */}
			<aside className="hidden lg:flex w-56 shrink-0 flex-col bg-slate-900/80 border-r border-slate-800 fixed left-0 top-0 bottom-0 z-30">
				<SidebarContent />
			</aside>

			{/* ── Mobile Sidebar ──────────────────────────── */}
			{sidebarOpen && (
				<div className="lg:hidden fixed inset-0 z-50 flex">
					<div
						className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
						onClick={() => setSidebarOpen(false)}
					/>
					<aside className="relative w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setSidebarOpen(false)}
							className="absolute top-3 right-3 text-slate-400 hover:text-white h-7 w-7 p-0"
						>
							<X className="w-4 h-4" />
						</Button>
						<SidebarContent />
					</aside>
				</div>
			)}

			{/* ── Main content ────────────────────────────── */}
			<div className="flex-1 lg:ml-56 min-h-screen flex flex-col">
				{/* Top bar (mobile) */}
				<header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-20">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setSidebarOpen(true)}
						className="text-slate-400 hover:text-white h-8 w-8 p-0"
					>
						<Menu className="w-5 h-5" />
					</Button>
					<Link href="/dashboard" className="flex items-center gap-2">
						<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
							<svg viewBox="0 0 24 24" className="w-4 h-4 text-white fill-current">
								<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
							</svg>
						</div>
						<span className="text-white font-bold text-sm">{brand.APP_NAME}</span>
					</Link>
					<div className="w-8" />
				</header>

				{/* Page content */}
				<main className="flex-1 p-5 md:p-8 max-w-7xl w-full">
					{children}
				</main>
			</div>
		</div>
	);
}

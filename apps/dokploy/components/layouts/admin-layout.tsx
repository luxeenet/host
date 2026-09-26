import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactNode, useState } from "react";
import {
	Activity,
	ChevronRight,
	CreditCard,
	Database,
	Globe,
	LayoutDashboard,
	LogOut,
	Menu,
	Server,
	Settings,
	ShieldCheck,
	Users,
	Zap,
	X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ADMIN_NAV_ITEMS = [
	{ label: "Admin Overview", icon: LayoutDashboard, href: "/admin" },
	{ label: "Plans & Pricing", icon: Zap, href: "/admin/plans" },
	{ label: "Customers", icon: Users, href: "/admin/customers" },
	{ label: "Server Nodes", icon: Server, href: "/admin/servers" },
	{ label: "Dokploy Infra Control", icon: ShieldCheck, href: "/dashboard/home" },
];

interface AdminLayoutProps {
	children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
	const router = useRouter();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const handleSignOut = async () => {
		await authClient.signOut();
		await router.push("/");
	};

	const SidebarContent = () => (
		<div className="flex flex-col h-full">
			{/* Logo & Admin Badge */}
			<div className="p-5 border-b border-slate-800">
				<Link href="/admin" className="flex items-center gap-2.5">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-amber-500 flex items-center justify-center shrink-0 shadow-lg shadow-red-500/20">
						<ShieldCheck className="w-4 h-4 text-white" />
					</div>
					<div>
						<span className="text-white font-bold text-sm block leading-tight">{brand.APP_NAME}</span>
						<span className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest">Platform Admin</span>
					</div>
				</Link>
			</div>

			{/* Navigation */}
			<nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
				<div className="px-3 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
					Platform Administration
				</div>
				{ADMIN_NAV_ITEMS.map(({ label, icon: Icon, href }) => {
					const isActive =
						href === "/admin"
							? router.pathname === "/admin"
							: router.pathname.startsWith(href);

					return (
						<Link
							key={href}
							href={href}
							onClick={() => setSidebarOpen(false)}
							className={cn(
								"flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all group",
								isActive
									? "bg-gradient-to-r from-red-950/60 to-amber-950/40 text-amber-300 border border-amber-500/30 shadow-sm"
									: "text-slate-400 hover:text-white hover:bg-slate-800",
							)}
						>
							<Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-amber-400" : "text-slate-500 group-hover:text-slate-300")} />
							{label}
							{isActive && <ChevronRight className="ml-auto w-3 h-3 text-amber-400" />}
						</Link>
					);
				})}
			</nav>

			{/* Footer */}
			<div className="p-3 border-t border-slate-800 space-y-2">
				<Link href="/dashboard">
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-2 text-slate-400 hover:text-white hover:bg-slate-800 text-xs"
					>
						<LayoutDashboard className="w-3.5 h-3.5 text-indigo-400" />
						Switch to Customer Portal
					</Button>
				</Link>
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
			{/* Desktop Sidebar */}
			<aside className="hidden lg:flex w-60 shrink-0 flex-col bg-slate-900/90 border-r border-slate-800 fixed left-0 top-0 bottom-0 z-30">
				<SidebarContent />
			</aside>

			{/* Main Content */}
			<div className="flex-1 lg:ml-60 min-h-screen flex flex-col">
				<header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-20">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setSidebarOpen(true)}
						className="text-slate-400 hover:text-white h-8 w-8 p-0"
					>
						<Menu className="w-5 h-5" />
					</Button>
					<span className="text-white font-bold text-sm">{brand.APP_NAME} Admin</span>
					<div className="w-8" />
				</header>

				<main className="flex-1 p-5 md:p-8 max-w-7xl w-full">
					{children}
				</main>
			</div>
		</div>
	);
}

import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	Users,
	Search,
	ShieldAlert,
	CheckCircle,
	MoreVertical,
	UserCheck,
	UserX,
	CreditCard,
	Zap,
	RefreshCw,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_CUSTOMERS = [
	{
		id: "usr-901",
		name: "Alex Kibwana",
		email: "alex@techcorp.co.tz",
		plan: "Pro Developer Plan",
		status: "ACTIVE",
		appsCount: 4,
		joinedAt: "Sep 12, 2026",
		mrr: "$29.00",
	},
	{
		id: "usr-902",
		name: "Sarah Jenkins",
		email: "s.jenkins@devstudio.com",
		plan: "Business Scale Plan",
		status: "ACTIVE",
		appsCount: 12,
		joinedAt: "Aug 28, 2026",
		mrr: "$79.00",
	},
	{
		id: "usr-903",
		name: "David Mwangi",
		email: "david@mwangiapps.net",
		plan: "Starter Plan",
		status: "SUSPENDED",
		appsCount: 1,
		joinedAt: "Sep 20, 2026",
		mrr: "$9.00",
	},
];

export default function AdminCustomersPage() {
	const [customers, setCustomers] = useState(MOCK_CUSTOMERS);
	const [search, setSearch] = useState("");

	const toggleStatus = (id: string) => {
		setCustomers(
			customers.map((c) => {
				if (c.id === id) {
					const nextStatus = c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
					toast.success(`Customer ${c.name} account set to ${nextStatus}`);
					return { ...c, status: nextStatus };
				}
				return c;
			}),
		);
	};

	const filtered = customers.filter(
		(c) =>
			c.name.toLowerCase().includes(search.toLowerCase()) ||
			c.email.toLowerCase().includes(search.toLowerCase()) ||
			c.plan.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<>
			<Head>
				<title>Customer Management - {brand.APP_NAME} Admin</title>
			</Head>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Customer Accounts & Subscriptions</h1>
						<p className="text-slate-400 text-sm mt-1">
							Monitor registered customer accounts, subscription status, active deployments, and suspensions.
						</p>
					</div>
				</div>

				{/* Search Bar */}
				<div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
					<Search className="w-4 h-4 text-slate-500 ml-2" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search by customer name, email address, or plan tier..."
						className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-slate-500"
					/>
				</div>

				{/* Customer Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
								<tr>
									<th className="px-6 py-3.5 font-medium">Customer Name</th>
									<th className="px-6 py-3.5 font-medium">Email</th>
									<th className="px-6 py-3.5 font-medium">Current Plan</th>
									<th className="px-6 py-3.5 font-medium">Monthly MRR</th>
									<th className="px-6 py-3.5 font-medium">Apps Deployed</th>
									<th className="px-6 py-3.5 font-medium">Status</th>
									<th className="px-6 py-3.5 font-medium text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800/60 text-slate-300">
								{filtered.map((cust) => (
									<tr key={cust.id} className="hover:bg-slate-800/30 transition-colors">
										<td className="px-6 py-4 font-bold text-white">{cust.name}</td>
										<td className="px-6 py-4 text-slate-400">{cust.email}</td>
										<td className="px-6 py-4 font-medium text-amber-300">{cust.plan}</td>
										<td className="px-6 py-4 font-semibold text-emerald-400">{cust.mrr}</td>
										<td className="px-6 py-4">{cust.appsCount} Apps</td>
										<td className="px-6 py-4">
											<span
												className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
													cust.status === "ACTIVE"
														? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
														: "bg-red-500/20 text-red-400 border border-red-500/30"
												}`}
											>
												{cust.status}
											</span>
										</td>
										<td className="px-6 py-4 text-right">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => toggleStatus(cust.id)}
												className={`text-xs h-8 px-3 gap-1.5 ${
													cust.status === "ACTIVE"
														? "text-red-400 hover:bg-red-950/30"
														: "text-emerald-400 hover:bg-emerald-950/30"
												}`}
											>
												{cust.status === "ACTIVE" ? (
													<>
														<UserX className="w-3.5 h-3.5" /> Suspend Account
													</>
												) : (
													<>
														<UserCheck className="w-3.5 h-3.5" /> Activate Account
													</>
												)}
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}

AdminCustomersPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

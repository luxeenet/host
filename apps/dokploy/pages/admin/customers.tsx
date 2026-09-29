import Head from "next/head";
import { type ReactElement, useState } from "react";
import {
	Search,
	UserCheck,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { api } from "@/utils/api";

export default function AdminCustomersPage() {
	const { data: customers, isLoading } = api.admin.listCustomers.useQuery();
	const [search, setSearch] = useState("");

	const filtered = (customers || []).filter(
		(c) =>
			`${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
			c.email.toLowerCase().includes(search.toLowerCase()) ||
			c.role.toLowerCase().includes(search.toLowerCase()),
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
							Monitor registered customer accounts, roles, active projects, and system access.
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
						placeholder="Search by customer name, email address, or role..."
						className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-slate-500"
					/>
				</div>

				{/* Customer Table */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="overflow-x-auto">
						{isLoading ? (
							<div className="text-slate-400 text-sm p-8 text-center">Loading customer accounts from database...</div>
						) : filtered.length === 0 ? (
							<div className="text-slate-500 text-sm p-8 text-center">No customer accounts found.</div>
						) : (
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
									<tr>
										<th className="px-6 py-3.5 font-medium">Customer Name</th>
										<th className="px-6 py-3.5 font-medium">Email</th>
										<th className="px-6 py-3.5 font-medium">Role</th>
										<th className="px-6 py-3.5 font-medium">Projects</th>
										<th className="px-6 py-3.5 font-medium">Platform Admin</th>
										<th className="px-6 py-3.5 font-medium">Registered</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-800/60 text-slate-300">
									{filtered.map((cust) => (
										<tr key={cust.id} className="hover:bg-slate-800/30 transition-colors">
											<td className="px-6 py-4 font-bold text-white">
												{`${cust.firstName} ${cust.lastName}`.trim() || "User"}
											</td>
											<td className="px-6 py-4 text-slate-400">{cust.email}</td>
											<td className="px-6 py-4 font-medium text-amber-300 uppercase">{cust.role}</td>
											<td className="px-6 py-4">{cust.projectCount} Projects</td>
											<td className="px-6 py-4">
												<span
													className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
														cust.isPlatformAdmin
															? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
															: "bg-slate-800 text-slate-400 border border-slate-700"
													}`}
												>
													{cust.isPlatformAdmin ? "YES" : "NO"}
												</span>
											</td>
											<td className="px-6 py-4 text-slate-400">{cust.createdAt}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

AdminCustomersPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

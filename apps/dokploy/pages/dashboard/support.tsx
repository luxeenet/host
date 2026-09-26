import Head from "next/head";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import {
	HeadphonesIcon,
	Plus,
	MessageSquare,
	Clock,
	CheckCircle,
	AlertCircle,
	Send,
	Paperclip,
	ChevronRight,
	HelpCircle,
	BookOpen,
} from "lucide-react";
import { CustomerLayout } from "@/components/layouts/customer-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";

const MOCK_TICKETS = [
	{
		id: "TICK-8021",
		subject: "SSL certificate renewal verification on custom domain",
		category: "Domains & SSL",
		priority: "HIGH",
		status: "OPEN",
		updatedAt: "10 mins ago",
		messages: 2,
	},
	{
		id: "TICK-7994",
		subject: "Query regarding PostgreSQL automated daily backup retention",
		category: "Databases",
		priority: "MEDIUM",
		status: "CLOSED",
		updatedAt: "Yesterday",
		messages: 4,
	},
];

export default function SupportPage() {
	const [showNewModal, setShowNewModal] = useState(false);
	const [subject, setSubject] = useState("");
	const [category, setCategory] = useState("Deployment");
	const [priority, setPriority] = useState("MEDIUM");
	const [message, setMessage] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleCreateTicket = () => {
		if (!subject || !message) {
			toast.error("Please fill in the subject and message details.");
			return;
		}
		setSubmitting(true);
		setTimeout(() => {
			setSubmitting(false);
			setShowNewModal(false);
			setSubject("");
			setMessage("");
			toast.success("Support ticket created! Our engineering team has been notified.");
		}, 1200);
	};

	return (
		<>
			<Head>
				<title>Customer Support - {brand.APP_NAME}</title>
			</Head>
			<div className="space-y-8">
				{/* Page Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Customer Support</h1>
						<p className="text-slate-400 text-sm mt-1">
							Need help with deployments, custom domains, or database configuration? Our team is here 24/7.
						</p>
					</div>

					<Button
						onClick={() => setShowNewModal(true)}
						className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-2 shrink-0 shadow-lg shadow-indigo-600/20"
					>
						<Plus className="w-4 h-4" /> Open Support Ticket
					</Button>
				</div>

				{/* Help Resources Bar */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-indigo-950/80 border border-indigo-500/20 flex items-center justify-center shrink-0">
							<BookOpen className="w-5 h-5 text-indigo-400" />
						</div>
						<div>
							<h4 className="text-xs font-bold text-white">Documentation</h4>
							<p className="text-[11px] text-slate-400 mt-0.5">Explore guides & deployment tutorials</p>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center shrink-0">
							<HelpCircle className="w-5 h-5 text-cyan-400" />
						</div>
						<div>
							<h4 className="text-xs font-bold text-white">System Status</h4>
							<p className="text-[11px] text-slate-400 mt-0.5">All platform systems operational (99.99%)</p>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-500/20 flex items-center justify-center shrink-0">
							<HeadphonesIcon className="w-5 h-5 text-emerald-400" />
						</div>
						<div>
							<h4 className="text-xs font-bold text-white">Priority SLA Response</h4>
							<p className="text-[11px] text-slate-400 mt-0.5">Average response time: &lt; 15 mins</p>
						</div>
					</div>
				</div>

				{/* Create Ticket Modal / Form inline */}
				{showNewModal && (
					<div className="p-6 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-4 shadow-2xl relative">
						<div className="flex items-center justify-between border-b border-slate-800 pb-3">
							<h3 className="text-base font-bold text-white flex items-center gap-2">
								<Plus className="w-4 h-4 text-indigo-400" /> Submit New Support Ticket
							</h3>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setShowNewModal(false)}
								className="text-slate-400 hover:text-white text-xs h-7"
							>
								Cancel
							</Button>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<label className="text-xs font-medium text-slate-300 block mb-1">Subject</label>
								<input
									type="text"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									placeholder="Brief summary of your issue"
									className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
								/>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="text-xs font-medium text-slate-300 block mb-1">Category</label>
									<select
										value={category}
										onChange={(e) => setCategory(e.target.value)}
										className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-indigo-500"
									>
										<option value="Deployment">Deployment / Build</option>
										<option value="Domains & SSL">Domains & SSL</option>
										<option value="Databases">Databases</option>
										<option value="Billing & Payments">Billing & Payments</option>
										<option value="Other">Other Inquiry</option>
									</select>
								</div>
								<div>
									<label className="text-xs font-medium text-slate-300 block mb-1">Priority</label>
									<select
										value={priority}
										onChange={(e) => setPriority(e.target.value)}
										className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-indigo-500"
									>
										<option value="LOW">Low</option>
										<option value="MEDIUM">Medium</option>
										<option value="HIGH">High (Urgent)</option>
									</select>
								</div>
							</div>
						</div>

						<div>
							<label className="text-xs font-medium text-slate-300 block mb-1">Message Description</label>
							<textarea
								rows={4}
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								placeholder="Describe the issue, error messages, or assistance required in detail..."
								className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none"
							/>
						</div>

						<div className="flex justify-end gap-3 pt-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowNewModal(false)}
								className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs"
							>
								Discard
							</Button>
							<Button
								disabled={submitting}
								onClick={handleCreateTicket}
								className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-5"
							>
								{submitting ? "Submitting..." : "Submit Ticket"}
							</Button>
						</div>
					</div>
				)}

				{/* Support Tickets List */}
				<div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
					<div className="p-6 border-b border-slate-800">
						<h3 className="text-base font-semibold text-white">Your Tickets</h3>
						<p className="text-xs text-slate-400">Track and respond to your active support conversations.</p>
					</div>

					<div className="divide-y divide-slate-800/60 text-slate-300">
						{MOCK_TICKETS.map((t) => (
							<div
								key={t.id}
								className="p-5 hover:bg-slate-800/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer"
							>
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<span className="font-mono text-xs font-bold text-indigo-400">{t.id}</span>
										<span
											className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
												t.status === "OPEN"
													? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
													: "bg-slate-800 text-slate-400"
											}`}
										>
											{t.status}
										</span>
										<span className="text-[11px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
											{t.category}
										</span>
									</div>
									<h4 className="text-sm font-semibold text-white">{t.subject}</h4>
									<p className="text-xs text-slate-400 flex items-center gap-2">
										<span>Last update: {t.updatedAt}</span> • <span>{t.messages} messages</span>
									</p>
								</div>

								<Button
									variant="outline"
									size="sm"
									className="border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-xs gap-1.5 shrink-0"
								>
									<MessageSquare className="w-3.5 h-3.5 text-indigo-400" /> View Thread
								</Button>
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

SupportPage.getLayout = (page: ReactElement) => <CustomerLayout>{page}</CustomerLayout>;

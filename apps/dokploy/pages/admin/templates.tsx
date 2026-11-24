import Head from "next/head";
import { type ReactElement, useState, useMemo } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import {
	Boxes,
	Check,
	Code2,
	Copy,
	ExternalLink,
	Eye,
	FileCode,
	Filter,
	Layers,
	Plus,
	RefreshCw,
	Search,
	Sparkles,
	Trash2,
	Upload,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AdminTemplatesPage() {
	const utils = api.useUtils();
	const { data: templates = [], isLoading, refetch } = api.admin.listTemplates.useQuery();

	const [search, setSearch] = useState("");
	const [selectedTag, setSelectedTag] = useState<string>("all");

	// Add Template Dialog State
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [formData, setFormData] = useState({
		id: "",
		name: "",
		description: "",
		version: "1.0.0",
		tags: "",
		logo: "",
		dockerCompose: `services:
  app:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
`,
		env: `# Application Environment Variables
PORT=80
NODE_ENV=production
`,
	});

	// Inspect Template Dialog State
	const [inspectingTemplate, setInspectingTemplate] = useState<any | null>(null);

	// Delete Template Dialog State
	const [templateToDelete, setTemplateToDelete] = useState<{ id: string; name: string } | null>(null);

	// Mutations
	const addTemplateMutation = api.admin.addTemplate.useMutation({
		onSuccess: () => {
			toast.success("Custom application template saved successfully!");
			utils.admin.listTemplates.invalidate();
			setIsAddModalOpen(false);
			setFormData({
				id: "",
				name: "",
				description: "",
				version: "1.0.0",
				tags: "",
				logo: "",
				dockerCompose: `services:
  app:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
`,
				env: "",
			});
		},
		onError: (err) => {
			toast.error(err.message || "Failed to save template. Please check the Docker Compose syntax.");
		},
	});

	const deleteTemplateMutation = api.admin.deleteTemplate.useMutation({
		onSuccess: () => {
			toast.success("Template removed from catalog successfully");
			utils.admin.listTemplates.invalidate();
			setTemplateToDelete(null);
		},
		onError: (err) => {
			toast.error(err.message || "Failed to remove template");
		},
	});

	// Compute available tags
	const allTags = useMemo(() => {
		const tagSet = new Set<string>();
		for (const t of templates) {
			for (const tag of t.tags || []) {
				tagSet.add(tag);
			}
		}
		return Array.from(tagSet).sort();
	}, [templates]);

	// Filter templates
	const filteredTemplates = useMemo(() => {
		return templates.filter((tpl) => {
			const matchesSearch =
				tpl.name.toLowerCase().includes(search.toLowerCase()) ||
				tpl.id.toLowerCase().includes(search.toLowerCase()) ||
				tpl.description.toLowerCase().includes(search.toLowerCase()) ||
				(tpl.tags || []).some((tag: string) => tag.toLowerCase().includes(search.toLowerCase()));

			if (!matchesSearch) return false;

			if (selectedTag === "all") return true;
			if (selectedTag === "custom") return (tpl as any).custom === true;
			return (tpl.tags || []).includes(selectedTag);
		});
	}, [templates, search, selectedTag]);

	const customCount = templates.filter((t: any) => t.custom === true).length;

	const handleCreateTemplate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!formData.id.trim() || !formData.name.trim() || !formData.dockerCompose.trim()) {
			toast.error("Please fill in the required fields: Template ID, Name, and Docker Compose YAML.");
			return;
		}

		const tagsArray = formData.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		addTemplateMutation.mutate({
			id: formData.id.toLowerCase().trim(),
			name: formData.name.trim(),
			description: formData.description.trim() || formData.name.trim(),
			version: formData.version.trim() || "1.0.0",
			tags: tagsArray.length > 0 ? tagsArray : ["Custom"],
			logo: formData.logo.trim() || undefined,
			dockerCompose: formData.dockerCompose,
			env: formData.env.trim() || undefined,
		});
	};

	return (
		<>
			<Head>
				<title>Template Catalog - {brand.APP_NAME} Admin</title>
			</Head>
			<div className="space-y-8 pb-12">
				{/* Header */}
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-white tracking-tight">Application Templates Catalog</h1>
						<p className="text-slate-400 text-sm mt-1">
							Manage system application templates. Add custom compose templates and remove unwanted presets from customer view.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
						>
							<RefreshCw className="w-3.5 h-3.5 mr-2" />
							Refresh
						</Button>
						<Button
							size="sm"
							onClick={() => setIsAddModalOpen(true)}
							className="bg-blue-600 hover:bg-blue-700 text-white"
						>
							<Plus className="w-4 h-4 mr-1.5" />
							Add Template
						</Button>
					</div>
				</div>

				{/* High-level stats */}
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
							<Boxes className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Total Available</div>
							<div className="text-xl font-bold text-white">{templates.length} Templates</div>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
							<Sparkles className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Custom Templates</div>
							<div className="text-xl font-bold text-indigo-400">{customCount} Custom</div>
						</div>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3.5">
						<div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
							<Layers className="w-5 h-5" />
						</div>
						<div>
							<div className="text-xs text-slate-400 font-medium">Unique Categories</div>
							<div className="text-xl font-bold text-purple-400">{allTags.length} Categories</div>
						</div>
					</div>
				</div>

				{/* Search & Tag Filter */}
				<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
					<div className="flex-1 flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
						<Search className="w-4 h-4 text-slate-500 ml-2 shrink-0" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search templates by name, id, category, or description..."
							className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-slate-500"
						/>
						{search && (
							<button
								onClick={() => setSearch("")}
								className="text-xs text-slate-500 hover:text-slate-300 mr-2"
							>
								Clear
							</button>
						)}
					</div>

					{/* Tag Filter Pills */}
					<div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
						<button
							onClick={() => setSelectedTag("all")}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
								selectedTag === "all"
									? "bg-slate-800 text-white border border-slate-700"
									: "bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-slate-200"
							}`}
						>
							All ({templates.length})
						</button>
						{customCount > 0 && (
							<button
								onClick={() => setSelectedTag("custom")}
								className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
									selectedTag === "custom"
										? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
										: "bg-slate-900/80 text-indigo-400 border border-slate-800 hover:text-indigo-300"
								}`}
							>
								Custom ({customCount})
							</button>
						)}
						{allTags.slice(0, 6).map((tag) => (
							<button
								key={tag}
								onClick={() => setSelectedTag(tag)}
								className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
									selectedTag === tag
										? "bg-slate-800 text-blue-400 border border-slate-700"
										: "bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-slate-200"
								}`}
							>
								{tag}
							</button>
						))}
					</div>
				</div>

				{/* Template Cards Grid */}
				{isLoading ? (
					<div className="text-slate-400 text-sm p-16 text-center flex flex-col items-center justify-center gap-2">
						<RefreshCw className="w-5 h-5 animate-spin text-slate-500" />
						<span>Loading template catalog...</span>
					</div>
				) : filteredTemplates.length === 0 ? (
					<div className="p-12 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-500 text-sm">
						No templates found matching your search.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{filteredTemplates.map((tpl) => {
							const isCustom = (tpl as any).custom === true;
							return (
								<div
									key={tpl.id}
									className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between group"
								>
									<div>
										{/* Top Row: Logo & Badges */}
										<div className="flex items-start justify-between gap-3 mb-3">
											<div className="flex items-center gap-3">
												<div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
													{tpl.logo ? (
														<img
															src={tpl.logo}
															alt={tpl.name}
															className="w-full h-full object-contain"
															onError={(e) => {
																(e.target as any).style.display = "none";
															}}
														/>
													) : (
														<Boxes className="w-5 h-5 text-slate-400" />
													)}
												</div>
												<div>
													<h3 className="font-bold text-white text-sm group-hover:text-blue-400 transition-colors">
														{tpl.name}
													</h3>
													<div className="text-[11px] text-slate-500 font-mono">
														{tpl.id} • v{tpl.version || "1.0.0"}
													</div>
												</div>
											</div>

											{isCustom ? (
												<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
													CUSTOM
												</span>
											) : (
												<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
													CATALOG
												</span>
											)}
										</div>

										{/* Description */}
										<p className="text-slate-400 text-xs line-clamp-2 mb-4 leading-relaxed">
											{tpl.description || "Pre-configured application stack for Docker compose deployment."}
										</p>

										{/* Tags */}
										<div className="flex flex-wrap gap-1.5 mb-4">
											{(tpl.tags || []).slice(0, 4).map((tag: string) => (
												<span
													key={tag}
													className="px-2 py-0.5 rounded text-[10px] bg-slate-800/80 text-slate-300 border border-slate-700/60"
												>
													{tag}
												</span>
											))}
											{(tpl.tags || []).length > 4 && (
												<span className="px-1.5 py-0.5 rounded text-[10px] text-slate-500">
													+{(tpl.tags || []).length - 4} more
												</span>
											)}
										</div>
									</div>

									{/* Card Footer Actions */}
									<div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setInspectingTemplate(tpl)}
											className="h-8 text-xs text-slate-400 hover:text-white hover:bg-slate-800 px-2.5"
										>
											<Eye className="w-3.5 h-3.5 mr-1" />
											View Details
										</Button>

										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setTemplateToDelete({
													id: tpl.id,
													name: tpl.name,
												})
											}
											title="Delete template from system"
											className="h-8 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2.5"
										>
											<Trash2 className="w-3.5 h-3.5 mr-1" />
											Remove
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				)}

				{/* Add Custom Template Modal */}
				<Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
					<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-950 border border-slate-800 text-white">
						<form onSubmit={handleCreateTemplate} className="space-y-5">
							<DialogHeader>
								<DialogTitle className="text-xl font-bold flex items-center gap-2">
									<Plus className="w-5 h-5 text-blue-400" />
									Add Custom Application Template
								</DialogTitle>
								<DialogDescription className="text-slate-400 text-xs">
									Create a new Docker Compose template. Templates added here will be immediately available to system administrators.
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-4">
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Template ID <span className="text-rose-400">*</span>
										</label>
										<input
											type="text"
											required
											value={formData.id}
											onChange={(e) => setFormData({ ...formData, id: e.target.value })}
											placeholder="e.g. directus, pocketbase"
											className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500 font-mono"
										/>
										<span className="text-[10px] text-slate-500 mt-0.5 block">Lowercase, numbers, hyphens only</span>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Display Name <span className="text-rose-400">*</span>
										</label>
										<input
											type="text"
											required
											value={formData.name}
											onChange={(e) => setFormData({ ...formData, name: e.target.value })}
											placeholder="e.g. Directus Headless CMS"
											className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500"
										/>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Version
										</label>
										<input
											type="text"
											value={formData.version}
											onChange={(e) => setFormData({ ...formData, version: e.target.value })}
											placeholder="1.0.0"
											className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500 font-mono"
										/>
									</div>

									<div>
										<label className="text-xs font-semibold text-slate-300 block mb-1">
											Categories / Tags
										</label>
										<input
											type="text"
											value={formData.tags}
											onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
											placeholder="e.g. CMS, Database, API"
											className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500"
										/>
									</div>
								</div>

								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1">
										Logo URL (optional)
									</label>
									<input
										type="url"
										value={formData.logo}
										onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
										placeholder="https://cdn.example.com/logo.svg"
										className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500"
									/>
								</div>

								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1">
										Short Description
									</label>
									<input
										type="text"
										value={formData.description}
										onChange={(e) => setFormData({ ...formData, description: e.target.value })}
										placeholder="Brief summary of what this application does"
										className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-blue-500"
									/>
								</div>

								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="text-xs font-semibold text-slate-300">
											Docker Compose YAML <span className="text-rose-400">*</span>
										</label>
										<span className="text-[10px] text-slate-400">Strict security rules apply</span>
									</div>
									<textarea
										rows={8}
										required
										value={formData.dockerCompose}
										onChange={(e) => setFormData({ ...formData, dockerCompose: e.target.value })}
										className="w-full p-3 text-xs font-mono rounded-lg bg-slate-900 border border-slate-800 text-emerald-300 focus:outline-none focus:border-blue-500 leading-relaxed"
										placeholder="services:\n  ..."
									/>
								</div>

								<div>
									<label className="text-xs font-semibold text-slate-300 block mb-1">
										Default Environment Variables (.env)
									</label>
									<textarea
										rows={4}
										value={formData.env}
										onChange={(e) => setFormData({ ...formData, env: e.target.value })}
										className="w-full p-3 text-xs font-mono rounded-lg bg-slate-900 border border-slate-800 text-amber-300 focus:outline-none focus:border-blue-500 leading-relaxed"
										placeholder="KEY=value\nPORT=3000"
									/>
								</div>
							</div>

							<DialogFooter className="gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => setIsAddModalOpen(false)}
									className="border-slate-800 text-slate-400 hover:bg-slate-900"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={addTemplateMutation.isPending}
									className="bg-blue-600 hover:bg-blue-700 text-white"
								>
									{addTemplateMutation.isPending ? "Validating & Saving..." : "Save Template"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				{/* Inspect Template Details Modal */}
				<Dialog open={!!inspectingTemplate} onOpenChange={(open) => !open && setInspectingTemplate(null)}>
					<DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-slate-950 border border-slate-800 text-white">
						{inspectingTemplate && (
							<div className="space-y-5">
								<DialogHeader>
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
											{inspectingTemplate.logo ? (
												<img
													src={inspectingTemplate.logo}
													alt={inspectingTemplate.name}
													className="w-full h-full object-contain"
												/>
											) : (
												<Boxes className="w-5 h-5 text-slate-400" />
											)}
										</div>
										<div>
											<DialogTitle className="text-lg font-bold flex items-center gap-2">
												<span>{inspectingTemplate.name}</span>
												<span className="text-xs text-slate-400 font-mono">
													v{inspectingTemplate.version || "1.0.0"}
												</span>
											</DialogTitle>
											<DialogDescription className="text-slate-400 text-xs">
												Identifier: <code className="text-blue-400">{inspectingTemplate.id}</code>
											</DialogDescription>
										</div>
									</div>
								</DialogHeader>

								<div className="space-y-4">
									<div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
										{inspectingTemplate.description || "No description provided."}
									</div>

									<div>
										<h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
											Assigned Tags
										</h4>
										<div className="flex flex-wrap gap-1.5">
											{(inspectingTemplate.tags || []).map((t: string) => (
												<span
													key={t}
													className="px-2.5 py-1 rounded text-xs bg-slate-900 text-slate-300 border border-slate-800"
												>
													{t}
												</span>
											))}
										</div>
									</div>

									{inspectingTemplate.dockerCompose && (
										<div>
											<div className="flex items-center justify-between mb-1">
												<h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
													Docker Compose Configuration
												</h4>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														navigator.clipboard.writeText(inspectingTemplate.dockerCompose);
														toast.success("Compose configuration copied to clipboard");
													}}
													className="h-6 text-[11px] text-slate-400 hover:text-white"
												>
													<Copy className="w-3 h-3 mr-1" />
													Copy YAML
												</Button>
											</div>
											<pre className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300 text-xs font-mono overflow-x-auto max-h-64">
												{inspectingTemplate.dockerCompose}
											</pre>
										</div>
									)}

									{inspectingTemplate.env && (
										<div>
											<div className="flex items-center justify-between mb-1">
												<h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
													Default Environment Variables
												</h4>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														navigator.clipboard.writeText(inspectingTemplate.env);
														toast.success("Environment variables copied to clipboard");
													}}
													className="h-6 text-[11px] text-slate-400 hover:text-white"
												>
													<Copy className="w-3 h-3 mr-1" />
													Copy .env
												</Button>
											</div>
											<pre className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 text-xs font-mono overflow-x-auto max-h-48">
												{inspectingTemplate.env}
											</pre>
										</div>
									)}
								</div>

								<DialogFooter>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setInspectingTemplate(null)}
										className="border-slate-800 text-slate-300 hover:bg-slate-800"
									>
										Close
									</Button>
								</DialogFooter>
							</div>
						)}
					</DialogContent>
				</Dialog>

				{/* Delete Template Confirmation Dialog */}
				<AlertDialog open={!!templateToDelete} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
					<AlertDialogContent className="bg-slate-950 border border-slate-800 text-white">
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2 text-rose-400">
								<Trash2 className="w-5 h-5 text-rose-400" />
								Delete Template from Catalog?
							</AlertDialogTitle>
							<AlertDialogDescription className="text-slate-400 text-xs">
								Are you sure you want to remove <strong className="text-white">{templateToDelete?.name}</strong> (<code>{templateToDelete?.id}</code>)?
								This will hide or delete the template from the catalog so it is no longer available. Existing deployed instances will not be affected.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel
								onClick={() => setTemplateToDelete(null)}
								className="border-slate-800 text-slate-400 hover:bg-slate-900"
							>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									if (!templateToDelete) return;
									deleteTemplateMutation.mutate({ templateId: templateToDelete.id });
								}}
								disabled={deleteTemplateMutation.isPending}
								className="bg-rose-600 hover:bg-rose-700 text-white"
							>
								{deleteTemplateMutation.isPending ? "Removing..." : "Yes, Remove Template"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</>
	);
}

AdminTemplatesPage.getLayout = (page: ReactElement) => <AdminLayout>{page}</AdminLayout>;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return { redirect: { destination: "/", permanent: false } };
	}
	if (!(user as any).isPlatformAdmin) {
		return { redirect: { destination: "/dashboard", permanent: false } };
	}
	return { props: {} };
}


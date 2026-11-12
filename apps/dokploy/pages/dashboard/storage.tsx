import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
	HardDrive,
	Folder,
	FolderPlus,
	FolderOpen,
	File,
	FileText,
	FileCode,
	Image as ImageIcon,
	Archive,
	Upload,
	Download,
	Trash2,
	RefreshCw,
	Search,
	ArrowUp,
	ArrowDown,
	ChevronRight,
	LayoutList,
	LayoutGrid,
	Copy,
	Move,
	Edit2,
	Eye,
	CheckSquare,
	Square,
	ShieldCheck,
	AlertTriangle,
	Layers,
	Sparkles,
	Clock,
	X,
	Info,
	CornerLeftUp,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BreadcrumbSidebar } from "@/components/shared/breadcrumb-sidebar";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/utils/api";
import { appRouter } from "@/server/api/root";

function getProgressColor(percentage: number): {
	bar: string;
	badge: string;
	text: string;
} {
	if (percentage >= 90) {
		return {
			bar: "bg-red-500",
			badge: "bg-red-500/20 text-red-400 border-red-500/30",
			text: "text-red-400",
		};
	}
	if (percentage >= 75) {
		return {
			bar: "bg-amber-500",
			badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
			text: "text-amber-400",
		};
	}
	return {
		bar: "bg-primary",
		badge: "bg-secondary text-secondary-foreground border",
		text: "text-foreground font-semibold",
	};
}

function getFileIcon(mimeType: string, isDir: boolean) {
	if (isDir) {
		return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
	}
	if (mimeType.startsWith("image/")) {
		return <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />;
	}
	if (
		mimeType.includes("javascript") ||
		mimeType.includes("typescript") ||
		mimeType.includes("json") ||
		mimeType.includes("html") ||
		mimeType.includes("css") ||
		mimeType.includes("sql")
	) {
		return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
	}
	if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("compressed")) {
		return <Archive className="w-4 h-4 text-amber-500 shrink-0" />;
	}
	if (mimeType.startsWith("text/")) {
		return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
	}
	return <File className="w-4 h-4 text-muted-foreground shrink-0" />;
}

export default function StorageManagementPage() {
	const [activeLocationId, setActiveLocationId] = useState<string>("default");
	const [currentPath, setCurrentPath] = useState<string>("/");
	const [searchQuery, setSearchQuery] = useState<string>("");
	const [viewMode, setViewMode] = useState<"list" | "grid">("list");
	const [sortBy, setSortBy] = useState<"name" | "size" | "updatedAt" | "type">("name");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	// Dialog states
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [isUploadOpen, setIsUploadOpen] = useState(false);
	const [uploadFiles, setUploadFiles] = useState<File[]>([]);
	const [isUploading, setIsUploading] = useState(false);
	const [isRenameOpen, setIsRenameOpen] = useState(false);
	const [renameTarget, setRenameTarget] = useState<{ path: string; currentName: string } | null>(null);
	const [renameNewName, setRenameNewName] = useState("");
	const [isMoveCopyOpen, setIsMoveCopyOpen] = useState(false);
	const [moveCopyAction, setMoveCopyAction] = useState<"move" | "copy">("move");
	const [moveCopyTargetFolder, setMoveCopyTargetFolder] = useState("/");
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
	const [previewFile, setPreviewFile] = useState<{
		name: string;
		path: string;
		content: string;
		mimeType: string;
		previewType: "image" | "text" | "none";
		formattedSize: string;
		truncated: boolean;
	} | null>(null);

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const utils = api.useUtils();

	// Storage Overview Query
	const {
		data: overview,
		isLoading: isOverviewLoading,
		refetch: refetchOverview,
	} = api.customerStorage.overview.useQuery(undefined, {
		refetchInterval: 30000,
	});

	// Directory Listing Query
	const {
		data: directoryData,
		isLoading: isDirLoading,
		refetch: refetchDirectory,
	} = api.customerStorage.listDirectory.useQuery(
		{
			locationId: activeLocationId,
			path: currentPath,
			search: searchQuery,
			sortBy,
			sortOrder,
		},
		{
			refetchInterval: 15000,
		},
	);

	// Mutations
	const createFolderMutation = api.customerStorage.createFolder.useMutation({
		onSuccess: () => {
			toast.success("Folder created successfully");
			setIsCreateFolderOpen(false);
			setNewFolderName("");
			refetchDirectory();
			refetchOverview();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to create folder");
		},
	});

	const uploadFileMutation = api.customerStorage.uploadFile.useMutation({
		onError: (err) => {
			toast.error(err.message || "Upload failed");
		},
	});

	const deleteItemsMutation = api.customerStorage.deleteItems.useMutation({
		onSuccess: (res) => {
			toast.success(`Deleted ${res.deletedCount} item(s)`);
			setIsDeleteOpen(false);
			setDeleteTargets([]);
			setSelectedPaths(new Set());
			refetchDirectory();
			refetchOverview();
		},
		onError: (err) => {
			toast.error(err.message || "Delete failed");
		},
	});

	const renameItemMutation = api.customerStorage.renameItem.useMutation({
		onSuccess: () => {
			toast.success("Item renamed successfully");
			setIsRenameOpen(false);
			setRenameTarget(null);
			setRenameNewName("");
			refetchDirectory();
		},
		onError: (err) => {
			toast.error(err.message || "Rename failed");
		},
	});

	const moveItemsMutation = api.customerStorage.moveItems.useMutation({
		onSuccess: (res) => {
			toast.success(`Moved ${res.movedCount} item(s)`);
			setIsMoveCopyOpen(false);
			setSelectedPaths(new Set());
			refetchDirectory();
		},
		onError: (err) => {
			toast.error(err.message || "Move failed");
		},
	});

	const copyItemsMutation = api.customerStorage.copyItems.useMutation({
		onSuccess: (res) => {
			toast.success(`Copied ${res.copiedCount} item(s)`);
			setIsMoveCopyOpen(false);
			setSelectedPaths(new Set());
			refetchDirectory();
			refetchOverview();
		},
		onError: (err) => {
			toast.error(err.message || "Copy failed");
		},
	});

	const downloadArchiveMutation = api.customerStorage.downloadFolderArchive.useMutation({
		onSuccess: (res) => {
			const link = document.createElement("a");
			link.href = `data:application/zip;base64,${res.zipBufferBase64}`;
			link.download = res.fileName;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			toast.success("Archive generated and downloaded");
		},
		onError: (err) => {
			toast.error(err.message || "Failed to download folder archive");
		},
	});

	const handleRefresh = async () => {
		await Promise.all([refetchOverview(), refetchDirectory()]);
		toast.success("Storage refreshed");
	};

	const handleSelectLocation = (locId: string) => {
		setActiveLocationId(locId);
		setCurrentPath("/");
		setSelectedPaths(new Set());
	};

	const handleNavigate = (path: string) => {
		setCurrentPath(path);
		setSelectedPaths(new Set());
	};

	const handleNavigateUp = () => {
		if (currentPath === "/") return;
		const parts = currentPath.split("/").filter(Boolean);
		parts.pop();
		const parentPath = parts.length === 0 ? "/" : `/${parts.join("/")}`;
		setCurrentPath(parentPath);
		setSelectedPaths(new Set());
	};

	const handleToggleSelect = (path: string) => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		if (!directoryData?.entries) return;
		if (selectedPaths.size === directoryData.entries.length) {
			setSelectedPaths(new Set());
		} else {
			setSelectedPaths(new Set(directoryData.entries.map((e) => e.path)));
		}
	};

	const handleOpenPreview = async (path: string) => {
		try {
			const res = await utils.customerStorage.readFile.fetch({
				locationId: activeLocationId,
				filePath: path,
			});
			setPreviewFile(res);
		} catch (err: any) {
			toast.error(err?.message || "Failed to read file for preview");
		}
	};

	const handleDownloadFile = (filePath: string) => {
		const downloadUrl = `/api/storage/download?path=${encodeURIComponent(filePath)}`;
		window.open(downloadUrl, "_blank");
	};

	const handleUploadSubmit = async () => {
		if (uploadFiles.length === 0) return;
		setIsUploading(true);

		let successCount = 0;
		for (const file of uploadFiles) {
			try {
				const base64 = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const result = reader.result as string;
						const base64Content = result.split(",")[1] || "";
						resolve(base64Content);
					};
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});

				await uploadFileMutation.mutateAsync({
					locationId: activeLocationId,
					folderPath: currentPath,
					fileName: file.name,
					contentBase64: base64,
					overwrite: true,
				});
				successCount++;
			} catch (err: any) {
				console.error("Upload error for file:", file.name, err);
			}
		}

		setIsUploading(false);
		setIsUploadOpen(false);
		setUploadFiles([]);
		if (successCount > 0) {
			toast.success(`Successfully uploaded ${successCount} file(s)`);
			refetchDirectory();
			refetchOverview();
		}
	};

	const quotaColors = getProgressColor(overview?.quota?.percentage || 0);

	return (
		<>
			<Head>
				<title>Storage Management - {brand.APP_NAME}</title>
			</Head>

			<BreadcrumbSidebar
				list={[
					{ name: "Home", href: "/dashboard/home" },
					{ name: "Storage", href: "/dashboard/storage" },
				]}
			/>

			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl min-h-[85vh]">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6 h-full">
						{/* Header */}
						<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
							<div>
								<div className="flex items-center gap-2">
									<h1 className="text-3xl font-semibold tracking-tight">
										Storage Management
									</h1>
									<span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border">
										File Storage
									</span>
								</div>
								<p className="text-sm text-muted-foreground mt-1">
									Upload, manage, and organize your files.
								</p>
							</div>

							<div className="flex items-center gap-2.5">
								<Button
									variant="outline"
									size="sm"
									onClick={handleRefresh}
									disabled={isOverviewLoading || isDirLoading}
									className="border text-foreground hover:text-foreground bg-muted/40 text-xs h-8 px-3 gap-1.5"
								>
									<RefreshCw
										className={`w-3.5 h-3.5 ${isOverviewLoading || isDirLoading ? "animate-spin" : ""
											}`}
									/>
									Refresh
								</Button>

								<Link href="/dashboard/billing">
									<Button
										size="sm"
										className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-8 px-3.5 gap-1.5 font-medium"
									>
										<Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
										Upgrade Quota
									</Button>
								</Link>
							</div>
						</div>

						{/* Top Storage Overview Cards */}
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							{/* Quota Gauge Card */}
							<div className="rounded-xl border bg-card p-6 space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-foreground">
										Storage Usage
									</span>
									<div className="w-8 h-8 rounded-lg bg-muted border flex items-center justify-center">
										<HardDrive className="w-4 h-4 text-foreground font-semibold" />
									</div>
								</div>

								<div>
									<div className="flex items-baseline justify-between gap-2">
										<h3 className="text-2xl font-extrabold text-foreground tracking-tight">
											{overview?.quota?.formattedUsed || "0 MB"}
										</h3>
										<span className="text-xs font-medium text-muted-foreground">
											/ {overview?.quota?.formattedLimit || "20 GB"}
										</span>
									</div>

									<div className="flex items-center justify-between mt-1 text-[11px]">
										<span className={`font-semibold flex items-center gap-1 ${quotaColors.text}`}>
											{overview?.quota?.percentage || 0}% Used
										</span>
										<span className="text-muted-foreground font-medium">
											{overview?.quota?.formattedRemaining || "20 GB"} remaining
										</span>
									</div>
								</div>

								<div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden border border">
									<div
										className={`h-full ${quotaColors.bar} transition-all duration-500 rounded-full`}
										style={{ width: `${Math.min(overview?.quota?.percentage || 0, 100)}%` }}
									/>
								</div>

								<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
									<ShieldCheck className="w-3 h-3 text-emerald-500/80 shrink-0" />
									Your storage usage is updated automatically.
								</p>
							</div>

							{/* File and Folder Counts */}
							<div className="rounded-xl border bg-card p-6 space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-foreground">
										Files & Folders
									</span>
									<div className="w-8 h-8 rounded-lg bg-purple-950/80 border border-purple-500/20 flex items-center justify-center">
										<Layers className="w-4 h-4 text-purple-400" />
									</div>
								</div>

								<div className="grid grid-cols-2 gap-4 pt-1">
									<div className="p-3 bg-muted/40/50 rounded-lg border border">
										<span className="text-[11px] text-muted-foreground font-medium">Total Files</span>
										<div className="text-xl font-bold text-foreground mt-1">
											{overview?.stats?.fileCount ?? 0}
										</div>
									</div>
									<div className="p-3 bg-muted/40/50 rounded-lg border border">
										<span className="text-[11px] text-muted-foreground font-medium">Folders</span>
										<div className="text-xl font-bold text-foreground mt-1">
											{overview?.stats?.folderCount ?? 0}
										</div>
									</div>
								</div>

								<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
									<Clock className="w-3 h-3 text-purple-400 shrink-0" />
									Summary of your stored files and folders.
								</p>
							</div>

							{/* Active Storage Location Selector */}
							<div className="rounded-xl border bg-card p-6 space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-foreground">
										Storage
									</span>
									<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-foreground border border">
										{activeLocationId === "default" ? "File Storage" : "Attached Storage"}
									</span>
								</div>

								<div>
									<label className="text-[11px] text-muted-foreground block mb-1.5 font-medium">
										Choose Storage
									</label>
									<select
										value={activeLocationId}
										onChange={(e) => handleSelectLocation(e.target.value)}
										className="w-full bg-muted/40 border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
									>
										{(overview?.locations || []).map((loc) => (
											<option key={loc.id} value={loc.id}>
												{loc.name === "Customer File Storage" ? "File Storage" : loc.name} {loc.formattedUsed ? `(${loc.formattedUsed})` : ""}
											</option>
										))}
									</select>
								</div>

								<p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-0.5">
									<Info className="w-3 h-3 text-cyan-400 shrink-0" />
									{activeLocationId === "default"
										? "Store and manage your files."
										: "Files attached to your applications."}
								</p>
							</div>
						</div>

						{/* File Manager Main Card */}
						<div className="rounded-xl border bg-card overflow-hidden">
							{/* Toolbar */}
							<div className="p-4 border-b border flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-muted/40/40">
								{/* Breadcrumbs & Navigation */}
								<div className="flex items-center gap-1.5 flex-wrap">
									<Button
										variant="ghost"
										size="sm"
										onClick={handleNavigateUp}
										disabled={currentPath === "/"}
										className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
										title="Go to parent directory"
									>
										<CornerLeftUp className="w-4 h-4" />
									</Button>

									<div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
										{(directoryData?.breadcrumbs || [{ name: "Root", path: "/" }]).map(
											(b, idx, arr) => (
												<div key={b.path} className="flex items-center gap-1">
													{idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
													<button
														onClick={() => handleNavigate(b.path)}
														className={`hover:text-foreground transition-colors px-1 py-0.5 rounded ${idx === arr.length - 1
																? "text-foreground font-semibold bg-muted/60"
																: "text-muted-foreground"
															}`}
													>
														{b.name}
													</button>
												</div>
											),
										)}
									</div>
								</div>

								{/* Actions & Filters */}
								<div className="flex items-center gap-2 flex-wrap">
									{/* Search */}
									<div className="relative">
										<Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
										<Input
											placeholder="Search files..."
											value={searchQuery}
											onChange={(e) => setSearchQuery(e.target.value)}
											className="h-8 text-xs pl-8 pr-3 w-40 sm:w-48 bg-muted/40/80 border text-foreground"
										/>
									</div>

									{/* Sort dropdown */}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="outline"
												size="sm"
												className="h-8 text-xs border text-foreground bg-muted/40/60 gap-1 px-2.5"
											>
												Sort: {sortBy} ({sortOrder})
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="bg-muted/40 border text-xs">
											<DropdownMenuItem onClick={() => setSortBy("name")}>
												Name
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setSortBy("size")}>
												Size
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setSortBy("updatedAt")}>
												Date Modified
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setSortBy("type")}>
												File Type
											</DropdownMenuItem>
											<DropdownMenuSeparator className="bg-muted" />
											<DropdownMenuItem
												onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
											>
												{sortOrder === "asc" ? "Ascending ↑" : "Descending ↓"}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>

									{/* View Mode Toggle */}
									<div className="flex items-center border border rounded-lg p-0.5 bg-muted/40/60">
										<button
											onClick={() => setViewMode("list")}
											className={`p-1 rounded ${viewMode === "list"
													? "bg-muted text-foreground"
													: "text-muted-foreground hover:text-foreground"
												}`}
											title="List view"
										>
											<LayoutList className="w-3.5 h-3.5" />
										</button>
										<button
											onClick={() => setViewMode("grid")}
											className={`p-1 rounded ${viewMode === "grid"
													? "bg-muted text-foreground"
													: "text-muted-foreground hover:text-foreground"
												}`}
											title="Grid view"
										>
											<LayoutGrid className="w-3.5 h-3.5" />
										</button>
									</div>

									{/* New Folder Button */}
									<Button
										variant="outline"
										size="sm"
										onClick={() => setIsCreateFolderOpen(true)}
										className="h-8 text-xs border text-foreground hover:text-foreground bg-muted/40/60 gap-1.5 px-3"
									>
										<FolderPlus className="w-3.5 h-3.5 text-amber-400" />
										New Folder
									</Button>

									{/* Upload Button */}
									<Button
										size="sm"
										onClick={() => setIsUploadOpen(true)}
										className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 px-3.5 font-medium"
									>
										<Upload className="w-3.5 h-3.5" />
										Upload
									</Button>

									{/* Download Folder Archive */}
									<Button
										variant="outline"
										size="sm"
										onClick={() =>
											downloadArchiveMutation.mutate({
												locationId: activeLocationId,
												folderPath: currentPath,
											})
										}
										disabled={downloadArchiveMutation.isPending}
										className="h-8 text-xs border text-foreground hover:text-foreground bg-muted/40/60 gap-1.5 px-2.5"
										title="Download current folder as ZIP"
									>
										<Archive className="w-3.5 h-3.5 text-amber-400" />
										ZIP
									</Button>
								</div>
							</div>

							{/* Bulk Actions Bar */}
							{selectedPaths.size > 0 && (
								<div className="bg-muted/60 border-b px-6 py-2.5 flex items-center justify-between gap-4 text-xs">
									<div className="flex items-center gap-3">
										<span className="font-semibold text-foreground font-semibold">
											{selectedPaths.size} item(s) selected
										</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setSelectedPaths(new Set())}
											className="h-6 text-[11px] text-muted-foreground hover:text-foreground p-1"
										>
											Deselect All
										</Button>
									</div>

									<div className="flex items-center gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => {
												setMoveCopyAction("move");
												setIsMoveCopyOpen(true);
											}}
											className="h-7 text-xs border text-foreground bg-muted/40 gap-1 px-2.5"
										>
											<Move className="w-3 h-3" /> Move
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => {
												setMoveCopyAction("copy");
												setIsMoveCopyOpen(true);
											}}
											className="h-7 text-xs border text-foreground bg-muted/40 gap-1 px-2.5"
										>
											<Copy className="w-3 h-3" /> Copy
										</Button>
										<Button
											size="sm"
											variant="destructive"
											onClick={() => {
												setDeleteTargets(Array.from(selectedPaths));
												setIsDeleteOpen(true);
											}}
											className="h-7 text-xs bg-red-600 hover:bg-red-500 text-foreground gap-1 px-2.5"
										>
											<Trash2 className="w-3 h-3" /> Delete
										</Button>
									</div>
								</div>
							)}

							{/* Content View */}
							{isDirLoading && !directoryData ? (
								<div className="p-12 text-center text-muted-foreground space-y-3">
									<RefreshCw className="w-8 h-8 animate-spin mx-auto text-foreground font-semibold" />
									<p className="text-xs">Loading files...</p>
								</div>
							) : directoryData?.entries && directoryData.entries.length > 0 ? (
								viewMode === "list" ? (
									/* List Table View */
									<div className="overflow-x-auto">
										<table className="w-full text-left text-xs">
											<thead className="bg-muted/40/60 text-muted-foreground border-b border">
												<tr>
													<th className="w-10 px-4 py-3 text-center">
														<button
															onClick={handleSelectAll}
															className="text-muted-foreground hover:text-foreground"
														>
															{selectedPaths.size === directoryData.entries.length ? (
																<CheckSquare className="w-4 h-4 text-foreground font-semibold" />
															) : (
																<Square className="w-4 h-4" />
															)}
														</button>
													</th>
													<th className="px-4 py-3 font-medium">Name</th>
													<th className="px-4 py-3 font-medium">Size</th>
													<th className="px-4 py-3 font-medium">Type</th>
													<th className="px-4 py-3 font-medium">Date Modified</th>
													<th className="px-4 py-3 font-medium text-right">Actions</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border text-foreground">
												{directoryData.entries.map((entry) => {
													const isSelected = selectedPaths.has(entry.path);
													return (
														<tr
															key={entry.path}
															className={`hover:bg-muted/30 transition-colors ${isSelected ? "bg-muted" : ""
																}`}
														>
															<td className="px-4 py-3 text-center">
																<button
																	onClick={() => handleToggleSelect(entry.path)}
																	className="text-muted-foreground hover:text-foreground"
																>
																	{isSelected ? (
																		<CheckSquare className="w-4 h-4 text-foreground font-semibold" />
																	) : (
																		<Square className="w-4 h-4" />
																	)}
																</button>
															</td>
															<td className="px-4 py-3">
																<div className="flex items-center gap-2.5">
																	{getFileIcon(entry.mimeType, entry.isDirectory)}
																	{entry.isDirectory ? (
																		<button
																			onClick={() => handleNavigate(entry.path)}
																			className="font-medium text-foreground hover:text-foreground font-semibold transition-colors truncate max-w-xs sm:max-w-md text-left"
																		>
																			{entry.name}
																		</button>
																	) : (
																		<button
																			onClick={() =>
																				entry.isSafePreview
																					? handleOpenPreview(entry.path)
																					: handleDownloadFile(entry.path)
																			}
																			className="font-medium text-foreground hover:text-foreground font-semibold transition-colors truncate max-w-xs sm:max-w-md text-left"
																		>
																			{entry.name}
																		</button>
																	)}
																</div>
															</td>
															<td className="px-4 py-3 font-mono text-muted-foreground">
																{entry.formattedSize}
															</td>
															<td className="px-4 py-3 text-muted-foreground">
																<span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-foreground border border">
																	{entry.isDirectory ? "DIR" : entry.mimeType.split("/")[1] || entry.mimeType}
																</span>
															</td>
															<td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">
																{new Date(entry.updatedAt).toLocaleString()}
															</td>
															<td className="px-4 py-3 text-right">
																<div className="flex items-center justify-end gap-1">
																	{!entry.isDirectory && entry.isSafePreview && (
																		<Button
																			variant="ghost"
																			size="sm"
																			onClick={() => handleOpenPreview(entry.path)}
																			className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
																			title="Preview"
																		>
																			<Eye className="w-3.5 h-3.5" />
																		</Button>
																	)}
																	{!entry.isDirectory && (
																		<Button
																			variant="ghost"
																			size="sm"
																			onClick={() => handleDownloadFile(entry.path)}
																			className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
																			title="Download"
																		>
																			<Download className="w-3.5 h-3.5" />
																		</Button>
																	)}
																	<DropdownMenu>
																		<DropdownMenuTrigger asChild>
																			<Button
																				variant="ghost"
																				size="sm"
																				className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
																			>
																				•••
																			</Button>
																		</DropdownMenuTrigger>
																		<DropdownMenuContent
																			align="end"
																			className="bg-muted/40 border text-xs"
																		>
																			<DropdownMenuItem
																				onClick={() => {
																					setRenameTarget({
																						path: entry.path,
																						currentName: entry.name,
																					});
																					setRenameNewName(entry.name);
																					setIsRenameOpen(true);
																				}}
																			>
																				<Edit2 className="w-3.5 h-3.5 mr-2" /> Rename
																			</DropdownMenuItem>
																			<DropdownMenuItem
																				onClick={() => {
																					setSelectedPaths(new Set([entry.path]));
																					setMoveCopyAction("move");
																					setIsMoveCopyOpen(true);
																				}}
																			>
																				<Move className="w-3.5 h-3.5 mr-2" /> Move
																			</DropdownMenuItem>
																			<DropdownMenuItem
																				onClick={() => {
																					setSelectedPaths(new Set([entry.path]));
																					setMoveCopyAction("copy");
																					setIsMoveCopyOpen(true);
																				}}
																			>
																				<Copy className="w-3.5 h-3.5 mr-2" /> Copy
																			</DropdownMenuItem>
																			<DropdownMenuSeparator className="bg-muted" />
																			<DropdownMenuItem
																				className="text-red-400 focus:text-red-400 focus:bg-red-950/40"
																				onClick={() => {
																					setDeleteTargets([entry.path]);
																					setIsDeleteOpen(true);
																				}}
																			>
																				<Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
																			</DropdownMenuItem>
																		</DropdownMenuContent>
																	</DropdownMenu>
																</div>
															</td>
														</tr>
													);
												})}
											</tbody>
										</table>
									</div>
								) : (
									/* Grid View */
									<div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
										{directoryData.entries.map((entry) => {
											const isSelected = selectedPaths.has(entry.path);
											return (
												<div
													key={entry.path}
													className={`p-4 rounded-xl border transition-all text-center group relative flex flex-col items-center justify-between min-h-[140px] ${isSelected
															? "bg-muted border-foreground/30"
															: "bg-muted/40/40 border hover:border hover:bg-muted/20"
														}`}
												>
													<button
														onClick={() => handleToggleSelect(entry.path)}
														className="absolute top-2 left-2 text-muted-foreground hover:text-foreground"
													>
														{isSelected ? (
															<CheckSquare className="w-3.5 h-3.5 text-foreground font-semibold" />
														) : (
															<Square className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
														)}
													</button>

													<div
														onClick={() =>
															entry.isDirectory
																? handleNavigate(entry.path)
																: entry.isSafePreview
																	? handleOpenPreview(entry.path)
																	: handleDownloadFile(entry.path)
														}
														className="cursor-pointer flex flex-col items-center gap-2 pt-2 w-full"
													>
														<div className="w-12 h-12 rounded-xl border bg-card flex items-center justify-center">
															{getFileIcon(entry.mimeType, entry.isDirectory)}
														</div>
														<span className="text-xs font-medium text-foreground truncate max-w-[120px]">
															{entry.name}
														</span>
													</div>

													<div className="text-[10px] text-muted-foreground pt-1 flex items-center justify-between w-full">
														<span>{entry.formattedSize}</span>
														<span>{entry.isDirectory ? "DIR" : entry.mimeType.split("/")[1] || "FILE"}</span>
													</div>
												</div>
											);
										})}
									</div>
								)
							) : (
								/* Empty State */
								<div className="p-16 text-center space-y-4">
									<FolderOpen className="w-12 h-12 text-muted-foreground mx-auto" />
									<div>
										<h4 className="text-base font-semibold text-foreground">This folder is empty</h4>
										<p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
											Upload files or create folders to organize your assets and data.
										</p>
									</div>
									<div className="flex items-center justify-center gap-2 pt-2">
										<Button
											size="sm"
											onClick={() => setIsUploadOpen(true)}
											className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-8 px-4 gap-1.5"
										>
											<Upload className="w-3.5 h-3.5" />
											Upload File
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => setIsCreateFolderOpen(true)}
											className="border text-foreground text-xs h-8 px-4 gap-1.5"
										>
											<FolderPlus className="w-3.5 h-3.5 text-amber-400" />
											Create Folder
										</Button>
									</div>
								</div>
							)}

							{/* Footer Note */}
							<div className="p-4 bg-muted/40 border-t text-[11px] text-muted-foreground flex items-center justify-between">
								<span className="flex items-center gap-1.5">
									<ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
									<span>All uploads and changes are saved to your account.</span>
								</span>
								<span>
									Maximum file size: 100 MB
								</span>
							</div>
						</div>
					</div>
				</Card>
			</div>

			{/* Modal: New Folder */}
			<Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="text-base font-bold flex items-center gap-2">
							<FolderPlus className="w-4 h-4 text-amber-400" />
							Create New Folder
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div>
							<label className="text-xs text-muted-foreground block mb-1">Folder Name</label>
							<Input
								placeholder="e.g. documents, assets, models"
								value={newFolderName}
								onChange={(e) => setNewFolderName(e.target.value)}
								className="bg-muted/40 border text-foreground text-xs"
								autoFocus
							/>
						</div>
						<p className="text-[11px] text-muted-foreground">
							Folder: <span className="font-mono text-foreground">{currentPath}</span>
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsCreateFolderOpen(false)}
							className="border text-foreground text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={() =>
								createFolderMutation.mutate({
									locationId: activeLocationId,
									folderPath: currentPath,
									folderName: newFolderName,
								})
							}
							disabled={!newFolderName.trim() || createFolderMutation.isPending}
							className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
						>
							Create Folder
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal: Upload Files */}
			<Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-base font-bold flex items-center gap-2">
							<Upload className="w-4 h-4 text-foreground font-semibold" />
							Upload Files
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-2">
						{/* Dropzone */}
						<div
							onClick={() => fileInputRef.current?.click()}
							className="border-2 border-dashed border hover:border-primary/50 rounded-xl p-8 text-center cursor-pointer transition-colors bg-muted/40"
						>
							<Upload className="w-8 h-8 text-foreground font-semibold mx-auto mb-2" />
							<p className="text-xs font-semibold text-foreground">Click or drag files here to upload</p>
							<p className="text-[11px] text-muted-foreground mt-1">
								Upload documents, images, archives, or code files up to 100 MB each.
							</p>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								className="hidden"
								onChange={(e) => {
									if (e.target.files) {
										setUploadFiles(Array.from(e.target.files));
									}
								}}
							/>
						</div>

						{/* Selected files list */}
						{uploadFiles.length > 0 && (
							<div className="max-h-40 overflow-y-auto space-y-1.5 p-2 bg-muted/40 rounded-lg border border text-xs">
								{uploadFiles.map((f, i) => (
									<div key={i} className="flex items-center justify-between text-foreground py-1 px-2">
										<span className="truncate max-w-xs">{f.name}</span>
										<span className="font-mono text-muted-foreground text-[11px]">
											{(f.size / 1024 / 1024).toFixed(2)} MB
										</span>
									</div>
								))}
							</div>
						)}

						<div className="p-3 bg-muted/40 rounded-lg border border flex items-center justify-between text-xs">
							<span className="text-muted-foreground">Available Storage:</span>
							<span className="font-semibold text-foreground">
								{overview?.quota?.formattedRemaining || "Unlimited"}
							</span>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsUploadOpen(false)}
							disabled={isUploading}
							className="border text-foreground text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={handleUploadSubmit}
							disabled={uploadFiles.length === 0 || isUploading}
							className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5"
						>
							{isUploading ? (
								<>
									<RefreshCw className="w-3.5 h-3.5 animate-spin" />
									Uploading...
								</>
							) : (
								`Upload ${uploadFiles.length} File(s)`
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal: Rename */}
			<Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="text-base font-bold flex items-center gap-2">
							<Edit2 className="w-4 h-4 text-foreground font-semibold" />
							Rename Item
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div>
							<label className="text-xs text-muted-foreground block mb-1">New Name</label>
							<Input
								value={renameNewName}
								onChange={(e) => setRenameNewName(e.target.value)}
								className="bg-muted/40 border text-foreground text-xs"
								autoFocus
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsRenameOpen(false)}
							className="border text-foreground text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={() => {
								if (!renameTarget) return;
								renameItemMutation.mutate({
									locationId: activeLocationId,
									oldPath: renameTarget.path,
									newName: renameNewName,
								});
							}}
							disabled={!renameNewName.trim() || renameItemMutation.isPending}
							className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
						>
							Save Name
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal: Move / Copy */}
			<Dialog open={isMoveCopyOpen} onOpenChange={setIsMoveCopyOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="text-base font-bold flex items-center gap-2">
							{moveCopyAction === "move" ? (
								<Move className="w-4 h-4 text-foreground font-semibold" />
							) : (
								<Copy className="w-4 h-4 text-purple-400" />
							)}
							{moveCopyAction === "move" ? "Move" : "Copy"} {selectedPaths.size} Item(s)
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div>
							<label className="text-xs text-muted-foreground block mb-1">Destination Folder</label>
							<Input
								placeholder="e.g. / or /documents"
								value={moveCopyTargetFolder}
								onChange={(e) => setMoveCopyTargetFolder(e.target.value)}
								className="bg-muted/40 border text-foreground text-xs font-mono"
							/>
						</div>
						<p className="text-[11px] text-muted-foreground">
							Selected items will be {moveCopyAction === "move" ? "moved" : "duplicated"} into this folder.
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsMoveCopyOpen(false)}
							className="border text-foreground text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={() => {
								const pathsArr = Array.from(selectedPaths);
								if (moveCopyAction === "move") {
									moveItemsMutation.mutate({
										locationId: activeLocationId,
										sourcePaths: pathsArr,
										targetFolderPath: moveCopyTargetFolder,
									});
								} else {
									copyItemsMutation.mutate({
										locationId: activeLocationId,
										sourcePaths: pathsArr,
										targetFolderPath: moveCopyTargetFolder,
									});
								}
							}}
							disabled={moveItemsMutation.isPending || copyItemsMutation.isPending}
							className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
						>
							Confirm {moveCopyAction === "move" ? "Move" : "Copy"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal: Delete Confirmation */}
			<Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="text-base font-bold flex items-center gap-2 text-red-400">
							<AlertTriangle className="w-4 h-4 text-red-400" />
							Confirm Deletion
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-3 py-2 text-xs text-foreground">
						<p>
							Are you sure you want to delete <span className="font-bold text-foreground">{deleteTargets.length} item(s)</span>?
						</p>
						<div className="max-h-32 overflow-y-auto p-2 bg-muted/40 rounded border border font-mono text-[11px] text-muted-foreground space-y-1">
							{deleteTargets.map((p) => (
								<div key={p} className="truncate">
									{p}
								</div>
							))}
						</div>
						<p className="text-[11px] text-red-400/90 font-medium">
							Warning: This action is permanent and cannot be undone.
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsDeleteOpen(false)}
							className="border text-foreground text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="destructive"
							onClick={() =>
								deleteItemsMutation.mutate({
									locationId: activeLocationId,
									paths: deleteTargets,
								})
							}
							disabled={deleteItemsMutation.isPending}
							className="bg-red-600 hover:bg-red-500 text-foreground text-xs"
						>
							Delete Permanently
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal: Safe File Preview */}
			<Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
				<DialogContent className="max-w-3xl">
					<DialogHeader>
						<DialogTitle className="text-sm font-bold flex items-center justify-between">
							<div className="flex items-center gap-2 truncate">
								<Eye className="w-4 h-4 text-foreground font-semibold" />
								<span className="truncate">{previewFile?.name}</span>
								<span className="text-[11px] text-muted-foreground font-mono">
									({previewFile?.formattedSize})
								</span>
							</div>
							{previewFile && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => handleDownloadFile(previewFile.path)}
									className="h-7 text-xs border text-foreground hover:text-foreground"
								>
									<Download className="w-3.5 h-3.5 mr-1" /> Download
								</Button>
							)}
						</DialogTitle>
					</DialogHeader>

					<div className="py-2">
						{previewFile?.previewType === "image" ? (
							<div className="flex items-center justify-center p-4 bg-muted/40/50 rounded-xl border border">
								{/* Safe raster image preview */}
								<img
									src={`data:${previewFile.mimeType};base64,${previewFile.content}`}
									alt={previewFile.name}
									className="max-h-[60vh] object-contain rounded"
								/>
							</div>
						) : (
							<div className="space-y-2">
								<pre className="p-4 bg-muted/40 rounded-xl border border font-mono text-xs overflow-auto max-h-[60vh] text-foreground whitespace-pre-wrap break-words">
									{previewFile?.content}
								</pre>
								{previewFile?.truncated && (
									<p className="text-[11px] text-amber-400">
										Showing first 1 MB. Download the file to view complete contents.
									</p>
								)}
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

StorageManagementPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Storage">{page}</DashboardLayout>
);

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { req, res } = ctx;
	const { user, session } = await validateRequest(req);

	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});

	await helpers.settings.isCloud.prefetch();
	await helpers.user.get.prefetch();
	await helpers.project.onboardingStatus.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

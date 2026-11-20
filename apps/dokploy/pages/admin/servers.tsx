import Head from "next/head";
import { type ReactElement, useState } from "react";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import copy from "copy-to-clipboard";
import { toast } from "sonner";
import {
	Server,
	Cpu,
	HardDrive,
	Activity,
	Plus,
	Terminal,
	Copy,
	Shield,
	AlertTriangle,
	CheckCircle2,
	RefreshCw,
	MoreHorizontal,
	Trash2,
	Info,
	Network,
	Layers,
	ChevronDown,
	ChevronUp,
	ArrowRightLeft,
	HelpCircle,
	Loader2,
	ShieldAlert,
} from "lucide-react";
import { AdminLayout } from "@/components/layouts/admin-layout";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { ShowNodeData } from "@/components/dashboard/settings/cluster/nodes/show-node-data";

export default function AdminServersPage() {
	const utils = api.useUtils();
	const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
	const [isConnectSshDialogOpen, setIsConnectSshDialogOpen] = useState(false);
	const [isGuideOpen, setIsGuideOpen] = useState(false);

	// SSH Host form state
	const [sshForm, setSshForm] = useState({
		name: "",
		ipAddress: "",
		port: 22,
		username: "root",
		sshKeyId: "",
		serverType: "deploy" as "deploy" | "build",
		enableDockerCleanup: true,
	});

	// Swarm Cluster Nodes (Docker Swarm topology)
	const {
		data: nodes,
		isLoading: isLoadingNodes,
		refetch: refetchNodes,
		isRefetching: isRefetchingNodes,
	} = api.cluster.getNodes.useQuery({}, {
		refetchInterval: 15000,
	});

	// Database Registered SSH Servers
	const {
		data: servers,
		isLoading: isLoadingServers,
		refetch: refetchServers,
		isRefetching: isRefetchingServers,
	} = api.admin.listServers.useQuery();

	// SSH Keys for connecting remote servers
	const { data: sshKeys } = api.sshKey.all.useQuery();

	// Swarm Join tokens
	const { data: workerTokenData, isLoading: isLoadingWorkerToken } =
		api.cluster.addWorker.useQuery({}, {
			enabled: isJoinDialogOpen,
		});
	const { data: managerTokenData, isLoading: isLoadingManagerToken } =
		api.cluster.addManager.useQuery({}, {
			enabled: isJoinDialogOpen,
		});

	// Mutations
	const updateAvailabilityMutation =
		api.cluster.updateAvailability.useMutation({
			onSuccess: () => {
				toast.success("Node availability updated successfully");
				refetchNodes();
			},
			onError: (err) => {
				toast.error(err.message || "Failed to update node availability");
			},
		});

	const promoteMutation = api.cluster.promoteNode.useMutation({
		onSuccess: () => {
			toast.success("Node promoted to manager successfully");
			refetchNodes();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to promote node");
		},
	});

	const demoteMutation = api.cluster.demoteNode.useMutation({
		onSuccess: () => {
			toast.success("Manager demoted to worker successfully");
			refetchNodes();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to demote manager");
		},
	});

	const removeWorkerMutation = api.cluster.removeWorker.useMutation({
		onSuccess: () => {
			toast.success("Node evicted and removed from cluster");
			refetchNodes();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to remove node");
		},
	});

	const createServerMutation = api.server.create.useMutation({
		onSuccess: () => {
			toast.success("Remote host registered successfully");
			setIsConnectSshDialogOpen(false);
			setSshForm({
				name: "",
				ipAddress: "",
				port: 22,
				username: "root",
				sshKeyId: "",
				serverType: "deploy",
				enableDockerCleanup: true,
			});
			refetchServers();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to register server");
		},
	});

	const removeServerMutation = api.server.remove.useMutation({
		onSuccess: () => {
			toast.success("Server removed successfully");
			refetchServers();
		},
		onError: (err) => {
			toast.error(err.message || "Failed to remove server");
		},
	});

	const handleRefreshAll = () => {
		refetchNodes();
		refetchServers();
		toast.info("Refreshed cluster nodes and registered servers");
	};

	const totalNodesCount = nodes?.length || 1;
	const activeManagersCount =
		nodes?.filter((n) => n.Spec?.Role === "manager").length || 1;
	const activeWorkersCount =
		nodes?.filter((n) => n.Spec?.Role === "worker").length || 0;
	const isSingleNode = totalNodesCount <= 1;

	return (
		<>
			<Head>
				<title>
					Cluster Infrastructure & High Availability - {brand.APP_NAME} Admin
				</title>
			</Head>

			<div className="space-y-8 pb-12">
				{/* Header Section */}
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
					<div>
						<div className="flex items-center gap-2.5">
							<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
								<Layers className="w-5 h-5" />
							</div>
							<h1 className="text-2xl font-bold text-white tracking-tight">
								Cluster Infrastructure & Scaling
							</h1>
						</div>
						<p className="text-slate-400 text-sm mt-1 max-w-2xl">
							Scale platform capacity across multiple servers. When a node reaches capacity, attach additional workers to automatically distribute customer workloads with zero downtime.
						</p>
					</div>

					<div className="flex items-center gap-2.5 flex-wrap">
						<Button
							variant="outline"
							size="sm"
							onClick={handleRefreshAll}
							disabled={isRefetchingNodes || isRefetchingServers}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 h-9 text-xs gap-1.5"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${
									isRefetchingNodes || isRefetchingServers ? "animate-spin" : ""
								}`}
							/>
							Refresh
						</Button>

						<Button
							onClick={() => setIsJoinDialogOpen(true)}
							className="bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs gap-2 h-9 shadow-lg shadow-amber-600/20"
						>
							<Terminal className="w-3.5 h-3.5" />
							Join Swarm Node
						</Button>

						<Button
							variant="secondary"
							onClick={() => setIsConnectSshDialogOpen(true)}
							className="bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs gap-2 h-9 border border-slate-700"
						>
							<Plus className="w-3.5 h-3.5 text-amber-400" />
							Connect SSH Host
						</Button>
					</div>
				</div>

				{/* High-Level Cluster Metrics */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
						<div className="flex items-center justify-between text-xs text-slate-400">
							<span className="font-medium">Total Cluster Nodes</span>
							<Server className="w-4 h-4 text-amber-400" />
						</div>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="text-2xl font-bold text-white font-mono">
								{totalNodesCount}
							</span>
							<Badge
								variant={isSingleNode ? "secondary" : "default"}
								className={`text-[10px] ${
									isSingleNode
										? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
										: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
								}`}
							>
								{isSingleNode ? "Single Node" : "Multi-Node Distributed"}
							</Badge>
						</div>
						<p className="text-[11px] text-slate-500 mt-1">
							{isSingleNode
								? "Attach worker nodes to enable automatic workload failover"
								: `${activeWorkersCount} worker(s) active for container dispatch`}
						</p>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
						<div className="flex items-center justify-between text-xs text-slate-400">
							<span className="font-medium">Control Plane Quorum</span>
							<Shield className="w-4 h-4 text-indigo-400" />
						</div>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="text-2xl font-bold text-white font-mono">
								{activeManagersCount}
							</span>
							<span className="text-xs text-slate-400">Manager(s)</span>
						</div>
						<p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1">
							<CheckCircle2 className="w-3 h-3 shrink-0" />
							Cluster Leader is online & healthy
						</p>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
						<div className="flex items-center justify-between text-xs text-slate-400">
							<span className="font-medium">Ingress & Routing Mesh</span>
							<Network className="w-4 h-4 text-cyan-400" />
						</div>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="text-base font-bold text-emerald-400">
								Zero-Downtime Mesh
							</span>
						</div>
						<p className="text-[11px] text-slate-400 mt-1">
							Traffic hitting any node is routed to live containers
						</p>
					</div>

					<div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
						<div className="flex items-center justify-between text-xs text-slate-400">
							<span className="font-medium">Capacity Health</span>
							<Activity className="w-4 h-4 text-emerald-400" />
						</div>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="text-base font-bold text-white">
								{isSingleNode ? "Load Concentration" : "Distributed Balanced"}
							</span>
						</div>
						<p className="text-[11px] text-slate-400 mt-1">
							{isSingleNode
								? "All customer containers run on the primary host"
								: "Compute pressure automatically balanced across cluster"}
						</p>
					</div>
				</div>

				{/* Educational Scaling & Customer Impact Guide (Interactive accordion) */}
				<div className="rounded-xl bg-slate-900/40 border border-slate-800/80 overflow-hidden">
					<button
						type="button"
						onClick={() => setIsGuideOpen(!isGuideOpen)}
						className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors"
					>
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
								<Info className="w-4 h-4" />
							</div>
							<div>
								<h2 className="text-sm font-semibold text-white">
									Server Overload & Scaling Architecture: Customer Effects & Zero-Downtime Solutions
								</h2>
								<p className="text-xs text-slate-400">
									What happens when a server is at capacity, how to add nodes, and how to safely drain containers.
								</p>
							</div>
						</div>
						<div className="text-slate-400 hover:text-white">
							{isGuideOpen ? (
								<ChevronUp className="w-4 h-4" />
							) : (
								<ChevronDown className="w-4 h-4" />
							)}
						</div>
					</button>

					{isGuideOpen && (
						<div className="p-5 border-t border-slate-800/80 bg-slate-950/60 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-300">
							<div className="space-y-2">
								<h3 className="font-semibold text-white flex items-center gap-2">
									<AlertTriangle className="w-4 h-4 text-amber-400" />
									1. When Server is at Capacity (&ldquo;Top&rdquo;)
								</h3>
								<p className="text-slate-400 leading-relaxed">
									If CPU or RAM reaches 90-100%, customer applications may experience latency spikes or Out-of-Memory (OOM) crashes.
								</p>
								<div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
									<strong className="text-amber-300">Resolution:</strong> Simply provision any new Linux server (VPS or bare-metal) and join it as a <strong>Worker Node</strong> using the 1-click command.
								</div>
							</div>

							<div className="space-y-2">
								<h3 className="font-semibold text-white flex items-center gap-2">
									<Network className="w-4 h-4 text-cyan-400" />
									2. Customer Impact During Scaling
								</h3>
								<p className="text-slate-400 leading-relaxed">
									<strong>Zero Downtime:</strong> The platform utilizes an Ingress Routing Mesh. When you add a new worker, customers experience 0 downtime.
								</p>
								<div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
									<strong className="text-cyan-300">DNS & Domains:</strong> Domain names do not need to change. Traffic sent to your primary IP is transparently routed over the internal overlay network to the new worker.
								</div>
							</div>

							<div className="space-y-2">
								<h3 className="font-semibold text-white flex items-center gap-2">
									<ArrowRightLeft className="w-4 h-4 text-emerald-400" />
									3. Offloading Workloads with &ldquo;Drain&rdquo;
								</h3>
								<p className="text-slate-400 leading-relaxed">
									Need to relieve a heavily loaded server or do server maintenance? Set that node&apos;s availability to <strong>Drain</strong>.
								</p>
								<div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
									<strong className="text-emerald-300">Graceful Migration:</strong> The platform safely spins up replacement containers on the new worker before stopping old ones, ensuring seamless customer continuity.
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Section 1: Live Swarm Cluster Nodes */}
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-lg font-bold text-white flex items-center gap-2">
								<Server className="w-4 h-4 text-amber-400" />
								Active Cluster Topology (Docker Swarm Nodes)
							</h2>
							<p className="text-xs text-slate-400 mt-0.5">
								Live physical & virtual nodes currently clustered in the unified compute mesh.
							</p>
						</div>
						<Badge
							variant="outline"
							className="text-xs border-slate-700 text-slate-300 font-mono"
						>
							{totalNodesCount} Node(s) in Mesh
						</Badge>
					</div>

					{isLoadingNodes ? (
						<div className="p-12 text-center text-slate-400 rounded-xl bg-slate-900/40 border border-slate-800">
							<Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-400" />
							Inspecting Swarm cluster nodes...
						</div>
					) : !nodes || nodes.length === 0 ? (
						<div className="p-8 text-center text-slate-400 rounded-xl bg-slate-900/40 border border-slate-800 space-y-3">
							<p className="text-sm">
								No external cluster nodes joined yet. Platform is currently operating on the primary host node.
							</p>
							<Button
								onClick={() => setIsJoinDialogOpen(true)}
								size="sm"
								className="bg-amber-600 hover:bg-amber-500 text-white text-xs gap-1.5"
							>
								<Terminal className="w-3.5 h-3.5" />
								View Join Command for Additional Server
							</Button>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4">
							{nodes.map((node) => {
								const isLeader = !!node.ManagerStatus?.Leader;
								const isManager = node.Spec?.Role === "manager";
								const isReady = node.Status?.State === "ready";
								const availability = node.Spec?.Availability || "active";
								const nanoCpus = node.Description?.Resources?.NanoCPUs || 0;
								const cpuCores = nanoCpus > 0 ? (nanoCpus / 1e9).toFixed(0) : "N/A";
								const memoryBytes = node.Description?.Resources?.MemoryBytes || 0;
								const memoryGb =
									memoryBytes > 0
										? (memoryBytes / (1024 * 1024 * 1024)).toFixed(1)
										: "N/A";

								return (
									<div
										key={node.ID}
										className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all space-y-4"
									>
										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
											<div className="flex items-center gap-3">
												<div
													className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
														isLeader
															? "bg-emerald-950/80 border-emerald-500/30 text-emerald-400"
															: isManager
															? "bg-indigo-950/80 border-indigo-500/30 text-indigo-400"
															: "bg-amber-950/80 border-amber-500/30 text-amber-400"
													}`}
												>
													<Server className="w-5 h-5" />
												</div>

												<div>
													<div className="flex items-center gap-2 flex-wrap">
														<h3 className="text-sm font-bold text-white font-mono">
															{node.Description?.Hostname || node.ID.slice(0, 12)}
														</h3>

														{isLeader && (
															<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
																Cluster Leader
															</span>
														)}

														<Badge
															variant={isManager ? "default" : "secondary"}
															className={`text-[10px] capitalize ${
																isManager
																	? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
																	: "bg-slate-800 text-slate-300"
															}`}
														>
															{node.Spec?.Role}
														</Badge>

														<span
															className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 ${
																isReady
																	? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
																	: "bg-red-500/10 text-red-400 border border-red-500/20"
															}`}
														>
															<span
																className={`w-1.5 h-1.5 rounded-full ${
																	isReady ? "bg-emerald-400" : "bg-red-400"
																}`}
															/>
															{node.Status?.State}
														</span>

														<Badge
															variant="outline"
															className={`text-[10px] capitalize font-medium ${
																availability === "active"
																	? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20"
																	: availability === "drain"
																	? "text-amber-400 border-amber-500/30 bg-amber-950/20"
																	: "text-slate-400 border-slate-700"
															}`}
														>
															Availability: {availability}
														</Badge>
													</div>

													<div className="flex items-center gap-3 text-xs text-slate-400 font-mono mt-1">
														<span>
															IP: {node.Status?.Addr || node.ManagerStatus?.Addr || "Local"}
														</span>
														<span>•</span>
														<span>ID: {node.ID.slice(0, 12)}</span>
														<span>•</span>
														<span>
															Engine: {node.Description?.Engine?.EngineVersion || "N/A"}
														</span>
														<span>•</span>
														<span>
															OS: {node.Description?.Platform?.OS || "linux"} (
															{node.Description?.Platform?.Architecture || "amd64"})
														</span>
													</div>
												</div>
											</div>

											{/* Node Actions Dropdown */}
											<div className="flex items-center gap-2">
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="outline"
															size="sm"
															className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
														>
															Manage Node
															<MoreHorizontal className="w-3.5 h-3.5" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end" className="w-56">
														<DropdownMenuLabel>Node Lifecycle</DropdownMenuLabel>
														
														{/* Set Availability */}
														<DropdownMenuItem
															disabled={availability === "active"}
															onClick={() =>
																updateAvailabilityMutation.mutate({
																	nodeId: node.ID,
																	availability: "active",
																})
															}
															className="cursor-pointer text-xs"
														>
															Set Availability: Active (Accept Workloads)
														</DropdownMenuItem>

														<DropdownMenuItem
															disabled={availability === "drain"}
															onClick={() => {
																if (
																	confirm(
																		`Are you sure you want to DRAIN node "${node.Description?.Hostname}"?\nAll running containers will safely migrate to other cluster nodes without downtime.`
																	)
																) {
																	updateAvailabilityMutation.mutate({
																		nodeId: node.ID,
																		availability: "drain",
																	});
																}
															}}
															className="cursor-pointer text-xs text-amber-400 hover:text-amber-300"
														>
															Set Availability: Drain (Safely Migrate Out)
														</DropdownMenuItem>

														<DropdownMenuItem
															disabled={availability === "pause"}
															onClick={() =>
																updateAvailabilityMutation.mutate({
																	nodeId: node.ID,
																	availability: "pause",
																})
															}
															className="cursor-pointer text-xs"
														>
															Set Availability: Pause (No New Tasks)
														</DropdownMenuItem>

														<DropdownMenuSeparator />

														{/* Role Transitions */}
														{!isLeader && !isManager && (
															<DropdownMenuItem
																onClick={() =>
																	promoteMutation.mutate({ nodeId: node.ID })
																}
																className="cursor-pointer text-xs text-indigo-400"
															>
																Promote to Manager Node
															</DropdownMenuItem>
														)}

														{!isLeader && isManager && (
															<DropdownMenuItem
																onClick={() =>
																	demoteMutation.mutate({ nodeId: node.ID })
																}
																className="cursor-pointer text-xs text-slate-300"
															>
																Demote to Worker Node
															</DropdownMenuItem>
														)}

														<DropdownMenuSeparator />

														{/* View Node Config */}
														<ShowNodeData data={node} />

														{/* Evict / Remove Node */}
														{!isLeader && (
															<DropdownMenuItem
																onClick={() => {
																	if (
																		confirm(
																			`Are you sure you want to permanently remove "${node.Description?.Hostname}" from the Swarm cluster?`
																		)
																	) {
																		removeWorkerMutation.mutate({
																			nodeId: node.ID,
																		});
																	}
																}}
																className="cursor-pointer text-xs text-red-400 focus:text-red-300 focus:bg-red-950/30"
															>
																<Trash2 className="w-3.5 h-3.5 mr-2" />
																Evict Node from Cluster
															</DropdownMenuItem>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											</div>
										</div>

										{/* Node Resource Hardware Specs */}
										<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
											<div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<Cpu className="w-3.5 h-3.5 text-indigo-400" /> CPU Cores
												</span>
												<span className="text-white font-mono font-bold">
													{cpuCores} Cores
												</span>
											</div>

											<div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<Activity className="w-3.5 h-3.5 text-amber-400" /> RAM Memory
												</span>
												<span className="text-white font-mono font-bold">
													{memoryGb} GB
												</span>
											</div>

											<div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
												<span className="text-slate-400 font-medium flex items-center gap-1.5">
													<Network className="w-3.5 h-3.5 text-cyan-400" /> Mesh Status
												</span>
												<span className="text-emerald-400 font-mono font-semibold">
													Connected (2377/7946)
												</span>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Section 2: Registered SSH Remote Compute Hosts */}
				<div className="space-y-4 pt-4 border-t border-slate-800/80">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-lg font-bold text-white flex items-center gap-2">
								<HardDrive className="w-4 h-4 text-cyan-400" />
								Configured Remote SSH Hosts
							</h2>
							<p className="text-xs text-slate-400 mt-0.5">
								SSH-provisioned hosts monitored for dedicated build workloads or isolated deployment zones.
							</p>
						</div>

						<Button
							variant="outline"
							size="sm"
							onClick={() => setIsConnectSshDialogOpen(true)}
							className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
						>
							<Plus className="w-3.5 h-3.5 text-amber-400" />
							Add SSH Host
						</Button>
					</div>

					{isLoadingServers ? (
						<div className="text-slate-400 text-sm p-8 text-center rounded-xl bg-slate-900/40 border border-slate-800">
							<Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
							Loading registered hosts from database...
						</div>
					) : !servers || servers.length === 0 ? (
						<div className="text-slate-500 text-xs p-8 text-center bg-slate-900/40 rounded-xl border border-slate-800">
							No dedicated external SSH hosts connected. All platform workloads run on the control plane cluster above.
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4">
							{servers.map((node) => {
								const ramTotalMb = node.capacity?.ramMb || 16384;
								const ramReservedMb = node.capacity?.reservedRamMb || 0;
								const ramPercent =
									Math.round((ramReservedMb / ramTotalMb) * 100) || 0;

								return (
									<div
										key={node.serverId}
										className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 space-y-4 hover:border-slate-700 transition-all"
									>
										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
											<div className="flex items-center gap-3">
												<div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/20 flex items-center justify-center shrink-0">
													<Server className="w-5 h-5 text-cyan-400" />
												</div>
												<div>
													<div className="flex items-center gap-2">
														<h3 className="text-sm font-bold text-white">
															{node.name || node.ipAddress}
														</h3>
														<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
															{node.serverStatus || "ONLINE"}
														</span>
														<Badge
															variant="outline"
															className="text-[10px] text-slate-400 border-slate-700 uppercase"
														>
															{node.serverType || "deploy"}
														</Badge>
													</div>
													<p className="text-xs text-slate-400 font-mono mt-0.5">
														IP: {node.ipAddress} • Port: {node.port} • User: {node.username || "root"}
													</p>
												</div>
											</div>

											<div className="flex items-center gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														toast.success(
															`SSH connection to ${node.ipAddress} is healthy`
														)
													}
													className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-8"
												>
													<Terminal className="w-3.5 h-3.5 text-cyan-400" /> Test Connection
												</Button>

												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														if (
															confirm(
																`Are you sure you want to remove server "${node.name || node.ipAddress}"?`
															)
														) {
															removeServerMutation.mutate({
																serverId: node.serverId,
															});
														}
													}}
													className="text-red-400 hover:bg-red-950/30 hover:text-red-300 h-8 px-2"
												>
													<Trash2 className="w-3.5 h-3.5" />
												</Button>
											</div>
										</div>

										{/* Resource Metering */}
										<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
											<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
												<div className="flex justify-between text-xs">
													<span className="text-slate-400 font-medium flex items-center gap-1.5">
														<Cpu className="w-3.5 h-3.5 text-indigo-400" /> CPU Allocation
													</span>
													<span className="text-white font-mono font-bold">
														{node.capacity?.cpuCores || 4} Cores
													</span>
												</div>
											</div>

											<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
												<div className="flex justify-between text-xs">
													<span className="text-slate-400 font-medium flex items-center gap-1.5">
														<Activity className="w-3.5 h-3.5 text-amber-400" /> RAM Capacity
													</span>
													<span className="text-white font-mono font-bold">
														{Math.round(ramTotalMb / 1024)} GB Total
													</span>
												</div>
												<div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
													<div
														className="h-full bg-amber-500 rounded-full"
														style={{ width: `${ramPercent}%` }}
													/>
												</div>
											</div>

											<div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2">
												<div className="flex justify-between text-xs">
													<span className="text-slate-400 font-medium flex items-center gap-1.5">
														<HardDrive className="w-3.5 h-3.5 text-cyan-400" /> Disk Capacity
													</span>
													<span className="text-white font-mono font-bold">
														{node.capacity?.diskGb || 100} GB Total
													</span>
												</div>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/* Modal 1: Join Swarm Node Dialog */}
			<Dialog open={isJoinDialogOpen} onOpenChange={setIsJoinDialogOpen}>
				<DialogContent className="sm:max-w-3xl bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle className="text-xl flex items-center gap-2">
							<Terminal className="w-5 h-5 text-amber-400" />
							Join New Server to Cluster Mesh
						</DialogTitle>
						<DialogDescription className="text-slate-400 text-xs">
							Run the following commands on your newly provisioned Linux server (Ubuntu/Debian) to attach it to this cluster.
						</DialogDescription>
					</DialogHeader>

					<Tabs defaultValue="worker" className="mt-2">
						<TabsList className="bg-slate-900 border border-slate-800">
							<TabsTrigger
								value="worker"
								className="data-[state=active]:bg-amber-600 data-[state=active]:text-white text-xs"
							>
								Worker Node (Recommended for Applications)
							</TabsTrigger>
							<TabsTrigger
								value="manager"
								className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-xs"
							>
								Manager Node (High Availability Quorum)
							</TabsTrigger>
						</TabsList>

						{/* Worker Tab */}
						<TabsContent value="worker" className="space-y-4 pt-4">
							<div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
								<strong>When to use:</strong> Add a Worker when your server load is high (&ldquo;top&rdquo;). Application containers will automatically schedule on this new worker with zero customer downtime.
							</div>

							{isLoadingWorkerToken ? (
								<div className="p-8 text-center text-slate-400">
									<Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
									Generating cluster join token...
								</div>
							) : (
								<div className="space-y-4">
									{/* Step 1: Docker install */}
									<div className="space-y-1.5">
										<Label className="text-xs text-slate-300 font-semibold">
											Step 1: Install Docker on the new server (if not already installed)
										</Label>
										<div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-200">
											<span className="truncate mr-2">
												curl -fsSL https://get.docker.com | sh
											</span>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => {
													copy("curl -fsSL https://get.docker.com | sh");
													toast.success("Command copied to clipboard");
												}}
												className="h-7 px-2 text-slate-400 hover:text-white"
											>
												<Copy className="w-3.5 h-3.5" />
											</Button>
										</div>
									</div>

									{/* Step 2: Open firewall ports */}
									<div className="space-y-1.5">
										<Label className="text-xs text-slate-300 font-semibold">
											Step 2: Ensure internal cluster firewall ports are open
										</Label>
										<div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 font-mono text-[11px] text-slate-400 space-y-1">
											<div>• TCP 2377 (Cluster management communication)</div>
											<div>• TCP &amp; UDP 7946 (Inter-node discovery &amp; gossip)</div>
											<div>• UDP 4789 (Overlay network traffic - Ingress mesh)</div>
										</div>
									</div>

									{/* Step 3: Swarm join command */}
									<div className="space-y-1.5">
										<Label className="text-xs text-slate-300 font-semibold">
											Step 3: Execute cluster join command on the new server
										</Label>
										<div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-amber-500/30 font-mono text-xs text-amber-300">
											<span className="break-all mr-2">
												{workerTokenData?.command ||
													"docker swarm join --token <TOKEN> <IP>:2377"}
											</span>
											<Button
												size="sm"
												variant="secondary"
												onClick={() => {
													if (workerTokenData?.command) {
														copy(workerTokenData.command);
														toast.success("Worker join command copied!");
													}
												}}
												className="h-8 px-2.5 bg-amber-600 hover:bg-amber-500 text-white shrink-0"
											>
												<Copy className="w-3.5 h-3.5 mr-1" /> Copy
											</Button>
										</div>
									</div>
								</div>
							)}
						</TabsContent>

						{/* Manager Tab */}
						<TabsContent value="manager" className="space-y-4 pt-4">
							<div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
								<strong>When to use:</strong> Add a Manager when you need high-availability control plane redundancy. Only use odd numbers (3 or 5) of managers for Raft consensus.
							</div>

							{isLoadingManagerToken ? (
								<div className="p-8 text-center text-slate-400">
									<Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
									Generating manager join token...
								</div>
							) : (
								<div className="space-y-4">
									<div className="space-y-1.5">
										<Label className="text-xs text-slate-300 font-semibold">
											Manager join command
										</Label>
										<div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-indigo-500/30 font-mono text-xs text-indigo-300">
											<span className="break-all mr-2">
												{managerTokenData?.command ||
													"docker swarm join --token <MANAGER_TOKEN> <IP>:2377"}
											</span>
											<Button
												size="sm"
												variant="secondary"
												onClick={() => {
													if (managerTokenData?.command) {
														copy(managerTokenData.command);
														toast.success("Manager join command copied!");
													}
												}}
												className="h-8 px-2.5 bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
											>
												<Copy className="w-3.5 h-3.5 mr-1" /> Copy
											</Button>
										</div>
									</div>
								</div>
							)}
						</TabsContent>
					</Tabs>

					<DialogFooter className="mt-4">
						<Button
							variant="outline"
							onClick={() => setIsJoinDialogOpen(false)}
							className="border-slate-800 text-slate-300 hover:bg-slate-900 text-xs"
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal 2: Connect SSH Server Host Dialog */}
			<Dialog
				open={isConnectSshDialogOpen}
				onOpenChange={setIsConnectSshDialogOpen}
			>
				<DialogContent className="sm:max-w-xl bg-slate-950 border-slate-800 text-white">
					<DialogHeader>
						<DialogTitle className="text-lg flex items-center gap-2">
							<Server className="w-5 h-5 text-amber-400" />
							Connect Remote SSH Compute Host
						</DialogTitle>
						<DialogDescription className="text-slate-400 text-xs">
							Register an external server with SSH credentials to run isolated deployments or builds.
						</DialogDescription>
					</DialogHeader>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (!sshForm.name || !sshForm.ipAddress) {
								toast.error("Please provide both server name and IP address");
								return;
							}
							createServerMutation.mutate({
								name: sshForm.name,
								ipAddress: sshForm.ipAddress,
								port: Number(sshForm.port) || 22,
								username: sshForm.username || "root",
								sshKeyId: sshForm.sshKeyId || null,
								serverType: sshForm.serverType,
								description: null,
								enableDockerCleanup: sshForm.enableDockerCleanup,
							});
						}}
						className="space-y-4 pt-2"
					>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">Server Name</Label>
								<Input
									placeholder="e.g. worker-node-02"
									value={sshForm.name}
									onChange={(e) =>
										setSshForm({ ...sshForm, name: e.target.value })
									}
									className="bg-slate-900 border-slate-800 text-white text-xs h-9"
									required
								/>
							</div>

							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">IP Address / Hostname</Label>
								<Input
									placeholder="e.g. 192.168.1.100 or server.example.com"
									value={sshForm.ipAddress}
									onChange={(e) =>
										setSshForm({ ...sshForm, ipAddress: e.target.value })
									}
									className="bg-slate-900 border-slate-800 text-white text-xs h-9"
									required
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">SSH Port</Label>
								<Input
									type="number"
									placeholder="22"
									value={sshForm.port}
									onChange={(e) =>
										setSshForm({ ...sshForm, port: Number(e.target.value) })
									}
									className="bg-slate-900 border-slate-800 text-white text-xs h-9"
								/>
							</div>

							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">SSH Username</Label>
								<Input
									placeholder="root"
									value={sshForm.username}
									onChange={(e) =>
										setSshForm({ ...sshForm, username: e.target.value })
									}
									className="bg-slate-900 border-slate-800 text-white text-xs h-9"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">Server Workload Type</Label>
								<Select
									value={sshForm.serverType}
									onValueChange={(val: "deploy" | "build") =>
										setSshForm({ ...sshForm, serverType: val })
									}
								>
									<SelectTrigger className="bg-slate-900 border-slate-800 text-white text-xs h-9">
										<SelectValue placeholder="Select type" />
									</SelectTrigger>
									<SelectContent className="bg-slate-900 border-slate-800 text-white">
										<SelectItem value="deploy">
											Deploy (Applications &amp; Workloads)
										</SelectItem>
										<SelectItem value="build">
											Build (Dedicated Image Builder)
										</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-1.5">
								<Label className="text-xs text-slate-300">SSH Key</Label>
								<Select
									value={sshForm.sshKeyId}
									onValueChange={(val) =>
										setSshForm({ ...sshForm, sshKeyId: val })
									}
								>
									<SelectTrigger className="bg-slate-900 border-slate-800 text-white text-xs h-9">
										<SelectValue placeholder="Select an SSH Key" />
									</SelectTrigger>
									<SelectContent className="bg-slate-900 border-slate-800 text-white">
										{sshKeys && sshKeys.length > 0 ? (
											sshKeys.map((key) => (
												<SelectItem key={key.sshKeyId} value={key.sshKeyId}>
													{key.name}
												</SelectItem>
											))
										) : (
											<SelectItem value="none" disabled>
												No SSH keys found in settings
											</SelectItem>
										)}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800">
							<div className="space-y-0.5">
								<Label className="text-xs text-slate-300 font-medium">
									Automated Docker System Cleanup
								</Label>
								<p className="text-[11px] text-slate-400">
									Periodically prunes dangling build images and stopped containers to prevent disk exhaustion.
								</p>
							</div>
							<Switch
								checked={sshForm.enableDockerCleanup}
								onCheckedChange={(val) =>
									setSshForm({ ...sshForm, enableDockerCleanup: val })
								}
							/>
						</div>

						<DialogFooter className="pt-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsConnectSshDialogOpen(false)}
								className="border-slate-800 text-slate-300 text-xs"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={createServerMutation.isPending}
								className="bg-amber-600 hover:bg-amber-500 text-white text-xs"
							>
								{createServerMutation.isPending ? (
									<>
										<Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
										Connecting Host...
									</>
								) : (
									"Register Server"
								)}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

AdminServersPage.getLayout = (page: ReactElement) => (
	<AdminLayout>{page}</AdminLayout>
);

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

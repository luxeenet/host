import { Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { ShowContainerConfig } from "@/components/dashboard/docker/config/show-container-config";
import { ShowContainerMounts } from "@/components/dashboard/docker/mounts/show-container-mounts";
import { ShowContainerNetworks } from "@/components/dashboard/docker/networks/show-container-networks";
import { DockerTerminalModal } from "@/components/dashboard/docker/terminal/docker-terminal-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const DockerLogsId = dynamic(
	() =>
		import("@/components/dashboard/docker/logs/docker-logs-id").then(
			(e) => e.DockerLogsId,
		),
	{
		ssr: false,
	},
);

interface Props {
	appName: string;
	serverId?: string;
	appType: "stack" | "docker-compose";
	serviceId?: string;
}

export const ShowComposeContainers = ({
	appName,
	appType,
	serverId,
	serviceId,
}: Props) => {
	const { data: userAuth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean(
		(userAuth as any)?.user?.isPlatformAdmin || (userAuth as any)?.isPlatformAdmin,
	);

	const { data, isPending, refetch } =
		api.docker.getContainersByAppNameMatch.useQuery(
			{
				appName,
				appType,
				serverId,
			},
			{
				enabled: !!appName,
			},
		);

	return (
		<Card className="bg-background">
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle className="text-xl">Services & Instances</CardTitle>
					<CardDescription>
						Inspect each service instance in this application stack and run basic lifecycle
						actions.
					</CardDescription>
				</div>
				<Button
					variant="outline"
					size="icon"
					onClick={() => refetch()}
					disabled={isPending}
				>
					<RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
				</Button>
			</CardHeader>
			<CardContent>
				{isPending ? (
					<div className="flex items-center justify-center h-[20vh]">
						<Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
					</div>
				) : !data || data.length === 0 ? (
					<div className="flex items-center justify-center h-[20vh]">
						<span className="text-muted-foreground">
							No running services found. Deploy the application to see active services here.
						</span>
					</div>
				) : (
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Service / Instance</TableHead>
									<TableHead>State</TableHead>
									<TableHead>Status</TableHead>
									{appType === "stack" && <TableHead>Node</TableHead>}
									{isPlatformAdmin && <TableHead>Instance ID</TableHead>}
									<TableHead className="text-right" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.map((container) => (
									<ContainerRow
										key={container.name}
										container={container}
										appType={appType}
										serverId={serverId}
										serviceId={serviceId}
										isPlatformAdmin={isPlatformAdmin}
										onActionComplete={() => refetch()}
									/>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
};

interface ContainerRowProps {
	container: {
		containerId: string;
		name: string;
		state: string;
		status: string;
		node?: string;
	};
	appType: "stack" | "docker-compose";
	serverId?: string;
	serviceId?: string;
	isPlatformAdmin?: boolean;
	onActionComplete: () => void;
}

const ContainerRow = ({
	container,
	appType,
	serverId,
	serviceId,
	isPlatformAdmin,
	onActionComplete,
}: ContainerRowProps) => {
	const [logsOpen, setLogsOpen] = useState(false);
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	const restartMutation = api.docker.restartContainer.useMutation();
	const startMutation = api.docker.startContainer.useMutation();
	const stopMutation = api.docker.stopContainer.useMutation();
	const killMutation = api.docker.killContainer.useMutation();

	const handleAction = async (
		action: string,
		mutationFn: typeof restartMutation,
	) => {
		setActionLoading(action);
		try {
			await mutationFn.mutateAsync({
				containerId: container.containerId,
				serverId,
			});
			toast.success(`Service ${action} completed successfully`);
			onActionComplete();
		} catch (error) {
			toast.error(
				`Failed to ${action} service: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		} finally {
			setActionLoading(null);
		}
	};

	return (
		<TableRow>
			<TableCell className="font-medium">{container.name}</TableCell>
			<TableCell>
				<Badge
					variant={
						container.state === "running"
							? "default"
							: [
										"exited",
										"pending",
										"preparing",
										"starting",
										"ready",
									].includes(container.state)
								? "secondary"
								: "destructive"
					}
				>
					{container.state}
				</Badge>
			</TableCell>
			<TableCell>{container.status}</TableCell>
			{appType === "stack" && <TableCell>{container.node || "-"}</TableCell>}
			{isPlatformAdmin && (
				<TableCell className="font-mono text-sm text-muted-foreground">
					{container.containerId || "-"}
				</TableCell>
			)}
			<TableCell className="text-right">
				{!container.containerId ? null : (
					<Dialog open={logsOpen} onOpenChange={setLogsOpen}>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" className="h-8 w-8 p-0">
									{actionLoading ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<MoreHorizontal className="h-4 w-4" />
									)}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>Actions</DropdownMenuLabel>
								<DialogTrigger asChild>
									<DropdownMenuItem
										className="cursor-pointer"
										onSelect={(e) => e.preventDefault()}
									>
										View Logs
									</DropdownMenuItem>
								</DialogTrigger>
								{isPlatformAdmin && (
									<>
										<ShowContainerConfig
											containerId={container.containerId}
											serverId={serverId || ""}
										/>
										<ShowContainerMounts
											containerId={container.containerId}
											serverId={serverId || ""}
										/>
										<ShowContainerNetworks
											containerId={container.containerId}
											serverId={serverId || ""}
										/>
									</>
								)}
								<DockerTerminalModal
									containerId={container.containerId}
									serverId={serverId || ""}
									serviceId={serviceId}
									appName={container.name}
								>
									Terminal
								</DockerTerminalModal>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="cursor-pointer"
									disabled={actionLoading !== null}
									onClick={() => handleAction("restart", restartMutation)}
								>
									Restart
								</DropdownMenuItem>
								<DropdownMenuItem
									className="cursor-pointer"
									disabled={actionLoading !== null}
									onClick={() => handleAction("start", startMutation)}
								>
									Start
								</DropdownMenuItem>
								<DropdownMenuItem
									className="cursor-pointer"
									disabled={actionLoading !== null}
									onClick={() => handleAction("stop", stopMutation)}
								>
									Stop
								</DropdownMenuItem>
								<DropdownMenuItem
									className="cursor-pointer text-red-500 focus:text-red-600"
									disabled={actionLoading !== null}
									onClick={() => handleAction("kill", killMutation)}
								>
									Kill
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<DialogContent className="sm:max-w-7xl">
							<DialogHeader>
								<DialogTitle>Application Logs</DialogTitle>
								<DialogDescription>Logs for {container.name}</DialogDescription>
							</DialogHeader>
							<div className="flex flex-col gap-4 pt-2.5">
								<DockerLogsId
									containerId={container.containerId}
									serverId={serverId}
									runType="native"
									serviceId={serviceId}
								/>
							</div>
						</DialogContent>
					</Dialog>
				)}
			</TableCell>
		</TableRow>
	);
};

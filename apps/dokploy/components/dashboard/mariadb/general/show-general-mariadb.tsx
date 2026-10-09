import { Ban, CheckCircle2, RefreshCcw, Rocket, Terminal } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { DrawerLogs } from "@/components/shared/drawer-logs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { DatabaseConnectionCard } from "../../database/connection/database-connection-card";
import { type LogLine, parseLogs } from "../../docker/logs/utils";
import { DockerTerminalModal } from "../../settings/web-server/docker-terminal-modal";

interface Props {
	mariadbId: string;
}

export const ShowGeneralMariadb = ({ mariadbId }: Props) => {
	const { data: permissions } = api.user.getPermissions.useQuery();
	const canDeploy = permissions?.deployment.create ?? false;
	const { data, refetch } = api.mariadb.one.useQuery(
		{
			mariadbId,
		},
		{ enabled: !!mariadbId },
	);

	const { mutateAsync: reload, isPending: isReloading } =
		api.mariadb.reload.useMutation();
	const { mutateAsync: start, isPending: isStarting } =
		api.mariadb.start.useMutation();
	const { mutateAsync: stop, isPending: isStopping } =
		api.mariadb.stop.useMutation();

	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [filteredLogs, setFilteredLogs] = useState<LogLine[]>([]);
	const [isDeploying, setIsDeploying] = useState(false);
	api.mariadb.deployWithLogs.useSubscription(
		{
			mariadbId: mariadbId,
		},
		{
			enabled: isDeploying,
			onData(log) {
				if (!isDrawerOpen) {
					setIsDrawerOpen(true);
				}

				if (log === "Deployment completed successfully!") {
					setIsDeploying(false);
				}
				const parsedLogs = parseLogs(log);
				setFilteredLogs((prev) => [...prev, ...parsedLogs]);
			},
			onError(error) {
				console.error("Deployment logs error:", error);
				setIsDeploying(false);
			},
		},
	);

	return (
		<div className="flex w-full flex-col gap-6">
			<Card className="bg-background">
				<CardHeader className="flex flex-row items-center justify-between pb-3">
					<CardTitle className="text-xl">Database Controls</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-row gap-4 flex-wrap items-center">
					<TooltipProvider disableHoverableContent={false}>
						{canDeploy && (
							<DialogAction
								title="Deploy MariaDB"
								description="Are you sure you want to deploy this MariaDB database?"
								type="default"
								onClick={async () => {
									setIsDeploying(true);
									await new Promise((resolve) => setTimeout(resolve, 1000));
									refetch();
								}}
							>
								<Button
									variant="default"
									isLoading={data?.applicationStatus === "running"}
									className="flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-offset-2"
								>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex items-center">
												<Rocket className="size-4 mr-1.5" />
												Deploy
											</div>
										</TooltipTrigger>
										<TooltipPrimitive.Portal>
											<TooltipContent sideOffset={5} className="z-60">
												<p>Downloads and sets up the MariaDB database</p>
											</TooltipContent>
										</TooltipPrimitive.Portal>
									</Tooltip>
								</Button>
							</DialogAction>
						)}
						{canDeploy && (
							<DialogAction
								title="Reload MariaDB"
								description="Are you sure you want to reload this MariaDB database?"
								type="default"
								onClick={async () => {
									await reload({
										mariadbId: mariadbId,
										appName: data?.appName || "",
									})
										.then(() => {
											toast.success("MariaDB reloaded successfully");
											refetch();
										})
										.catch(() => {
											toast.error("Error reloading MariaDB");
										});
								}}
							>
								<Button
									variant="secondary"
									isLoading={isReloading}
									className="flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-offset-2"
								>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex items-center">
												<RefreshCcw className="size-4 mr-1.5" />
												Reload
											</div>
										</TooltipTrigger>
										<TooltipPrimitive.Portal>
											<TooltipContent sideOffset={5} className="z-60">
												<p>Restart the MariaDB service without rebuilding</p>
											</TooltipContent>
										</TooltipPrimitive.Portal>
									</Tooltip>
								</Button>
							</DialogAction>
						)}
						{canDeploy &&
							(data?.applicationStatus === "idle" ? (
								<DialogAction
									title="Start MariaDB"
									description="Are you sure you want to start this MariaDB database?"
									type="default"
									onClick={async () => {
										await start({
											mariadbId: mariadbId,
										})
											.then(() => {
												toast.success("MariaDB started successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error starting MariaDB");
											});
									}}
								>
									<Button
										variant="secondary"
										isLoading={isStarting}
										className="flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-offset-2"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<CheckCircle2 className="size-4 mr-1.5" />
													Start
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>
														Start the MariaDB database (requires a previous
														successful setup)
													</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							) : (
								<DialogAction
									title="Stop MariaDB"
									description="Are you sure you want to stop this MariaDB database?"
									onClick={async () => {
										await stop({
											mariadbId: mariadbId,
										})
											.then(() => {
												toast.success("MariaDB stopped successfully");
												refetch();
											})
											.catch(() => {
												toast.error("Error stopping MariaDB");
											});
									}}
								>
									<Button
										variant="destructive"
										isLoading={isStopping}
										className="flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-offset-2"
									>
										<Tooltip>
											<TooltipTrigger asChild>
												<div className="flex items-center">
													<Ban className="size-4 mr-1.5" />
													Stop
												</div>
											</TooltipTrigger>
											<TooltipPrimitive.Portal>
												<TooltipContent sideOffset={5} className="z-60">
													<p>Stop the currently running MariaDB database</p>
												</TooltipContent>
											</TooltipPrimitive.Portal>
										</Tooltip>
									</Button>
								</DialogAction>
							))}
					</TooltipProvider>
					<DockerTerminalModal
						appName={data?.appName || ""}
						serviceId={data?.mariadbId}
						serverId={data?.serverId || ""}
					>
						<Button
							variant="outline"
							className="flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-offset-2 ml-auto"
						>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className="flex items-center">
										<Terminal className="size-4 mr-1.5" />
										Terminal
									</div>
								</TooltipTrigger>
								<TooltipPrimitive.Portal>
									<TooltipContent sideOffset={5} className="z-60">
										<p>Open a terminal to the MariaDB container</p>
									</TooltipContent>
								</TooltipPrimitive.Portal>
							</Tooltip>
						</Button>
					</DockerTerminalModal>
				</CardContent>
			</Card>

			<DatabaseConnectionCard
				databaseId={mariadbId}
				databaseType="mariadb"
				data={data}
				refetch={refetch}
				environmentId={data?.environmentId}
			/>

			<DrawerLogs
				isOpen={isDrawerOpen}
				onClose={() => {
					setIsDrawerOpen(false);
					setFilteredLogs([]);
					setIsDeploying(false);
					refetch();
				}}
				filteredLogs={filteredLogs}
			/>
		</div>
	);
};

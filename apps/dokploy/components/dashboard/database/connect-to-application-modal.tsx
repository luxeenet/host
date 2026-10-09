import { ArrowRight, Check, Database, Link2, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

interface Props {
	databaseId: string;
	databaseType:
		| "postgres"
		| "mysql"
		| "mariadb"
		| "mongo"
		| "redis"
		| "libsql";
	environmentId: string;
	databaseName?: string;
	children?: React.ReactNode;
}

export const ConnectToApplicationModal = ({
	databaseId,
	databaseType,
	environmentId,
	databaseName,
	children,
}: Props) => {
	const [isOpen, setIsOpen] = useState(false);
	const [selectedAppId, setSelectedAppId] = useState<string>("");
	const utils = api.useUtils();

	const { data: environment, isLoading: isLoadingApps } =
		api.environment.one.useQuery(
			{ environmentId },
			{ enabled: !!environmentId && isOpen },
		);

	const applications = environment?.applications || [];

	const postgresConnect = api.postgres.connectToApplication.useMutation();
	const mysqlConnect = api.mysql.connectToApplication.useMutation();
	const mariadbConnect = api.mariadb.connectToApplication.useMutation();
	const mongoConnect = api.mongo.connectToApplication.useMutation();
	const redisConnect = api.redis.connectToApplication.useMutation();
	const libsqlConnect = api.libsql.connectToApplication.useMutation();

	const isConnecting =
		postgresConnect.isPending ||
		mysqlConnect.isPending ||
		mariadbConnect.isPending ||
		mongoConnect.isPending ||
		redisConnect.isPending ||
		libsqlConnect.isPending;

	const handleConnect = async () => {
		if (!selectedAppId) {
			toast.error("Please select a target application");
			return;
		}

		try {
			if (databaseType === "postgres") {
				await postgresConnect.mutateAsync({
					postgresId: databaseId,
					applicationId: selectedAppId,
				});
			} else if (databaseType === "mysql") {
				await mysqlConnect.mutateAsync({
					mysqlId: databaseId,
					applicationId: selectedAppId,
				});
			} else if (databaseType === "mariadb") {
				await mariadbConnect.mutateAsync({
					mariadbId: databaseId,
					applicationId: selectedAppId,
				});
			} else if (databaseType === "mongo") {
				await mongoConnect.mutateAsync({
					mongoId: databaseId,
					applicationId: selectedAppId,
				});
			} else if (databaseType === "redis") {
				await redisConnect.mutateAsync({
					redisId: databaseId,
					applicationId: selectedAppId,
				});
			} else if (databaseType === "libsql") {
				await libsqlConnect.mutateAsync({
					libsqlId: databaseId,
					applicationId: selectedAppId,
				});
			}

			toast.success("Database connected to application successfully!", {
				description:
					"Environment variables have been updated on the target application.",
			});
			await utils.application.one.invalidate();
			setIsOpen(false);
		} catch (error) {
			toast.error("Failed to connect database", {
				description:
					error instanceof Error ? error.message : "Unknown error occurred",
			});
		}
	};

	const selectedApp = applications.find(
		(a) => a.applicationId === selectedAppId,
	);

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				{children || (
					<Button
						variant="outline"
						className="flex items-center gap-2 border-primary/30 hover:border-primary"
					>
						<Link2 className="size-4 text-primary" />
						Connect to Application
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<Database className="size-5 text-primary" />
						Connect to Application
					</DialogTitle>
					<DialogDescription>
						Automatically inject standard database connection environment
						variables (e.g. <code>DATABASE_URL</code>) into an application in
						this environment.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 py-2">
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium text-muted-foreground">
							Select Target Application
						</label>
						{isLoadingApps ? (
							<div className="h-10 animate-pulse bg-muted rounded-md" />
						) : applications.length === 0 ? (
							<AlertBlock type="info">
								No applications found in this environment. Create an application
								first to connect your database.
							</AlertBlock>
						) : (
							<Select
								value={selectedAppId}
								onValueChange={setSelectedAppId}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Choose an application..." />
								</SelectTrigger>
								<SelectContent>
									{applications.map((app) => (
										<SelectItem
											key={app.applicationId}
											value={app.applicationId}
										>
											<div className="flex items-center gap-2">
												<Server className="size-4 text-muted-foreground" />
												<span>{app.name}</span>
												<Badge variant="outline" className="text-xs ml-auto">
													{app.applicationStatus}
												</Badge>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>

					{selectedApp && (
						<div className="flex flex-col gap-3 p-3.5 bg-muted/40 border rounded-lg">
							<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Variables to be Configured
							</span>
							<div className="flex flex-col gap-1.5 text-xs font-mono">
								<div className="flex items-center justify-between py-1 border-b border-muted">
									<span className="text-primary font-bold">DATABASE_URL</span>
									<span className="text-muted-foreground truncate max-w-[240px]">
										{databaseType}://... (Internal URL)
									</span>
								</div>
								{databaseType !== "redis" && databaseType !== "libsql" && (
									<>
										<div className="flex items-center justify-between py-1 border-b border-muted">
											<span className="text-foreground">
												{databaseType.toUpperCase()}_USER
											</span>
											<span className="text-muted-foreground">Configured</span>
										</div>
										<div className="flex items-center justify-between py-1 border-b border-muted">
											<span className="text-foreground">
												{databaseType.toUpperCase()}_PASSWORD
											</span>
											<span className="text-muted-foreground">••••••••</span>
										</div>
										<div className="flex items-center justify-between py-1">
											<span className="text-foreground">
												{databaseType.toUpperCase()}_DB
											</span>
											<span className="text-muted-foreground">
												{databaseName || "Configured"}
											</span>
										</div>
									</>
								)}
								{databaseType === "redis" && (
									<div className="flex items-center justify-between py-1">
										<span className="text-primary font-bold">REDIS_URL</span>
										<span className="text-muted-foreground">
											redis://...:6379
										</span>
									</div>
								)}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Existing unrelated variables and comments in{" "}
								<strong>{selectedApp.name}</strong> will be preserved safely.
							</p>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						variant="ghost"
						onClick={() => setIsOpen(false)}
						disabled={isConnecting}
					>
						Cancel
					</Button>
					<Button
						onClick={handleConnect}
						isLoading={isConnecting}
						disabled={!selectedAppId || isConnecting}
						className="flex items-center gap-2"
					>
						<Check className="size-4" />
						Connect Database
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

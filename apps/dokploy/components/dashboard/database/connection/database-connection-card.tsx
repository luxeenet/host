import {
	Check,
	Copy,
	Globe,
	Info,
	Link2,
	Lock,
	Radio,
	RefreshCw,
	Server,
	ShieldCheck,
	Unlink,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ToggleVisibilityInput } from "@/components/shared/toggle-visibility-input";
import { UpdateDatabasePassword } from "@/components/shared/update-database-password";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/utils/api";
import { ConnectToApplicationModal } from "../connect-to-application-modal";

export type DatabaseType =
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

interface Props {
	databaseId: string;
	databaseType: DatabaseType;
	data: any;
	refetch: () => void;
	environmentId?: string;
}

export const DatabaseConnectionCard = ({
	databaseId,
	databaseType,
	data,
	refetch,
	environmentId,
}: Props) => {
	const utils = api.useUtils();
	const [activeTab, setActiveTab] = useState<"internal" | "external">("internal");
	const [customPort, setCustomPort] = useState<string>("");
	const [isCustomPortOpen, setIsCustomPortOpen] = useState(false);

	// Mutations for password update
	const changePasswordPostgres = api.postgres.changePassword.useMutation();
	const changePasswordMysql = api.mysql.changePassword.useMutation();
	const changePasswordMariadb = api.mariadb.changePassword.useMutation();
	const changePasswordMongo = api.mongo.changePassword.useMutation();
	const changePasswordRedis = api.redis.changePassword.useMutation();
	const changePasswordLibsql = api.libsql.changePassword.useMutation();

	// Mutations for enabling / disabling external access
	const enablePostgres = api.postgres.enableExternalAccess.useMutation();
	const disablePostgres = api.postgres.disableExternalAccess.useMutation();
	const enableMysql = api.mysql.enableExternalAccess.useMutation();
	const disableMysql = api.mysql.disableExternalAccess.useMutation();
	const enableMariadb = api.mariadb.enableExternalAccess.useMutation();
	const disableMariadb = api.mariadb.disableExternalAccess.useMutation();
	const enableMongo = api.mongo.enableExternalAccess.useMutation();
	const disableMongo = api.mongo.disableExternalAccess.useMutation();
	const enableRedis = api.redis.enableExternalAccess.useMutation();
	const disableRedis = api.redis.disableExternalAccess.useMutation();
	const enableLibsql = api.libsql.enableExternalAccess.useMutation();
	const disableLibsql = api.libsql.disableExternalAccess.useMutation();

	const isEnabling =
		enablePostgres.isPending ||
		enableMysql.isPending ||
		enableMariadb.isPending ||
		enableMongo.isPending ||
		enableRedis.isPending ||
		enableLibsql.isPending;

	const isDisabling =
		disablePostgres.isPending ||
		disableMysql.isPending ||
		disableMariadb.isPending ||
		disableMongo.isPending ||
		disableRedis.isPending ||
		disableLibsql.isPending;

	const handleUpdatePassword = async (newPassword: string) => {
		try {
			if (databaseType === "postgres") {
				await changePasswordPostgres.mutateAsync({
					postgresId: databaseId,
					password: newPassword,
				});
				utils.postgres.one.invalidate({ postgresId: databaseId });
			} else if (databaseType === "mysql") {
				await changePasswordMysql.mutateAsync({
					mysqlId: databaseId,
					password: newPassword,
				});
				utils.mysql.one.invalidate({ mysqlId: databaseId });
			} else if (databaseType === "mariadb") {
				await changePasswordMariadb.mutateAsync({
					mariadbId: databaseId,
					password: newPassword,
				});
				utils.mariadb.one.invalidate({ mariadbId: databaseId });
			} else if (databaseType === "mongo") {
				await changePasswordMongo.mutateAsync({
					mongoId: databaseId,
					password: newPassword,
				});
				utils.mongo.one.invalidate({ mongoId: databaseId });
			} else if (databaseType === "redis") {
				await changePasswordRedis.mutateAsync({
					redisId: databaseId,
					password: newPassword,
				});
				utils.redis.one.invalidate({ redisId: databaseId });
			} else if (databaseType === "libsql") {
				await changePasswordLibsql.mutateAsync({
					libsqlId: databaseId,
					password: newPassword,
				});
				utils.libsql.one.invalidate({ libsqlId: databaseId });
			}
			toast.success("Database password updated successfully");
			refetch();
		} catch (error) {
			toast.error("Failed to update password", {
				description:
					error instanceof Error ? error.message : "Unknown error occurred",
			});
		}
	};

	const handleEnableExternal = async (specifiedPort?: number) => {
		try {
			if (databaseType === "postgres") {
				await enablePostgres.mutateAsync({
					postgresId: databaseId,
					customPort: specifiedPort,
				});
			} else if (databaseType === "mysql") {
				await enableMysql.mutateAsync({
					mysqlId: databaseId,
					customPort: specifiedPort,
				});
			} else if (databaseType === "mariadb") {
				await enableMariadb.mutateAsync({
					mariadbId: databaseId,
					customPort: specifiedPort,
				});
			} else if (databaseType === "mongo") {
				await enableMongo.mutateAsync({
					mongoId: databaseId,
					customPort: specifiedPort,
				});
			} else if (databaseType === "redis") {
				await enableRedis.mutateAsync({
					redisId: databaseId,
					customPort: specifiedPort,
				});
			} else if (databaseType === "libsql") {
				await enableLibsql.mutateAsync({
					libsqlId: databaseId,
					customPort: specifiedPort,
				});
			}
			toast.success("Public external access enabled successfully!", {
				description:
					"An external endpoint has been allocated and configured for your database.",
			});
			refetch();
		} catch (error) {
			toast.error("Failed to enable external access", {
				description:
					error instanceof Error ? error.message : "Unknown error occurred",
			});
		}
	};

	const handleDisableExternal = async () => {
		try {
			if (databaseType === "postgres") {
				await disablePostgres.mutateAsync({ postgresId: databaseId });
			} else if (databaseType === "mysql") {
				await disableMysql.mutateAsync({ mysqlId: databaseId });
			} else if (databaseType === "mariadb") {
				await disableMariadb.mutateAsync({ mariadbId: databaseId });
			} else if (databaseType === "mongo") {
				await disableMongo.mutateAsync({ mongoId: databaseId });
			} else if (databaseType === "redis") {
				await disableRedis.mutateAsync({ redisId: databaseId });
			} else if (databaseType === "libsql") {
				await disableLibsql.mutateAsync({ libsqlId: databaseId });
			}
			toast.success("Public external access disabled");
			refetch();
		} catch (error) {
			toast.error("Failed to disable external access", {
				description:
					error instanceof Error ? error.message : "Unknown error occurred",
			});
		}
	};

	// Standard internal port per database engine
	const defaultPorts: Record<DatabaseType, number> = {
		postgres: 5432,
		mysql: 3306,
		mariadb: 3306,
		mongo: 27017,
		redis: 6379,
		libsql: 8080,
	};

	const internalPort = defaultPorts[databaseType];
	const user =
		data?.databaseUser || (databaseType === "redis" ? "default" : "postgres");
	const password = data?.databasePassword || "";
	const dbName = data?.databaseName || "";
	const appName = data?.appName || "";
	const publicHost = data?.publicHost || data?.server?.ipAddress || "";
	const externalPort = data?.externalPort || null;
	const isExternalEnabled = Boolean(externalPort && externalPort > 0);

	// Build connection URLs
	let internalUrl = "";
	let externalUrl = "";

	if (databaseType === "postgres") {
		internalUrl = `postgresql://${user}:${password}@${appName}:${internalPort}/${dbName}`;
		externalUrl = isExternalEnabled
			? `postgresql://${user}:${password}@${publicHost}:${externalPort}/${dbName}`
			: "";
	} else if (databaseType === "mysql" || databaseType === "mariadb") {
		internalUrl = `mysql://${user}:${password}@${appName}:${internalPort}/${dbName}`;
		externalUrl = isExternalEnabled
			? `mysql://${user}:${password}@${publicHost}:${externalPort}/${dbName}`
			: "";
	} else if (databaseType === "mongo") {
		internalUrl = `mongodb://${user}:${password}@${appName}:${internalPort}/${dbName}?authSource=admin`;
		externalUrl = isExternalEnabled
			? `mongodb://${user}:${password}@${publicHost}:${externalPort}/${dbName}?authSource=admin`
			: "";
	} else if (databaseType === "redis") {
		internalUrl = `redis://default:${password}@${appName}:${internalPort}`;
		externalUrl = isExternalEnabled
			? `redis://default:${password}@${publicHost}:${externalPort}`
			: "";
	} else if (databaseType === "libsql") {
		internalUrl = `http://${user}:${password}@${appName}:${internalPort}`;
		externalUrl = isExternalEnabled
			? `http://${user}:${password}@${publicHost}:${externalPort}`
			: "";
	}

	return (
		<Card className="bg-background shadow-sm border">
			<CardHeader className="flex flex-row items-center justify-between pb-4">
				<div className="flex flex-col gap-1">
					<CardTitle className="text-xl flex items-center gap-2">
						<Lock className="size-5 text-primary" />
						Database Connection Details
					</CardTitle>
					<CardDescription>
						Connect applications running inside HatDot or connect securely from
						external tools.
					</CardDescription>
				</div>
				{environmentId && (
					<ConnectToApplicationModal
						databaseId={databaseId}
						databaseType={databaseType}
						environmentId={environmentId}
						databaseName={dbName}
					/>
				)}
			</CardHeader>
			<CardContent>
				<Tabs
					value={activeTab}
					onValueChange={(v) => setActiveTab(v as "internal" | "external")}
					className="w-full"
				>
					<TabsList className="grid grid-cols-2 w-full max-w-md mb-6">
						<TabsTrigger value="internal" className="flex items-center gap-2">
							<Server className="size-4" />
							<span>Internal Connection</span>
							<Badge variant="secondary" className="text-xs ml-1 py-0 px-1.5">
								Private
							</Badge>
						</TabsTrigger>
						<TabsTrigger value="external" className="flex items-center gap-2">
							<Globe className="size-4" />
							<span>Public Connection</span>
							<Badge
								variant={isExternalEnabled ? "default" : "outline"}
								className="text-xs ml-1 py-0 px-1.5"
							>
								{isExternalEnabled ? "Active" : "Disabled"}
							</Badge>
						</TabsTrigger>
					</TabsList>

					{/* INTERNAL CONNECTION TAB */}
					<TabsContent value="internal" className="space-y-6 mt-0">
						<div className="flex flex-col gap-1 text-sm bg-muted/30 p-3.5 rounded-lg border">
							<div className="flex items-center gap-2 text-foreground font-medium">
								<ShieldCheck className="size-4 text-emerald-500" />
								<span>Private Virtual Network</span>
							</div>
							<p className="text-muted-foreground text-xs">
								Use this connection URL for applications hosted within HatDot.
								Communication is fast and completely isolated from the public
								internet.
							</p>
						</div>

						{/* Full Internal Connection String */}
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between">
								<Label className="text-sm font-semibold">
									Internal Connection URL
								</Label>
								<span className="text-xs text-muted-foreground font-mono">
									Format: {databaseType}://...
								</span>
							</div>
							<ToggleVisibilityInput value={internalUrl} disabled />
						</div>

						{/* Individual Internal Fields Grid */}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground uppercase font-semibold">
									Host
								</Label>
								<Input enableCopyButton disabled value={appName} />
							</div>

							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground uppercase font-semibold">
									Port
								</Label>
								<Input
									enableCopyButton
									disabled
									value={String(internalPort)}
								/>
							</div>

							{databaseType !== "redis" && (
								<div className="flex flex-col gap-1.5">
									<Label className="text-xs text-muted-foreground uppercase font-semibold">
										Database Name
									</Label>
									<Input enableCopyButton disabled value={dbName} />
								</div>
							)}

							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground uppercase font-semibold">
									User
								</Label>
								<Input enableCopyButton disabled value={user} />
							</div>

							<div className="flex flex-col gap-1.5 md:col-span-2">
								<Label className="text-xs text-muted-foreground uppercase font-semibold">
									Password
								</Label>
								<div className="flex flex-row gap-2 items-center">
									<ToggleVisibilityInput value={password} disabled />
									<UpdateDatabasePassword
										onUpdatePassword={handleUpdatePassword}
									/>
								</div>
							</div>
						</div>
					</TabsContent>

					{/* EXTERNAL CONNECTION TAB */}
					<TabsContent value="external" className="space-y-6 mt-0">
						{!isExternalEnabled ? (
							<div className="flex flex-col items-center justify-center p-8 bg-muted/20 border border-dashed rounded-xl gap-4 text-center">
								<div className="p-3 bg-muted rounded-full">
									<Globe className="size-8 text-muted-foreground" />
								</div>
								<div className="flex flex-col gap-1 max-w-md">
									<h4 className="text-base font-semibold text-foreground">
										Public External Access is Disabled
									</h4>
									<p className="text-xs text-muted-foreground leading-relaxed">
										Enable external access to connect to your database from
										local development machines, external servers, or BI
										tools. HatDot will automatically provision a public endpoint
										without requiring server configuration.
									</p>
								</div>
								<Button
									onClick={() => handleEnableExternal()}
									isLoading={isEnabling}
									className="flex items-center gap-2 mt-2"
								>
									<Radio className="size-4" />
									Enable Public Connection
								</Button>
							</div>
						) : (
							<div className="flex flex-col gap-6">
								<div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-lg">
									<div className="flex items-center gap-2.5">
										<span className="relative flex h-2.5 w-2.5">
											<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
											<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
										</span>
										<div className="flex flex-col">
											<div className="flex items-center gap-2">
												<span className="text-sm font-semibold text-foreground">
													Public Database Endpoint Active
												</span>
												<Badge
													variant="outline"
													className="text-[10px] py-0 px-1.5 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
												>
													Platform Domain
												</Badge>
											</div>
											<span className="text-xs text-muted-foreground">
												Reachable via {publicHost || "Platform Gateway"}:
												{externalPort}
											</span>
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={handleDisableExternal}
										isLoading={isDisabling}
										className="text-destructive hover:bg-destructive/10 border-destructive/30"
									>
										Disable Public Access
									</Button>
								</div>

								{/* Full External Connection String */}
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between">
										<Label className="text-sm font-semibold">
											External Connection URL (Public)
										</Label>
										<span className="text-xs text-muted-foreground font-mono">
											Ready for external tools & clients
										</span>
									</div>
									<ToggleVisibilityInput value={externalUrl} disabled />
								</div>

								{/* Individual External Fields Grid */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="flex flex-col gap-1.5">
										<Label className="text-xs text-muted-foreground uppercase font-semibold">
											External Host (Platform Domain)
										</Label>
										<Input
											enableCopyButton
											disabled
											value={publicHost || "Resolving Host..."}
										/>
									</div>

									<div className="flex flex-col gap-1.5">
										<Label className="text-xs text-muted-foreground uppercase font-semibold">
											External Port
										</Label>
										<Input
											enableCopyButton
											disabled
											value={String(externalPort)}
										/>
									</div>

									{databaseType !== "redis" && (
										<div className="flex flex-col gap-1.5">
											<Label className="text-xs text-muted-foreground uppercase font-semibold">
												Database Name
											</Label>
											<Input enableCopyButton disabled value={dbName} />
										</div>
									)}

									<div className="flex flex-col gap-1.5">
										<Label className="text-xs text-muted-foreground uppercase font-semibold">
											User
										</Label>
										<Input enableCopyButton disabled value={user} />
									</div>

									<div className="flex flex-col gap-1.5 md:col-span-2">
										<Label className="text-xs text-muted-foreground uppercase font-semibold">
											Password
										</Label>
										<ToggleVisibilityInput value={password} disabled />
									</div>
								</div>

								{/* Quick Connect CLI / Tool snippet */}
								<div className="flex flex-col gap-2 bg-muted/30 border rounded-lg p-3">
									<Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
										<Link2 className="size-3.5 text-primary" />
										CLI Connection Command
									</Label>
									<div className="flex items-center gap-2">
										<Input
											disabled
											enableCopyButton
											className="font-mono text-xs bg-background"
											value={
												databaseType === "postgres"
													? `psql "${externalUrl || ""}"`
													: databaseType === "mysql" || databaseType === "mariadb"
														? `mysql -h ${publicHost} -P ${externalPort} -u ${user} -p ${dbName}`
														: databaseType === "mongo"
															? `mongosh "${externalUrl || ""}"`
															: databaseType === "redis"
																? `redis-cli -h ${publicHost} -p ${externalPort} -a "${password}"`
																: `turso db shell "http://${publicHost}:${externalPort}" --auth-token "${password}"`
											}
										/>
									</div>
								</div>

								{/* Power user custom port option */}
								<div className="pt-1">
									{!isCustomPortOpen ? (
										<button
											type="button"
											onClick={() => setIsCustomPortOpen(true)}
											className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
										>
											Advanced: Change external port assignment
										</button>
									) : (
										<div className="flex items-center gap-3 p-3 bg-muted/30 border rounded-lg max-w-md">
											<div className="flex-1">
												<Label className="text-xs">Custom Port</Label>
												<Input
													placeholder={String(externalPort)}
													value={customPort}
													onChange={(e) => setCustomPort(e.target.value)}
													className="h-8 mt-1 text-xs"
												/>
											</div>
											<Button
												size="sm"
												onClick={() => {
													const parsed = Number.parseInt(customPort, 10);
													if (
														!Number.isNaN(parsed) &&
														parsed >= 1 &&
														parsed <= 65535
													) {
														handleEnableExternal(parsed);
														setIsCustomPortOpen(false);
													} else {
														toast.error("Please enter a valid port number");
													}
												}}
												isLoading={isEnabling}
												className="mt-5"
											>
												Save Port
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setIsCustomPortOpen(false)}
												className="mt-5 text-xs"
											>
												Cancel
											</Button>
										</div>
									)}
								</div>
							</div>
						)}
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
};

import { validateRequest } from "@dokploy/server/lib/auth";
import { brand } from "@paas/branding";
import { createServerSideHelpers } from "@trpc/react-query/server";
import copy from "copy-to-clipboard";
import { ExternalLink, Globe, HelpCircle, ServerOff } from "lucide-react";
import type {
	GetServerSidePropsContext,
	InferGetServerSidePropsType,
} from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import superjson from "superjson";
import { ShowClusterSettings } from "@/components/dashboard/application/advanced/cluster/show-cluster-settings";
import { AddCommand } from "@/components/dashboard/application/advanced/general/add-command";
import { ShowPorts } from "@/components/dashboard/application/advanced/ports/show-port";
import { ShowRedirects } from "@/components/dashboard/application/advanced/redirects/show-redirects";
import { ShowSecurity } from "@/components/dashboard/application/advanced/security/show-security";
import { ShowBuildServer } from "@/components/dashboard/application/advanced/show-build-server";
import { ShowResources } from "@/components/dashboard/application/advanced/show-resources";
import { RunContainerCommand } from "@/components/dashboard/application/advanced/general/run-container-command";
import { ShowVolumes } from "@/components/dashboard/application/advanced/volumes/show-volumes";
import { ShowDeployments } from "@/components/dashboard/application/deployments/show-deployments";
import { ShowDomains } from "@/components/dashboard/application/domains/show-domains";
import { ShowEnvironment } from "@/components/dashboard/application/environment/show";
import { ShowGeneralApplication } from "@/components/dashboard/application/general/show";
import { ShowIconSettings } from "@/components/dashboard/application/icon/show-icon-settings";
import { ShowDockerLogs } from "@/components/dashboard/application/logs/show";
import { ShowPatches } from "@/components/dashboard/application/patches/show-patches";
import { ShowPreviewDeployments } from "@/components/dashboard/application/preview-deployments/show-preview-deployments";
import { ShowSchedules } from "@/components/dashboard/application/schedules/show-schedules";
import { UpdateApplication } from "@/components/dashboard/application/update-application";
import { ShowVolumeBackups } from "@/components/dashboard/application/volume-backups/show-volume-backups";
import { DeleteService } from "@/components/dashboard/compose/delete-service";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ContainerPaidMonitoring } from "@/components/dashboard/monitoring/paid/container/show-paid-container-monitoring";
import { AssignNetworks } from "@/components/dashboard/networks/assign-networks";
import { TransferService } from "@/components/dashboard/shared/transfer-service";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { AdvanceBreadcrumb } from "@/components/shared/advance-breadcrumb";
import { StatusTooltip } from "@/components/shared/status-tooltip";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { UseKeyboardNav } from "@/hooks/use-keyboard-nav";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";
import { useWhitelabeling } from "@/utils/hooks/use-whitelabeling";

type TabState =
	| "general"
	| "environment"
	| "domains"
	| "resources"
	| "redirects"
	| "security"
	| "deployments"
	| "preview-deployments"
	| "storage"
	| "volume-backups"
	| "schedules"
	| "logs"
	| "patches"
	| "monitoring"
	| "advanced"
	| "projects"
	| "settings"
	| "icon";

const Service = (
	props: InferGetServerSidePropsType<typeof getServerSideProps>,
) => {
	const [_toggleMonitoring, _setToggleMonitoring] = useState(false);
	const { applicationId, activeTab } = props;
	const router = useRouter();
	const { projectId, environmentId } = router.query;
	const [tab, setTab] = useState<TabState>(activeTab);

	useEffect(() => {
		if (router.query.tab) {
			const requestedTab = router.query.tab as string;
			if (requestedTab === "volume-backups") {
				setTab("storage");
			} else {
				setTab(requestedTab as TabState);
			}
		}
	}, [router.query.tab]);

	const { data } = api.application.one.useQuery(
		{ applicationId },
		{
			refetchInterval: 5000,
		},
	);

	const { data: domains } = api.domain.byApplicationId.useQuery(
		{ applicationId },
		{
			enabled: !!applicationId,
		},
	);

	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { data: serverIp } = api.settings.getIp.useQuery();
	const { data: auth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean(
		(auth as any)?.user?.isPlatformAdmin || (auth as any)?.isPlatformAdmin,
	);
	const { data: permissions } = api.user.getPermissions.useQuery();

	const { data: environments } = api.environment.byProjectId.useQuery({
		projectId: data?.environment?.project?.projectId || "",
	});
	const { config: whitelabeling } = useWhitelabeling();
	const appName = whitelabeling?.appName || brand.APP_NAME;
	const environmentDropdownItems =
		environments?.map((env) => ({
			name: env.name,
			href: `/dashboard/project/${projectId}/environment/${env.environmentId}`,
		})) || [];

	const primaryDomain = domains?.[0];

	return (
		<div className="pb-10">
			<UseKeyboardNav forPage="application" />
			<AdvanceBreadcrumb />
			<Head>
				<title>
					Application: {data?.name} - {data?.environment.project.name} |{" "}
					{appName}
				</title>
			</Head>
			<div className="w-full">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl w-full">
					<div className="rounded-xl bg-background shadow-md ">
						<CardHeader className="flex flex-row justify-between items-center">
							<div className="flex flex-col">
								<CardTitle className="text-xl flex flex-row gap-2 items-center">
									<div className="relative flex flex-row gap-4 items-center">
										<ShowIconSettings
											serviceId={applicationId}
											serviceType="application"
											icon={data?.icon}
										/>
										<div className="absolute -right-1 -top-2 z-10">
											<StatusTooltip status={data?.applicationStatus} />
										</div>
									</div>
									{data?.name}
								</CardTitle>
								{data?.description && (
									<CardDescription>{data?.description}</CardDescription>
								)}

								{isPlatformAdmin && data?.appName && (
									<span className="text-sm text-muted-foreground font-mono">
										{data?.appName}
									</span>
								)}
							</div>
							<div className="flex flex-col h-fit w-fit gap-2">
								<div className="flex flex-row h-fit w-fit gap-2 flex-wrap items-center">
									{primaryDomain && (
										<Link
											href={`${primaryDomain.https ? "https" : "http"}://${primaryDomain.host}${primaryDomain.path || ""}`}
											target="_blank"
											rel="noopener noreferrer"
										>
											<Badge
												variant="outline"
												className="bg-primary/5 hover:bg-primary/10 text-primary border-primary/20 flex items-center gap-1.5 font-normal text-xs transition-colors cursor-pointer"
											>
												<Globe className="size-3.5" />
												{primaryDomain.host}
												<ExternalLink className="size-3" />
											</Badge>
										</Link>
									)}
									{isPlatformAdmin ? (
										<Badge
											className="cursor-pointer"
											onClick={() => {
												const ip = data?.server?.ipAddress || serverIp;
												if (ip) {
													copy(ip);
													toast.success("IP Address Copied!");
												}
											}}
											variant={
												!data?.serverId
													? "default"
													: data?.server?.serverStatus === "active"
														? "default"
														: "destructive"
											}
										>
											{data?.server?.name || "Primary Server"}
										</Badge>
									) : (
										<Badge
											variant="outline"
											className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-medium text-xs flex items-center gap-1.5"
										>
											<span className="size-1.5 rounded-full bg-emerald-500" />
											Cloud Runtime
										</Badge>
									)}
									{isPlatformAdmin && data?.server?.serverStatus === "inactive" && (
										<TooltipProvider delayDuration={0}>
											<Tooltip>
												<TooltipTrigger asChild>
													<Label className="break-all w-fit flex flex-row gap-1 items-center">
														<HelpCircle className="size-4 text-muted-foreground" />
													</Label>
												</TooltipTrigger>
												<TooltipContent
													className="z-999 w-[300px]"
													align="start"
													side="top"
												>
													<span>
														You cannot deploy this application because the
														server is inactive, please upgrade your plan to add
														more servers.
													</span>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									)}
								</div>

								<div className="flex flex-row gap-2 justify-end">
									{permissions?.service.create && (
										<UpdateApplication applicationId={applicationId} />
									)}
									{permissions?.service.create && (
										<TransferService
											id={applicationId}
											type="application"
											serverId={data?.serverId}
										/>
									)}
									{permissions?.service.delete && (
										<DeleteService id={applicationId} type="application" />
									)}
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-2 py-8 border-t">
							{data?.server?.serverStatus === "inactive" ? (
								<div className="flex h-[55vh] border-2 rounded-xl border-dashed p-4">
									<div className="max-w-3xl mx-auto flex flex-col items-center justify-center self-center gap-3">
										<ServerOff className="size-10 text-muted-foreground self-center" />
										<span className="text-center text-base text-muted-foreground">
											{isPlatformAdmin
												? `This service is hosted on the server ${data?.server?.name}, but this server has been disabled because your current plan doesn't include enough servers. Please purchase more servers to regain access to this application.`
												: "This service runtime is currently inactive. Please check your plan limits in Billing or contact support to reactivate your deployment resources."}
										</span>
										<span className="text-center text-base text-muted-foreground">
											Go to{" "}
											<Link
												href="/dashboard/settings/billing"
												className="text-primary"
											>
												Billing
											</Link>
										</span>
									</div>
								</div>
							) : (
								<Tabs
									value={tab}
									defaultValue="general"
									className="w-full"
									onValueChange={(e) => {
										setTab(e as TabState);
										const newPath = `/dashboard/project/${projectId}/environment/${environmentId}/services/application/${applicationId}?tab=${e}`;
										router.push(newPath);
									}}
								>
									<div className="flex flex-row items-center justify-between w-full overflow-auto">
										<TabsList className="flex gap-8 max-md:gap-4 justify-start">
											<TabsTrigger value="general">General</TabsTrigger>
											{permissions?.domain.read && (
												<TabsTrigger value="domains">Domains & HTTPS</TabsTrigger>
											)}
											<TabsTrigger value="resources">Resources</TabsTrigger>
											<TabsTrigger value="redirects">Redirects</TabsTrigger>
											<TabsTrigger value="security">Security</TabsTrigger>
											{permissions?.deployment.read && (
												<TabsTrigger value="deployments">
													Deployments
												</TabsTrigger>
											)}
											{permissions?.deployment.read && (
												<TabsTrigger value="preview-deployments">
													Preview Deployments
												</TabsTrigger>
											)}
											{(permissions?.volumeBackup.read || isPlatformAdmin) && (
												<TabsTrigger value="storage">
													Storage & Backups
												</TabsTrigger>
											)}
											{permissions?.envVars.read && (
												<TabsTrigger value="environment">
													Environment
												</TabsTrigger>
											)}
											{permissions?.logs.read && (
												<TabsTrigger value="logs">Logs</TabsTrigger>
											)}
											{permissions?.schedule.read && (
												<TabsTrigger value="schedules">Schedules</TabsTrigger>
											)}
											{data?.sourceType !== "docker" && (
												<TabsTrigger value="patches">Patches</TabsTrigger>
											)}
											{permissions?.monitoring.read &&
												((data?.serverId && isCloud) || !data?.server) && (
													<TabsTrigger value="monitoring">
														Monitoring
													</TabsTrigger>
												)}
											{permissions?.service.create && (
												<TabsTrigger value="advanced">
													Advanced Settings
												</TabsTrigger>
											)}
										</TabsList>
									</div>

									<TabsContent value="general">
										<div className="flex flex-col gap-4 pt-2.5">
											<ShowGeneralApplication applicationId={applicationId} />
										</div>
									</TabsContent>
									{permissions?.envVars.read && (
										<TabsContent value="environment">
											<div className="flex flex-col gap-4 pt-2.5">
												<ShowEnvironment applicationId={applicationId} />
											</div>
										</TabsContent>
									)}

									{permissions?.monitoring.read && (
										<TabsContent value="monitoring">
											<div className="pt-2.5">
												<div className="flex flex-col gap-4 border rounded-lg p-6">
													{data?.serverId && isCloud ? (
														<ContainerPaidMonitoring
															appName={data?.appName || ""}
															baseUrl={`${data?.serverId ? `http://${data?.server?.ipAddress}:${data?.server?.metricsConfig?.server?.port}` : "http://localhost:4500"}`}
															token={
																data?.server?.metricsConfig?.server?.token || ""
															}
														/>
													) : (
														<>
															{/* {monitoring?.enabledFeatures &&
															isCloud &&
															data?.serverId && (
																<div className="flex flex-row border w-fit p-4 rounded-lg items-center gap-2">
																	<Label className="text-muted-foreground">
																		Change Monitoring
																	</Label>
																	<Switch
																		checked={toggleMonitoring}
																		onCheckedChange={setToggleMonitoring}
																	/>
																</div>
															)} */}

															{/* {toggleMonitoring ? (
															<ContainerPaidMonitoring
																appName={data?.appName || ""}
																baseUrl={`http://${monitoring?.serverIp}:${monitoring?.metricsConfig?.server?.port}`}
																token={
																	monitoring?.metricsConfig?.server?.token || ""
																}
															/>
														) : ( */}
															<div>
																<ContainerFreeMonitoring
																	appName={data?.appName || ""}
																/>
															</div>
															{/* )} */}
														</>
													)}
												</div>
											</div>
										</TabsContent>
									)}

									{permissions?.logs.read && (
										<TabsContent value="logs">
											<div className="flex flex-col gap-4 pt-2.5">
												<ShowDockerLogs
													appName={data?.appName || ""}
													serverId={data?.serverId || ""}
													serviceId={data?.applicationId}
												/>
											</div>
										</TabsContent>
									)}
									{permissions?.schedule.read && (
										<TabsContent value="schedules">
											<div className="flex flex-col gap-4 pt-2.5">
												<ShowSchedules
													id={applicationId}
													scheduleType="application"
												/>
											</div>
										</TabsContent>
									)}
									{permissions?.deployment.read && (
										<TabsContent value="deployments" className="w-full pt-2.5">
											<div className="flex flex-col gap-4 ">
												<ShowDeployments
													id={applicationId}
													type="application"
													serverId={data?.serverId || ""}
													refreshToken={data?.refreshToken || ""}
												/>
											</div>
										</TabsContent>
									)}
									<TabsContent value="resources" className="w-full pt-2.5">
										<div className="flex flex-col gap-4">
											<ShowResources id={applicationId} type="application" />
										</div>
									</TabsContent>
									<TabsContent value="redirects" className="w-full pt-2.5">
										<div className="flex flex-col gap-4">
											<ShowRedirects applicationId={applicationId} />
										</div>
									</TabsContent>
									<TabsContent value="security" className="w-full pt-2.5">
										<div className="flex flex-col gap-4">
											<ShowSecurity applicationId={applicationId} />
										</div>
									</TabsContent>
									{(permissions?.volumeBackup.read || isPlatformAdmin) && (
										<TabsContent
											value="storage"
											className="w-full pt-2.5"
										>
											<div className="flex flex-col gap-6">
												{isPlatformAdmin && (
													<ShowVolumes id={applicationId} type="application" />
												)}
												{permissions?.volumeBackup.read && (
													<ShowVolumeBackups
														id={applicationId}
														type="application"
														serverId={data?.serverId || ""}
													/>
												)}
											</div>
										</TabsContent>
									)}
									{permissions?.deployment.read && (
										<TabsContent value="preview-deployments" className="w-full">
											<div className="flex flex-col gap-4 pt-2.5">
												<ShowPreviewDeployments applicationId={applicationId} />
											</div>
										</TabsContent>
									)}
									{permissions?.domain.read && (
										<TabsContent value="domains" className="w-full">
											<div className="flex flex-col gap-4 pt-2.5">
												<ShowDomains id={applicationId} type="application" />
											</div>
										</TabsContent>
									)}
									<TabsContent value="patches" className="w-full">
										<div className="flex flex-col gap-4 pt-2.5">
											<ShowPatches id={applicationId} type="application" />
										</div>
									</TabsContent>
									{permissions?.service.create && (
										<TabsContent value="advanced">
											<div className="flex flex-col gap-6 pt-2.5">
												<RunContainerCommand applicationId={applicationId} />
												<AddCommand applicationId={applicationId} />
												<ShowPorts applicationId={applicationId} />
												{isPlatformAdmin && (
													<ShowClusterSettings
														id={applicationId}
														type="application"
													/>
												)}
												{isPlatformAdmin && (
													<ShowBuildServer applicationId={applicationId} />
												)}
												{isPlatformAdmin && (
													<AssignNetworks id={applicationId} type="application" />
												)}
											</div>
										</TabsContent>
									)}
								</Tabs>
							)}
						</CardContent>
					</div>
				</Card>
			</div>
		</div>
	);
};

export default Service;
Service.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{
		applicationId: string;
		activeTab: TabState;
		environmentId: string;
	}>,
) {
	const { query, params, req, res } = ctx;

	const activeTab = query.tab;
	const { user, session } = await validateRequest(req);
	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}
	// Fetch data from external API
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

	// Valid project, if not return to initial homepage....
	if (typeof params?.applicationId === "string") {
		try {
			await helpers.application.one.fetch({
				applicationId: params?.applicationId,
			});

			await helpers.settings.isCloud.prefetch();

			return {
				props: {
					trpcState: helpers.dehydrate(),
					applicationId: params?.applicationId,
					activeTab: (activeTab || "general") as TabState,
					environmentId: params?.environmentId,
				},
			};
		} catch {
			return {
				redirect: {
					permanent: false,
					destination: "/dashboard/home",
				},
			};
		}
	}

	return {
		redirect: {
			permanent: false,
			destination: "/",
		},
	};
}

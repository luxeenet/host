import { formatDate } from "date-fns";
import {
	ExternalLinkIcon,
	GitBranch,
	ImportIcon,
	Loader2,
	Trash2,
	Users,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
	BitbucketIcon,
	GiteaIcon,
	GithubIcon,
	GitlabIcon,
} from "@/components/icons/data-tools-icons";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/utils/api";
import { DEFAULT_GITHUB_URL } from "@/utils/github-utils";
import { useUrl } from "@/utils/hooks/use-url";
import { AddBitbucketProvider } from "./bitbucket/add-bitbucket-provider";
import { EditBitbucketProvider } from "./bitbucket/edit-bitbucket-provider";
import { AddGiteaProvider } from "./gitea/add-gitea-provider";
import { EditGiteaProvider } from "./gitea/edit-gitea-provider";
import { AddGithubProvider } from "./github/add-github-provider";
import { EditGithubProvider } from "./github/edit-github-provider";
import { AddGitlabProvider } from "./gitlab/add-gitlab-provider";
import { EditGitlabProvider } from "./gitlab/edit-gitlab-provider";

export const ShowGitProviders = () => {
	const { data, isPending, refetch } = api.gitProvider.getAll.useQuery();
	const { data: availability } = api.integration.availability.useQuery();
	const { data: installInfo } = api.github.getInstallationUrl.useQuery(undefined, {
		retry: false,
	});
	const { mutateAsync, isPending: isRemoving } =
		api.gitProvider.remove.useMutation();
	const { mutateAsync: toggleShare, isPending: isToggling } =
		api.gitProvider.toggleShare.useMutation();
	const { data: currentMember } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const url = useUrl();
	const isOrgAdmin =
		currentMember?.role === "owner" || currentMember?.role === "admin";

	const isProviderAvailable = (providerId: string) => {
		if (!availability) return false;
		const item = availability.find((a) => a.id === providerId);
		return item ? item.available : false;
	};

	const githubIntegration = availability?.find((a) => a.id === "github");
	const isGithubAvailable = isProviderAvailable("github");
	const isGitlabAvailable = isProviderAvailable("gitlab");
	const isBitbucketAvailable = isProviderAvailable("bitbucket");
	const isGiteaAvailable = isProviderAvailable("gitea");
	const hasAnyProviderEnabled =
		isGithubAvailable || isGitlabAvailable || isBitbucketAvailable || isGiteaAvailable;

	const getGitlabUrl = (
		clientId: string,
		gitlabId: string,
		gitlabUrl: string,
	) => {
		const redirectUri = `${url}/api/providers/gitlab/callback?gitlabId=${gitlabId}`;
		const scope = "api read_user read_repository";
		const authUrl = `${gitlabUrl}/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scopes=${encodeURIComponent(scope)}`;
		return authUrl;
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl w-full">
				<div className="rounded-xl bg-background shadow-md ">
					<CardHeader className="">
						<CardTitle className="text-xl flex flex-row gap-2">
							<GitBranch className="size-6 text-muted-foreground self-center" />
							Git Providers
						</CardTitle>
						<CardDescription>
							Connect your Git provider for authentication.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 py-8 border-t">
						{isPending ? (
							<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[25vh]">
								<span>Loading...</span>
								<Loader2 className="animate-spin size-4" />
							</div>
						) : (
							<>
								{data?.length === 0 ? (
									<div className="flex flex-col items-center gap-4 min-h-[25vh] justify-center text-center max-w-lg mx-auto py-8">
										<GitBranch className="size-10 self-center text-muted-foreground" />
										
										{!hasAnyProviderEnabled && availability && availability.length > 0 ? (
											<div className="space-y-1">
												<h4 className="text-base font-semibold">Git Providers Unavailable</h4>
												<p className="text-sm text-muted-foreground">
													Git provider integrations have been disabled by the HatDot platform administrator.
												</p>
											</div>
										) : isGithubAvailable && installInfo?.url ? (
											<div className="space-y-3">
												<div className="space-y-1">
													<h4 className="text-base font-semibold">Connect GitHub Account</h4>
													<p className="text-sm text-muted-foreground">
														Connect your GitHub account or organization through the official HatDot GitHub App to select repositories and automate deployments.
													</p>
												</div>
												<Button asChild size="default" className="mt-2">
													<Link href={installInfo.url} target="_blank">
														<GithubIcon className="size-4 mr-2" />
														Install HatDot GitHub App
													</Link>
												</Button>
											</div>
										) : isGithubAvailable && !installInfo?.url ? (
											<div className="space-y-2">
												<h4 className="text-base font-semibold">GitHub Platform App Not Configured</h4>
												<p className="text-sm text-muted-foreground">
													GitHub integration is enabled, but the platform GitHub App credentials or App Slug have not been configured by the administrator.
												</p>
												{isOrgAdmin && (
													<Button variant="outline" asChild size="sm">
														<Link href="/dashboard/settings/integrations">
															Configure in Platform Integrations
														</Link>
													</Button>
												)}
											</div>
										) : (
											<div className="space-y-1">
												<h4 className="text-base font-semibold">No Connected Providers</h4>
												<p className="text-sm text-muted-foreground">
													No Git provider accounts have been connected yet.
												</p>
											</div>
										)}

										{permissions?.gitProviders.create && isOrgAdmin && (
											<div className="w-full pt-4 border-t mt-2">
												<span className="text-xs text-muted-foreground block mb-2">
													Custom Organization Provider Setup:
												</span>
												<div className="flex flex-wrap items-center justify-center gap-3">
													{isGithubAvailable && <AddGithubProvider />}
													{isGitlabAvailable && <AddGitlabProvider />}
													{isBitbucketAvailable && <AddBitbucketProvider />}
													{isGiteaAvailable && <AddGiteaProvider />}
												</div>
											</div>
										)}
									</div>
								) : (
									<div className="flex flex-col gap-4 min-h-[25vh]">
										<div className="flex flex-col gap-2 rounded-lg ">
											<div className="flex items-center justify-between">
												<span className="text-base font-medium">
													Connected Providers
												</span>
												{isGithubAvailable && installInfo?.url && (
													<Button asChild size="sm" variant="outline">
														<Link href={installInfo.url} target="_blank">
															<GithubIcon className="size-4 mr-2" />
															Connect Another Account
														</Link>
													</Button>
												)}
											</div>
											{permissions?.gitProviders.create && isOrgAdmin && (
												<div className="flex items-center bg-sidebar p-1 w-full rounded-lg">
													<div className="flex flex-wrap items-center gap-4 p-3.5 rounded-lg bg-background border w-full [&>button]:grow">
														{isGithubAvailable && <AddGithubProvider />}
														{isGitlabAvailable && <AddGitlabProvider />}
														{isBitbucketAvailable && <AddBitbucketProvider />}
														{isGiteaAvailable && <AddGiteaProvider />}
													</div>
												</div>
											)}
										</div>

										<div className="flex flex-col gap-4 rounded-lg ">
											{data?.map((gitProvider, _index) => {
												const isGithub = gitProvider.providerType === "github";
												const isGitlab = gitProvider.providerType === "gitlab";
												const isBitbucket =
													gitProvider.providerType === "bitbucket";
												const isGitea = gitProvider.providerType === "gitea";
												const canManage = gitProvider.isOwner || isOrgAdmin;

												const haveGithubRequirements =
													isGithub && gitProvider.github?.isConfigured;

												const haveGitlabRequirements =
													isGitlab && gitProvider.gitlab?.isConfigured;

												return (
													<div
														key={gitProvider.gitProviderId}
														className="flex items-center justify-between bg-sidebar p-1 w-full rounded-lg"
													>
														<div className="flex items-center justify-between p-3.5 rounded-lg bg-background border w-full">
															<div className="flex flex-col items-center justify-between">
																<div className="flex gap-2 flex-row items-center">
																	{isGithub && (
																		<GithubIcon className="size-5" />
																	)}
																	{isGitlab && (
																		<GitlabIcon className="size-5" />
																	)}
																	{isBitbucket && (
																		<BitbucketIcon className="size-5" />
																	)}
																	{isGitea && <GiteaIcon className="size-5" />}
																	<div className="flex flex-col gap-1">
																		<span className="text-sm font-medium">
																			{gitProvider.name}
																		</span>
																		{isGithub &&
																			gitProvider.github?.githubUrl &&
																			gitProvider.github.githubUrl !==
																				DEFAULT_GITHUB_URL && (
																				<span className="text-xs text-muted-foreground">
																					{gitProvider.github.githubUrl}
																				</span>
																			)}
																		<span className="text-xs text-muted-foreground">
																			{formatDate(
																				gitProvider.createdAt,
																				"yyyy-MM-dd hh:mm:ss a",
																			)}
																		</span>
																	</div>
																	{!gitProvider.isOwner && (
																		<Badge
																			variant="secondary"
																			className="text-xs"
																		>
																			<Users className="size-3 mr-1" />
																			Shared
																		</Badge>
																	)}
																</div>
															</div>

															<div className="flex flex-row gap-1 items-center">
																{gitProvider.isOwner && (
																	<TooltipProvider delayDuration={0}>
																		<Tooltip>
																			<TooltipTrigger asChild>
																				<div className="flex items-center gap-1.5 mr-2">
																					<Users className="size-4 text-muted-foreground" />
																					<Switch
																						disabled={isToggling}
																						checked={
																							gitProvider.sharedWithOrganization
																						}
																						onCheckedChange={async (
																							checked,
																						) => {
																							await toggleShare({
																								gitProviderId:
																									gitProvider.gitProviderId,
																								sharedWithOrganization: checked,
																							})
																								.then(() => {
																									toast.success(
																										checked
																											? "Provider shared with organization"
																											: "Provider unshared",
																									);
																									refetch();
																								})
																								.catch(() => {
																									toast.error(
																										"Error updating sharing",
																									);
																								});
																						}}
																					/>
																				</div>
																			</TooltipTrigger>
																			<TooltipContent>
																				Share with entire organization
																			</TooltipContent>
																		</Tooltip>
																	</TooltipProvider>
																)}

																{isBitbucket &&
																gitProvider.bitbucket?.isDeprecated ? (
																	<Badge variant="yellow">Deprecated</Badge>
																) : null}

																{!haveGithubRequirements && isGithub && (
																	<div className="flex flex-row gap-1 items-center">
																		<Badge
																			variant="outline"
																			className="text-xs"
																		>
																			Action Required
																		</Badge>
																		<Link
																			href={
																				installInfo?.url ||
																				`${gitProvider?.github?.githubAppName}/installations/new?state=gh_setup:${gitProvider?.github?.githubId}`
																			}
																			className={buttonVariants({
																				size: "icon",
																				variant: "ghost",
																			})}
																		>
																			<ImportIcon className="size-4 text-primary" />
																		</Link>
																	</div>
																)}
																{haveGithubRequirements && isGithub && (
																	<div className="flex flex-col gap-1">
																		<Link
																			href={`${gitProvider?.github?.githubAppName}`}
																			target="_blank"
																			className={buttonVariants({
																				size: "icon",
																				variant: "ghost",
																			})}
																		>
																			<ExternalLinkIcon className="size-4 text-primary" />
																		</Link>
																	</div>
																)}
																{!haveGitlabRequirements && isGitlab && (
																	<div className="flex flex-row gap-1 items-center">
																		<Badge
																			variant="outline"
																			className="text-xs"
																		>
																			Action Required
																		</Badge>
																		<Link
																			href={getGitlabUrl(
																				gitProvider.gitlab?.applicationId || "",
																				gitProvider.gitlab?.gitlabId || "",
																				gitProvider.gitlab?.gitlabUrl || "",
																			)}
																			target="_blank"
																			className={buttonVariants({
																				size: "icon",
																				variant: "ghost",
																			})}
																		>
																			<ImportIcon className="size-4 text-primary" />
																		</Link>
																	</div>
																)}

																{canManage && (
																	<>
																		{isGithub &&
																			haveGithubRequirements &&
																			gitProvider.github?.githubId && (
																				<EditGithubProvider
																					githubId={gitProvider.github.githubId}
																				/>
																			)}

																		{isGitlab &&
																			gitProvider.gitlab?.gitlabId && (
																				<EditGitlabProvider
																					gitlabId={gitProvider.gitlab.gitlabId}
																				/>
																			)}

																		{isBitbucket &&
																			gitProvider.bitbucket?.bitbucketId && (
																				<EditBitbucketProvider
																					bitbucketId={
																						gitProvider.bitbucket.bitbucketId
																					}
																				/>
																			)}

																		{isGitea && gitProvider.gitea?.giteaId && (
																			<EditGiteaProvider
																				giteaId={gitProvider.gitea.giteaId}
																			/>
																		)}

																		<DialogAction
																			title="Delete Git Provider"
																			description={
																				gitProvider.sharedWithOrganization
																					? "This provider is shared with the organization. Deleting it will remove access for all members. Are you sure?"
																					: "Are you sure you want to delete this Git Provider?"
																			}
																			type="destructive"
																			onClick={async () => {
																				await mutateAsync({
																					gitProviderId:
																						gitProvider.gitProviderId,
																				})
																					.then(() => {
																						toast.success(
																							"Git Provider deleted successfully",
																						);
																						refetch();
																					})
																					.catch(() => {
																						toast.error(
																							"Error deleting Git Provider",
																						);
																					});
																			}}
																		>
																			<Button
																				variant="ghost"
																				size="icon"
																				className="group hover:bg-red-500/10"
																				isLoading={isRemoving}
																			>
																				<Trash2 className="size-4 text-primary group-hover:text-red-500" />
																			</Button>
																		</DialogAction>
																	</>
																)}
															</div>
														</div>
													</div>
												);
											})}
										</div>

										<div className="flex flex-row gap-2 flex-wrap w-full justify-end mr-4">
											{/* <AddCertificate /> */}
										</div>
									</div>
								)}
							</>
						)}
					</CardContent>
				</div>
			</Card>
		</div>
	);
};

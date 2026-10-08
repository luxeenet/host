import { GitBranch, Loader2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { SaveDockerProvider } from "@/components/dashboard/application/general/generic/save-docker-provider";
import { SaveGitProvider } from "@/components/dashboard/application/general/generic/save-git-provider";
import { SaveGiteaProvider } from "@/components/dashboard/application/general/generic/save-gitea-provider";
import { SaveGithubProvider } from "@/components/dashboard/application/general/generic/save-github-provider";
import {
	BitbucketIcon,
	DockerIcon,
	GiteaIcon,
	GithubIcon,
	GitIcon,
	GitlabIcon,
} from "@/components/icons/data-tools-icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/utils/api";
import { AddBitbucketProvider } from "@/components/dashboard/settings/git/bitbucket/add-bitbucket-provider";
import { AddGiteaProvider } from "@/components/dashboard/settings/git/gitea/add-gitea-provider";
import { AddGithubProvider } from "@/components/dashboard/settings/git/github/add-github-provider";
import { AddGitlabProvider } from "@/components/dashboard/settings/git/gitlab/add-gitlab-provider";
import { Button } from "@/components/ui/button";
import { SaveBitbucketProvider } from "./save-bitbucket-provider";
import { SaveDragNDrop } from "./save-drag-n-drop";
import { SaveGitlabProvider } from "./save-gitlab-provider";
import { UnauthorizedGitProvider } from "./unauthorized-git-provider";

type TabState =
	| "github"
	| "docker"
	| "git"
	| "drop"
	| "gitlab"
	| "bitbucket"
	| "gitea";

interface Props {
	applicationId: string;
}

export const ShowProviderForm = ({ applicationId }: Props) => {
	const { data: githubProviders, isPending: isLoadingGithub } =
		api.github.githubProviders.useQuery();
	const { data: gitlabProviders, isPending: isLoadingGitlab } =
		api.gitlab.gitlabProviders.useQuery();
	const { data: bitbucketProviders, isPending: isLoadingBitbucket } =
		api.bitbucket.bitbucketProviders.useQuery();
	const { data: giteaProviders, isPending: isLoadingGitea } =
		api.gitea.giteaProviders.useQuery();

	const { data: application, refetch } = api.application.one.useQuery({
		applicationId,
	});
	const { mutateAsync: disconnectGitProvider } =
		api.application.disconnectGitProvider.useMutation();

	const [tab, setSab] = useState<TabState>(application?.sourceType || "github");

	const isLoading =
		isLoadingGithub || isLoadingGitlab || isLoadingBitbucket || isLoadingGitea;

	const handleDisconnect = async () => {
		try {
			await disconnectGitProvider({ applicationId });
			toast.success("Repository disconnected successfully");
			await refetch();
		} catch (error) {
			toast.error(
				`Failed to disconnect repository: ${error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}
	};

	if (isLoading) {
		return (
			<Card className="group relative w-full bg-transparent">
				<CardHeader>
					<CardTitle className="flex items-start justify-between">
						<div className="flex flex-col gap-2">
							<span className="flex flex-col space-y-0.5">Provider</span>
							<p className="flex items-center text-sm font-normal text-muted-foreground">
								Select the source of your code
							</p>
						</div>
						<div className="hidden space-y-1 text-sm font-normal md:block">
							<GitBranch className="size-6 text-muted-foreground" />
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex min-h-[25vh] items-center justify-center">
						<div className="flex items-center gap-2 text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>Loading providers...</span>
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	// Check if user doesn't have access to the current git provider
	if (
		application &&
		!application.hasGitProviderAccess &&
		application.sourceType !== "docker" &&
		application.sourceType !== "drop"
	) {
		return (
			<Card className="group relative w-full bg-transparent">
				<CardHeader>
					<CardTitle className="flex items-start justify-between">
						<div className="flex flex-col gap-2">
							<span className="flex flex-col space-y-0.5">Provider</span>
							<p className="flex items-center text-sm font-normal text-muted-foreground">
								Repository connection through unauthorized provider
							</p>
						</div>
						<div className="hidden space-y-1 text-sm font-normal md:block">
							<GitBranch className="size-6 text-muted-foreground" />
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<UnauthorizedGitProvider
						service={application}
						onDisconnect={handleDisconnect}
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="group relative w-full bg-transparent">
			<CardHeader>
				<CardTitle className="flex items-start justify-between">
					<div className="flex flex-col gap-2">
						<span className="flex flex-col space-y-0.5">Provider</span>
						<p className="flex items-center text-sm font-normal text-muted-foreground">
							Select the source of your code
						</p>
					</div>
					<div className="hidden space-y-1 text-sm font-normal md:block">
						<GitBranch className="size-6 text-muted-foreground" />
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<Tabs
					value={tab}
					className="w-full"
					onValueChange={(e) => {
						setSab(e as TabState);
					}}
				>
					<div className="flex flex-row items-center justify-between w-full overflow-auto">
						<TabsList
							variant="line"
							className="flex gap-4 justify-start bg-transparent"
						>
							<TabsTrigger
								value="github"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GithubIcon className="size-4 text-current fill-current" />
								Github
							</TabsTrigger>
							<TabsTrigger
								value="gitlab"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GitlabIcon className="size-4 text-current fill-current" />
								Gitlab
							</TabsTrigger>
							<TabsTrigger
								value="bitbucket"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<BitbucketIcon className="size-4 text-current fill-current" />
								Bitbucket
							</TabsTrigger>
							<TabsTrigger
								value="gitea"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GiteaIcon className="size-4 text-current fill-current" />
								Gitea
							</TabsTrigger>
							<TabsTrigger
								value="docker"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<DockerIcon className="size-5 text-current" />
								Docker
							</TabsTrigger>
							<TabsTrigger
								value="git"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GitIcon />
								Git
							</TabsTrigger>
							<TabsTrigger
								value="drop"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<UploadCloud className="size-5 text-current" />
								Drop
							</TabsTrigger>
						</TabsList>
					</div>

					<TabsContent value="github" className="w-full p-2">
						{githubProviders && githubProviders?.length > 0 ? (
							<SaveGithubProvider applicationId={applicationId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GithubIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">GitHub Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your GitHub account or organization to select repositories and configure automated branch deployments.
									</p>
								</div>
								<div className="flex items-center gap-3">
									<AddGithubProvider />
									<Button variant="outline" asChild size="sm">
										<Link href="/dashboard/settings/git-providers">
											Manage Providers
										</Link>
									</Button>
								</div>
							</div>
						)}
					</TabsContent>
					<TabsContent value="gitlab" className="w-full p-2">
						{gitlabProviders && gitlabProviders?.length > 0 ? (
							<SaveGitlabProvider applicationId={applicationId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GitlabIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">GitLab Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your GitLab account or self-hosted instance to deploy from GitLab repositories.
									</p>
								</div>
								<div className="flex items-center gap-3">
									<AddGitlabProvider />
									<Button variant="outline" asChild size="sm">
										<Link href="/dashboard/settings/git-providers">
											Manage Providers
										</Link>
									</Button>
								</div>
							</div>
						)}
					</TabsContent>
					<TabsContent value="bitbucket" className="w-full p-2">
						{bitbucketProviders && bitbucketProviders?.length > 0 ? (
							<SaveBitbucketProvider applicationId={applicationId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<BitbucketIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">Bitbucket Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your Bitbucket account to deploy from Bitbucket repositories.
									</p>
								</div>
								<div className="flex items-center gap-3">
									<AddBitbucketProvider />
									<Button variant="outline" asChild size="sm">
										<Link href="/dashboard/settings/git-providers">
											Manage Providers
										</Link>
									</Button>
								</div>
							</div>
						)}
					</TabsContent>
					<TabsContent value="gitea" className="w-full p-2">
						{giteaProviders && giteaProviders?.length > 0 ? (
							<SaveGiteaProvider applicationId={applicationId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GiteaIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">Gitea Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your Gitea or Forgejo instance to deploy from Gitea repositories.
									</p>
								</div>
								<div className="flex items-center gap-3">
									<AddGiteaProvider />
									<Button variant="outline" asChild size="sm">
										<Link href="/dashboard/settings/git-providers">
											Manage Providers
										</Link>
									</Button>
								</div>
							</div>
						)}
					</TabsContent>
					<TabsContent value="docker" className="w-full p-2">
						<SaveDockerProvider applicationId={applicationId} />
					</TabsContent>

					<TabsContent value="git" className="w-full p-2">
						<SaveGitProvider applicationId={applicationId} />
					</TabsContent>
					<TabsContent value="drop" className="w-full p-2">
						<SaveDragNDrop applicationId={applicationId} />
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
};

import { CodeIcon, GitBranch, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UnauthorizedGitProvider } from "@/components/dashboard/application/general/generic/unauthorized-git-provider";
import {
	BitbucketIcon,
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
import { ComposeFileEditor } from "../compose-file-editor";
import { ShowConvertedCompose } from "../show-converted-compose";
import { SaveBitbucketProviderCompose } from "./save-bitbucket-provider-compose";
import { SaveGitProviderCompose } from "./save-git-provider-compose";
import { SaveGiteaProviderCompose } from "./save-gitea-provider-compose";
import { SaveGithubProviderCompose } from "./save-github-provider-compose";
import { SaveGitlabProviderCompose } from "./save-gitlab-provider-compose";

type TabState = "github" | "git" | "raw" | "gitlab" | "bitbucket" | "gitea";
interface Props {
	composeId: string;
}

export const ShowProviderFormCompose = ({ composeId }: Props) => {
	const { data: githubProviders, isPending: isLoadingGithub } =
		api.github.githubProviders.useQuery();
	const { data: gitlabProviders, isPending: isLoadingGitlab } =
		api.gitlab.gitlabProviders.useQuery();
	const { data: bitbucketProviders, isPending: isLoadingBitbucket } =
		api.bitbucket.bitbucketProviders.useQuery();
	const { data: giteaProviders, isPending: isLoadingGitea } =
		api.gitea.giteaProviders.useQuery();

	const { mutateAsync: disconnectGitProvider } =
		api.compose.disconnectGitProvider.useMutation();

	const { data: compose, refetch } = api.compose.one.useQuery({ composeId });
	const [tab, setSab] = useState<TabState>(compose?.sourceType || "github");

	const isLoading =
		isLoadingGithub || isLoadingGitlab || isLoadingBitbucket || isLoadingGitea;

	const handleDisconnect = async () => {
		try {
			await disconnectGitProvider({ composeId });
			toast.success("Repository disconnected successfully");
			await refetch();
		} catch (error) {
			toast.error(
				`Failed to disconnect repository: ${
					error instanceof Error ? error.message : "Unknown error"
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
		compose &&
		!compose.hasGitProviderAccess &&
		compose.sourceType !== "raw"
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
						service={compose}
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
					<div className="hidden space-y-1 text-sm font-normal md:flex flex-row items-center gap-2">
						<ShowConvertedCompose composeId={composeId} />
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
								GitHub
							</TabsTrigger>
							<TabsTrigger
								value="gitlab"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GitlabIcon className="size-4 text-current fill-current" />
								GitLab
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
								<GiteaIcon className="size-4 text-current fill-current" /> Gitea
							</TabsTrigger>
							<TabsTrigger
								value="git"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<GitIcon />
								Git
							</TabsTrigger>
							<TabsTrigger
								value="raw"
								className="rounded-none border-b-2 gap-2 border-b-transparent data-[state=active]:border-b-2 data-[state=active]:border-b-border"
							>
								<CodeIcon className="size-4" />
								Raw
							</TabsTrigger>
						</TabsList>
					</div>

					<TabsContent value="github" className="w-full p-2">
						{githubProviders && githubProviders?.length > 0 ? (
							<SaveGithubProviderCompose composeId={composeId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GithubIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">GitHub Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your GitHub account to select Compose repositories.
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
							<SaveGitlabProviderCompose composeId={composeId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GitlabIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">GitLab Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your GitLab account to select Compose repositories.
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
							<SaveBitbucketProviderCompose composeId={composeId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<BitbucketIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">Bitbucket Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your Bitbucket account to select Compose repositories.
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
							<SaveGiteaProviderCompose composeId={composeId} />
						) : (
							<div className="flex flex-col items-center gap-4 py-8 px-4 text-center justify-center border border-dashed rounded-lg bg-card/50">
								<GiteaIcon className="size-10 text-muted-foreground" />
								<div className="space-y-1 max-w-md">
									<h4 className="text-sm font-semibold">Gitea Not Connected</h4>
									<p className="text-xs text-muted-foreground">
										Connect your Gitea instance to select Compose repositories.
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
					<TabsContent value="git" className="w-full p-2">
						<SaveGitProviderCompose composeId={composeId} />
					</TabsContent>

					<TabsContent value="raw" className="w-full p-2 flex flex-col gap-4">
						<ComposeFileEditor composeId={composeId} />
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
};

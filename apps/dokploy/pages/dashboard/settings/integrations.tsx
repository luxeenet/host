import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import type { ReactElement } from "react";
import { useState, useEffect } from "react";
import superjson from "superjson";
import { toast } from "sonner";
import {
	Boxes,
	CheckCircle2,
	XCircle,
	AlertTriangle,
	RefreshCw,
	Loader2,
	Save,
	ShieldCheck,
} from "lucide-react";

import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { brand } from "@paas/branding";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";
import { requirePlatformAdminSession } from "@/utils/server-auth-guards";
import type { IntegrationId, IntegrationState } from "@dokploy/server";

const PROVIDER_METADATA: Record<
	IntegrationId,
	{ title: string; category: string; description: string }
> = {
	github: {
		title: "GitHub",
		category: "Git & Deployment",
		description:
			"Configure GitHub App integration for customer repository browsing, OAuth setup, and webhooks.",
	},
	gitlab: {
		title: "GitLab",
		category: "Git & Deployment",
		description:
			"Configure GitLab OAuth application and API integration for self-hosted or gitlab.com repositories.",
	},
	bitbucket: {
		title: "Bitbucket",
		category: "Git & Deployment",
		description:
			"Configure Bitbucket Cloud workspace and App Password credentials.",
	},
	gitea: {
		title: "Gitea",
		category: "Git & Deployment",
		description:
			"Configure self-hosted Gitea OAuth application and API integration.",
	},
	docker: {
		title: "Docker Registry",
		category: "Container Images",
		description:
			"Control permitted container registries and credentials for customer image deployments.",
	},
	git: {
		title: "Raw Git",
		category: "Git & Deployment",
		description:
			"Enable or restrict generic Git repository URLs (HTTPS/SSH) and allowed hostnames.",
	},
	drop: {
		title: "Drop / Direct Upload",
		category: "Direct Deployments",
		description:
			"Allow or disallow customer ZIP archive drag-and-drop deployments and set upload limits.",
	},
};

interface FormStateItem {
	enabled: boolean;
	config: Record<string, any>;
	secretPatch: Record<string, string>;
}

export default function IntegrationsSettingsPage() {
	const utils = api.useUtils();
	const { data: integrations, isLoading } =
		api.integration.adminList.useQuery();

	const { mutateAsync: setEnabled, isPending: isToggling } =
		api.integration.adminSetEnabled.useMutation({
			onSuccess: () => {
				utils.integration.adminList.invalidate();
				utils.integration.availability.invalidate();
			},
		});

	const { mutateAsync: saveConfig, isPending: isSaving } =
		api.integration.adminSave.useMutation({
			onSuccess: () => {
				utils.integration.adminList.invalidate();
				utils.integration.availability.invalidate();
				toast.success("Integration settings saved successfully.");
			},
			onError: (err) => {
				toast.error(err.message || "Failed to save settings");
			},
		});

	const { mutateAsync: testIntegration, isPending: isTesting } =
		api.integration.adminTest.useMutation({
			onSuccess: (res) => {
				utils.integration.adminList.invalidate();
				if (res.result.status === "verified") {
					toast.success(res.result.message || "Connection test succeeded!");
				} else {
					toast.error(res.result.message || "Connection test failed.");
				}
			},
			onError: (err) => {
				toast.error(err.message || "Test failed with an error.");
			},
		});

	const [activeTab, setActiveTab] = useState<IntegrationId>("github");
	const [formStates, setFormStates] = useState<Record<string, FormStateItem>>(
		{},
	);

	// Initialize form states when integrations load
	useEffect(() => {
		if (!integrations) return;
		const next: Record<string, FormStateItem> = {};
		for (const item of integrations) {
			next[item.id] = {
				enabled: item.enabled,
				config: { ...(item.config || {}) },
				secretPatch: {},
			};
		}
		setFormStates(next);
	}, [integrations]);

	const currentItem = integrations?.find((i) => i.id === activeTab);
	const currentForm: FormStateItem = formStates[activeTab] || {
		enabled: currentItem?.enabled ?? true,
		config: currentItem?.config || {},
		secretPatch: {},
	};

	const updateConfigField = (key: string, value: any) => {
		setFormStates((prev) => {
			const current = prev[activeTab] || {
				enabled: currentItem?.enabled ?? true,
				config: {},
				secretPatch: {},
			};
			return {
				...prev,
				[activeTab]: {
					...current,
					config: {
						...current.config,
						[key]: value,
					},
				},
			};
		});
	};

	const updateSecretField = (key: string, value: string) => {
		setFormStates((prev) => {
			const current = prev[activeTab] || {
				enabled: currentItem?.enabled ?? true,
				config: {},
				secretPatch: {},
			};
			return {
				...prev,
				[activeTab]: {
					...current,
					secretPatch: {
						...current.secretPatch,
						[key]: value,
					},
				},
			};
		});
	};

	const handleToggleEnabled = async (
		provider: IntegrationId,
		checked: boolean,
	) => {
		try {
			await setEnabled({ provider, enabled: checked });
			setFormStates((prev) => {
				const current = prev[provider] || {
					config: {},
					secretPatch: {},
					enabled: checked,
				};
				return {
					...prev,
					[provider]: {
						...current,
						enabled: checked,
					},
				};
			});
			toast.success(
				`${PROVIDER_METADATA[provider]?.title ?? provider} ${checked ? "enabled" : "disabled"
				}.`,
			);
		} catch (err: any) {
			toast.error(err.message || "Failed to toggle status");
		}
	};

	const handleSave = async () => {
		try {
			await saveConfig({
				provider: activeTab,
				config: currentForm.config,
				secrets:
					Object.keys(currentForm.secretPatch).length > 0
						? currentForm.secretPatch
						: undefined,
			});
			// Clear secret patch inputs after successful save
			setFormStates((prev) => {
				const current = prev[activeTab] || {
					enabled: currentItem?.enabled ?? true,
					config: {},
					secretPatch: {},
				};
				return {
					...prev,
					[activeTab]: {
						...current,
						secretPatch: {},
					},
				};
			});
		} catch { }
	};

	const handleTest = async () => {
		try {
			await testIntegration({ provider: activeTab });
		} catch { }
	};

	const renderStateBadge = (state?: IntegrationState) => {
		switch (state) {
			case "ready":
				return (
					<Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 gap-1 font-semibold">
						<CheckCircle2 className="w-3.5 h-3.5" /> Operational
					</Badge>
				);
			case "configured":
				return (
					<Badge className="bg-blue-500/20 text-blue-300 border border-blue-500/30 gap-1 font-semibold">
						<ShieldCheck className="w-3.5 h-3.5" /> Configured
					</Badge>
				);
			case "failing":
				return (
					<Badge className="bg-red-500/20 text-red-400 border border-red-500/30 gap-1 font-semibold">
						<XCircle className="w-3.5 h-3.5" /> Failing
					</Badge>
				);
			case "disabled":
				return (
					<Badge className="bg-slate-700/40 text-slate-400 border border-slate-700/50 gap-1 font-semibold">
						Disabled
					</Badge>
				);
			default:
				return (
					<Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 gap-1 font-semibold">
						<AlertTriangle className="w-3.5 h-3.5" /> Not Configured
					</Badge>
				);
		}
	};

	return (
		<>
			<Head>
				<title>Integrations Management - {brand.APP_NAME}</title>
			</Head>

			<div className="space-y-6">
				{/* Header */}
				<div>
					<h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
						<Boxes className="w-6 h-6 text-indigo-400" /> Integrations
						Management
					</h1>
					<p className="text-slate-400 text-sm mt-1">
						Centrally configure, test, and control external providers and deployment
						sources accessible by your customers. Disabling an integration
						prevents new usage without impacting already deployed applications.
					</p>
				</div>

				{isLoading ? (
					<div className="p-16 flex items-center justify-center gap-3 text-slate-400 text-sm">
						<Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
						Loading integration settings...
					</div>
				) : (
					<Tabs
						value={activeTab}
						onValueChange={(v) => setActiveTab(v as IntegrationId)}
						className="space-y-6"
					>
						<TabsList className="bg-slate-900 border border-slate-800 p-1 flex-wrap h-auto gap-1">
							{integrations?.map((item) => {
								const meta = PROVIDER_METADATA[item.id];
								return (
									<TabsTrigger
										key={item.id}
										value={item.id}
										className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-xs px-3.5 py-1.5 flex items-center gap-2"
									>
										<span>{meta?.title ?? item.id}</span>
										<span
											className={`w-2 h-2 rounded-full ${!item.enabled
													? "bg-slate-600"
													: item.state === "ready"
														? "bg-emerald-400"
														: item.state === "failing"
															? "bg-red-400"
															: item.state === "configured"
																? "bg-blue-400"
																: "bg-amber-400"
												}`}
										/>
									</TabsTrigger>
								);
							})}
						</TabsList>

						{/* Active Provider Card */}
						{currentItem && (
							<Card className="bg-slate-900/90 border border-slate-800 shadow-xl">
								<CardHeader className="border-b border-slate-800/80 pb-5">
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
										<div>
											<div className="flex items-center gap-3">
												<CardTitle className="text-lg font-bold text-white">
													{PROVIDER_METADATA[currentItem.id]?.title ?? currentItem.id}
												</CardTitle>
												{renderStateBadge(currentItem.state)}
											</div>
											<CardDescription className="text-slate-400 text-xs mt-1">
												{PROVIDER_METADATA[currentItem.id]?.description ?? currentItem.description}
											</CardDescription>
										</div>

										<div className="flex items-center gap-3 shrink-0">
											<span className="text-xs text-slate-300 font-medium">
												{currentForm.enabled ? "Enabled" : "Disabled"}
											</span>
											<Switch
												checked={currentForm.enabled}
												disabled={isToggling}
												onCheckedChange={(checked) =>
													handleToggleEnabled(currentItem.id, checked)
												}
											/>
										</div>
									</div>

									{!currentForm.enabled && (
										<div className="mt-4">
											<AlertBlock type="warning">
												This integration is currently disabled. Customers cannot
												connect new repositories or deploy via this provider. Existing
												deployed workloads will continue running normally.
											</AlertBlock>
										</div>
									)}

									{currentItem.lastTestedAt && (
										<div className="text-xs text-slate-400 mt-3 flex items-center gap-2 pt-2 border-t border-slate-800/60">
											<span className="text-slate-500">Last Test:</span>
											<span>
												{new Date(currentItem.lastTestedAt).toLocaleString()}
											</span>
											{currentItem.lastTestMessage && (
												<span
													className={`ml-2 truncate font-mono text-[11px] ${currentItem.lastTestStatus === "verified"
															? "text-emerald-400"
															: "text-red-400"
														}`}
												>
													({currentItem.lastTestMessage})
												</span>
											)}
										</div>
									)}
								</CardHeader>

								<CardContent className="pt-6 space-y-6">
									{/* GitHub Fields */}
									{activeTab === "github" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													App ID
												</label>
												<input
													type="text"
													value={String(currentForm.config.appId ?? "")}
													onChange={(e) =>
														updateConfigField("appId", e.target.value)
													}
													placeholder="e.g. 123456"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Client ID
												</label>
												<input
													type="text"
													value={String(currentForm.config.clientId ?? "")}
													onChange={(e) =>
														updateConfigField("clientId", e.target.value)
													}
													placeholder="Iv1.xxxxxxxxxxxx"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Client Secret
													{currentItem?.secretsConfigured?.clientSecret && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Secret currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.clientSecret || ""}
													onChange={(e) =>
														updateSecretField("clientSecret", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.clientSecret
															? "Leave blank to keep current secret"
															: "Paste client secret..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Webhook Secret
													{currentItem?.secretsConfigured?.webhookSecret && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Secret currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.webhookSecret || ""}
													onChange={(e) =>
														updateSecretField("webhookSecret", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.webhookSecret
															? "Leave blank to keep current secret"
															: "Paste webhook secret..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div className="md:col-span-2">
												<label className="font-semibold text-slate-300 block mb-1">
													Private Key (PEM)
													{currentItem?.secretsConfigured?.privateKey && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Private key currently stored)
														</span>
													)}
												</label>
												<textarea
													rows={4}
													value={currentForm.secretPatch.privateKey || ""}
													onChange={(e) =>
														updateSecretField("privateKey", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.privateKey
															? "Leave blank to keep current private key"
															: "-----BEGIN RSA PRIVATE KEY-----\n..."
													}
													className="w-full font-mono text-xs px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* GitLab Fields */}
									{activeTab === "gitlab" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													GitLab URL
												</label>
												<input
													type="text"
													value={String(currentForm.config.instanceUrl ?? "https://gitlab.com")}
													onChange={(e) =>
														updateConfigField("instanceUrl", e.target.value)
													}
													placeholder="https://gitlab.com"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Application ID
												</label>
												<input
													type="text"
													value={String(currentForm.config.applicationId ?? "")}
													onChange={(e) =>
														updateConfigField("applicationId", e.target.value)
													}
													placeholder="Application ID"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Secret
													{currentItem?.secretsConfigured?.secret && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Secret currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.secret || ""}
													onChange={(e) =>
														updateSecretField("secret", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.secret
															? "Leave blank to keep current secret"
															: "Paste application secret..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Access Token (for connection test)
													{currentItem?.secretsConfigured?.accessToken && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Token currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.accessToken || ""}
													onChange={(e) =>
														updateSecretField("accessToken", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.accessToken
															? "Leave blank to keep current token"
															: "Paste test token..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* Bitbucket Fields */}
									{activeTab === "bitbucket" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Username
												</label>
												<input
													type="text"
													value={String(currentForm.config.username ?? "")}
													onChange={(e) =>
														updateConfigField("username", e.target.value)
													}
													placeholder="Bitbucket Username"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Workspace
												</label>
												<input
													type="text"
													value={String(currentForm.config.workspace ?? "")}
													onChange={(e) =>
														updateConfigField("workspace", e.target.value)
													}
													placeholder="Workspace slug"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div className="md:col-span-2">
												<label className="font-semibold text-slate-300 block mb-1">
													App Password
													{currentItem?.secretsConfigured?.appPassword && (
														<span className="text-emerald-400 ml-2 font-normal">
															(App password currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.appPassword || ""}
													onChange={(e) =>
														updateSecretField("appPassword", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.appPassword
															? "Leave blank to keep current app password"
															: "Enter app password..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* Gitea Fields */}
									{activeTab === "gitea" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Gitea Instance URL
												</label>
												<input
													type="text"
													value={String(currentForm.config.instanceUrl ?? "")}
													onChange={(e) =>
														updateConfigField("instanceUrl", e.target.value)
													}
													placeholder="https://gitea.example.com"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Client ID
												</label>
												<input
													type="text"
													value={String(currentForm.config.clientId ?? "")}
													onChange={(e) =>
														updateConfigField("clientId", e.target.value)
													}
													placeholder="Client ID"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div className="md:col-span-2">
												<label className="font-semibold text-slate-300 block mb-1">
													Client Secret
													{currentItem?.secretsConfigured?.clientSecret && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Secret currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.clientSecret || ""}
													onChange={(e) =>
														updateSecretField("clientSecret", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.clientSecret
															? "Leave blank to keep current secret"
															: "Paste client secret..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* Docker Registry Fields */}
									{activeTab === "docker" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Registry Endpoint
												</label>
												<input
													type="text"
													value={String(currentForm.config.registryEndpoint ?? "https://registry-1.docker.io")}
													onChange={(e) =>
														updateConfigField("registryEndpoint", e.target.value)
													}
													placeholder="https://registry-1.docker.io"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label className="font-semibold text-slate-300 block mb-1">
													Username (optional)
												</label>
												<input
													type="text"
													value={String(currentForm.config.username ?? "")}
													onChange={(e) =>
														updateConfigField("username", e.target.value)
													}
													placeholder="Registry username"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div className="md:col-span-2">
												<label className="font-semibold text-slate-300 block mb-1">
													Password / Access Token
													{currentItem?.secretsConfigured?.password && (
														<span className="text-emerald-400 ml-2 font-normal">
															(Token currently stored)
														</span>
													)}
												</label>
												<input
													type="password"
													value={currentForm.secretPatch.password || ""}
													onChange={(e) =>
														updateSecretField("password", e.target.value)
													}
													placeholder={
														currentItem?.secretsConfigured?.password
															? "Leave blank to keep current token"
															: "Paste access token..."
													}
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* Raw Git Fields */}
									{activeTab === "git" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div className="md:col-span-2">
												<label className="font-semibold text-slate-300 block mb-1">
													Test Repository URL
												</label>
												<input
													type="text"
													value={String(currentForm.config.testRepositoryUrl ?? "")}
													onChange={(e) =>
														updateConfigField(
															"testRepositoryUrl",
															e.target.value,
														)
													}
													placeholder="https://github.com/torvalds/linux.git"
													className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
												/>
											</div>
										</div>
									)}

									{/* Drop Fields */}
									{activeTab === "drop" && (
										<div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
											<div>
												<p className="text-xs text-slate-300">
													Drop deployments allow customers to upload pre-built ZIP
													archives directly into application workspaces.
												</p>
											</div>
										</div>
									)}

									{/* Bottom Action Bar */}
									<div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-slate-800/80">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={isTesting || !currentForm.enabled}
											onClick={handleTest}
											className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs gap-1.5 h-9"
										>
											{isTesting ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
											) : (
												<RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
											)}
											Test Connection
										</Button>

										<Button
											type="button"
											size="sm"
											disabled={isSaving}
											onClick={handleSave}
											className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs gap-1.5 h-9 px-5 shadow-lg shadow-indigo-600/20"
										>
											{isSaving ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin" />
											) : (
												<Save className="w-3.5 h-3.5" />
											)}
											Save Settings
										</Button>
									</div>
								</CardContent>
							</Card>
						)}
					</Tabs>
				)}
			</div>
		</>
	);
}

IntegrationsSettingsPage.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Integrations">{page}</DashboardLayout>
);

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const authGuard = await requirePlatformAdminSession(ctx);
	if ("redirect" in authGuard) {
		return { redirect: authGuard.redirect };
	}

	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: ctx.req as any,
			res: ctx.res as any,
			db: null as any,
			session: authGuard.session as any,
			user: authGuard.user as any,
		},
		transformer: superjson,
	});

	await helpers.user.get.prefetch();
	await helpers.integration.adminList.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

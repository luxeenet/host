
import { defineStepper } from "@stepperize/react";
import { Bot, Sparkles, Settings } from "lucide-react";
import Link from "next/link";
import React, { useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api } from "@/utils/api";
import { StepOne } from "./step-one";
import { StepThree } from "./step-three";
import { StepTwo } from "./step-two";

interface EnvVariable {
	name: string;
	value: string;
}

interface Domain {
	host: string;
	port: number;
	serviceName: string;
}

interface Details {
	name: string;
	id: string;
	description: string;
	dockerCompose: string;
	envVariables: EnvVariable[];
	shortDescription: string;
	domains: Domain[];
	configFiles?: Mount[] | null;
}

interface Mount {
	filePath: string;
	content: string;
}

export interface TemplateInfo {
	userInput: string;
	details?: Details | null;
	suggestions?: Details[];
	server?: {
		serverId: string;
		name: string;
	};
	aiId: string;
}

const defaultTemplateInfo: TemplateInfo = {
	aiId: "",
	userInput: "",
	server: undefined,
	details: null,
	suggestions: [],
};

export const { useStepper, steps, Scoped } = defineStepper(
	{
		id: "needs",
		title: "Describe your needs",
	},
	{
		id: "variant",
		title: "Choose a Variant",
	},
	{
		id: "review",
		title: "Review and Finalize",
	},
);

interface Props {
	environmentId: string;
	projectName?: string;
}

export const TemplateGenerator = ({ environmentId }: Props) => {
	const { data: userAuth } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean(
		(userAuth as any)?.user?.isPlatformAdmin || (userAuth as any)?.isPlatformAdmin,
	);
	const [open, setOpen] = useState(false);
	const stepper = useStepper();
	const { data: aiSettings } = api.ai.getEnabledProviders.useQuery();
	const { mutateAsync } = api.ai.deploy.useMutation();
	const [templateInfo, setTemplateInfo] =
		useState<TemplateInfo>(defaultTemplateInfo);
	const utils = api.useUtils();

	const haveAtleasOneProviderEnabled = Boolean(
		aiSettings && aiSettings.length > 0,
	);

	const isDisabled = () => {
		if (stepper.current.id === "needs") {
			return !templateInfo.aiId || !templateInfo.userInput;
		}

		if (stepper.current.id === "variant") {
			return !templateInfo?.details?.id;
		}

		return false;
	};

	const onSubmit = async () => {
		await mutateAsync({
			environmentId: environmentId,
			id: templateInfo.details?.id || "",
			name: templateInfo?.details?.name || "",
			description: templateInfo?.details?.shortDescription || "",
			dockerCompose: templateInfo?.details?.dockerCompose || "",
			envVariables: (templateInfo?.details?.envVariables || [])
				.map((env: any) => `${env.name}=${env.value}`)
				.join("\n"),
			domains: templateInfo?.details?.domains || [],
			...(templateInfo.server?.serverId && {
				serverId: templateInfo.server?.serverId || "",
			}),
			configFiles: templateInfo?.details?.configFiles || [],
		})
			.then(async () => {
				toast.success("Compose Created");
				setOpen(false);
				// Invalidate the project query to refresh the environment data
				await utils.environment.one.invalidate({
					environmentId,
				});
			})
			.catch(() => {
				toast.error("Error creating the compose");
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3 flex items-center justify-between"
					onSelect={(e) => e.preventDefault()}
				>
					<div className="flex items-center space-x-3">
						<Bot className="size-4 text-muted-foreground" />
						<span>AI Assistant</span>
					</div>
					{!haveAtleasOneProviderEnabled && !isPlatformAdmin && (
						<span className="text-[10px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
							Soon
						</span>
					)}
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent
				className={
					!haveAtleasOneProviderEnabled
						? "sm:max-w-lg w-full flex flex-col p-6 border-slate-800 bg-slate-950"
						: "sm:max-w-4xl w-full flex flex-col"
				}
			>
				{!haveAtleasOneProviderEnabled ? (
					!isPlatformAdmin ? (
						<div className="flex flex-col items-center justify-center text-center py-8 px-2 space-y-5">
							<div className="relative">
								<div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-950/40 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/10">
									<Sparkles className="size-8" />
								</div>
								<span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
									<span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500" />
								</span>
							</div>

							<div className="space-y-2 max-w-md">
								<div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold uppercase tracking-wider">
									Feature Preview • Coming Soon
								</div>
								<h3 className="text-2xl font-bold tracking-tight text-white">
									AI Assistant is Coming Soon
								</h3>
								<p className="text-sm text-slate-400 leading-relaxed">
									This feature is currently in private preview and will be available in an upcoming HatDot Cloud update. You will be able to describe your infrastructure requirements in plain English and automatically generate production-ready Docker Compose stacks.
								</p>
							</div>

							<div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-left space-y-2.5 font-mono">
								<div className="text-slate-300 font-semibold flex items-center gap-2">
									<Bot className="size-4 text-amber-400" />
									<span>Upcoming AI Capabilities:</span>
								</div>
								<div className="text-slate-400 pl-6 space-y-1.5 text-[11px]">
									<div>✦ Natural language to multi-service production topology</div>
									<div>✦ Automatic database wiring &amp; environment configuration</div>
									<div>✦ Built-in zero-downtime healthcheck &amp; SSL ingress generation</div>
								</div>
							</div>

							<Button
								variant="secondary"
								className="px-8 mt-2 bg-slate-800 hover:bg-slate-700 text-white"
								onClick={() => setOpen(false)}
							>
								Got it
							</Button>
						</div>
					) : (
						<div className="flex flex-col items-center justify-center text-center py-8 px-4 space-y-4">
							<div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
								<Settings className="size-7" />
							</div>
							<div className="space-y-1.5 max-w-md">
								<h3 className="text-lg font-semibold text-foreground">
									AI Provider Configuration Required
								</h3>
								<p className="text-sm text-muted-foreground">
									To use AI-powered architecture generation, configure at least one active AI provider in your system settings.
								</p>
							</div>
							<Button size="sm" asChild className="gap-2">
								<Link href="/dashboard/settings/ai">
									<Settings className="size-4" />
									Configure AI Provider
								</Link>
							</Button>
						</div>
					)
				) : (
					<>
						<DialogHeader>
							<DialogTitle>AI Assistant</DialogTitle>
							<DialogDescription>
								Create a custom template based on your needs
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4">
							<div className="flex justify-between">
								<h2 className="text-lg font-semibold">Steps</h2>
								<div className="flex items-center gap-2">
									<span className="text-sm text-muted-foreground">
										Step {stepper.current.index + 1} of {steps.length}
									</span>
									<div />
								</div>
							</div>
							<Scoped>
								<nav aria-label="Checkout Steps" className="group my-4">
									<ol
										className="flex items-center justify-between gap-2"
										aria-orientation="horizontal"
									>
										{stepper.all.map((step, index, array) => (
											<React.Fragment key={step.id}>
												<li className="flex items-center gap-4 shrink-0">
													<Button
														type="button"
														role="tab"
														variant={
															index <= stepper.current.index
																? "secondary"
																: "ghost"
														}
														aria-current={
															stepper.current.id === step.id
																? "step"
																: undefined
														}
														aria-posinset={index + 1}
														aria-setsize={steps.length}
														aria-selected={stepper.current.id === step.id}
														className="flex size-10 items-center justify-center rounded-full border-2 border-border"
													>
														{index + 1}
													</Button>
													<span className="text-sm font-medium">{step.title}</span>
												</li>
												{index < array.length - 1 && (
													<Separator
														className={`flex-1 ${
															index < stepper.current.index
																? "bg-primary"
																: "bg-muted"
														}`}
													/>
												)}
											</React.Fragment>
										))}
									</ol>
								</nav>
								{stepper.switch({
									needs: () => (
										<div className="space-y-4">
											<div className="flex flex-col gap-2">
												<label
													htmlFor="user-needs"
													className="text-sm font-medium"
												>
													Select AI Provider
												</label>
												<Select
													value={templateInfo.aiId}
													onValueChange={(value) =>
														setTemplateInfo((prev) => ({
															...prev,
															aiId: value,
														}))
													}
												>
													<SelectTrigger>
														<SelectValue placeholder="Select an AI provider" />
													</SelectTrigger>
													<SelectContent>
														{aiSettings?.map((ai) => (
															<SelectItem key={ai.aiId} value={ai.aiId}>
																{ai.name} ({ai.model})
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											{templateInfo.aiId && (
												<StepOne
													setTemplateInfo={setTemplateInfo}
													templateInfo={templateInfo}
												/>
											)}
										</div>
									),
									variant: () => (
										<StepTwo
											templateInfo={templateInfo}
											setTemplateInfo={setTemplateInfo}
										/>
									),
									review: () => (
										<StepThree
											templateInfo={templateInfo}
											setTemplateInfo={setTemplateInfo}
										/>
									),
								})}
							</Scoped>
						</div>
						<DialogFooter>
							<div className="flex items-center justify-between w-full">
								<div className="flex items-center gap-2 w-full justify-end">
									<Button
										onClick={() => {
											if (
												stepper.current.id === "variant" &&
												templateInfo.details
											) {
												setTemplateInfo((prev) => ({
													...prev,
													details: null,
												}));
												return;
											}
											stepper.prev();
										}}
										disabled={stepper.isFirst}
										variant="secondary"
									>
										Back
									</Button>
									<Button
										disabled={isDisabled()}
										onClick={async () => {
											if (stepper.current.id === "needs") {
												setTemplateInfo((prev) => ({
													...prev,
													suggestions: [],
													details: null,
												}));
											}

											if (stepper.isLast) {
												await onSubmit();
												return;
											}
											stepper.next();
										}}
									>
										{stepper.isLast ? "Create" : "Next"}
									</Button>
								</div>
							</div>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
};

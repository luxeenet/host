import { defineStepper } from "@stepperize/react";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { GithubIcon } from "@/components/icons/data-tools-icons";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";
import { getOnboardingState, setOnboardingState } from "./onboarding-lock";
import { CompleteStep } from "./steps/complete-step";
import { DeployStep } from "./steps/deploy-step";
import { PlanStep } from "./steps/plan-step";
import { ProjectStep } from "./steps/project-step";
import { ServerStep } from "./steps/server-step";
import { WelcomeStep } from "./steps/welcome-step";

const { useStepper, steps, Scoped } = defineStepper(
	{ id: "welcome", title: "Welcome" },
	{ id: "plan", title: "Pick a plan" },
	{ id: "project", title: "New project" },
	{ id: "server", title: "Connect server" },
	{ id: "deploy", title: "Ship something" },
	{ id: "complete", title: "You're live" },
);

type StepId = (typeof steps)[number]["id"];
const isStepId = (id: string | undefined): id is StepId =>
	!!id && steps.some((step) => step.id === id);

interface Props {
	onClose: () => void | Promise<void>;
}

export const OnboardingWizard = ({ onClose }: Props) => {
	const router = useRouter();
	const persisted = getOnboardingState();
	const stepper = useStepper(
		isStepId(persisted.stepId) ? persisted.stepId : undefined,
	);
	const [projectId, setProjectId] = useState<string | undefined>(
		persisted.projectId,
	);
	const [environmentId, setEnvironmentId] = useState<string | undefined>(
		persisted.environmentId,
	);

	const { data: isCloud = true } = api.settings.isCloud.useQuery();
	const visibleStepIds = isCloud
		? steps.map((step) => step.id)
		: steps
				.filter((step) => step.id !== "plan" && step.id !== "server")
				.map((step) => step.id);
	const visibleIndex = visibleStepIds.indexOf(stepper.current.id);
	const isLastVisible = visibleIndex === visibleStepIds.length - 1;
	const goToNextVisible = () => {
		const nextId = visibleStepIds[visibleIndex + 1];
		if (nextId) stepper.goTo(nextId);
	};

	const [skipAllOpen, setSkipAllOpen] = useState(false);
	const handleSkipAll = async () => {
		await onClose();
		router.push(
			projectId && environmentId
				? `/dashboard/project/${projectId}/environment/${environmentId}`
				: "/dashboard/projects",
		);
	};

	useEffect(() => {
		setOnboardingState({ stepId: stepper.current.id });
	}, [stepper.current.id]);

	const { error: projectCheckError } = api.project.one.useQuery(
		{ projectId: projectId ?? "" },
		{ enabled: !!projectId, retry: false },
	);
	useEffect(() => {
		if (!projectCheckError || !projectId) return;
		setProjectId(undefined);
		setEnvironmentId(undefined);
		setOnboardingState({ projectId: undefined, environmentId: undefined });
		stepper.goTo("project");
	}, [projectCheckError, projectId]);

	return (
		<>
			<div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-background text-foreground">
				<aside className="relative shrink-0 md:w-[300px] lg:w-[340px] overflow-hidden bg-zinc-950 text-zinc-400">
					<div
						className="pointer-events-none absolute inset-0 opacity-[0.07]"
						style={{
							backgroundImage:
								"linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
							backgroundSize: "28px 28px",
						}}
					/>
					<div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-white/10 blur-[100px]" />

					<div className="relative flex md:h-full flex-col p-6 lg:p-8">
						<div className="flex items-center justify-between md:block">
							<div className="flex items-center gap-2.5 text-zinc-50 [&_path]:!fill-white [&_path]:!stroke-white">
								<Logo className="size-7" />
								<span className="text-lg font-semibold tracking-tight">
									HatDot
								</span>
							</div>
							{!isLastVisible && (
								<button
									type="button"
									onClick={() => setSkipAllOpen(true)}
									className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 transition-colors md:hidden"
								>
									Skip all
								</button>
							)}
						</div>

						<Scoped>
							<ol className="hidden md:flex flex-col gap-0.5 mt-12">
								{visibleStepIds.map((id, index) => {
									const step = steps.find((s) => s.id === id)!;
									const isDone = index < visibleIndex;
									const isCurrent = stepper.current.id === step.id;
									return (
										<li key={step.id} className="flex gap-3.5">
											<div className="flex flex-col items-center">
												<span
													className={`flex items-center justify-center font-mono text-[11px] tabular-nums size-5 rounded-full ${
														isCurrent
															? "bg-white text-zinc-950 font-semibold"
															: isDone
																? "text-zinc-100"
																: "text-zinc-400"
													}`}
												>
													{isDone ? (
														<CheckIcon className="size-3" />
													) : (
														String(index + 1).padStart(2, "0")
													)}
												</span>
												{index < visibleStepIds.length - 1 && (
													<span
														className={`w-px flex-1 min-h-7 my-1.5 ${
															isDone ? "bg-zinc-400" : "bg-zinc-700"
														}`}
													/>
												)}
											</div>
											{isDone ? (
												<button
													type="button"
													onClick={() => stepper.goTo(step.id)}
													className="text-sm font-medium transition-colors pb-6 last:pb-0 text-zinc-100 hover:text-white text-left"
												>
													{step.title}
												</button>
											) : (
												<p
													className={`text-sm font-medium transition-colors pb-6 last:pb-0 ${
														isCurrent ? "text-white" : "text-zinc-400"
													}`}
												>
													{step.title}
												</p>
											)}
										</li>
									);
								})}
							</ol>
						</Scoped>

						<div className="hidden md:flex flex-col gap-4 mt-auto pt-8 border-t border-zinc-800">
							{!isLastVisible && (
								<button
									type="button"
									onClick={() => setSkipAllOpen(true)}
									className="w-fit font-mono text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 transition-colors"
								>
									Skip all →
								</button>
							)}
						</div>
					</div>
				</aside>

				<div className="flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-2xl px-6 py-14 lg:py-20">
						{stepper.switch({
							welcome: () => <WelcomeStep onNext={goToNextVisible} />,
							plan: () => <PlanStep onNext={goToNextVisible} />,
							project: () => (
								<ProjectStep
									onNext={(project) => {
										setProjectId(project.projectId);
										setEnvironmentId(project.environmentId);
										setOnboardingState({
											projectId: project.projectId,
											environmentId: project.environmentId,
										});
										goToNextVisible();
									}}
								/>
							),
							server: () => <ServerStep onNext={goToNextVisible} />,
							deploy: () => (
								<DeployStep
									environmentId={environmentId}
									onNext={goToNextVisible}
								/>
							),
							complete: () => (
								<CompleteStep
									projectId={projectId}
									environmentId={environmentId}
									onFinish={onClose}
								/>
							),
						})}
					</div>
				</div>
			</div>

			<Dialog open={skipAllOpen} onOpenChange={setSkipAllOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Skip onboarding?</DialogTitle>
						<DialogDescription>
							If this is your first time using HatDot, we recommend going
							through these steps – it only takes a couple of minutes and gives
							you a feel for how projects, servers, and deployments fit
							together.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSkipAllOpen(false)}>
							Continue setup
						</Button>
						<Button onClick={handleSkipAll}>Skip anyway</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};

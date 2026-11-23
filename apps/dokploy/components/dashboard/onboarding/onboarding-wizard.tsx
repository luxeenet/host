import { defineStepper } from "@stepperize/react";
import { CheckIcon, Zap, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { brand } from "@paas/branding";
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

	const { data: onboardingStatus } = api.project.onboardingStatus.useQuery();
	const { data: currentSubscription } = api.subscription.getCurrent.useQuery();
	const { data: resourceLimits } = api.subscription.getResourceLimits.useQuery();

	const activePlan = currentSubscription?.plan;
	const activePlanName = activePlan?.name || resourceLimits?.planName;
	const activeRamMb =
		resourceLimits?.maxRamMb ??
		activePlan?.resources?.find((r) => r.resourceKey === "max_ram_mb")?.value ??
		512;

	const needsPlan = Boolean(
		onboardingStatus?.needsPlanSelection && !currentSubscription,
	);

	// In HatDot PaaS, infrastructure is cloud-managed (server step excluded).
	// Plan step is shown if customer needs to select a plan; otherwise skipped since they already have one.
	const visibleStepIds = steps
		.filter((step) => {
			if (step.id === "server") return false;
			if (step.id === "plan" && !needsPlan) return false;
			return true;
		})
		.map((step) => step.id);

	const visibleIndex = visibleStepIds.indexOf(stepper.current.id);
	const isLastVisible = visibleIndex === visibleStepIds.length - 1;

	const goToNextVisible = () => {
		const nextId = visibleStepIds[visibleIndex + 1];
		if (nextId) stepper.goTo(nextId);
	};

	const [skipAllOpen, setSkipAllOpen] = useState(false);
	const handleSkipAll = async () => {
		if ((onboardingStatus as any)?.needsPayment) {
			toast.info("Payment is required to activate your plan before accessing the dashboard.");
			router.push("/checkout");
			return;
		}
		if (onboardingStatus?.needsPlanSelection && !currentSubscription) {
			toast.info("A cloud hosting plan is required before accessing the dashboard.");
			router.push("/onboarding");
			return;
		}
		try {
			await onClose();
			router.push(
				projectId && environmentId
					? `/dashboard/project/${projectId}/environment/${environmentId}`
					: "/dashboard/projects",
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Unable to complete onboarding");
		}
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
				<aside className="relative shrink-0 md:w-[300px] lg:w-[340px] overflow-hidden bg-sidebar text-sidebar-foreground border-b md:border-b-0 md:border-r border-sidebar-border">
					<div className="relative flex md:h-full flex-col p-4 sm:p-6 lg:p-8">
						<div className="flex items-center justify-between md:block">
							<div className="flex items-center gap-2.5 text-sidebar-foreground">
								<Logo className="size-7 shrink-0" />
								<span className="text-lg font-semibold tracking-tight">
									{brand.APP_NAME}
								</span>
							</div>
							{!isLastVisible && !needsPlan && (
								<button
									type="button"
									onClick={() => setSkipAllOpen(true)}
									className="text-xs text-muted-foreground hover:text-foreground transition-colors md:hidden"
								>
									Skip all
								</button>
							)}
						</div>

						{/* Mobile Step Status & Progress */}
						<div className="md:hidden mt-3 pt-2.5 border-t border-sidebar-border">
							<div className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground text-[11px] font-medium">
									Step {visibleIndex + 1} of {visibleStepIds.length}
								</span>
								<span className="font-semibold text-foreground text-xs">
									{steps.find((s) => s.id === stepper.current.id)?.title}
								</span>
							</div>
							<div className="w-full bg-muted/50 h-1 rounded-full mt-2 overflow-hidden">
								<div
									className="bg-primary h-full transition-all duration-300"
									style={{
										width: `${((visibleIndex + 1) / visibleStepIds.length) * 100}%`,
									}}
								/>
							</div>
						</div>

						{/* Active Plan Context in Sidebar */}
						{activePlanName && (
							<div className="hidden sm:block mt-4 md:mt-6 p-2.5 sm:p-3 rounded-xl bg-card border border-border text-xs text-card-foreground">
								<div className="flex items-center justify-between text-[11px] text-muted-foreground">
									<span>Selected Plan</span>
									<span className="text-foreground font-semibold">{activePlanName}</span>
								</div>
								<div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Zap className="size-3 text-primary shrink-0" />
									<span>
										{activeRamMb === -1 ? "Unlimited" : `${activeRamMb}MB`} RAM • Edge Routing
									</span>
								</div>
							</div>
						)}

						{/* Enterprise Security Badge */}
						<div className="hidden md:flex mt-3 p-2.5 rounded-xl bg-muted/40 border border-border text-[10px] text-muted-foreground items-center gap-2">
							<ShieldCheck className="size-3.5 text-primary shrink-0" />
							<span>Dedicated Private Cloud • Encrypted Isolation</span>
						</div>

						<Scoped>
							<ol className="hidden md:flex flex-col gap-0.5 mt-8">
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
															? "bg-primary text-primary-foreground font-semibold"
															: isDone
																? "bg-primary/15 text-primary border border-primary/30 font-medium"
																: "text-muted-foreground bg-muted"
													}`}
												>
													{isDone ? (
														<CheckIcon className="size-3 text-primary" />
													) : (
														String(index + 1).padStart(2, "0")
													)}
												</span>
												{index < visibleStepIds.length - 1 && (
													<span
														className={`w-px flex-1 min-h-7 my-1.5 ${
															isDone ? "bg-primary/40" : "bg-border"
														}`}
													/>
												)}
											</div>
											{isDone ? (
												<button
													type="button"
													onClick={() => stepper.goTo(step.id)}
													className="text-sm font-medium transition-colors pb-6 last:pb-0 text-foreground/80 hover:text-foreground text-left"
												>
													{step.title}
												</button>
											) : (
												<p
													className={`text-sm font-medium transition-colors pb-6 last:pb-0 ${
														isCurrent ? "text-foreground font-semibold" : "text-muted-foreground"
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

						<div className="hidden md:flex flex-col gap-4 mt-auto pt-8 border-t border-border">
							{!isLastVisible && !needsPlan && (
								<button
									type="button"
									onClick={() => setSkipAllOpen(true)}
									className="w-fit text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									Skip all →
								</button>
							)}
						</div>
					</div>
				</aside>

				<div className="flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-6 md:py-14 lg:py-20">
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
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Skip onboarding?</DialogTitle>
						<DialogDescription className="text-xs">
							If this is your first time using {brand.APP_NAME}, we recommend completing
							these steps – it only takes a couple of minutes to set up your project
							and deploy your first live application.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setSkipAllOpen(false)}
						>
							Continue setup
						</Button>
						<Button
							size="sm"
							onClick={handleSkipAll}
						>
							Skip anyway
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};

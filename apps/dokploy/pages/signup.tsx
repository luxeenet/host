import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { toast } from "sonner";
import { z } from "zod";
import { Sparkles, Layers, ShieldCheck, CheckCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { GetServerSidePropsContext } from "next";
import { validateRequest } from "@dokploy/server/lib/auth";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { SignupShowcase } from "@/components/proprietary/auth/signup-showcase";
import { SignInWithGithub } from "@/components/proprietary/auth/sign-in-with-github";
import { SignInWithGoogle } from "@/components/proprietary/auth/sign-in-with-google";
import { Logo } from "@/components/shared/logo";
import { AlertBlock } from "@/components/shared/alert-block";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";
import { generateServerSideHelper } from "@/utils/create-server-helpers";
import { appRouter } from "@/server/api/root";

const signupSchema = z
	.object({
		firstName: z.string().min(1, "First name is required"),
		lastName: z.string().optional(),
		email: z.string().email("Invalid email address"),
		password: z
			.string()
			.min(8, "Password must be at least 8 characters")
			.regex(/[A-Z]/, "Must contain at least one uppercase letter")
			.regex(/[0-9]/, "Must contain at least one number"),
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((d) => d.password === d.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
	const router = useRouter();
	const { config: whitelabeling } = useWhitelabelingPublic();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preselectedPlan, setPreselectedPlan] = useState<string | null>(null);

	// Persist and track chosen plan from landing page
	useEffect(() => {
		if (typeof window !== "undefined") {
			const queryPlan = router.query.plan ? String(router.query.plan) : null;
			if (queryPlan) {
				localStorage.setItem("hatdot_selected_plan", queryPlan);
				setPreselectedPlan(queryPlan);
			} else {
				const stored =
					localStorage.getItem("hatdot_selected_plan_slug") ||
					localStorage.getItem("hatdot_selected_plan");
				if (stored) {
					setPreselectedPlan(stored);
				}
			}
		}
	}, [router.query.plan]);

	const form = useForm<SignupForm>({
		resolver: zodResolver(signupSchema),
		defaultValues: {
			firstName: "",
			lastName: "",
			email: "",
			password: "",
			confirmPassword: "",
		},
	});

	const onSubmit = async (data: SignupForm) => {
		setLoading(true);
		setError(null);
		try {
			const result = await authClient.signUp.email({
				name: data.firstName.trim(),
				lastName: (data.lastName ?? "").trim(),
				email: data.email.trim().toLowerCase(),
				password: data.password,
			});

			if (result.error) {
				const msg = result.error.message ?? "Registration failed. Please try again.";
				setError(msg);
				toast.error(msg);
				return;
			}

			toast.success("Account created successfully! Proceeding to package selection...");
			const selectedPlan =
				(router.query.plan ? String(router.query.plan) : null) ||
				(typeof window !== "undefined"
					? localStorage.getItem("hatdot_selected_plan") ||
					  localStorage.getItem("hatdot_selected_plan_slug")
					: null);

			// Always direct to the mandatory package selection step
			if (selectedPlan) {
				await router.push(`/onboarding?plan=${encodeURIComponent(selectedPlan)}`);
			} else {
				await router.push("/onboarding");
			}
		} catch (err: any) {
			const msg = err?.message ?? "Something went wrong. Please try again.";
			setError(msg);
			toast.error(msg);
		} finally {
			setLoading(false);
		}
	};

	const onboardingRedirectUrl = preselectedPlan
		? `/onboarding?plan=${encodeURIComponent(preselectedPlan)}`
		: "/onboarding";

	return (
		<>
			<Head>
				<title>Create Your Account — {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Sign up for ${brand.APP_NAME} and deploy your first application in minutes.`}
				/>
			</Head>

			{/* Progress Stepper */}
			<div className="flex items-center justify-center gap-2 mb-3">
				<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/25">
					<span className="size-2 rounded-full bg-primary animate-pulse" />
					Step 1 of 2: Create Account
				</span>
				<span className="text-muted-foreground text-xs font-bold">•</span>
				<span className="text-xs text-muted-foreground font-medium">
					Step 2: Choose Cloud Package
				</span>
			</div>

			<div className="flex flex-col space-y-2 text-center mb-2">
				<h1 className="text-2xl font-bold tracking-tight">
					<div className="flex flex-row items-center justify-center gap-2">
						<Logo
							className="size-10"
							logoUrl={
								whitelabeling?.loginLogoUrl ||
								whitelabeling?.logoUrl ||
								undefined
							}
						/>
						Create your {brand.APP_NAME} account
					</div>
				</h1>
				<p className="text-sm text-muted-foreground">
					Deploy your apps in seconds with automated builds and private cloud isolation
				</p>
			</div>

			{/* Landing page pre-selected plan banner */}
			{preselectedPlan && (
				<div className="flex items-center justify-between p-2.5 rounded-xl border border-primary/25 bg-primary/5 text-xs text-muted-foreground my-2">
					<div className="flex items-center gap-2 text-foreground font-medium">
						<Sparkles className="size-3.5 text-primary shrink-0" />
						<span>
							Selected Package:{" "}
							<span className="capitalize font-bold text-primary">
								{preselectedPlan}
							</span>
						</span>
					</div>
					<span className="text-[11px] text-muted-foreground font-medium">
						Confirmed in Step 2 →
					</span>
				</div>
			)}

			{error && (
				<AlertBlock type="error" className="my-2">
					<span>{error}</span>
				</AlertBlock>
			)}

			<CardContent className="p-0 space-y-4">
				{/* Social login */}
				<div className="flex flex-col gap-2">
					<SignInWithGithub
						callbackURL={onboardingRedirectUrl}
						newUserCallbackURL={onboardingRedirectUrl}
						text="Sign up with GitHub"
					/>
					<SignInWithGoogle
						callbackURL={onboardingRedirectUrl}
						newUserCallbackURL={onboardingRedirectUrl}
						text="Sign up with Google"
					/>
				</div>

				<div className="relative my-2">
					<Separator />
					<span className="absolute inset-0 flex items-center justify-center">
						<span className="bg-background px-2 text-xs text-muted-foreground">
							or register with email
						</span>
					</span>
				</div>

				{/* Email form */}
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3.5">
						<div className="grid grid-cols-2 gap-3">
							<FormField
								control={form.control}
								name="firstName"
								render={({ field }) => (
									<FormItem>
										<FormLabel>First Name</FormLabel>
										<FormControl>
											<Input placeholder="John" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="lastName"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Last Name</FormLabel>
										<FormControl>
											<Input placeholder="Doe" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email Address</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder="john@example.com"
											autoComplete="email"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input
											type="password"
											placeholder="At least 8 chars, 1 uppercase, 1 number"
											autoComplete="new-password"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm Password</FormLabel>
									<FormControl>
										<Input
											type="password"
											placeholder="Re-type your password"
											autoComplete="new-password"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<Button
							type="submit"
							isLoading={loading}
							className="w-full mt-2"
							size="lg"
						>
							Continue to Package Selection →
						</Button>
					</form>
				</Form>

				<p className="text-center text-xs text-muted-foreground pt-1">
					By creating an account you agree to our{" "}
					<Link href="/terms" className="text-primary hover:underline underline-offset-4">
						Terms of Service
					</Link>{" "}
					and{" "}
					<Link href="/privacy" className="text-primary hover:underline underline-offset-4">
						Privacy Policy
					</Link>
					.
				</p>

				<div className="flex flex-row justify-between items-center text-sm pt-2 text-muted-foreground">
					<span>Already have an account?</span>
					<Link
						href="/"
						className="text-primary font-medium hover:underline underline-offset-4"
					>
						Sign in
					</Link>
				</div>
			</CardContent>
		</>
	);
}

SignupPage.getLayout = (page: ReactElement) => {
	return <OnboardingLayout leftPanel={<SignupShowcase />}>{page}</OnboardingLayout>;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const helpers = generateServerSideHelper(appRouter, ctx);
	await helpers.whitelabeling.getPublic.prefetch();

	const { session } = await validateRequest(ctx.req);
	if (session) {
		return { redirect: { destination: "/dashboard/home", permanent: false } };
	}
	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

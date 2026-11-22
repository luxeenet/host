import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { toast } from "sonner";
import { z } from "zod";
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

	// Persist chosen plan from landing page
	useEffect(() => {
		if (router.query.plan && typeof window !== "undefined") {
			localStorage.setItem("hatdot_selected_plan", String(router.query.plan));
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

			toast.success("Account created successfully! Welcome aboard 🎉");
			const selectedPlan =
				(router.query.plan ? String(router.query.plan) : null) ||
				(typeof window !== "undefined"
					? localStorage.getItem("hatdot_selected_plan")
					: null);
			const planParam = selectedPlan
				? `?plan=${encodeURIComponent(selectedPlan)}`
				: "";
			await router.push(`/onboarding${planParam}`);
		} catch (err: any) {
			const msg = err?.message ?? "Something went wrong. Please try again.";
			setError(msg);
			toast.error(msg);
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<Head>
				<title>Create Your Account — {brand.APP_NAME}</title>
				<meta
					name="description"
					content={`Sign up for ${brand.APP_NAME} and deploy your first application in minutes.`}
				/>
			</Head>

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
					Deploy your apps in seconds with a 14-day free trial on any plan
				</p>
			</div>

			{error && (
				<AlertBlock type="error" className="my-2">
					<span>{error}</span>
				</AlertBlock>
			)}

			<CardContent className="p-0 space-y-4">
				{/* Social login */}
				<div className="flex flex-col gap-2">
					<SignInWithGithub
						callbackURL="/onboarding"
						newUserCallbackURL="/onboarding"
						text="Sign up with GitHub"
					/>
					<SignInWithGoogle
						callbackURL="/onboarding"
						newUserCallbackURL="/onboarding"
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
							Create Account →
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

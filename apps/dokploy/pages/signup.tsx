import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { brand } from "@paas/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const signupSchema = z
	.object({
		firstName: z.string().min(1, "First name is required"),
		lastName: z.string().optional(),
		email: z.string().email("Invalid email address"),
		password: z
			.string()
			.min(8, "Password must be at least 8 characters")
			.regex(/[A-Z]/, "Must contain an uppercase letter")
			.regex(/[0-9]/, "Must contain a number"),
		confirmPassword: z.string(),
	})
	.refine((d) => d.password === d.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<SignupForm>({
		resolver: zodResolver(signupSchema),
	});

	const onSubmit = async (data: SignupForm) => {
		setLoading(true);
		try {
			const result = await authClient.signUp.email({
				name: data.firstName,
				lastName: data.lastName ?? "",
				email: data.email,
				password: data.password,
			});

			if (result.error) {
				toast.error(result.error.message ?? "Registration failed. Please try again.");
				return;
			}

			toast.success("Account created! Setting up your workspace...");
			await router.push("/onboarding");
		} catch (err) {
			toast.error("Something went wrong. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleGitHub = async () => {
		await authClient.signIn.social({ provider: "github", callbackURL: "/onboarding" });
	};

	const handleGoogle = async () => {
		await authClient.signIn.social({ provider: "google", callbackURL: "/onboarding" });
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

			<div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
				{/* Background glow */}
				<div className="absolute inset-0 pointer-events-none overflow-hidden">
					<div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-3xl" />
					<div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-cyan-500/8 blur-3xl" />
				</div>

				<div className="relative w-full max-w-md">
					{/* Logo */}
					<div className="text-center mb-8">
						<Link href="/" className="inline-flex items-center gap-2">
							<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
								<svg viewBox="0 0 24 24" className="w-6 h-6 text-white fill-current">
									<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
								</svg>
							</div>
							<span className="text-xl font-bold text-white">{brand.APP_NAME}</span>
						</Link>
						<p className="mt-2 text-slate-400 text-sm">{brand.TAGLINE}</p>
					</div>

					<Card className="bg-slate-900/80 border-slate-800 backdrop-blur-xl shadow-2xl">
						<CardHeader className="space-y-1 pb-4">
							<CardTitle className="text-2xl text-white">Get started</CardTitle>
							<CardDescription className="text-slate-400">
								Create your account — it's free for 14 days
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{/* Social login */}
							<div className="grid grid-cols-2 gap-3">
								<Button
									variant="outline"
									onClick={handleGitHub}
									className="border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-white"
								>
									<svg className="w-4 h-4 mr-2 fill-current" viewBox="0 0 24 24">
										<path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12" />
									</svg>
									GitHub
								</Button>
								<Button
									variant="outline"
									onClick={handleGoogle}
									className="border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-white"
								>
									<svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
										<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
										<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
										<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
										<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
									</svg>
									Google
								</Button>
							</div>

							<div className="relative">
								<Separator className="bg-slate-800" />
								<span className="absolute inset-0 flex items-center justify-center">
									<span className="bg-slate-900 px-2 text-xs text-slate-500">or continue with email</span>
								</span>
							</div>

							{/* Email form */}
							<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
								<div className="grid grid-cols-2 gap-3">
									<div>
										<Label htmlFor="firstName" className="text-slate-300 text-sm">First Name</Label>
										<Input
											id="firstName"
											{...register("firstName")}
											placeholder="John"
											className="mt-1 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
										/>
										{errors.firstName && (
											<p className="text-red-400 text-xs mt-1">{errors.firstName.message}</p>
										)}
									</div>
									<div>
										<Label htmlFor="lastName" className="text-slate-300 text-sm">Last Name</Label>
										<Input
											id="lastName"
											{...register("lastName")}
											placeholder="Doe"
											className="mt-1 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
										/>
									</div>
								</div>

								<div>
									<Label htmlFor="email" className="text-slate-300 text-sm">Email Address</Label>
									<Input
										id="email"
										type="email"
										{...register("email")}
										placeholder="john@company.com"
										className="mt-1 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
									/>
									{errors.email && (
										<p className="text-red-400 text-xs mt-1">{errors.email.message}</p>
									)}
								</div>

								<div>
									<Label htmlFor="password" className="text-slate-300 text-sm">Password</Label>
									<Input
										id="password"
										type="password"
										{...register("password")}
										placeholder="Minimum 8 characters"
										className="mt-1 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
									/>
									{errors.password && (
										<p className="text-red-400 text-xs mt-1">{errors.password.message}</p>
									)}
								</div>

								<div>
									<Label htmlFor="confirmPassword" className="text-slate-300 text-sm">Confirm Password</Label>
									<Input
										id="confirmPassword"
										type="password"
										{...register("confirmPassword")}
										placeholder="Repeat your password"
										className="mt-1 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
									/>
									{errors.confirmPassword && (
										<p className="text-red-400 text-xs mt-1">{errors.confirmPassword.message}</p>
									)}
								</div>

								<Button
									type="submit"
									disabled={loading}
									className="w-full bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold h-11 transition-all duration-200"
								>
									{loading ? (
										<span className="flex items-center gap-2">
											<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
												<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
												<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
											</svg>
											Creating account...
										</span>
									) : (
										"Create Account →"
									)}
								</Button>
							</form>

							<p className="text-center text-xs text-slate-500">
								By signing up you agree to our{" "}
								<Link href="/terms" className="text-indigo-400 hover:underline">Terms of Service</Link>
								{" "}and{" "}
								<Link href="/privacy" className="text-indigo-400 hover:underline">Privacy Policy</Link>
							</p>
						</CardContent>
					</Card>

					<p className="text-center mt-4 text-sm text-slate-500">
						Already have an account?{" "}
						<Link href="/" className="text-indigo-400 hover:text-indigo-300 font-medium">
							Sign in
						</Link>
					</p>
				</div>
			</div>
		</>
	);
}

SignupPage.getLayout = (page: ReactElement) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	// If already logged in, redirect to dashboard
	const { session } = await validateRequest(ctx.req);
	if (session) {
		return { redirect: { destination: "/dashboard", permanent: false } };
	}
	return { props: {} };
}

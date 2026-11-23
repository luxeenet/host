import { brand } from "@paas/branding";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { generateServerSideHelper } from "@/utils/create-server-helpers";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
	Lock,
	CheckCircle2,
	AlertTriangle,
	Loader2,
	Eye,
	EyeOff,
	ArrowRight,
	ShieldCheck,
} from "lucide-react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { appRouter } from "@/server/api/root";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";

const resetPasswordSchema = z
	.object({
		password: z
			.string()
			.min(1, { message: "Password is required" })
			.min(8, { message: "Password must be at least 8 characters" })
			.max(128, { message: "Password must be at most 128 characters" }),
		confirmPassword: z
			.string()
			.min(1, { message: "Please confirm your password" }),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

interface Props {
	tokenResetPassword: string | null;
}

export default function ResetPasswordPage({ tokenResetPassword }: Props) {
	const { config: whitelabeling } = useWhitelabelingPublic();
	const [token, setToken] = useState<string | null>(tokenResetPassword);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [isSuccess, setIsSuccess] = useState(false);
	const router = useRouter();

	const form = useForm<ResetPasswordInput>({
		defaultValues: {
			password: "",
			confirmPassword: "",
		},
		resolver: zodResolver(resetPasswordSchema),
	});

	useEffect(() => {
		if (typeof window !== "undefined") {
			const queryToken = new URLSearchParams(window.location.search).get("token");
			if (queryToken) {
				setToken(queryToken);
			}
		}
	}, []);

	const watchedPassword = form.watch("password") || "";
	const hasLength = watchedPassword.length >= 8;
	const hasNumberOrSymbol = /[0-9!@#$%^&*(),.?":{}|<>]/.test(watchedPassword);
	const hasUpperAndLower = /[a-z]/.test(watchedPassword) && /[A-Z]/.test(watchedPassword);

	const onSubmit = async (values: ResetPasswordInput) => {
		if (!token) {
			setError("Invalid or missing reset token. Please request a new password reset link.");
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const { error: resetError } = await authClient.resetPassword({
				newPassword: values.password,
				token,
			});

			if (resetError) {
				const msg = resetError.message || "Failed to reset password. The link may have expired.";
				setError(msg);
				toast.error(msg);
			} else {
				setIsSuccess(true);
				toast.success("Password reset successfully! Redirecting to login...");
				setTimeout(() => {
					router.push("/login");
				}, 2000);
			}
		} catch (err: any) {
			const msg = err?.message || "An unexpected error occurred while resetting password.";
			setError(msg);
			toast.error(msg);
		} finally {
			setIsLoading(false);
		}
	};

	const appName = whitelabeling?.appName || brand.APP_NAME;

	return (
		<>
			<Head>
				<title>Choose New Password — {appName}</title>
				<meta
					name="description"
					content={`Set a new secure password for your ${appName} account.`}
				/>
			</Head>

			<div className="flex w-full items-center justify-center py-8">
				<div className="flex flex-col items-center gap-6 w-full max-w-md px-4">
					{/* Brand Logo Header */}
					<Link href="/" className="flex flex-row items-center gap-2.5 transition-transform hover:scale-105">
						<Logo
							className="size-9"
							logoUrl={
								whitelabeling?.loginLogoUrl || whitelabeling?.logoUrl || undefined
							}
						/>
						<span className="font-bold text-lg text-foreground tracking-tight">
							{appName}
						</span>
					</Link>

					<div className="w-full rounded-xl bg-card border border-border shadow-sm p-6 sm:p-8 text-card-foreground">
						{isSuccess ? (
							/* Success State */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
									<CheckCircle2 className="w-6 h-6" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Password Reset Complete
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs">
										Your credentials have been securely updated. You are being redirected to the sign-in screen.
									</CardDescription>
								</div>
								<Button asChild className="w-full mt-2">
									<Link href="/login">
										Continue to Login <ArrowRight className="w-4 h-4 ml-1" />
									</Link>
								</Button>
							</div>
						) : !token ? (
							/* Invalid/Missing Token State */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
									<AlertTriangle className="w-6 h-6" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Invalid or Expired Link
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs">
										This password reset link is invalid, incomplete, or has already expired. Password reset links remain active for 1 hour from issuance.
									</CardDescription>
								</div>
								<Button asChild variant="outline" className="w-full">
									<Link href="/send-reset-password">
										Request New Reset Link
									</Link>
								</Button>
							</div>
						) : (
							/* Set New Password Form */
							<div className="space-y-5">
								<div className="space-y-1.5 text-center sm:text-left">
									<CardTitle className="text-xl font-bold text-foreground tracking-tight">
										Set New Password
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs">
										Choose a strong, unique password to secure your account and cloud resources.
									</CardDescription>
								</div>

								{error && (
									<AlertBlock type="error" className="text-xs">
										{error}
									</AlertBlock>
								)}

								<Form {...form}>
									<form
										onSubmit={form.handleSubmit(onSubmit)}
										className="space-y-4"
									>
										<FormField
											control={form.control}
											name="password"
											render={({ field }) => (
												<FormItem className="space-y-1.5">
													<FormLabel className="text-xs text-foreground font-medium">
														New Password
													</FormLabel>
													<FormControl>
														<div className="relative">
															<Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
															<Input
																type={showPassword ? "text" : "password"}
																placeholder="Enter at least 8 characters"
																autoComplete="new-password"
																className="pl-9 pr-9 bg-card border-border text-foreground text-xs h-10"
																{...field}
															/>
															<button
																type="button"
																onClick={() => setShowPassword(!showPassword)}
																className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
															>
																{showPassword ? (
																	<EyeOff className="w-4 h-4" />
																) : (
																	<Eye className="w-4 h-4" />
																)}
															</button>
														</div>
													</FormControl>
													<FormMessage className="text-[11px]" />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="confirmPassword"
											render={({ field }) => (
												<FormItem className="space-y-1.5">
													<FormLabel className="text-xs text-foreground font-medium">
														Confirm New Password
													</FormLabel>
													<FormControl>
														<div className="relative">
															<Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
															<Input
																type={showPassword ? "text" : "password"}
																placeholder="Repeat new password"
																autoComplete="new-password"
																className="pl-9 bg-card border-border text-foreground text-xs h-10"
																{...field}
															/>
														</div>
													</FormControl>
													<FormMessage className="text-[11px]" />
												</FormItem>
											)}
										/>

										{/* Password Strength Checklist */}
										<div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1.5 text-xs">
											<div className="text-muted-foreground font-medium mb-1">
												Password security criteria:
											</div>
											<div className={`flex items-center gap-1.5 ${hasLength ? "text-primary font-medium" : "text-muted-foreground"}`}>
												<ShieldCheck className="w-3.5 h-3.5" />
												<span>At least 8 characters long</span>
											</div>
											<div className={`flex items-center gap-1.5 ${hasNumberOrSymbol ? "text-primary font-medium" : "text-muted-foreground"}`}>
												<ShieldCheck className="w-3.5 h-3.5" />
												<span>Includes a number or special symbol</span>
											</div>
											<div className={`flex items-center gap-1.5 ${hasUpperAndLower ? "text-primary font-medium" : "text-muted-foreground"}`}>
												<ShieldCheck className="w-3.5 h-3.5" />
												<span>Mix of lowercase and uppercase letters</span>
											</div>
										</div>

										<Button
											type="submit"
											disabled={isLoading}
											className="w-full text-xs h-10 font-semibold"
										>
											{isLoading ? (
												<>
													<Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
													Updating Password...
												</>
											) : (
												"Update Password"
											)}
										</Button>
									</form>
								</Form>
							</div>
						)}

						{/* Bottom Back to Login */}
						<div className="mt-6 pt-4 border-t border-border flex items-center justify-center text-xs">
							<Link
								href="/login"
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								Remember your password? <span className="text-primary font-medium">Log in</span>
							</Link>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

ResetPasswordPage.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
	const helpers = generateServerSideHelper(appRouter, context);
	await helpers.whitelabeling.getPublic.prefetch();

	const rawToken = context.query.token;
	const token = typeof rawToken === "string" ? rawToken : null;

	return {
		props: {
			trpcState: helpers.dehydrate(),
			tokenResetPassword: token,
		},
	};
}

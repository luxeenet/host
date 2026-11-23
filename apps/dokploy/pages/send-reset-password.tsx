import { brand } from "@paas/branding";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { generateServerSideHelper } from "@/utils/create-server-helpers";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
	Mail,
	ArrowLeft,
	CheckCircle2,
	AlertCircle,
	Loader2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
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

const resetRequestSchema = z.object({
	email: z
		.string()
		.min(1, { message: "Email is required" })
		.max(255, { message: "Email must be at most 255 characters" })
		.email({ message: "Please provide a valid email address" }),
});

type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export default function SendResetPasswordPage() {
	const { config: whitelabeling } = useWhitelabelingPublic();
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [sentEmail, setSentEmail] = useState<string | null>(null);
	const [cooldown, setCooldown] = useState(0);
	const router = useRouter();

	const form = useForm<ResetRequestInput>({
		defaultValues: {
			email: "",
		},
		resolver: zodResolver(resetRequestSchema),
	});

	const onSubmit = async (values: ResetRequestInput) => {
		setIsLoading(true);
		setError(null);
		try {
			const { error: resetError } = await authClient.requestPasswordReset({
				email: values.email.trim().toLowerCase(),
				redirectTo: "/reset-password",
			});

			if (resetError) {
				setError(resetError.message || "Failed to send password reset link.");
				toast.error(resetError.message || "Failed to send reset email");
			} else {
				setSentEmail(values.email.trim().toLowerCase());
				toast.success("Password reset instructions dispatched!");
				// Start 30s resend cooldown
				setCooldown(30);
				const timer = setInterval(() => {
					setCooldown((prev) => {
						if (prev <= 1) {
							clearInterval(timer);
							return 0;
						}
						return prev - 1;
					});
				}, 1000);
			}
		} catch (err: any) {
			const msg = err?.message || "An unexpected error occurred. Please try again.";
			setError(msg);
			toast.error(msg);
		} finally {
			setIsLoading(false);
		}
	};

	const handleResend = () => {
		if (sentEmail && cooldown === 0) {
			onSubmit({ email: sentEmail });
		}
	};

	const appName = whitelabeling?.appName || brand.APP_NAME;

	return (
		<>
			<Head>
				<title>Forgot Password — {appName}</title>
				<meta
					name="description"
					content={`Reset your ${appName} account password safely and securely.`}
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
						{sentEmail ? (
							/* Success Confirmation State */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
									<CheckCircle2 className="w-6 h-6" />
								</div>

								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Check Your Email
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs leading-relaxed">
										We have dispatched a password reset link to:
										<br />
										<span className="font-semibold text-foreground text-sm font-mono mt-1 inline-block">
											{sentEmail}
										</span>
									</CardDescription>
								</div>

								<div className="p-3.5 rounded-xl bg-muted/40 border border-border text-left text-xs text-muted-foreground space-y-2 w-full">
									<div className="flex items-start gap-2">
										<ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
										<span>
											For your security, the reset link is valid for <strong>1 hour</strong>.
										</span>
									</div>
									<div className="flex items-start gap-2">
										<AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
										<span>
											Be sure to inspect your spam or junk folder if the email doesn&apos;t arrive within 2 minutes.
										</span>
									</div>
								</div>

								<div className="pt-2 w-full space-y-2.5">
									<Button
										type="button"
										variant="outline"
										onClick={handleResend}
										disabled={cooldown > 0 || isLoading}
										className="w-full text-xs h-10 gap-2"
									>
										{isLoading ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<RefreshCw className="w-3.5 h-3.5" />
										)}
										{cooldown > 0
											? `Resend available in ${cooldown}s`
											: "Resend Reset Link"}
									</Button>

									<Button
										type="button"
										variant="ghost"
										onClick={() => {
											setSentEmail(null);
											form.reset();
										}}
										className="w-full text-muted-foreground hover:text-foreground text-xs"
									>
										Try another email address
									</Button>
								</div>
							</div>
						) : (
							/* Request Form State */
							<div className="space-y-5">
								<div className="space-y-1.5 text-center sm:text-left">
									<CardTitle className="text-xl font-bold text-foreground tracking-tight">
										Forgot Password
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs">
										Enter your registered email address and we will send you a secure link to reset your account credentials.
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
											name="email"
											render={({ field }) => (
												<FormItem className="space-y-1.5">
													<FormLabel className="text-xs text-foreground font-medium">
														Account Email Address
													</FormLabel>
													<FormControl>
														<div className="relative">
															<Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
															<Input
																type="email"
																placeholder="name@company.com"
																maxLength={255}
																autoComplete="email"
																className="pl-9 bg-card border-border text-foreground text-xs h-10"
																{...field}
															/>
														</div>
													</FormControl>
													<FormMessage className="text-[11px]" />
												</FormItem>
											)}
										/>

										<Button
											type="submit"
											disabled={isLoading}
											className="w-full text-xs h-10 font-semibold"
										>
											{isLoading ? (
												<>
													<Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
													Sending Reset Link...
												</>
											) : (
												"Send Reset Link"
											)}
										</Button>
									</form>
								</Form>
							</div>
						)}

						{/* Bottom Navigation */}
						<div className="mt-6 pt-4 border-t border-border flex items-center justify-center text-xs">
							<Link
								href="/login"
								className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors font-medium"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
								Back to Login
							</Link>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

SendResetPasswordPage.getLayout = (page: ReactElement) => {
	return <OnboardingLayout>{page}</OnboardingLayout>;
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
	const helpers = generateServerSideHelper(appRouter, context);
	await helpers.whitelabeling.getPublic.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

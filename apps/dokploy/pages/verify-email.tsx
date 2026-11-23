import { brand } from "@paas/branding";
import { generateServerSideHelper } from "@/utils/create-server-helpers";
import type { GetServerSidePropsContext } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Mail,
	CheckCircle2,
	AlertCircle,
	Loader2,
	RefreshCw,
	ArrowRight,
	ShieldCheck,
} from "lucide-react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { appRouter } from "@/server/api/root";
import { useWhitelabelingPublic } from "@/utils/hooks/use-whitelabeling";

export default function VerifyEmailPage() {
	const { config: whitelabeling } = useWhitelabelingPublic();
	const router = useRouter();
	const { data: sessionData } = authClient.useSession();

	const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(
		"idle"
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [manualEmail, setManualEmail] = useState("");
	const [isResending, setIsResending] = useState(false);
	const [cooldown, setCooldown] = useState(0);

	const appName = whitelabeling?.appName || brand.APP_NAME;

	// Check for token or verified flag in URL
	useEffect(() => {
		if (!router.isReady) return;

		const token = router.query.token as string | undefined;
		const isAlreadyVerified = router.query.verified === "true";

		if (isAlreadyVerified) {
			setStatus("success");
			return;
		}

		if (token) {
			setStatus("verifying");
			authClient
				.verifyEmail({
					query: {
						token,
						callbackURL: "/dashboard/home",
					},
				})
				.then((res) => {
					if (res.error) {
						setStatus("error");
						setErrorMessage(
							res.error.message ||
								"This verification link is invalid, expired, or has already been used."
						);
					} else {
						setStatus("success");
						toast.success("Email verified successfully! Welcome aboard.");
					}
				})
				.catch((err) => {
					setStatus("error");
					setErrorMessage(
						err?.message ||
							"An unexpected error occurred while verifying your email."
					);
				});
		}
	}, [router.isReady, router.query]);

	const targetEmail = sessionData?.user?.email || manualEmail;

	const handleResend = async () => {
		const emailToSend = targetEmail.trim().toLowerCase();
		if (!emailToSend) {
			toast.error("Please enter an email address to send the verification link.");
			return;
		}

		setIsResending(true);
		try {
			const { error } = await authClient.sendVerificationEmail({
				email: emailToSend,
				callbackURL: "/verify-email?verified=true",
			});

			if (error) {
				toast.error(error.message || "Failed to resend verification email");
			} else {
				toast.success("Verification link sent! Check your email inbox.");
				setCooldown(45);
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
			toast.error(err?.message || "Error resending email");
		} finally {
			setIsResending(false);
		}
	};

	return (
		<>
			<Head>
				<title>Verify Your Email — {appName}</title>
				<meta
					name="description"
					content={`Verify your email address to activate your ${appName} cloud account.`}
				/>
			</Head>

			<div className="flex w-full items-center justify-center py-8">
				<div className="flex flex-col items-center gap-6 w-full max-w-md px-4">
					{/* Brand Logo Header */}
					<Link
						href="/"
						className="flex flex-row items-center gap-2.5 transition-transform hover:scale-105"
					>
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
						{status === "verifying" ? (
							/* Verifying in Progress */
							<div className="flex flex-col items-center text-center space-y-4 py-4">
								<Loader2 className="w-10 h-10 animate-spin text-primary" />
								<div className="space-y-1">
									<CardTitle className="text-xl font-bold text-foreground">
										Verifying Your Email
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs">
										Please wait a moment while we validate your security token...
									</CardDescription>
								</div>
							</div>
						) : status === "success" ? (
							/* Verified Successfully */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
									<CheckCircle2 className="w-6 h-6" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Email Verified Successfully!
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs leading-relaxed">
										Your email address is now confirmed. Your {appName} cloud account is fully verified and active.
									</CardDescription>
								</div>

								<div className="p-3 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground w-full flex items-center gap-2">
									<ShieldCheck className="w-4 h-4 text-primary shrink-0" />
									<span>Account security &amp; notifications unlocked.</span>
								</div>

								<Button asChild className="w-full mt-2">
									<Link href="/dashboard/home">
										Go to Dashboard <ArrowRight className="w-4 h-4 ml-1" />
									</Link>
								</Button>
							</div>
						) : status === "error" ? (
							/* Token Expired or Invalid */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
									<AlertCircle className="w-6 h-6" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Verification Failed
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs leading-relaxed">
										{errorMessage ||
											"This verification token is invalid or has expired."}
									</CardDescription>
								</div>

								<div className="space-y-3 w-full pt-2">
									{!sessionData?.user?.email && (
										<Input
											type="email"
											placeholder="Enter your email"
											value={manualEmail}
											onChange={(e) => setManualEmail(e.target.value)}
											className="bg-card border-border text-foreground text-xs h-10"
										/>
									)}

									<Button
										onClick={handleResend}
										disabled={isResending || cooldown > 0}
										className="w-full text-xs h-10 gap-2 font-semibold"
									>
										{isResending ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<RefreshCw className="w-3.5 h-3.5" />
										)}
										{cooldown > 0
											? `Resend in ${cooldown}s`
											: "Request New Verification Email"}
									</Button>
								</div>
							</div>
						) : (
							/* Idle State: Instructions to verify */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
									<Mail className="w-6 h-6" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-foreground">
										Verify Your Email Address
									</CardTitle>
									<CardDescription className="text-muted-foreground text-xs leading-relaxed">
										We sent a verification link to your email:
										<br />
										<span className="font-semibold text-foreground text-sm font-mono mt-1 inline-block">
											{sessionData?.user?.email || "your registered email"}
										</span>
									</CardDescription>
								</div>

								<div className="p-3.5 rounded-xl bg-muted/40 border border-border text-left text-xs text-muted-foreground space-y-1.5 w-full">
									<div>• Click the link in the message to activate your account.</div>
									<div>• Check your spam or promotions folder if not found.</div>
								</div>

								<div className="space-y-2.5 w-full pt-1">
									{!sessionData?.user?.email && (
										<Input
											type="email"
											placeholder="name@company.com"
											value={manualEmail}
											onChange={(e) => setManualEmail(e.target.value)}
											className="bg-card border-border text-foreground text-xs h-10"
										/>
									)}

									<Button
										onClick={handleResend}
										disabled={isResending || cooldown > 0}
										variant="outline"
										className="w-full text-xs h-10 gap-2"
									>
										{isResending ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<RefreshCw className="w-3.5 h-3.5" />
										)}
										{cooldown > 0
											? `Resend link available in ${cooldown}s`
											: "Resend Verification Email"}
									</Button>
								</div>
							</div>
						)}

						{/* Bottom Navigation */}
						<div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
							<Link href="/login" className="hover:text-foreground transition-colors">
								Sign in with another account
							</Link>
							<Link href="/dashboard/home" className="hover:text-foreground transition-colors">
								Go to Dashboard &rarr;
							</Link>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

VerifyEmailPage.getLayout = (page: ReactElement) => {
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

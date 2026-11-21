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
						<span className="font-bold text-lg text-white tracking-tight">
							{appName}
						</span>
					</Link>

					<div className="w-full rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-sm">
						{status === "verifying" ? (
							/* Verifying in Progress */
							<div className="flex flex-col items-center text-center space-y-4 py-4">
								<Loader2 className="w-10 h-10 animate-spin text-amber-400" />
								<div className="space-y-1">
									<CardTitle className="text-xl font-bold text-white">
										Verifying Your Email
									</CardTitle>
									<CardDescription className="text-slate-400 text-xs">
										Please wait a moment while we validate your security token...
									</CardDescription>
								</div>
							</div>
						) : status === "success" ? (
							/* Verified Successfully */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
									<CheckCircle2 className="w-7 h-7" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-white">
										Email Verified Successfully!
									</CardTitle>
									<CardDescription className="text-slate-400 text-xs leading-relaxed">
										Your email address is now confirmed. Your {appName} cloud account is fully verified and active.
									</CardDescription>
								</div>

								<div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 w-full flex items-center gap-2">
									<ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
									<span>Account security &amp; notifications unlocked.</span>
								</div>

								<Link
									href="/dashboard/home"
									className="w-full inline-flex items-center justify-center bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs h-10 rounded-lg gap-2 mt-2 shadow-lg shadow-amber-600/20"
								>
									Go to Dashboard <ArrowRight className="w-4 h-4" />
								</Link>
							</div>
						) : status === "error" ? (
							/* Token Expired or Invalid */
							<div className="flex flex-col items-center text-center space-y-4">
								<div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
									<AlertCircle className="w-7 h-7" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-white">
										Verification Failed
									</CardTitle>
									<CardDescription className="text-slate-400 text-xs leading-relaxed">
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
											className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 text-xs h-10"
										/>
									)}

									<Button
										onClick={handleResend}
										disabled={isResending || cooldown > 0}
										className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs h-10 gap-2 shadow-lg shadow-amber-600/20"
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
								<div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
									<Mail className="w-7 h-7" />
								</div>
								<div className="space-y-1.5">
									<CardTitle className="text-xl font-bold text-white">
										Verify Your Email Address
									</CardTitle>
									<CardDescription className="text-slate-400 text-xs leading-relaxed">
										We sent a verification link to your email:
										<br />
										<span className="font-semibold text-slate-200 text-sm font-mono mt-1 inline-block">
											{sessionData?.user?.email || "your registered email"}
										</span>
									</CardDescription>
								</div>

								<div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs text-slate-400 space-y-1.5 w-full">
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
											className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 text-xs h-10"
										/>
									)}

									<Button
										onClick={handleResend}
										disabled={isResending || cooldown > 0}
										variant="outline"
										className="w-full border-slate-800 text-slate-300 hover:bg-slate-800 text-xs h-10 gap-2"
									>
										{isResending ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<RefreshCw className="w-3.5 h-3.5 text-amber-400" />
										)}
										{cooldown > 0
											? `Resend link available in ${cooldown}s`
											: "Resend Verification Email"}
									</Button>
								</div>
							</div>
						)}

						{/* Bottom Navigation */}
						<div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
							<Link href="/login" className="hover:text-white transition-colors">
								Sign in with another account
							</Link>
							<Link href="/dashboard/home" className="hover:text-white transition-colors">
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


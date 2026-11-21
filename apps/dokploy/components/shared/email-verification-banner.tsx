import { useState } from "react";
import { toast } from "sonner";
import { Mail, RefreshCw, X, ShieldAlert, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/utils/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export const EmailVerificationBanner = () => {
	const { data: memberData } = api.user.get.useQuery(undefined, {
		refetchOnWindowFocus: false,
	});

	const [isDismissed, setIsDismissed] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const [cooldown, setCooldown] = useState(0);

	const user = memberData?.user;

	// Only show if user exists, email is present, and emailVerified is explicitly false
	if (!user || user.emailVerified === true || isDismissed) {
		return null;
	}

	const handleResendVerification = async () => {
		if (!user.email || cooldown > 0) return;
		setIsResending(true);
		try {
			const { error } = await authClient.sendVerificationEmail({
				email: user.email,
				callbackURL: "/verify-email?verified=true",
			});

			if (error) {
				toast.error(error.message || "Failed to send verification email");
			} else {
				toast.success(`Verification link sent to ${user.email}!`);
				setCooldown(60);
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
			toast.error(err?.message || "Failed to send verification email");
		} finally {
			setIsResending(false);
		}
	};

	return (
		<div className="w-full bg-gradient-to-r from-amber-950/80 via-slate-900/90 to-amber-950/80 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200">
			<div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
				<div className="flex items-center gap-2">
					<div className="w-6 h-6 rounded-md bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
						<Mail className="w-3.5 h-3.5 text-amber-400" />
					</div>
					<span>
						<strong className="text-amber-300 font-semibold">Verify your email address:</strong>{" "}
						Your account ({user.email}) is unverified. Verify to ensure password recovery and system alerts.
					</span>
				</div>

				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={handleResendVerification}
						disabled={isResending || cooldown > 0}
						className="h-7 text-[11px] border-amber-500/30 text-amber-300 hover:bg-amber-950/60 hover:text-white px-2.5 gap-1.5"
					>
						{isResending ? (
							<Loader2 className="w-3 h-3 animate-spin" />
						) : (
							<RefreshCw className="w-3 h-3" />
						)}
						{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Link"}
					</Button>

					<Link
						href="/verify-email"
						className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 hover:underline px-1"
					>
						Verify Page <ArrowRight className="w-3 h-3" />
					</Link>

					<button
						type="button"
						onClick={() => setIsDismissed(true)}
						className="text-amber-400/70 hover:text-amber-300 p-1"
						aria-label="Dismiss banner"
					>
						<X className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
};


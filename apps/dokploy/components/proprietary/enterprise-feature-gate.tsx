"use client";

import { Loader2, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { api } from "@/utils/api";

interface EnterpriseFeatureLockedProps {
	/** Optional title override */
	title?: string;
	/** Optional description override */
	description?: string;
	/** Optional custom CTA label */
	ctaLabel?: string;
	/** Optional CTA href (default: /dashboard/settings/license) */
	ctaHref?: string;
	/** Compact variant (less padding, smaller icon) */
	compact?: boolean;
}

/**
 * Displays a locked state for enterprise features when the user has no valid license.
 * Use standalone or via EnterpriseFeatureGate.
 */
export function EnterpriseFeatureLocked({
	title = "Feature",
	description,
	ctaLabel,
	ctaHref = "/dashboard/settings/license",
	compact = false,
}: EnterpriseFeatureLockedProps) {
	const { data: user } = api.user.get.useQuery();
	const isPlatformAdmin = Boolean((user as any)?.isPlatformAdmin);

	const cleanTitle = title.replace(/^Enterprise\s+/i, "");
	const defaultDescription = isPlatformAdmin
		? "Add a valid license to enable this feature across your instance."
		: "This capability is currently in development and will be available in an upcoming update.";

	const displayDescription = description
		? isPlatformAdmin
			? description
			: description.replace(
					/part of the Enterprise Edition\.\s*Add a valid license to [^.]+\./i,
					"coming soon to the platform.",
				)
		: defaultDescription;

	return (
		<Card className="border-dashed bg-transparent">
			<CardHeader className={compact ? "pb-2" : undefined}>
				<div className="flex flex-col items-center gap-3 text-center">
					<div
						className={
							compact
								? "rounded-full bg-muted p-3"
								: "rounded-full bg-muted p-4"
						}
					>
						{isPlatformAdmin ? (
							<Lock
								className={
									compact
										? "size-6 text-muted-foreground"
										: "size-8 text-muted-foreground"
								}
							/>
						) : (
							<Sparkles
								className={
									compact
										? "size-6 text-amber-400"
										: "size-8 text-amber-400"
								}
							/>
						)}
					</div>
					<div className="space-y-1">
						<div className="flex items-center justify-center gap-2">
							<CardTitle className="text-lg">{cleanTitle}</CardTitle>
							{!isPlatformAdmin && (
								<Badge
									variant="outline"
									className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/10"
								>
									Coming Soon
								</Badge>
							)}
						</div>
						<CardDescription className="max-w-sm mx-auto text-xs">
							{displayDescription}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			{isPlatformAdmin && (
				<CardContent className={compact ? "pt-0" : undefined}>
					<div className="flex justify-center">
						<Button
							asChild
							variant="secondary"
							size={compact ? "sm" : "default"}
							className="text-xs"
						>
							<Link href={ctaHref}>{ctaLabel || "Configure License"}</Link>
						</Button>
					</div>
				</CardContent>
			)}
		</Card>
	);
}

interface EnterpriseFeatureGateProps {
	children: React.ReactNode;
	/** Props for the locked state when license is invalid */
	lockedProps?: Omit<EnterpriseFeatureLockedProps, "compact">;
	/** Show loading spinner while checking license */
	fallback?: React.ReactNode;
}

/**
 * Renders children only when the instance has a valid enterprise license.
 * Otherwise shows EnterpriseFeatureLocked.
 */
export function EnterpriseFeatureGate({
	children,
	lockedProps,
	fallback,
}: EnterpriseFeatureGateProps) {
	const { data: haveValidLicense, isPending } =
		api.licenseKey.haveValidLicenseKey.useQuery();

	if (isPending) {
		if (fallback) return <>{fallback}</>;
		return (
			<div className="flex items-center gap-2 justify-center min-h-[25vh]">
				<Loader2 className="size-6 text-muted-foreground animate-spin" />
				<span className="text-sm text-muted-foreground">
					Checking license...
				</span>
			</div>
		);
	}

	if (!haveValidLicense) {
		return <EnterpriseFeatureLocked {...lockedProps} />;
	}

	return <>{children}</>;
}

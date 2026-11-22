import { useRouter } from "next/router";
import { useEffect, type ReactElement } from "react";
import Head from "next/head";
import { Loader2, AlertCircle } from "lucide-react";
import { api } from "@/utils/api";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { brand } from "@paas/branding";

export default function EnvironmentResolverPage() {
	const router = useRouter();
	const id = (router.query.id as string) || "";

	const { data: env, isLoading, error } = api.environment.one.useQuery(
		{ environmentId: id },
		{ enabled: !!id, retry: 1 },
	);

	useEffect(() => {
		if (env && env.projectId && env.environmentId) {
			const query = router.asPath.includes("?") ? `?${router.asPath.split("?")[1]}` : "";
			const targetUrl = `/dashboard/project/${env.projectId}/environment/${env.environmentId}${query}`;
			const asUrl = `/dashboard/env/${id}${query}`;
			void router.replace(targetUrl, asUrl);
		}
	}, [env, id, router]);

	if (isLoading || (env && !error)) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
				<Loader2 className="size-8 animate-spin text-primary" />
				<p className="text-sm text-muted-foreground">Loading environment...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
			<Head>
				<title>Environment Not Found | {brand.APP_NAME}</title>
			</Head>
			<Card className="max-w-md w-full text-center">
				<CardHeader>
					<div className="mx-auto mb-2 size-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
						<AlertCircle className="size-5" />
					</div>
					<CardTitle className="text-lg">Environment Unavailable</CardTitle>
					<CardDescription>
						{error?.message || "The requested environment could not be found or you don't have permission to access it."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild className="w-full">
						<Link href="/dashboard/home">Back to Overview</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

EnvironmentResolverPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};


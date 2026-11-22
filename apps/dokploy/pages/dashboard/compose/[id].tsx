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

export default function ComposeResolverPage() {
	const router = useRouter();
	const id = (router.query.id as string) || "";

	const { data: comp, isLoading, error } = api.compose.one.useQuery(
		{ composeId: id },
		{ enabled: !!id, retry: 1 },
	);

	useEffect(() => {
		if (comp && comp.environment?.project?.projectId && comp.environmentId) {
			const query = router.asPath.includes("?") ? `?${router.asPath.split("?")[1]}` : "";
			const targetUrl = `/dashboard/project/${comp.environment.project.projectId}/environment/${comp.environmentId}/services/compose/${comp.composeId}${query}`;
			const asUrl = `/dashboard/compose/${id}${query}`;
			void router.replace(targetUrl, asUrl);
		}
	}, [comp, id, router]);

	if (isLoading || (comp && !error)) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
				<Loader2 className="size-8 animate-spin text-primary" />
				<p className="text-sm text-muted-foreground">Opening stack...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
			<Head>
				<title>Stack Not Found | {brand.APP_NAME}</title>
			</Head>
			<Card className="max-w-md w-full text-center">
				<CardHeader>
					<div className="mx-auto mb-2 size-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
						<AlertCircle className="size-5" />
					</div>
					<CardTitle className="text-lg">Stack Unavailable</CardTitle>
					<CardDescription>
						{error?.message || "The requested stack could not be found or you don't have permission to access it."}
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

ComposeResolverPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

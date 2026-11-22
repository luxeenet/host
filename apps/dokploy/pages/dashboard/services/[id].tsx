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

export default function UniversalServiceResolverPage() {
	const router = useRouter();
	const id = (router.query.id as string) || "";

	const { data: service, isLoading, error } = api.project.resolveService.useQuery(
		{ serviceId: id },
		{ enabled: !!id, retry: 1 },
	);

	useEffect(() => {
		if (service && service.projectId && service.environmentId) {
			const query = router.asPath.includes("?") ? `?${router.asPath.split("?")[1]}` : "";
			const targetUrl = `/dashboard/project/${service.projectId}/environment/${service.environmentId}/services/${service.serviceType}/${service.serviceId}${query}`;
			const asCategory =
				service.serviceType === "application"
					? "app"
					: service.serviceType === "compose"
						? "compose"
						: "database";
			const asUrl = `/dashboard/${asCategory}/${id}${query}`;
			void router.replace(targetUrl, asUrl);
		}
	}, [service, id, router]);

	if (isLoading || (service && !error)) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
				<Loader2 className="size-8 animate-spin text-primary" />
				<p className="text-sm text-muted-foreground">Opening service...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
			<Head>
				<title>Service Not Found | {brand.APP_NAME}</title>
			</Head>
			<Card className="max-w-md w-full text-center">
				<CardHeader>
					<div className="mx-auto mb-2 size-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
						<AlertCircle className="size-5" />
					</div>
					<CardTitle className="text-lg">Service Unavailable</CardTitle>
					<CardDescription>
						{error?.message || "The requested service could not be found or you don't have permission to access it."}
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

UniversalServiceResolverPage.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};


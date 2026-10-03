import { IS_CLOUD, validateRequest } from "@dokploy/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { ShowBackups } from "@/components/dashboard/database/backups/show-backups";
import { WebDomain } from "@/components/dashboard/settings/web-domain";
import { WebServer } from "@/components/dashboard/settings/web-server";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Card } from "@/components/ui/card";
import { appRouter } from "@/server/api/root";
import { api } from "@/utils/api";

const Page = () => {
	const { data: user } = api.user.get.useQuery();
	return (
		<div className="w-full">
			<div className="h-full rounded-xl w-full flex flex-col gap-4">
				<WebDomain />
				<WebServer />
				<div className="w-full flex flex-col gap-4">
					<Card className="h-full bg-sidebar  p-2.5 rounded-xl  mx-auto w-full">
						<ShowBackups
							id={user?.userId ?? ""}
							databaseType="web-server"
							backupType="database"
						/>
					</Card>
				</div>
			</div>
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="Server">{page}</DashboardLayout>;
};
export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	const { requirePlatformAdminPage } = await import("@/utils/server-auth-guards");
	const guardResult = await requirePlatformAdminPage(ctx);
	if (guardResult) return guardResult;

	return {
		props: {},
	};
}

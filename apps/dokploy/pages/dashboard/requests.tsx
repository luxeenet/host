import { IS_CLOUD } from "@dokploy/server/constants";
import { validateRequest } from "@dokploy/server/lib/auth";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { ShowRequests } from "@/components/dashboard/requests/show-requests";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";

export default function Requests() {
	return <ShowRequests />;
}
Requests.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
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

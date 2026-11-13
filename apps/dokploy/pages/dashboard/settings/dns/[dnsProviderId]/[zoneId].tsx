import { validateRequest } from "@dokploy/server";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { ShowDnsRecords } from "@/components/dashboard/settings/dns/show-dns-records";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { appRouter } from "@/server/api/root";

interface Props {
	dnsProviderId: string;
	zoneId: string;
}

const Page = ({ dnsProviderId, zoneId }: Props) => {
	return <ShowDnsRecords dnsProviderId={dnsProviderId} zoneId={zoneId} />;
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="DNS Providers">{page}</DashboardLayout>;
};

import { requirePlatformAdminSession } from "@/utils/server-auth-guards";

export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ dnsProviderId: string; zoneId: string }>,
) {
	const { req, res, params } = ctx;
	const authGuard = await requirePlatformAdminSession(ctx);
	if ("redirect" in authGuard) {
		return { redirect: authGuard.redirect };
	}
	if (!params?.dnsProviderId || !params?.zoneId) {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/home",
			},
		};
	}
	const { user, session } = authGuard;
	const helpers = createServerSideHelpers({
		router: appRouter,
		ctx: {
			req: req as any,
			res: res as any,
			db: null as any,
			session: session as any,
			user: user as any,
		},
		transformer: superjson,
	});
	await helpers.user.get.prefetch();
	await helpers.settings.isCloud.prefetch();

	return {
		props: {
			trpcState: helpers.dehydrate(),
			dnsProviderId: params.dnsProviderId,
			zoneId: params.zoneId,
		},
	};
}

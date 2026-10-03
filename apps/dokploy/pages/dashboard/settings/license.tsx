import { createServerSideHelpers } from "@trpc/react-query/server";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import superjson from "superjson";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { LicenseKeySettings } from "@/components/proprietary/license-keys/license-key";
import { Card } from "@/components/ui/card";
import { appRouter } from "@/server/api/root";

const Page = () => {
	return (
		<div className="w-full">
			<div className="h-full rounded-xl w-full flex flex-col gap-4">
				<Card className="h-full bg-sidebar p-2.5 rounded-xl mx-auto w-full">
					<div className="rounded-xl bg-background shadow-md">
						<div className="p-6">
							<LicenseKeySettings />
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
};

export default Page;

Page.getLayout = (page: ReactElement) => {
	return <DashboardLayout metaName="License">{page}</DashboardLayout>;
};

import { requirePlatformAdminSession } from "@/utils/server-auth-guards";

export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	const { req, res } = ctx;
	const authGuard = await requirePlatformAdminSession(ctx);
	if ("redirect" in authGuard) {
		return { redirect: authGuard.redirect };
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

	return {
		props: {
			trpcState: helpers.dehydrate(),
		},
	};
}

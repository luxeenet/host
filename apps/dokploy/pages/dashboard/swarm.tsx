import type { GetServerSidePropsContext } from "next";

const Swarm = () => {
	return null;
};

export default Swarm;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { requirePlatformAdminPage } = await import("@/utils/server-auth-guards");
	const guardResult = await requirePlatformAdminPage(ctx);
	if (guardResult) return guardResult;

	const serverId =
		typeof ctx.query.serverId === "string" ? ctx.query.serverId : undefined;

	return {
		redirect: {
			permanent: false,
			destination: `/dashboard/docker?tab=swarm${
				serverId ? `&serverId=${encodeURIComponent(serverId)}` : ""
			}`,
		},
	};
}

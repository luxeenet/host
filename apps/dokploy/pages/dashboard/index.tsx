import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { validateRequest } from "@dokploy/server/lib/auth";

export default function DashboardIndexPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/home");
	}, [router]);

	return null;
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const { session } = await validateRequest(ctx.req);
	if (!session) {
		return { redirect: { destination: "/", permanent: false } };
	}
	return {
		redirect: {
			destination: "/dashboard/home",
			permanent: false,
		},
	};
}

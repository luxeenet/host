import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function HomeDashboardUsageRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/usage");
	}, [router]);

	return null;
}

export async function getServerSideProps(_ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			destination: "/dashboard/usage",
			permanent: false,
		},
	};
}

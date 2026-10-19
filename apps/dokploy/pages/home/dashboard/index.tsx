import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function HomeDashboardIndexRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/home");
	}, [router]);

	return null;
}

export async function getServerSideProps(_ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			destination: "/dashboard/home",
			permanent: false,
		},
	};
}

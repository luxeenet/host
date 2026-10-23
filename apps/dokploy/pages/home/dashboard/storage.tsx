import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function HomeDashboardStorageRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/storage");
	}, [router]);

	return null;
}

export async function getServerSideProps(_ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			destination: "/dashboard/storage",
			permanent: false,
		},
	};
}

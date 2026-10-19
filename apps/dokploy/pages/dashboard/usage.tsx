import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function DeprecatedUsageRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/home/dashboard/usage");
	}, [router]);

	return null;
}

export async function getServerSideProps(_ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			destination: "/home/dashboard/usage",
			permanent: false,
		},
	};
}

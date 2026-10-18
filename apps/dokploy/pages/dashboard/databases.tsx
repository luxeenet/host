import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function DeprecatedDatabasesRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/home/databases");
	}, [router]);

	return null;
}

export async function getServerSideProps(_ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			destination: "/dashboard/home/databases",
			permanent: false,
		},
	};
}

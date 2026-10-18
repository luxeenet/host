import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function DeprecatedDatabaseManageRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		const search = window.location.search || "";
		router.replace(`/dashboard/home/databases/manage${search}`);
	}, [router]);

	return null;
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	const search = ctx.req.url?.includes("?")
		? ctx.req.url.slice(ctx.req.url.indexOf("?"))
		: "";

	return {
		redirect: {
			destination: `/dashboard/home/databases/manage${search}`,
			permanent: false,
		},
	};
}

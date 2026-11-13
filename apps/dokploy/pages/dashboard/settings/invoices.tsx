import type { GetServerSidePropsContext } from "next";

export default function Page() {
	return null;
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
	return {
		redirect: {
			permanent: false,
			destination: "/dashboard/billing",
		},
	};
}

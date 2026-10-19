import type { NextPage } from "next";
import type { ReactElement } from "react";
import Home, { getServerSideProps as originalGetServerSideProps } from "@/pages/dashboard/home";

const HomeDashboardPage: NextPage & {
	getLayout?: (page: ReactElement) => ReactElement;
} = () => {
	return <Home />;
};

HomeDashboardPage.getLayout = Home.getLayout;

export const getServerSideProps = originalGetServerSideProps;

export default HomeDashboardPage;

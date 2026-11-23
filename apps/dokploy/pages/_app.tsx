import "@/styles/globals.css";

import type { NextPage } from "next";
import type { AppProps } from "next/app";
import Head from "next/head";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import type { ReactElement, ReactNode } from "react";
import { brand } from "@paas/branding";
import { SearchCommand } from "@/components/dashboard/search-command";
import { Analytics } from "@/components/shared/analytics";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/utils/api";

const inter = Inter({ subsets: ["latin"] });

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode;
	theme?: string;
};

type AppPropsWithLayout = AppProps & {
	Component: NextPageWithLayout;
};

const MyApp = ({
	Component,
	pageProps: { ...pageProps },
}: AppPropsWithLayout) => {
	const getLayout = Component.getLayout ?? ((page) => page);

	return (
		<>
			<Head>
				<title>{brand.APP_NAME} — {brand.TAGLINE}</title>
				<meta name="description" content={brand.TAGLINE} />
				<link rel="icon" type="image/x-icon" href="/favicon.ico" />
				<link rel="shortcut icon" href="/favicon.ico" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="manifest" href="/site.webmanifest" />
				<meta name="theme-color" content="#09090b" />
			</Head>
			<style jsx global>
				{`
					:root {
						--font-inter: ${inter.style.fontFamily};
					}
				`}
			</style>
			<TooltipProvider>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
					forcedTheme={Component.theme}
				>
					<NextTopLoader color="hsl(var(--sidebar-ring))" />
					<Analytics />
					<Toaster richColors />
					<SearchCommand />
					{getLayout(<Component {...pageProps} />)}
				</ThemeProvider>
			</TooltipProvider>
		</>
	);
};

export default api.withTRPC(MyApp);

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
				<link rel="icon" href={brand.ICON_URL || "/logo-icon.png"} />
				<link rel="shortcut icon" href="/favicon.ico" />
				<link rel="apple-touch-icon" href={brand.ICON_URL || "/logo-icon.png"} />
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

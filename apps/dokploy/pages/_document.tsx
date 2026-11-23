import { getPublicWhitelabelingConfig } from "@dokploy/server";
import NextDocument, {
	type DocumentContext,
	type DocumentInitialProps,
	Head,
	Html,
	Main,
	NextScript,
} from "next/document";

import { brand } from "@paas/branding";

interface WhitelabelingDocumentProps {
	appName: string | null;
	appDescription: string | null;
	ogImageUrl: string | null;
	faviconHref: string | null;
	customCss: string | null;
	baseUrl: string;
}

export default function Document({
	appName,
	appDescription,
	ogImageUrl,
	faviconHref,
	customCss,
	baseUrl,
}: WhitelabelingDocumentProps) {
	const title = appName || brand.APP_NAME;
	const description = appDescription || brand.TAGLINE;

	let ogImage = ogImageUrl || "/og.png";
	if (ogImage.startsWith("/")) {
		ogImage = `${baseUrl}${ogImage}`;
	}

	return (
		<Html lang="en" className="font-sans">
			<Head>
				{/* Primary Meta Tags */}
				<meta name="title" content={title} />
				<meta name="description" content={description} />

				{/* Open Graph / Facebook / WhatsApp / Telegram / LinkedIn */}
				<meta property="og:site_name" content={title} />
				<meta property="og:type" content="website" />
				<meta property="og:title" content={title} />
				<meta property="og:description" content={description} />
				<meta property="og:image" content={ogImage} />
				<meta property="og:image:secure_url" content={ogImage} />
				<meta property="og:image:type" content="image/png" />
				<meta property="og:image:width" content="1200" />
				<meta property="og:image:height" content="630" />
				<meta property="og:image:alt" content={title} />

				{/* Twitter / X */}
				<meta name="twitter:card" content="summary_large_image" />
				<meta name="twitter:title" content={title} />
				<meta name="twitter:description" content={description} />
				<meta name="twitter:image" content={ogImage} />
				<meta name="twitter:image:alt" content={title} />

				{/* Fallback image for link preview scrapers */}
				<link rel="image_src" href={ogImage} />

				{/* Favicons & App Icons */}
				<link rel="icon" type="image/x-icon" href={faviconHref || "/favicon.ico"} />
				<link rel="shortcut icon" href={faviconHref || "/favicon.ico"} />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png" />
				<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="manifest" href="/site.webmanifest" />
				<meta name="theme-color" content="#09090b" />
				<meta name="msapplication-TileColor" content="#09090b" />

				{customCss && (
					<style
						id="whitelabeling-styles"
						dangerouslySetInnerHTML={{ __html: customCss }}
					/>
				)}
			</Head>
			<body className="flex h-full w-full flex-col font-sans">
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}

const SETTINGS_CACHE_TTL = 60 * 1000; // 1 minute

declare global {
	var __SETTINGS_CACHE: {
		data: {
			appName: string | null;
			appDescription: string | null;
			ogImageUrl: string | null;
			faviconHref: string | null;
			customCss: string | null;
		};
		expiresAt: number;
	} | null;
}

Document.getInitialProps = async (
	ctx: DocumentContext,
): Promise<DocumentInitialProps & WhitelabelingDocumentProps> => {
	const initialProps = await NextDocument.getInitialProps(ctx);

	let appName: string | null = null;
	let appDescription: string | null = null;
	let ogImageUrl: string | null = null;
	let faviconHref: string | null = null;
	let customCss: string | null = null;

	const host = ctx.req?.headers?.host || "hatdot.cloud";
	const forwardedProto = ctx.req?.headers?.["x-forwarded-proto"];
	const protocol =
		typeof forwardedProto === "string"
			? forwardedProto
			: host.includes("localhost") || host.includes("127.0.0.1")
			? "http"
			: "https";
	const baseUrl = `${protocol}://${host}`;

	if (
		globalThis.__SETTINGS_CACHE &&
		globalThis.__SETTINGS_CACHE.expiresAt > Date.now() &&
		globalThis.__SETTINGS_CACHE.data
	) {
		return {
			...initialProps,
			...globalThis.__SETTINGS_CACHE.data,
			baseUrl,
		};
	}

	try {
		const config = await getPublicWhitelabelingConfig();
		if (config) {
			appName = config.appName;
			appDescription = config.appDescription;
			ogImageUrl = config.ogImageUrl;
			// Remove any </style> tags to prevent XSS breakout
			customCss = config.customCss
				? config.customCss.replace(/<\/\s*style[^>]*>/gi, "")
				: null;
			faviconHref = config.faviconUrl || null;
		}
	} catch {
		// Fall back to defaults if settings can't be read (e.g. DB not ready)
	}

	globalThis.__SETTINGS_CACHE = {
		data: {
			appName,
			appDescription,
			ogImageUrl,
			faviconHref,
			customCss,
		},
		expiresAt: Date.now() + SETTINGS_CACHE_TTL,
	};

	return {
		...initialProps,
		appName,
		appDescription,
		ogImageUrl,
		faviconHref,
		customCss,
		baseUrl,
	};
};

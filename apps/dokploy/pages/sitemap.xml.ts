import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({ res, req }) => {
	const host = req.headers.host || "hatdot.cloud";
	const forwardedProto = req.headers["x-forwarded-proto"];
	const protocol =
		typeof forwardedProto === "string"
			? forwardedProto
			: host.includes("localhost") || host.includes("127.0.0.1")
			? "http"
			: "https";
	const baseUrl = `${protocol}://${host}`;
	const currentDate = new Date().toISOString().split("T")[0];

	const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/signup</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/register</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/login</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;

	res.setHeader("Content-Type", "application/xml; charset=utf-8");
	res.setHeader(
		"Cache-Control",
		"public, s-maxage=86400, stale-while-revalidate=43200",
	);
	res.write(sitemap);
	res.end();

	return {
		props: {},
	};
};

export default function Sitemap() {
	return null;
}


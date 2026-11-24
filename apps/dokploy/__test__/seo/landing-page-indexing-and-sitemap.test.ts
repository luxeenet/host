import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("HatDot Search Engine Indexing & SEO Configuration", () => {
	const publicDir = path.resolve(__dirname, "../../public");
	const robotsTxtPath = path.join(publicDir, "robots.txt");
	const sitemapXmlPath = path.join(publicDir, "sitemap.xml");

	it("should have a robots.txt that allows crawling the landing page and public routes", () => {
		expect(fs.existsSync(robotsTxtPath)).toBe(true);
		const robotsContent = fs.readFileSync(robotsTxtPath, "utf-8");

		// Must allow root and public routes
		expect(robotsContent).toMatch(/Allow:\s*\/\s*$/m);
		expect(robotsContent).toMatch(/Allow:\s*\/signup/);
		expect(robotsContent).toMatch(/Allow:\s*\/login/);

		// Must NOT disallow root for all agents
		expect(robotsContent).not.toMatch(/^Disallow:\s*\/\s*$/m);

		// Must protect internal dashboard and admin areas
		expect(robotsContent).toMatch(/Disallow:\s*\/dashboard\//);
		expect(robotsContent).toMatch(/Disallow:\s*\/admin\//);

		// Must specify the canonical sitemap
		expect(robotsContent).toMatch(/Sitemap:\s*https:\/\/hatdot\.cloud\/sitemap\.xml/i);
	});

	it("should have a valid sitemap.xml listing the canonical landing page and public URLs", () => {
		expect(fs.existsSync(sitemapXmlPath)).toBe(true);
		const sitemapContent = fs.readFileSync(sitemapXmlPath, "utf-8");

		// Must contain standard xml header and urlset schema
		expect(sitemapContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(sitemapContent).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');

		// Must include canonical home page with highest priority
		expect(sitemapContent).toContain("<loc>https://hatdot.cloud/</loc>");
		expect(sitemapContent).toContain("<priority>1.0</priority>");

		// Must include signup and registration pages
		expect(sitemapContent).toContain("<loc>https://hatdot.cloud/signup</loc>");
		expect(sitemapContent).toContain("<loc>https://hatdot.cloud/register</loc>");
	});

	it("should include Schema.org JSON-LD structured data for HatDot in landing page", () => {
		const indexPath = path.resolve(__dirname, "../../pages/index.tsx");
		const indexContent = fs.readFileSync(indexPath, "utf-8");

		// Check for WebSite schema with HatDot name and alternate names
		expect(indexContent).toContain('"@type": "WebSite"');
		expect(indexContent).toContain('"name": "HatDot"');
		expect(indexContent).toContain('"url": "https://hatdot.cloud/"');

		// Check for Organization schema with logo and branding
		expect(indexContent).toContain('"@type": "Organization"');
		expect(indexContent).toContain('"name": "HatDot"');
		expect(indexContent).toContain("https://hatdot.cloud/logo-icon.png");

		// Check for SoftwareApplication schema
		expect(indexContent).toContain('"@type": "SoftwareApplication"');
		expect(indexContent).toContain('"name": "HatDot Cloud Platform"');

		// Check for canonical and robots meta directives
		expect(indexContent).toContain('rel="canonical" href="https://hatdot.cloud/"');
		expect(indexContent).toContain('name="robots"');
		expect(indexContent).toContain("index, follow");
		expect(indexContent).toContain('name="googlebot"');
		expect(indexContent).toContain('name="bingbot"');
	});
});


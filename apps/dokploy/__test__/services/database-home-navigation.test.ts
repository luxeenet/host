import { Database } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
	isCustomerRouteActive,
	NAV_ITEMS,
} from "@/components/layouts/customer-layout";
import { isActiveRoute, MENU } from "@/components/layouts/side";
import { getServerSideProps as legacyDatabasesRedirect } from "@/pages/dashboard/databases";
import { getServerSideProps as legacyManageRedirect } from "@/pages/dashboard/databases/manage";

describe("Databases Navigation Under Home Dashboard", () => {
	describe("1. Navigation Item Registration & Access Control", () => {
		it("includes Databases in MENU.home with correct route and icon", () => {
			const databasesItem = MENU.home.find(
				(item) => item.isSingle && item.url === "/dashboard/home/databases",
			);

			expect(databasesItem).toBeDefined();
			expect(databasesItem?.title).toBe("Databases");
			expect(databasesItem?.isSingle).toBe(true);
			expect(databasesItem?.icon).toBe(Database);
			// Must be accessible to regular users (no isPlatformAdmin requirement)
			expect((databasesItem as any)?.isEnabled).toBeUndefined();
		});

		it("positions Databases alongside Home and Projects in the primary Home group", () => {
			const urls = MENU.home.map((item) => (item.isSingle ? item.url : ""));
			expect(urls).toContain("/dashboard/home");
			expect(urls).toContain("/dashboard/projects");
			expect(urls).toContain("/dashboard/home/databases");

			const homeIndex = urls.indexOf("/dashboard/home");
			const projectsIndex = urls.indexOf("/dashboard/projects");
			const databasesIndex = urls.indexOf("/dashboard/home/databases");

			expect(homeIndex).toBeGreaterThanOrEqual(0);
			expect(projectsIndex).toBeGreaterThanOrEqual(0);
			expect(databasesIndex).toBeGreaterThan(homeIndex);
		});

		it("updates customer layout NAV_ITEMS to point to /dashboard/home/databases", () => {
			const dbNavItem = NAV_ITEMS.find((item) => item.label === "Databases");
			expect(dbNavItem).toBeDefined();
			expect(dbNavItem?.href).toBe("/dashboard/home/databases");
			expect(dbNavItem?.icon).toBe(Database);
		});
	});

	describe("2. Active Route Resolution & Route Isolation (side.tsx)", () => {
		it("isolates /dashboard/home so it does NOT match /dashboard/home/databases", () => {
			const isHomeActiveOnDatabases = isActiveRoute({
				itemUrl: "/dashboard/home",
				pathname: "/dashboard/home/databases",
			});
			expect(isHomeActiveOnDatabases).toBe(false);

			const isDatabasesActiveOnDatabases = isActiveRoute({
				itemUrl: "/dashboard/home/databases",
				pathname: "/dashboard/home/databases",
			});
			expect(isDatabasesActiveOnDatabases).toBe(true);
		});

		it("correctly identifies /dashboard/home as active when strictly on home", () => {
			const isHomeActive = isActiveRoute({
				itemUrl: "/dashboard/home",
				pathname: "/dashboard/home",
			});
			expect(isHomeActive).toBe(true);

			const isDatabasesActive = isActiveRoute({
				itemUrl: "/dashboard/home/databases",
				pathname: "/dashboard/home",
			});
			expect(isDatabasesActive).toBe(false);
		});

		it("keeps Databases active on workspace sub-route /dashboard/home/databases/manage", () => {
			const isHomeActive = isActiveRoute({
				itemUrl: "/dashboard/home",
				pathname: "/dashboard/home/databases/manage",
			});
			expect(isHomeActive).toBe(false);

			const isDatabasesActive = isActiveRoute({
				itemUrl: "/dashboard/home/databases",
				pathname: "/dashboard/home/databases/manage",
			});
			expect(isDatabasesActive).toBe(true);
		});

		it("provides backward compatibility for legacy /dashboard/databases routes", () => {
			const isDatabasesActiveLegacy = isActiveRoute({
				itemUrl: "/dashboard/home/databases",
				pathname: "/dashboard/databases",
			});
			expect(isDatabasesActiveLegacy).toBe(true);

			const isManageActiveLegacy = isActiveRoute({
				itemUrl: "/dashboard/home/databases",
				pathname: "/dashboard/databases/manage",
			});
			expect(isManageActiveLegacy).toBe(true);
		});
	});

	describe("3. Active Route Resolution in Customer Layout (customer-layout.tsx)", () => {
		it("marks Overview active only when on /dashboard/home and not on /dashboard/home/databases", () => {
			expect(isCustomerRouteActive("/dashboard/home", "/dashboard/home")).toBe(
				true,
			);
			expect(
				isCustomerRouteActive("/dashboard/home", "/dashboard/home/databases"),
			).toBe(false);
		});

		it("marks Databases active on /dashboard/home/databases and its subroutes", () => {
			expect(
				isCustomerRouteActive(
					"/dashboard/home/databases",
					"/dashboard/home/databases",
				),
			).toBe(true);
			expect(
				isCustomerRouteActive(
					"/dashboard/home/databases",
					"/dashboard/home/databases/manage",
				),
			).toBe(true);
		});

		it("marks Databases active on legacy /dashboard/databases for backward compatibility", () => {
			expect(
				isCustomerRouteActive(
					"/dashboard/home/databases",
					"/dashboard/databases",
				),
			).toBe(true);
			expect(
				isCustomerRouteActive(
					"/dashboard/home/databases",
					"/dashboard/databases/manage",
				),
			).toBe(true);
		});
	});

	describe("4. Backward-Compatible Server-Side Redirects", () => {
		it("redirects /dashboard/databases to /dashboard/home/databases with 307 temporary redirect", async () => {
			const fakeCtx: any = { req: { url: "/dashboard/databases" } };
			const result = await legacyDatabasesRedirect(fakeCtx);

			expect(result).toEqual({
				redirect: {
					destination: "/dashboard/home/databases",
					permanent: false,
				},
			});
		});

		it("redirects /dashboard/databases/manage preserving query parameters", async () => {
			const fakeCtxWithQuery: any = {
				req: { url: "/dashboard/databases/manage?id=db-xyz123&engine=mongo" },
			};
			const resultWithQuery = await legacyManageRedirect(fakeCtxWithQuery);

			expect(resultWithQuery).toEqual({
				redirect: {
					destination:
						"/dashboard/home/databases/manage?id=db-xyz123&engine=mongo",
					permanent: false,
				},
			});

			const fakeCtxWithoutQuery: any = {
				req: { url: "/dashboard/databases/manage" },
			};
			const resultWithoutQuery =
				await legacyManageRedirect(fakeCtxWithoutQuery);

			expect(resultWithoutQuery).toEqual({
				redirect: {
					destination: "/dashboard/home/databases/manage",
					permanent: false,
				},
			});
		});
	});
});

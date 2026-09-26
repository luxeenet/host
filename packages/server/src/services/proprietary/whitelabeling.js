import { IS_CLOUD } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import { hasValidLicense } from "@dokploy/server/services/proprietary/license-key";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
// Self-hosted is single-tenant; gate on the oldest organization's license,
// mirroring resolveLocalConcurrency in server/queues/concurrency.ts. Used only
// for unauthenticated requests (no active organization in session).
const hasAnyValidLicense = async () => {
    const org = await db.query.organization.findFirst({
        columns: { id: true },
        orderBy: (organization, { asc }) => [asc(organization.createdAt)],
    });
    return org ? await hasValidLicense(org.id) : false;
};
/**
 * Public whitelabeling config for unauthenticated contexts (login page, SSR
 * document shell). No active organization/session is available here.
 */
export const getPublicWhitelabelingConfig = async () => {
    if (IS_CLOUD) {
        return null;
    }
    if (!(await hasAnyValidLicense())) {
        return null;
    }
    const settings = await getWebServerSettings();
    const config = settings?.whitelabelingConfig;
    if (!config)
        return null;
    return {
        appName: config.appName,
        appDescription: config.appDescription,
        logoUrl: config.logoUrl,
        loginLogoUrl: config.loginLogoUrl,
        faviconUrl: config.faviconUrl,
        customCss: config.customCss,
        ogImageUrl: config.ogImageUrl,
        errorPageTitle: config.errorPageTitle,
        errorPageDescription: config.errorPageDescription,
        footerText: config.footerText,
    };
};

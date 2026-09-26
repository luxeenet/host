/**
 * Platform Branding Configuration
 *
 * All brand-related constants live here.
 * NEVER hardcode platform names in feature code.
 * NEVER remove upstream Dokploy copyright notices from their original files.
 */
export declare const BRAND: {
    /** Platform display name shown in UI */
    readonly APP_NAME: string;
    /** Short tagline */
    readonly TAGLINE: string;
    /** Primary domain for the platform control plane */
    readonly APP_URL: string;
    /** Public-facing marketing site */
    readonly MARKETING_URL: string;
    /** Platform subdomain base — customer apps get <project>.this-domain */
    readonly PLATFORM_SUBDOMAIN_BASE: string;
    /** Support email visible to customers */
    readonly SUPPORT_EMAIL: string;
    /** Billing contact email */
    readonly BILLING_EMAIL: string;
    /** From address for transactional emails */
    readonly EMAIL_FROM: string;
    /** Company legal name */
    readonly COMPANY_NAME: string;
    /** Default currency ISO code */
    readonly DEFAULT_CURRENCY: string;
    /** Default billing locale */
    readonly DEFAULT_LOCALE: string;
    /** Primary hex color (used in emails + UI theme) */
    readonly PRIMARY_COLOR: string;
    /** Secondary hex color */
    readonly SECONDARY_COLOR: string;
    /** Logo URL (absolute, served from CDN or public/) */
    readonly LOGO_URL: string;
    /** Favicon URL */
    readonly FAVICON_URL: string;
    /** Social: Twitter/X handle */
    readonly TWITTER_HANDLE: string;
    /** Social: GitHub org */
    readonly GITHUB_URL: string;
    /** Copyright line */
    readonly COPYRIGHT: string;
};
export type Brand = typeof BRAND;
/** Resolved brand (reads env at module load time — suitable for server-side) */
export declare const brand: {
    /** Platform display name shown in UI */
    readonly APP_NAME: string;
    /** Short tagline */
    readonly TAGLINE: string;
    /** Primary domain for the platform control plane */
    readonly APP_URL: string;
    /** Public-facing marketing site */
    readonly MARKETING_URL: string;
    /** Platform subdomain base — customer apps get <project>.this-domain */
    readonly PLATFORM_SUBDOMAIN_BASE: string;
    /** Support email visible to customers */
    readonly SUPPORT_EMAIL: string;
    /** Billing contact email */
    readonly BILLING_EMAIL: string;
    /** From address for transactional emails */
    readonly EMAIL_FROM: string;
    /** Company legal name */
    readonly COMPANY_NAME: string;
    /** Default currency ISO code */
    readonly DEFAULT_CURRENCY: string;
    /** Default billing locale */
    readonly DEFAULT_LOCALE: string;
    /** Primary hex color (used in emails + UI theme) */
    readonly PRIMARY_COLOR: string;
    /** Secondary hex color */
    readonly SECONDARY_COLOR: string;
    /** Logo URL (absolute, served from CDN or public/) */
    readonly LOGO_URL: string;
    /** Favicon URL */
    readonly FAVICON_URL: string;
    /** Social: Twitter/X handle */
    readonly TWITTER_HANDLE: string;
    /** Social: GitHub org */
    readonly GITHUB_URL: string;
    /** Copyright line */
    readonly COPYRIGHT: string;
};
/**
 * Returns the platform URL for a given customer project slug.
 * e.g. "my-app" → "https://my-app.hosting.co.tz"
 */
export declare function getPlatformUrl(slug: string): string;
/**
 * Returns a localised currency string.
 * e.g. formatCurrency(5000, "TZS") → "TZS 5,000"
 */
export declare function formatCurrency(amount: number, currency?: string, locale?: string): string;

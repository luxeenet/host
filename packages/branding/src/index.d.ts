/**
 * Platform Branding Configuration — Hatdot Cloud
 *
 * All brand-related constants live here.
 * NEVER hardcode platform names in feature code.
 * NEVER remove upstream copyright notices from their original source code licenses.
 */
export declare const BRAND: {
    /** Platform display name shown in UI */
    readonly APP_NAME: any;
    /** Impressive, high-converting tagline */
    readonly TAGLINE: any;
    /** Primary domain for the platform control plane */
    readonly APP_URL: any;
    /** Public-facing marketing site */
    readonly MARKETING_URL: any;
    /** Platform subdomain base — customer apps get <project>.hatdot.cloud */
    readonly PLATFORM_SUBDOMAIN_BASE: any;
    /** Support email visible to customers */
    readonly SUPPORT_EMAIL: any;
    /** Billing contact email */
    readonly BILLING_EMAIL: any;
    /** From address for transactional emails */
    readonly EMAIL_FROM: any;
    /** Company legal name */
    readonly COMPANY_NAME: any;
    /** Default currency ISO code */
    readonly DEFAULT_CURRENCY: any;
    /** Default billing locale */
    readonly DEFAULT_LOCALE: any;
    /** Primary hex color (Hatdot Blue) */
    readonly PRIMARY_COLOR: any;
    /** Secondary hex color */
    readonly SECONDARY_COLOR: any;
    /** Logo URL (absolute, served from public/) */
    readonly LOGO_URL: any;
    /** Icon URL */
    readonly ICON_URL: any;
    /** Dark Logo URL */
    readonly DARK_LOGO_URL: any;
    /** Favicon URL */
    readonly FAVICON_URL: any;
    /** Social: Twitter/X handle */
    readonly TWITTER_HANDLE: any;
    /** Social: GitHub org */
    readonly GITHUB_URL: any;
    /** Copyright line */
    readonly COPYRIGHT: any;
};
export type Brand = typeof BRAND;
/** Resolved brand (reads env at module load time — suitable for server-side) */
export declare const brand: {
    /** Platform display name shown in UI */
    readonly APP_NAME: any;
    /** Impressive, high-converting tagline */
    readonly TAGLINE: any;
    /** Primary domain for the platform control plane */
    readonly APP_URL: any;
    /** Public-facing marketing site */
    readonly MARKETING_URL: any;
    /** Platform subdomain base — customer apps get <project>.hatdot.cloud */
    readonly PLATFORM_SUBDOMAIN_BASE: any;
    /** Support email visible to customers */
    readonly SUPPORT_EMAIL: any;
    /** Billing contact email */
    readonly BILLING_EMAIL: any;
    /** From address for transactional emails */
    readonly EMAIL_FROM: any;
    /** Company legal name */
    readonly COMPANY_NAME: any;
    /** Default currency ISO code */
    readonly DEFAULT_CURRENCY: any;
    /** Default billing locale */
    readonly DEFAULT_LOCALE: any;
    /** Primary hex color (Hatdot Blue) */
    readonly PRIMARY_COLOR: any;
    /** Secondary hex color */
    readonly SECONDARY_COLOR: any;
    /** Logo URL (absolute, served from public/) */
    readonly LOGO_URL: any;
    /** Icon URL */
    readonly ICON_URL: any;
    /** Dark Logo URL */
    readonly DARK_LOGO_URL: any;
    /** Favicon URL */
    readonly FAVICON_URL: any;
    /** Social: Twitter/X handle */
    readonly TWITTER_HANDLE: any;
    /** Social: GitHub org */
    readonly GITHUB_URL: any;
    /** Copyright line */
    readonly COPYRIGHT: any;
};
/**
 * Returns the platform URL for a given customer project slug.
 * e.g. "my-app" → "https://my-app.hatdot.cloud"
 */
export declare function getPlatformUrl(slug: string): string;
/**
 * Returns a localised currency string.
 * e.g. formatCurrency(50000, "TZS") → "TZS 50,000"
 */
export declare function formatCurrency(amount: number, currency?: string, locale?: string): string;

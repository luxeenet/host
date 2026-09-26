/**
 * Platform Branding Configuration
 *
 * All brand-related constants live here.
 * NEVER hardcode platform names in feature code.
 * NEVER remove upstream Dokploy copyright notices from their original files.
 */

export const BRAND = {
  /** Platform display name shown in UI */
  APP_NAME: process.env.BRAND_APP_NAME ?? "HostPlatform",
  /** Short tagline */
  TAGLINE:
    process.env.BRAND_TAGLINE ?? "Deploy fast. Scale easy. Pay less.",
  /** Primary domain for the platform control plane */
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.yourhosting.co.tz",
  /** Public-facing marketing site */
  MARKETING_URL:
    process.env.BRAND_MARKETING_URL ?? "https://yourhosting.co.tz",
  /** Platform subdomain base — customer apps get <project>.this-domain */
  PLATFORM_SUBDOMAIN_BASE:
    process.env.BRAND_PLATFORM_SUBDOMAIN_BASE ?? "hosting.co.tz",
  /** Support email visible to customers */
  SUPPORT_EMAIL:
    process.env.BRAND_SUPPORT_EMAIL ?? "support@yourhosting.co.tz",
  /** Billing contact email */
  BILLING_EMAIL:
    process.env.BRAND_BILLING_EMAIL ?? "billing@yourhosting.co.tz",
  /** From address for transactional emails */
  EMAIL_FROM:
    process.env.BRAND_EMAIL_FROM ?? "noreply@yourhosting.co.tz",
  /** Company legal name */
  COMPANY_NAME:
    process.env.BRAND_COMPANY_NAME ?? "Your Hosting Ltd",
  /** Default currency ISO code */
  DEFAULT_CURRENCY: process.env.BRAND_DEFAULT_CURRENCY ?? "TZS",
  /** Default billing locale */
  DEFAULT_LOCALE: process.env.BRAND_DEFAULT_LOCALE ?? "sw-TZ",
  /** Primary hex color (used in emails + UI theme) */
  PRIMARY_COLOR: process.env.BRAND_PRIMARY_COLOR ?? "#6366f1",
  /** Secondary hex color */
  SECONDARY_COLOR: process.env.BRAND_SECONDARY_COLOR ?? "#0ea5e9",
  /** Logo URL (absolute, served from CDN or public/) */
  LOGO_URL: process.env.BRAND_LOGO_URL ?? "/logo.svg",
  /** Favicon URL */
  FAVICON_URL: process.env.BRAND_FAVICON_URL ?? "/favicon.ico",
  /** Social: Twitter/X handle */
  TWITTER_HANDLE: process.env.BRAND_TWITTER_HANDLE ?? "",
  /** Social: GitHub org */
  GITHUB_URL: process.env.BRAND_GITHUB_URL ?? "",
  /** Copyright line */
  COPYRIGHT: process.env.BRAND_COPYRIGHT ?? `© ${new Date().getFullYear()} Your Hosting Ltd`,
} as const;

export type Brand = typeof BRAND;

/** Resolved brand (reads env at module load time — suitable for server-side) */
export const brand = BRAND;

/**
 * Returns the platform URL for a given customer project slug.
 * e.g. "my-app" → "https://my-app.hosting.co.tz"
 */
export function getPlatformUrl(slug: string): string {
  return `https://${slug}.${BRAND.PLATFORM_SUBDOMAIN_BASE}`;
}

/**
 * Returns a localised currency string.
 * e.g. formatCurrency(5000, "TZS") → "TZS 5,000"
 */
export function formatCurrency(
  amount: number,
  currency: string = BRAND.DEFAULT_CURRENCY,
  locale: string = BRAND.DEFAULT_LOCALE,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

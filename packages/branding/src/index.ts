/**
 * Platform Branding Configuration — Hatdot Cloud
 *
 * All brand-related constants live here.
 * NEVER hardcode platform names in feature code.
 * NEVER remove upstream copyright notices from their original source code licenses.
 */

export const BRAND = {
  /** Platform display name shown in UI */
  APP_NAME: process.env.BRAND_APP_NAME ?? "Hatdot",
  /** Impressive, high-converting tagline */
  TAGLINE:
    process.env.BRAND_TAGLINE ?? "Deploy Instantly. Scale Effortlessly. Own Your Cloud.",
  /** Primary domain for the platform control plane */
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.hatdot.cloud",
  /** Public-facing marketing site */
  MARKETING_URL:
    process.env.BRAND_MARKETING_URL ?? "https://hatdot.cloud",
  /** Platform subdomain base — customer apps get <project>.hatdot.cloud */
  PLATFORM_SUBDOMAIN_BASE:
    process.env.BRAND_PLATFORM_SUBDOMAIN_BASE ?? "hatdot.cloud",
  /** Support email visible to customers */
  SUPPORT_EMAIL:
    process.env.BRAND_SUPPORT_EMAIL ?? "support@hatdot.cloud",
  /** Billing contact email */
  BILLING_EMAIL:
    process.env.BRAND_BILLING_EMAIL ?? "billing@hatdot.cloud",
  /** From address for transactional emails */
  EMAIL_FROM:
    process.env.BRAND_EMAIL_FROM ?? "noreply@hatdot.cloud",
  /** Company legal name */
  COMPANY_NAME:
    process.env.BRAND_COMPANY_NAME ?? "Hatdot Cloud Inc.",
  /** Default currency ISO code */
  DEFAULT_CURRENCY: process.env.BRAND_DEFAULT_CURRENCY ?? "TZS",
  /** Default billing locale */
  DEFAULT_LOCALE: process.env.BRAND_DEFAULT_LOCALE ?? "sw-TZ",
  /** Primary hex color (Hatdot Blue) */
  PRIMARY_COLOR: process.env.BRAND_PRIMARY_COLOR ?? "#0284c7",
  /** Secondary hex color */
  SECONDARY_COLOR: process.env.BRAND_SECONDARY_COLOR ?? "#0369a1",
  /** Logo URL (absolute, served from public/) */
  LOGO_URL: process.env.BRAND_LOGO_URL ?? "/logo.png",
  /** Icon URL */
  ICON_URL: process.env.BRAND_ICON_URL ?? "/logo-icon.png",
  /** Dark Logo URL */
  DARK_LOGO_URL: process.env.BRAND_DARK_LOGO_URL ?? "/logo-dark.jpg",
  /** Favicon URL */
  FAVICON_URL: process.env.BRAND_FAVICON_URL ?? "/favicon.ico",
  /** Social: Twitter/X handle */
  TWITTER_HANDLE: process.env.BRAND_TWITTER_HANDLE ?? "@hatdotcloud",
  /** Social: GitHub org */
  GITHUB_URL: process.env.BRAND_GITHUB_URL ?? "https://github.com/hatdot",
  /** Copyright line */
  COPYRIGHT: process.env.BRAND_COPYRIGHT ?? `© ${new Date().getFullYear()} Hatdot Cloud Inc. All rights reserved.`,
} as const;

export type Brand = typeof BRAND;

/** Resolved brand (reads env at module load time — suitable for server-side) */
export const brand = BRAND;

/**
 * Returns the platform URL for a given customer project slug.
 * e.g. "my-app" → "https://my-app.hatdot.cloud"
 */
export function getPlatformUrl(slug: string): string {
  return `https://${slug}.${BRAND.PLATFORM_SUBDOMAIN_BASE}`;
}

/**
 * Returns a localised currency string.
 * e.g. formatCurrency(50000, "TZS") → "TZS 50,000"
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

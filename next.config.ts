import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { MOVED_SERVICE_PATHS, SHORT_SERVICE_PATHS } from "./lib/seo/short-paths";
import { routing } from "./i18n/routing";

/** "en|fr|es|..." for route patterns; OTHER_LOCALES has no English (no prefix). */
const ALL_LOCALES = routing.locales.join("|");
const OTHER_LOCALES = routing.locales.filter((l) => l !== routing.defaultLocale).join("|");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Content-Security-Policy (production audit, 2026-11-15). Only the services
 * the app really uses are allowed:
 *  - Supabase (realtime websocket + API) from NEXT_PUBLIC_SUPABASE_URL;
 *  - Stripe (checkout redirect / frames), Google avatars, Riot Data Dragon
 *    images, Sentry error reports, Vercel analytics.
 * Inline scripts and styles stay allowed: Next.js injects inline bootstrap
 * scripts and a nonce would force every page to render dynamically. The
 * policy still blocks scripts, frames and connections to any other origin.
 * Set CSP_REPORT_ONLY=true to log violations without blocking (first deploy).
 */
const isDev = process.env.NODE_ENV !== "production";
function supabaseOrigins(): string[] {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [u.origin, `wss://${u.host}`];
  } catch {
    return [];
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://ddragon.leagueoflegends.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "media-src 'self'",
  `connect-src 'self' ${[...supabaseOrigins(), "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io", "https://*.ingest.us.sentry.io", "https://api.stripe.com", "https://ddragon.leagueoflegends.com", "https://vitals.vercel-insights.com", ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : [])].join(" ")}`,
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");
const cspHeader = process.env.CSP_REPORT_ONLY === "true" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

/** Security headers for every response. */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: cspHeader, value: csp },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "ddragon.leagueoflegends.com" }],
  },
  // Short page addresses (client PDFs 2026-11-19). The browser keeps the short
  // address; the old /games/... links keep working. The language proxy runs
  // first and turns /lol-boosting into /en/lol-boosting (or /fr/...), so the
  // short addresses are matched with the language in front.
  // Moved short addresses: permanent redirect, with or without a language prefix.
  async redirects() {
    return Object.entries(MOVED_SERVICE_PATHS).flatMap(([from, to]) => [
      { source: from, destination: to, permanent: true },
      { source: `/:locale(${ALL_LOCALES})${from}`, destination: `/:locale${to}`, permanent: true },
    ]);
  },
  async rewrites() {
    // One list (lib/seo/short-paths.ts) for these rewrites, links, the sitemap and canonical tags.
    return Object.entries(SHORT_SERVICE_PATHS).map(([key, short]) => ({
      source: `/:locale(${ALL_LOCALES})${short}`,
      destination: `/:locale/games/${key.replace("/", "/services/")}`,
    }));
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Signed-in pages and API answers must never be cached by shared caches.
      { source: "/dashboard/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: `/:locale(${OTHER_LOCALES})/dashboard/:path*`, headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      // Public blog images are cached for a year (their own header); every other API answer is not.
      { source: "/api/:path((?!blog/images/).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);

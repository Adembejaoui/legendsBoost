import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";
import { routing } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n/alternates";

/** Private and account pages, in every language (they are also marked noindex). */
const PRIVATE_PATHS = ["/dashboard", "/checkout", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email"];

/** Public storefront and blog are indexable; account, checkout and API routes are not. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", ...routing.locales.flatMap((l) => PRIVATE_PATHS.map((p) => localizedPath(p, l))), "/blog?q="],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

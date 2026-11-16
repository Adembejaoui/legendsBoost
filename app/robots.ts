import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";

/** Public storefront is indexable; account, checkout and API routes are not. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/checkout", "/login", "/register"],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}

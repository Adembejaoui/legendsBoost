import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";
import { getGames } from "@/lib/games";
import { gameServices } from "@/lib/catalog/game-services";
import { routing } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n/alternates";
import { sitemapPosts } from "@/lib/blog/service";
import { logger } from "@/lib/logger";
import { servicePath } from "@/lib/seo/short-paths";

/** Rebuilt at most once an hour (new blog posts). */
export const revalidate = 3600;

/**
 * Public storefront pages (home, games, each game and service page) and the
 * blog, each with its address in every language.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();
  const now = new Date();
  const page = (path: string, changeFrequency: "weekly" | "daily", priority: number): MetadataRoute.Sitemap[number] => ({
    url: url(path),
    lastModified: now,
    changeFrequency,
    priority,
    alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, url(localizedPath(path, l))])) },
  });

  const storefront = [
    page("/", "weekly", 1),
    page("/games", "weekly", 0.8),
    ...getGames().map((g) => page(`/games/${g.slug}`, "weekly", 0.7)),
    // The main address of each service page (short one when it has one).
    ...gameServices.filter((s) => s.visibility !== "hidden").map((s) => page(servicePath(s.gameSlug, s.serviceSlug), "weekly", 0.7)),
    page("/blog", "daily", 0.6),
    page("/boosters", "weekly", 0.5),
  ];

  let posts: Awaited<ReturnType<typeof sitemapPosts>> = [];
  try {
    posts = await sitemapPosts();
  } catch (e) {
    // Database unreachable (e.g. at build time): the storefront is still listed.
    logger.warn("Sitemap without blog posts", { error: e instanceof Error ? e.name : "unknown" });
  }
  const groups = new Map<string, typeof posts>();
  for (const p of posts) groups.set(p.translationGroup, [...(groups.get(p.translationGroup) ?? []), p]);
  const blog = posts.map((p) => ({
    url: url(localizedPath(`/blog/${p.slug}`, p.locale)),
    lastModified: p.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.5,
    alternates: {
      languages: Object.fromEntries((groups.get(p.translationGroup) ?? []).map((v) => [v.locale, url(localizedPath(`/blog/${v.slug}`, v.locale))])),
    },
  }));

  return [...storefront, ...blog];
}

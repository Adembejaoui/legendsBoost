import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/url";
import { getGames } from "@/lib/games";
import { gameServices } from "@/lib/catalog/game-services";

/** Public storefront pages only (home, games, each game and service page). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).toString();
  const now = new Date();
  return [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/games"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...getGames().map((g) => ({ url: url(`/games/${g.slug}`), lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...gameServices
      .map((s) => ({
        url: url(`/games/${s.gameSlug}/services/${s.serviceSlug}`),
        lastModified: now,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
  ];
}

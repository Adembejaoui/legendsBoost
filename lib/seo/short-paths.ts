/**
 * Short public addresses of service pages (client PDFs 2026-11-19). They are
 * the MAIN address of those pages: links, the sitemap and the canonical tag
 * use them, so search engines index one address per page. The long
 * /games/<game>/services/<service> address keeps working (same content,
 * canonical points here). next.config.ts maps them with rewrites.
 * Safe for client, server and next.config.
 */
export const SHORT_SERVICE_PATHS: Record<string, string> = {
  "league-of-legends/rank-boost": "/league-of-legends-rank-boost",
  "league-of-legends/win-boost": "/lol-net-win-boost",
  "league-of-legends/placement-boost": "/lol-placement-boost",
  "league-of-legends/arena-boost": "/lol-arena-boost",
  "league-of-legends/champion-mastery": "/lol-champion-mastery-boost",
  "league-of-legends/normal-matches": "/lol-normal-games-boost",
};

/**
 * Old short addresses that moved (permanent redirect to the new one, so
 * links and search results keep working). Client PDF 2026-11-24.
 */
export const MOVED_SERVICE_PATHS: Record<string, string> = {
  "/lol-boosting": "/lol-net-win-boost",
  // Client PDF 2026-11-25: pages renamed.
  "/champion-mastery": "/lol-champion-mastery-boost",
  "/normal-games": "/lol-normal-games-boost",
};

/** The address to link to for a service page (short when it has one). */
export function servicePath(gameSlug: string, serviceSlug: string): string {
  return SHORT_SERVICE_PATHS[`${gameSlug}/${serviceSlug}`] ?? `/games/${gameSlug}/services/${serviceSlug}`;
}

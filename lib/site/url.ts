/**
 * Absolute public origin of this deployment (metadata, sitemap, robots).
 * Same variables as the Stripe redirects: APP_URL, then NEXTAUTH_URL, then
 * Vercel's production / deployment URL, then localhost for development.
 */
export function siteUrl(): URL {
  const candidates = [
    process.env.APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return new URL(c);
    } catch {
      /* try the next one */
    }
  }
  return new URL("http://localhost:3000");
}

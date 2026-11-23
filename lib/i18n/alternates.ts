import { routing } from "@/i18n/routing";

/** The address of `path` in `locale` (English keeps the address without a prefix). */
export function localizedPath(path: string, locale: string): string {
  if (locale === routing.defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Metadata `alternates` for a public page: the canonical address plus one
 * address per language, so search engines list each language separately.
 */
export function languageAlternates(path: string, locale: string = routing.defaultLocale) {
  return {
    canonical: localizedPath(path, locale),
    languages: Object.fromEntries([
      ...routing.locales.map((l) => [l, localizedPath(path, l)]),
      ["x-default", path],
    ]),
  };
}

/** "/fr/dashboard/x" → "/dashboard/x"; English addresses are returned unchanged. */
export function stripLocale(pathname: string): string {
  for (const l of routing.locales) {
    if (l === routing.defaultLocale) continue;
    if (pathname === `/${l}`) return "/";
    if (pathname.startsWith(`/${l}/`)) return pathname.slice(l.length + 1);
  }
  return pathname;
}

import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import en from "../messages/en.json";

type Messages = typeof en;

/** Missing keys in a language fall back to English instead of showing the key. */
function withFallback(base: Messages, overrides: Record<string, unknown>): Messages {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && b && typeof b === "object" ? withFallback(b as Messages, v as Record<string, unknown>) : v;
  }
  return out as Messages;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = locale === "en" ? en : withFallback(en, (await import(`../messages/${locale}.json`)).default);
  return { locale, messages };
});

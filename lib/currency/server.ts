// Server-only module.
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { CURRENCY_COOKIE, resolveCurrency, type SiteCurrency } from "./currencies";

/** The visitor's currency for server-rendered prices (makes the page dynamic). */
export async function getRequestCurrency(): Promise<SiteCurrency> {
  const [jar, locale] = await Promise.all([cookies(), getLocale()]);
  return resolveCurrency(jar.get(CURRENCY_COOKIE)?.value, locale);
}

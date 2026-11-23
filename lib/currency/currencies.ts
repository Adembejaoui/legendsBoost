/**
 * Currencies a customer can pay in (client decision 2026-11-23: USD, EUR,
 * GBP). Prices are set by admins in one currency per service; the order is
 * priced and charged in the customer's choice at the daily exchange rate
 * (lib/currency/rates.ts). Safe for client and server code.
 */
export const SITE_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type SiteCurrency = (typeof SITE_CURRENCIES)[number];

/** Remembers the visitor's choice (1 year). */
export const CURRENCY_COOKIE = "NEXT_CURRENCY";

export const CURRENCY_LABELS: Record<SiteCurrency, string> = {
  USD: "$ USD",
  EUR: "€ EUR",
  GBP: "£ GBP",
};

export function isSiteCurrency(v: unknown): v is SiteCurrency {
  return typeof v === "string" && (SITE_CURRENCIES as readonly string[]).includes(v);
}

/** Before the visitor picks one: euros on the French site, dollars otherwise. */
export function defaultCurrencyFor(locale: string): SiteCurrency {
  return locale === "fr" ? "EUR" : "USD";
}

/** The cookie value when valid, else the language default. */
export function resolveCurrency(cookieValue: string | undefined | null, locale: string): SiteCurrency {
  const v = cookieValue?.toUpperCase();
  return isSiteCurrency(v) ? v : defaultCurrencyFor(locale);
}

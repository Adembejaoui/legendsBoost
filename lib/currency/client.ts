"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { CURRENCY_COOKIE, defaultCurrencyFor, resolveCurrency, type SiteCurrency } from "./currencies";

const EVENT = "lb:currency";

function readCookie(): string | undefined {
  try {
    return document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${CURRENCY_COOKIE}=`))
      ?.slice(CURRENCY_COOKIE.length + 1);
  } catch {
    return undefined;
  }
}

/** The visitor's currency: their choice (cookie), else the language default. */
export function useCurrency(): SiteCurrency {
  const locale = useLocale();
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    () => resolveCurrency(readCookie(), locale),
    () => defaultCurrencyFor(locale)
  );
}

/** Remember the choice for a year; the server reads the same cookie for "From" prices. */
export function setCurrency(currency: SiteCurrency): void {
  try {
    document.cookie = `${CURRENCY_COOKIE}=${currency}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {
    /* cookies blocked: the choice lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

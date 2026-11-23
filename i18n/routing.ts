import { defineRouting } from "next-intl/routing";

/**
 * Site languages. English is the default and keeps the existing links
 * (/games, /dashboard, ...); other languages add a prefix (/fr/games).
 * Add a language here and a matching messages/<code>.json file.
 */
export const routing = defineRouting({
  locales: ["en", "fr", "es", "de", "ar"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  // Remembered for a year once a visitor picks a language.
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];

/** Name of each language, written in that language (for the picker). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  ar: "العربية",
};

/** Languages written right to left: the page gets dir="rtl" and a mirrored layout. */
export const RTL_LOCALES: readonly string[] = ["ar"];

export function textDirection(locale: string): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

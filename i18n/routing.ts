import { defineRouting } from "next-intl/routing";

/**
 * Site languages. English is the default and keeps the existing links
 * (/games, /dashboard, ...); other languages add a prefix (/fr/games).
 * Add a language here and a matching messages/<code>.json file.
 */
export const routing = defineRouting({
  locales: ["en", "fr"],
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
};

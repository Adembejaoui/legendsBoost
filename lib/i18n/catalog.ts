import { useLocale } from "next-intl";
import { catalogFr } from "@/lib/i18n/catalog/fr";
import { catalogEs } from "@/lib/i18n/catalog/es";
import { catalogDe } from "@/lib/i18n/catalog/de";
import { catalogAr } from "@/lib/i18n/catalog/ar";
import { getDivision, getTier } from "@/lib/catalog/rank-systems";
import type { RankSelection } from "@/types/catalog";

/**
 * Catalog data (games, services, order-form fields, extras, FAQs) is written
 * in English in lib/catalog and lib/config. Other languages translate it by
 * the English text (lib/i18n/catalog/<code>.ts); a text without a
 * translation stays in English. Only what is SHOWN is translated: saved
 * values (option values, slugs, keys) never change.
 */
export const CATALOG_DICTIONARIES: Record<string, Record<string, string>> = { fr: catalogFr, es: catalogEs, de: catalogDe, ar: catalogAr };
const DICTIONARIES = CATALOG_DICTIONARIES;

export type CatalogText = (english: string | undefined | null) => string;

export function catalogText(locale: string): CatalogText {
  const dict = DICTIONARIES[locale];
  return (s) => (s ? (dict?.[s] ?? s) : "");
}

/** Client and server components (not async ones: use catalogText(await getLocale())). */
export function useCatalogText(): CatalogText {
  return catalogText(useLocale());
}

/** "Gold II" in the visitor's language ("Or II"). */
export function rankLabel(ct: CatalogText, rankSystemId: string | undefined, selection: RankSelection | null | undefined, notSelected = "—"): string {
  if (!rankSystemId || !selection) return notSelected;
  const tier = getTier(rankSystemId, selection.tierId);
  const division = selection.divisionId ? getDivision(rankSystemId, selection.tierId, selection.divisionId) : undefined;
  return [tier ? ct(tier.name) : selection.tierId, division?.label].filter(Boolean).join(" ");
}

type Field = { label: string; description?: string; group?: string; unit?: string; optionLabel?: string; options?: { label: string; value: string; description?: string }[] };

/** A copy of an order-form field with its shown texts translated. */
export function localizeField<F extends Field>(f: F, ct: CatalogText): F {
  return {
    ...f,
    label: ct(f.label),
    ...(f.description !== undefined ? { description: ct(f.description) } : {}),
    ...(f.group !== undefined ? { group: ct(f.group) } : {}),
    ...(f.unit !== undefined ? { unit: ct(f.unit) } : {}),
    ...(f.optionLabel !== undefined ? { optionLabel: ct(f.optionLabel) } : {}),
    ...(f.options ? { options: f.options.map((o) => ({ ...o, label: ct(o.label), ...(o.description !== undefined ? { description: ct(o.description) } : {}) })) } : {}),
  };
}

/**
 * Every English text shown from the catalog data (games, services, order
 * form fields and options, FAQs, availability labels). Used by the test
 * that checks each language translates all of them, so a new catalog text
 * cannot ship untranslated.
 */
import { games as catalogGames } from "@/lib/catalog/games";
import { games as homeGames } from "@/lib/games";
import { gameServices } from "@/lib/catalog/game-services";
import { serviceTemplates } from "@/lib/catalog/service-templates";
import { gameFaqs } from "@/lib/game-faqs";
import { faqAC } from "@/lib/content/faqAC";
import { AVAILABILITY_LABEL } from "@/lib/catalog/storefront-types";
import { RIOT_PLATFORM_LABELS } from "@/lib/services/games/league-of-legends/routing";
import { rankSystems } from "@/lib/catalog/rank-systems";
import { checkoutConfigs } from "@/lib/config/checkout-options";

export function catalogStrings(): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined | null) => {
    if (s && /[A-Za-z]/.test(s)) out.add(s);
  };
  for (const g of catalogGames) {
    add(g.shortDescription);
    add(g.description);
    add(g.availabilityLabel);
  }
  for (const g of homeGames) {
    add(g.description);
    add(g.serviceSummary);
    add(g.availabilityLabel);
  }
  for (const t of serviceTemplates) {
    add(t.title);
    add(t.description);
  }
  for (const o of gameServices) {
    add(o.title);
    add(o.description);
    add(o.availabilityLabel);
    for (const f of o.fields) {
      add(f.label);
      add(f.description);
      add(f.group);
      if (f.type === "number") {
        add(f.unit);
        add(f.optionLabel);
      }
      if (f.type === "select" || f.type === "multi-select") for (const opt of f.options) add(opt.label);
    }
  }
  for (const list of Object.values(gameFaqs)) for (const f of list) (add(f.q), add(f.a));
  for (const list of Object.values(faqAC)) for (const f of list) (add(f.question), add(f.answer));
  for (const l of Object.values(AVAILABILITY_LABEL)) add(l);
  for (const l of Object.values(RIOT_PLATFORM_LABELS)) add(l);
  for (const rs of rankSystems) for (const t of rs.tiers) add(t.name);
  for (const c of checkoutConfigs) {
    for (const m of c.modes ?? []) add(m.label);
    for (const o of c.options) {
      add(o.label);
      add(o.description);
      add(o.descriptionDuo);
      for (const x of o.options ?? []) add(x.label);
    }
  }
  return [...out];
}

/**
 * Catalog texts (games, services, order form, extras, FAQs, ranks) are
 * translated by their English text. Every one of them needs a French
 * entry, so a new service or option cannot ship half in English.
 */
import { describe, it, expect } from "vitest";
import { catalogStrings } from "@/lib/i18n/catalog-strings";
import { catalogFr } from "@/lib/i18n/catalog/fr";
import { catalogText, localizeField, rankLabel } from "@/lib/i18n/catalog";

describe("catalog translations", () => {
  it("French translates every catalog text", () => {
    expect(catalogStrings().filter((s) => !(s in catalogFr))).toEqual([]);
  });

  it("no French entry is empty and placeholders are kept", () => {
    for (const [en, fr] of Object.entries(catalogFr)) {
      expect(fr.trim(), en).not.toBe("");
      expect(fr.match(/\{\w+\}/g) ?? [], en).toEqual(en.match(/\{\w+\}/g) ?? []);
    }
  });

  it("English and unknown texts are shown as they are", () => {
    expect(catalogText("en")("Current rank")).toBe("Current rank");
    expect(catalogText("fr")("A text nobody translated")).toBe("A text nobody translated");
    expect(catalogText("fr")(undefined)).toBe("");
  });

  it("a field keeps its key and option values; only shown texts change", () => {
    const field = {
      type: "select" as const,
      key: "queueType",
      label: "Queue Type",
      options: [{ label: "Ranked Flex", value: "ranked-flex" }],
    };
    expect(localizeField(field, catalogText("fr"))).toEqual({
      type: "select",
      key: "queueType",
      label: "Type de file",
      options: [{ label: "Classé Flex", value: "ranked-flex" }],
    });
  });

  it("ranks read in the visitor's language", () => {
    expect(rankLabel(catalogText("fr"), "lol-ranked", { tierId: "gold", divisionId: "ii" })).toBe("Or II");
    expect(rankLabel(catalogText("en"), "lol-ranked", { tierId: "gold", divisionId: "ii" })).toBe("Gold II");
  });
});

/**
 * Site languages (multi-language, 2026-11-23): every language file has the
 * same texts as English, with the same {placeholders} and <tags>, and the
 * address helpers keep English links unchanged.
 */
import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import es from "@/messages/es.json";
import de from "@/messages/de.json";
import ar from "@/messages/ar.json";
import { routing } from "@/i18n/routing";
import { languageAlternates, localizedPath, stripLocale } from "@/lib/i18n/alternates";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const tokens = (s: string) => [...s.matchAll(/\{(\w+)[^}]*\}|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort();

const languages: Record<string, Tree> = { fr, es, de, ar };

describe("language files", () => {
  const base = flatten(en);

  it("every site language has a messages file", () => {
    for (const l of routing.locales) if (l !== "en") expect(languages[l], l).toBeDefined();
  });

  for (const [code, tree] of Object.entries(languages)) {
    const other = flatten(tree);
    it(`${code}: has every English text and nothing extra`, () => {
      expect(Object.keys(other).filter((k) => !(k in base))).toEqual([]);
      expect(Object.keys(base).filter((k) => !(k in other))).toEqual([]);
    });
    it(`${code}: keeps the same {placeholders} and <tags>`, () => {
      for (const [k, v] of Object.entries(other)) expect(tokens(v), k).toEqual(tokens(base[k]));
    });
    it(`${code}: no text is empty`, () => {
      for (const [k, v] of Object.entries(other)) expect(v.trim(), k).not.toBe("");
    });
  }
});

describe("language addresses", () => {
  it("English keeps the address without a prefix, French adds /fr", () => {
    expect(localizedPath("/games", "en")).toBe("/games");
    expect(localizedPath("/games", "fr")).toBe("/fr/games");
    expect(localizedPath("/", "fr")).toBe("/fr");
  });

  it("strips the language from an address", () => {
    expect(stripLocale("/fr/dashboard/abc")).toBe("/dashboard/abc");
    expect(stripLocale("/fr")).toBe("/");
    expect(stripLocale("/dashboard/abc")).toBe("/dashboard/abc");
    expect(stripLocale("/french-page")).toBe("/french-page");
  });

  it("lists each language's address for search engines", () => {
    expect(languageAlternates("/games", "fr")).toEqual({
      canonical: "/fr/games",
      languages: { en: "/games", fr: "/fr/games", es: "/es/games", de: "/de/games", ar: "/ar/games", "x-default": "/games" },
    });
  });
});

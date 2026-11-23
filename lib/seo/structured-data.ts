/**
 * schema.org structured data (JSON-LD) for search engines. Plain objects;
 * rendered by components/seo/JsonLd.tsx. Every URL is absolute.
 */
import { siteUrl } from "@/lib/site/url";
import { localizedPath } from "@/lib/i18n/alternates";
import { toDecimalString } from "@/lib/money";

type Json = Record<string, unknown>;

export function absoluteUrl(path: string, locale?: string): string {
  return new URL(locale ? localizedPath(path, locale) : path, siteUrl()).toString();
}

export function organizationLd(description: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: "LegendsBoost",
    url: absoluteUrl("/"),
    logo: absoluteUrl("/images/og.jpg"),
    description,
  };
}

export function websiteLd(locale: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    name: "LegendsBoost",
    url: absoluteUrl("/", locale),
    inLanguage: locale,
    publisher: { "@id": absoluteUrl("/#organization") },
  };
}

/** Breadcrumb trail; the last item is the current page. */
export function breadcrumbLd(items: { name: string; path: string }[], locale: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path, locale) })),
  };
}

export function faqLd(items: { question: string; answer: string }[]): Json | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
}

/** A service page: what is sold, by whom, and its starting price when it can be bought. */
export function serviceLd(p: {
  name: string;
  description: string;
  gameName: string;
  path: string;
  locale: string;
  price: { amount: number; currency: string } | null;
}): Json {
  const url = absoluteUrl(p.path, p.locale);
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: p.name,
    description: p.description,
    serviceType: `${p.gameName} ${p.name}`,
    category: p.gameName,
    url,
    inLanguage: p.locale,
    provider: { "@id": absoluteUrl("/#organization") },
    areaServed: "Worldwide",
    ...(p.price
      ? {
          offers: {
            "@type": "Offer",
            url,
            price: toDecimalString(p.price.amount, p.price.currency),
            priceCurrency: p.price.currency,
            availability: "https://schema.org/InStock",
            description: "Starting price",
          },
        }
      : {}),
  };
}

/** JSON for a <script type="application/ld+json"> ("<" escaped so nothing can close the tag). */
export function ldScript(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Blog body helpers (safe for client and server).
 *
 * Order box: a line that contains only `[service:<game>/<service>]`, e.g.
 * `[service:league-of-legends/rank-boost]`, becomes a card with the
 * service's live starting price and an order button.
 */
import { getGameServiceOffer } from "@/lib/catalog/game-services";

export type BodyBlock = { type: "markdown"; text: string } | { type: "service"; gameSlug: string; serviceSlug: string };

const EMBED = /^\s*\[service:([a-z0-9-]+)\/([a-z0-9-]+)\]\s*$/;

/** Split the body into Markdown parts and order boxes (unknown services stay as text). */
export function splitBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let buffer: string[] = [];
  let fenced = false;
  const flush = () => {
    if (buffer.join("").trim()) blocks.push({ type: "markdown", text: buffer.join("\n") });
    buffer = [];
  };
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced ? EMBED.exec(line) : null;
    if (m && getGameServiceOffer(m[1], m[2])) {
      flush();
      blocks.push({ type: "service", gameSlug: m[1], serviceSlug: m[2] });
    } else buffer.push(line);
  }
  flush();
  return blocks;
}

/** Anchor id for a heading ("LP gains, explained!" -> "lp-gains-explained"). */
export function headingId(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/** "## " headings for the table of contents (code blocks skipped). */
export function tableOfContents(body: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let fenced = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      const text = m[1].replace(/[*_`]/g, "");
      out.push({ id: headingId(text), text });
    }
  }
  return out;
}

/** Only our own uploaded images are shown in posts (and allowed by the CSP). */
export function isAllowedImage(src: unknown): src is string {
  return typeof src === "string" && /^\/api\/blog\/images\/[a-z0-9]{10,40}$/i.test(src);
}

/** A link inside the site (kept in the visitor's language) or an outside one. */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** Plain-text summary length for search results. */
export function slugify(text: string): string {
  return headingId(text).slice(0, 100);
}

// Server-only module.
/**
 * Transactional email through Resend (decision 2026-11-15).
 *
 * Env: RESEND_API_KEY and EMAIL_FROM (e.g. "LegendsBoost <no-reply@your-domain>",
 * the domain must be verified in Resend). Without a key nothing is sent:
 * in development the message (with its link) is written to the server log so
 * the flows can be tested; in production only a warning is logged.
 * Never throws: callers answer the same way whether the email left or not.
 */
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body (also used to build the HTML). */
  text: string;
  /** Optional button. */
  action?: { label: string; url: string };
  /** Optional extra block (trusted, already escaped HTML) shown after the text. */
  html?: string;
  /** Button / brand colour (default gold). */
  accent?: string;
  /** Text colour on the button. */
  onAccent?: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmailHtml(m: EmailMessage): string {
  const paragraphs = m.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#d4d4d8;font-size:15px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const accent = m.accent ?? "#C8AA6E";
  const onAccent = m.onAccent ?? "#0A0E14";
  const button = m.action
    ? `<p style="margin:22px 0"><a href="${esc(m.action.url)}" style="display:inline-block;background:${esc(accent)};color:${esc(onAccent)};font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px">${esc(m.action.label)}</a></p>
       <p style="margin:0 0 14px;color:#71717a;font-size:12px;line-height:1.5">If the button does not work, copy this link:<br><span style="color:#a1a1aa;word-break:break-all">${esc(m.action.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0b0c10;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="font-size:22px;font-weight:700;color:#ffffff;margin-bottom:20px">Legends<span style="color:#C8AA6E">Boost</span></div>
  <div style="background:#111319;border:1px solid #23262f;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 14px;font-size:18px;color:#ffffff">${esc(m.subject)}</h1>
    ${paragraphs}${m.html ?? ""}${button}
  </div>
  <p style="margin:16px 0 0;color:#52525b;font-size:12px">You received this email because of an action on your LegendsBoost account.</p>
</div></body></html>`;
}

export async function sendEmail(m: EmailMessage): Promise<{ sent: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") {
      logger.warn("Email not sent: RESEND_API_KEY / EMAIL_FROM are not set", { subject: m.subject });
    } else {
      logger.info("Email (not sent, no RESEND_API_KEY)", { to: m.to, subject: m.subject, link: m.action?.url });
    }
    return { sent: false };
  }
  try {
    const text = m.action ? `${m.text}\n\n${m.action.label}: ${m.action.url}` : m.text;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text, html: renderEmailHtml(m) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error("Email provider refused the message", { status: res.status, subject: m.subject });
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    logger.error("Email send failed", { error: e instanceof Error ? e.name : "unknown", subject: m.subject });
    return { sent: false };
  }
}

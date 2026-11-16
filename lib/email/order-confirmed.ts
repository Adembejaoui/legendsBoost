// Server-only module.
/**
 * "Order confirmed" email, sent once per paid order by the outbox
 * (EMAIL_ORDER_CONFIRMED, queued in the same transaction that marks the
 * order paid). Same content as the checkout success page.
 */
import prisma from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { buildOrderSummary, type OrderSummary } from "@/lib/orders/order-summary";
import { gameTheme } from "@/components/orders/workspace/game-theme";
import { appUrl, emailConfigured, sendEmail, type EmailMessage } from "./send";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const row = (label: string, value: string, strong = false, color = "#d4d4d8") =>
  `<tr><td style="padding:6px 0;color:#71717a;font-size:14px">${esc(label)}</td><td style="padding:6px 0;text-align:right;color:${color};font-size:${strong ? 17 : 14}px;font-weight:${strong ? 700 : 500}">${esc(value)}</td></tr>`;

/** Email for a summary; exported for tests and previews. */
export function orderConfirmedEmail(to: string, orderId: string, s: OrderSummary): EmailMessage {
  const theme = gameTheme(s.gameSlug);
  const p = s.pricing;
  const money = (n: number) => (p ? formatMoney(n, p.currency) : "");
  const rankLine = s.ranks ? `${s.ranks.from?.label ?? "—"} → ${s.ranks.to?.label ?? "—"}` : null;

  const rows: string[] = [];
  rows.push(row("Game", s.gameName));
  rows.push(row("Service", s.serviceName));
  if (s.mode) rows.push(row("Mode", s.mode));
  for (const d of s.details) rows.push(row(d.label, d.value));
  if (s.options.length) rows.push(row("Options", s.options.join(", ")));

  const priceRows: string[] = [];
  if (p) {
    for (const l of p.lines) priceRows.push(row(l.label, money(l.amount)));
    if (p.discountAmount > 0) priceRows.push(row("Discount", `−${money(p.discountAmount)}`, false, "#34d399"));
    priceRows.push(
      `<tr><td colspan="2" style="border-top:1px solid #23262f;padding:0;height:8px"></td></tr>` + row("Total paid", money(p.totalAmount), true, theme.light)
    );
  }

  const html = `
<div style="margin:6px 0 18px;padding:14px 16px;border-radius:10px;background:#0b0c10;border:1px solid #23262f">
  <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${theme.light};font-weight:600">${esc(s.gameName)} · Order #${esc(s.reference)}</div>
  <div style="margin-top:4px;font-size:17px;font-weight:700;color:#ffffff">${esc(s.serviceName)}</div>
  ${rankLine ? `<div style="margin-top:10px;font-size:16px;font-weight:600;color:${theme.light}">${esc(rankLine)}</div>` : ""}
</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:6px">${rows.join("")}</table>
${priceRows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:10px;border-top:1px solid #23262f;padding-top:6px">${priceRows.join("")}</table>` : ""}`;

  const textLines = [
    `Thank you for your order! Your payment is confirmed and your order #${s.reference} is now available to our boosters.`,
    [
      `${s.gameName} · ${s.serviceName}${s.mode ? ` (${s.mode})` : ""}`,
      rankLine,
      ...s.details.map((d) => `${d.label}: ${d.value}`),
      s.options.length ? `Options: ${s.options.join(", ")}` : null,
      p ? `Total paid: ${money(p.totalAmount)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "We will let you know as soon as a booster starts. You can follow the progress and chat with your booster from your order page.",
  ];

  return {
    to,
    subject: `Order confirmed · #${s.reference}`,
    text: textLines.join("\n\n"),
    html,
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "Open my order", url: `${appUrl()}/dashboard/${orderId}` },
  };
}

/** Outbox handler. Throws when the provider refused, so the outbox retries. */
export async function sendOrderConfirmedEmail(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true, deletedAt: true } },
      pricingSnapshot: { select: { currency: true, discountAmount: true, totalAmount: true, breakdown: true } },
    },
  });
  if (!order || !order.paymentVerifiedAt || !order.user?.email || order.user.deletedAt) return;
  const { sent } = await sendEmail(orderConfirmedEmail(order.user.email, order.id, buildOrderSummary(order)));
  if (!sent && emailConfigured()) throw new Error("Order confirmation email not accepted");
}

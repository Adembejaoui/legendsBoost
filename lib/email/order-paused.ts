// Server-only module.
/**
 * "The customer paused order #…" email to the assigned booster, sent by the
 * outbox (EMAIL_ORDER_PAUSED) when the customer pauses (sound test 2026-11-22).
 */
import prisma from "@/lib/prisma";
import { buildOrderSummary } from "@/lib/orders/order-summary";
import { gameTheme } from "@/components/orders/workspace/game-theme";
import { appUrl, emailConfigured, sendEmail, type EmailMessage } from "./send";

export function orderPausedEmail(p: { to: string; orderId: string; reference: string; gameSlug: string }): EmailMessage {
  const theme = gameTheme(p.gameSlug);
  return {
    to: p.to,
    subject: `The customer paused order #${p.reference}`,
    text: "Stop boosting now and do not play any game on this account until the customer resumes the order. Games played while the order is paused are flagged.",
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "Open the order", url: `${appUrl()}/dashboard/${p.orderId}` },
  };
}

/** Outbox handler. Throws when the provider refused, so the outbox retries. */
export async function sendOrderPausedEmail(orderId: string, boosterId: string): Promise<void> {
  const [order, booster] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.user.findUnique({ where: { id: boosterId }, select: { email: true, deletedAt: true } }),
  ]);
  // Resumed before the email went out: nothing to say any more.
  if (!order || order.status !== "PAUSED" || !booster?.email || booster.deletedAt) return;
  const s = buildOrderSummary({ ...order, pricingSnapshot: null });
  const { sent } = await sendEmail(orderPausedEmail({ to: booster.email, orderId, reference: s.reference, gameSlug: order.gameSlug }));
  if (!sent && emailConfigured()) throw new Error("Order paused email not accepted");
}

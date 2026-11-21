// Server-only module.
/**
 * "Your customer needs your attention" email to the booster, sent by the
 * outbox (EMAIL_BOOSTER_POKE) when the customer pokes them (client PDF 2026-11-21).
 */
import prisma from "@/lib/prisma";
import { buildOrderSummary } from "@/lib/orders/order-summary";
import { gameTheme } from "@/components/orders/workspace/game-theme";
import { appUrl, emailConfigured, sendEmail, type EmailMessage } from "./send";

export function boosterPokeEmail(p: { to: string; orderId: string; reference: string; gameSlug: string }): EmailMessage {
  const theme = gameTheme(p.gameSlug);
  return {
    to: p.to,
    subject: `Your customer needs your attention on order #${p.reference}`,
    text: "Please open the order chat to check in with your customer.",
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "Open order chat", url: `${appUrl()}/dashboard/${p.orderId}?view=chat` },
  };
}

/** Outbox handler. Throws when the provider refused, so the outbox retries. */
export async function sendBoosterPokeEmail(orderId: string, boosterId: string): Promise<void> {
  const [order, booster] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.user.findUnique({ where: { id: boosterId }, select: { email: true, deletedAt: true } }),
  ]);
  if (!order || !booster?.email || booster.deletedAt) return;
  const s = buildOrderSummary({ ...order, pricingSnapshot: null });
  const { sent } = await sendEmail(boosterPokeEmail({ to: booster.email, orderId, reference: s.reference, gameSlug: order.gameSlug }));
  if (!sent && emailConfigured()) throw new Error("Poke email not accepted");
}

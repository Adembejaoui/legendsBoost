// Server-only module.
/**
 * Stalled order emails to the booster (2026-11-24), sent by the outbox
 * (EMAIL_BOOSTER_STALL): the 2 h warning, the final warning 1 h before the
 * order is taken back, and the "order taken back" notice with the fine.
 */
import prisma from "@/lib/prisma";
import { buildOrderSummary } from "@/lib/orders/order-summary";
import { gameTheme } from "@/components/orders/workspace/game-theme";
import { formatMoney } from "@/lib/money";
import { appUrl, emailConfigured, sendEmail, type EmailMessage } from "./send";

export type StallEmailKind = "warning" | "final" | "released";

export interface StallEmailPayload {
  orderId: string;
  boosterId: string;
  kind: StallEmailKind;
  /** warning/final: hours without activity so far; released: the release limit. */
  hours: number;
  releaseHours?: number;
  fineMinor?: number;
  currency?: string;
  blocked?: boolean;
  /** warning/final: the assignment the warning was for (skipped once it ended). */
  assignmentId?: string;
}

export function boosterStallEmail(p: StallEmailPayload & { to: string; reference: string; gameSlug: string }): EmailMessage {
  const theme = gameTheme(p.gameSlug);
  const orderUrl = `${appUrl()}/dashboard/${p.orderId}?view=chat`;
  if (p.kind === "released") {
    const fine = p.fineMinor && p.currency ? formatMoney(p.fineMinor, p.currency) : null;
    return {
      to: p.to,
      subject: `Order #${p.reference} was taken back`,
      text: [
        `Order #${p.reference} had no messages, games or rank updates for ${p.hours} hours, so it was taken back from you.`,
        fine ? `A fine of ${fine} will be taken off your next payout. If you think this is wrong, you can appeal it once on Fines/Abandoned Orders.` : "",
        p.blocked ? "This is your third order taken back in 30 days: you cannot take new orders until our team reviews your account. Contact support." : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      accent: theme.accent,
      onAccent: theme.onAccent,
      action: { label: "See my fines", url: `${appUrl()}/dashboard/booster/rules` },
    };
  }
  const releaseHours = p.releaseHours ?? 24;
  return {
    to: p.to,
    subject: p.kind === "final" ? `Order #${p.reference} will be taken back in 1 hour` : `Order #${p.reference} needs your attention`,
    text:
      p.kind === "final"
        ? `Order #${p.reference} has had no messages, games or rank updates for ${p.hours} hours. Message the customer or play now: in 1 hour the order is taken back and you are fined.`
        : `Order #${p.reference} has had no messages, games or rank updates for ${p.hours} hours.\n\nMessage the customer or post a progress update. After ${releaseHours} hours without activity the order is taken back from you and you are fined.`,
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "Open order chat", url: orderUrl },
  };
}

/** Outbox handler. Throws when the provider refused, so the outbox retries. */
export async function sendBoosterStallEmail(p: StallEmailPayload): Promise<void> {
  const [order, booster] = await Promise.all([
    prisma.order.findUnique({ where: { id: p.orderId } }),
    prisma.user.findUnique({ where: { id: p.boosterId }, select: { email: true, deletedAt: true } }),
  ]);
  if (!order || !booster?.email || booster.deletedAt) return;
  if (p.kind !== "released" && p.assignmentId) {
    // The booster acted (or the order moved on) before the email went out.
    const a = await prisma.orderBoosterAssignment.findUnique({ where: { id: p.assignmentId }, select: { status: true } });
    if (!a || !["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(a.status)) return;
  }
  const s = buildOrderSummary({ ...order, pricingSnapshot: null });
  const { sent } = await sendEmail(boosterStallEmail({ ...p, to: booster.email, reference: s.reference, gameSlug: order.gameSlug }));
  if (!sent && emailConfigured()) throw new Error("Stall email not accepted");
}

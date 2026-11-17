// Server-only module.
/**
 * "Your boost is done, please confirm" email to the customer, sent once per
 * completion request by the outbox (EMAIL_COMPLETION_SUBMITTED).
 */
import prisma from "@/lib/prisma";
import { buildOrderSummary } from "@/lib/orders/order-summary";
import { gameTheme } from "@/components/orders/workspace/game-theme";
import { appUrl, emailConfigured, sendEmail, type EmailMessage } from "./send";

export function completionSubmittedEmail(p: {
  to: string;
  orderId: string;
  reference: string;
  gameSlug: string;
  serviceName: string;
  autoConfirmAt: Date;
}): EmailMessage {
  const theme = gameTheme(p.gameSlug);
  const when = p.autoConfirmAt.toUTCString().replace(/:\d\d GMT$/, " UTC");
  return {
    to: p.to,
    subject: `Your order #${p.reference} is done: please confirm`,
    text: [
      `Good news! Your booster has finished your ${p.serviceName} (order #${p.reference}) and uploaded screenshots of the result.`,
      `Please check them and confirm, or tell us if something is wrong. If we do not hear from you, the order is confirmed automatically on ${when}.`,
      `Your booster no longer has access to your account login. You can change your password now if you wish.`,
    ].join("\n\n"),
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "Review and confirm", url: `${appUrl()}/dashboard/${p.orderId}` },
  };
}

/** Outbox handler. Throws when the provider refused, so the outbox retries. */
export async function sendCompletionSubmittedEmail(requestId: string): Promise<void> {
  const r = await prisma.orderCompletionRequest.findUnique({
    where: { id: requestId },
    include: { order: { include: { user: { select: { email: true, deletedAt: true } } } } },
  });
  if (!r || r.status !== "PENDING" || !r.order.user?.email || r.order.user.deletedAt) return;
  const s = buildOrderSummary({ ...r.order, pricingSnapshot: null });
  const { sent } = await sendEmail(
    completionSubmittedEmail({
      to: r.order.user.email,
      orderId: r.orderId,
      reference: s.reference,
      gameSlug: r.order.gameSlug,
      serviceName: s.serviceName,
      autoConfirmAt: r.autoConfirmAt,
    })
  );
  if (!sent && emailConfigured()) throw new Error("Completion email not accepted");
}

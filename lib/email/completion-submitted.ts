// Server-only module.
/**
 * "Your boost is done" email to the customer, sent once per completion
 * request by the outbox (EMAIL_COMPLETION_SUBMITTED). Since 2026-11-22 an
 * admin marks the order Completed; the customer only checks the screenshots.
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
  return {
    to: p.to,
    subject: `Your order #${p.reference} is done`,
    text: [
      `Good news! Your booster has finished your ${p.serviceName} (order #${p.reference}) and uploaded screenshots of the result.`,
      `You can see them on your order page. Our team checks them and marks the order Completed. If something is wrong, tell us from the order page.`,
      `Your booster no longer has access to your account login. You can change your password now if you wish.`,
    ].join("\n\n"),
    accent: theme.accent,
    onAccent: theme.onAccent,
    action: { label: "See the screenshots", url: `${appUrl()}/dashboard/${p.orderId}` },
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

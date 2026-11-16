/**
 * Customer-facing order representation. Excludes internal fields (the
 * idempotency hash, the commission split, payment references).
 */
type SnapshotLike = {
  currency: string;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  breakdown: unknown;
} | null;

export function toPublicOrder(order: {
  id: string;
  status: string;
  gameSlug: string;
  serviceSlug: string;
  configuration: unknown;
  selectedMode: string | null;
  selectedOptions: string[];
  createdAt: Date;
  paymentVerifiedAt: Date | null;
  pricingSnapshot?: SnapshotLike;
}) {
  const s = order.pricingSnapshot ?? null;
  return {
    id: order.id,
    status: order.status,
    gameSlug: order.gameSlug,
    serviceSlug: order.serviceSlug,
    configuration: order.configuration,
    selectedMode: order.selectedMode,
    selectedOptions: order.selectedOptions,
    createdAt: order.createdAt.toISOString(),
    paid: order.paymentVerifiedAt !== null,
    pricing: s
      ? {
          currency: s.currency,
          subtotalAmount: s.subtotalAmount,
          discountAmount: s.discountAmount,
          taxAmount: s.taxAmount,
          totalAmount: s.totalAmount,
          lines: ((s.breakdown as { lines?: unknown[] } | null)?.lines ?? []) as { code: string; label: string; amount: number }[],
        }
      : null,
  };
}

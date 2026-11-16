/**
 * Server-side catalog eligibility for creating a purchasable order.
 *
 * Deny by default: an order can be created only when BOTH the catalog offer
 * and its checkout configuration explicitly allow live ordering. The frontend
 * may hide or disable buttons, but this check is the enforcement point.
 *
 * Publication (availability / orderCapability / allowOrder) and compliance
 * (complianceStatus) are separate gates:
 *   - "rejected" compliance always blocks ordering.
 *   - "pending-review" compliance blocks every REAL sale. It is waived only
 *     while Stripe runs with TEST keys, where no real money can be charged,
 *     so the owner can test the purchase flow end to end. The status itself
 *     is never changed or reported as approved.
 */
import { getGameServiceOffer, getGameServiceOffers } from "@/lib/catalog/game-services";
import { getCheckoutConfig, type GameCheckoutConfig } from "@/lib/config/checkout-options";
import { serverPaymentMode, type PaymentMode } from "@/lib/stripe/mode";
import type { GameServiceOffer } from "@/types/catalog";

export type OrderEligibility =
  | {
      ok: true;
      offer: GameServiceOffer;
      checkout: GameCheckoutConfig;
      /** True when the order is allowed only because Stripe is in test mode. */
      complianceWaivedForTestMode: boolean;
    }
  | { ok: false; status: 400 | 403; reason: string };

export const NOT_PURCHASABLE_MESSAGE = "This service is not available for purchase yet.";

type Compliance = "pending-review" | "approved" | "rejected" | undefined;

/** Pure rule set (exported for tests). paymentMode defaults to the strictest case. */
export function evaluateOrderEligibility(
  offer: GameServiceOffer | undefined,
  checkout: GameCheckoutConfig | undefined,
  paymentMode: PaymentMode = "live"
): OrderEligibility {
  if (!offer) return { ok: false, status: 400, reason: "Invalid game/service combination" };
  if (offer.visibility === "hidden") return { ok: false, status: 403, reason: "Service not available" };

  // Offer-level publication flags.
  if (offer.availability !== "available") return deny();
  if (offer.orderCapability !== undefined && offer.orderCapability !== "live-order") return deny();

  // Checkout-level publication flags. A missing checkout config is not purchasable.
  if (!checkout) return deny();
  if (checkout.visibility === "hidden") return { ok: false, status: 403, reason: "Service not available" };
  if (checkout.availability !== "available") return deny();
  if (checkout.orderCapability !== "live-order") return deny();
  if (checkout.allowOrder !== true) return deny();

  // Compliance gate.
  const statuses: Compliance[] = [offer.complianceStatus, checkout.complianceStatus];
  if (statuses.includes("rejected")) return deny();
  const pending = statuses.some((s) => s !== undefined && s !== "approved");
  if (pending && paymentMode !== "test") return deny();

  return { ok: true, offer, checkout, complianceWaivedForTestMode: pending };
}

function deny(): OrderEligibility {
  return { ok: false, status: 403, reason: NOT_PURCHASABLE_MESSAGE };
}

export function getOrderEligibility(gameSlug: string, serviceSlug: string): OrderEligibility {
  return evaluateOrderEligibility(
    getGameServiceOffer(gameSlug, serviceSlug),
    getCheckoutConfig(gameSlug, serviceSlug),
    serverPaymentMode()
  );
}

/** Game badge: "Available" when at least one of its services can be ordered right now. */
export function getGamePurchaseLabel(gameSlug: string): string {
  return getGameServiceOffers(gameSlug).some((o) => getOrderEligibility(o.gameSlug, o.serviceSlug).ok)
    ? "Available"
    : "Under review";
}

/** Display summary computed on the server (badges must match the server rule). */
export function getPurchaseStatus(gameSlug: string, serviceSlug: string): { orderable: boolean; testMode: boolean } {
  const e = getOrderEligibility(gameSlug, serviceSlug);
  return { orderable: e.ok, testMode: e.ok && e.complianceWaivedForTestMode };
}

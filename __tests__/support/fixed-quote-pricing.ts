/**
 * For the older, in-memory (non-Postgres) order tests: keep the REAL catalog
 * eligibility gate but replace the database price lookup with a fixed 100.00
 * EUR quote. Real pricing is covered by __tests__/payments/*.
 *
 *   vi.mock("@/lib/pricing/service", async (orig) =>
 *     (await import("../support/fixed-quote-pricing")).withFixedQuote(await orig()));
 */
import type * as PricingService from "@/lib/pricing/service";
import { getOrderEligibility } from "@/lib/orders/order-eligibility";

export function withFixedQuote(actual: typeof PricingService): typeof PricingService {
  return {
    ...actual,
    buildServerQuote: async (request) => {
      const eligibility = getOrderEligibility(request.gameSlug, request.serviceSlug);
      if (!eligibility.ok) throw new actual.PricingError(eligibility.reason, eligibility.status);
      return {
        serviceTitle: request.serviceSlug,
        estimate: null,
        coupon: null,
        cashback: null,
        cashbackEarn: 0,
        input: {
          gameSlug: request.gameSlug,
          serviceSlug: request.serviceSlug,
          configuration: request.configuration ?? {},
          selectedMode: request.selectedMode ?? null,
          selectedOptions: request.selectedOptions ?? [],
          championsRoles: null,
        },
        quote: {
          currency: "EUR",
          lines: [{ code: "BASE", label: "Base price", amount: 10000 }],
          subtotalAmount: 10000,
          discountAmount: 0,
          cashbackAmount: 0,
          taxAmount: 0,
          totalAmount: 10000,
          commissionBaseAmount: 10000,
          commission: { platformFeeBps: 4500, boosterShareBps: 5500, platformFeeAmount: 4500, boosterShareAmount: 5500 },
          servicePriceId: "price-fixed",
          servicePriceVersion: 1,
          commissionPolicyId: "commission_policy_initial_45_55",
          optionAmounts: {},
        },
      };
    },
  };
}

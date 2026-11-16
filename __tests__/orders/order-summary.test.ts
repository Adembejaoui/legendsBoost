// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/email/send", async (orig) => ({ ...(await orig<typeof import("@/lib/email/send")>()), appUrl: () => "https://app.test" }));

import { buildOrderSummary } from "@/lib/orders/order-summary";
import { orderConfirmedEmail } from "@/lib/email/order-confirmed";
import { renderEmailHtml } from "@/lib/email/send";

const order = {
  id: "ckorder000000000abcd1234",
  gameSlug: "league-of-legends",
  serviceSlug: "rank-boost",
  configuration: { currentRank: { tierId: "gold", divisionId: "ii" }, targetRank: { tierId: "platinum", divisionId: "iv" } },
  selectedMode: "duo",
  selectedOptions: ["priority-completion", "unknown-option"],
  pricingSnapshot: {
    currency: "EUR",
    discountAmount: 500,
    totalAmount: 4500,
    breakdown: { lines: [{ code: "base", label: "Gold II → Platinum IV", amount: 4000 }, { code: "opt", label: "Priority completion", amount: 1000 }] },
  },
};

describe("order summary", () => {
  it("reads labels from the catalog and keeps ranks apart from other details", () => {
    const s = buildOrderSummary(order);
    expect(s.reference).toBe("ABCD1234");
    expect(s.gameName).toBe("League of Legends");
    expect(s.serviceName).toBe("Rank Boost");
    expect(s.mode).toBe("Duo");
    expect(s.ranks?.from?.label).toMatch(/Gold/);
    expect(s.ranks?.to?.label).toMatch(/Platinum/);
    expect(s.ranks?.from?.iconSrc).toBeTruthy();
    expect(s.details.some((d) => /rank/i.test(d.label))).toBe(false);
    expect(s.options).toContain("unknown-option"); // unknown ids are shown as-is, never dropped
    expect(s.pricing).toMatchObject({ currency: "EUR", totalAmount: 4500, discountAmount: 500 });
    expect(s.pricing?.lines).toHaveLength(2);
  });

  it("has no ranks or pricing when there are none", () => {
    const s = buildOrderSummary({ ...order, serviceSlug: "win-boost", configuration: {}, selectedMode: null, selectedOptions: [], pricingSnapshot: null });
    expect(s.ranks).toBeNull();
    expect(s.pricing).toBeNull();
    expect(s.mode).toBeNull();
  });
});

describe("order confirmed email", () => {
  it("contains the order, the total and a link to the order, with the game colour", () => {
    const m = orderConfirmedEmail("c@t.test", order.id, buildOrderSummary(order));
    expect(m.subject).toBe("Order confirmed · #ABCD1234");
    expect(m.action?.url).toBe(`https://app.test/dashboard/${order.id}`);
    expect(m.text).toContain("Total paid");
    const html = renderEmailHtml(m);
    expect(html).toContain("Rank Boost");
    expect(html).toContain("Platinum");
    expect(html).toContain("#C8AA6E");
    expect(html).toContain("Discount");
  });

  it("escapes customer-entered text", () => {
    const s = buildOrderSummary(order);
    s.details.push({ label: "Additional information", value: `<script>alert(1)</script>` });
    expect(renderEmailHtml(orderConfirmedEmail("c@t.test", order.id, s))).not.toContain("<script>");
  });

  it("uses the Valorant colour for Valorant orders", () => {
    const s = { ...buildOrderSummary(order), gameSlug: "valorant" };
    expect(renderEmailHtml(orderConfirmedEmail("c@t.test", order.id, s))).toContain("#FF4655");
  });
});

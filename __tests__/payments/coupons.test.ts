import { describe, expect, it } from "vitest";
import { evaluateCoupon, normalizeCouponCode, type CouponRow } from "@/lib/pricing/coupons";
import { computeDiscount } from "@/lib/pricing/engine";

const base: CouponRow = {
  id: "c1", code: "SAVE", type: "PERCENT", percentBps: 1000, amount: null, currency: null, maxDiscount: null, minSubtotal: null,
  maxRedemptions: null, perCustomerLimit: 1, gameSlug: null, serviceSlug: null, startsAt: null, expiresAt: null, active: true,
};
const ctx = { subtotal: 10000, currency: "USD", gameSlug: "league-of-legends", serviceSlug: "rank-boost", now: new Date("2026-11-14T12:00:00Z"), totalUses: 0, customerUses: 0 };

describe("evaluateCoupon", () => {
  it("percent and fixed, with a cap", () => {
    expect(evaluateCoupon(base, ctx)).toEqual({ ok: true, discount: 1000 });
    expect(evaluateCoupon({ ...base, maxDiscount: 500 }, ctx)).toEqual({ ok: true, discount: 500 });
    expect(evaluateCoupon({ ...base, type: "FIXED", percentBps: null, amount: 700, currency: "usd" }, ctx)).toEqual({ ok: true, discount: 700 });
    expect(evaluateCoupon({ ...base, type: "FIXED", percentBps: null, amount: 700, currency: "EUR" }, ctx)).toMatchObject({ ok: false });
    expect(evaluateCoupon({ ...base, type: "FIXED", percentBps: null, amount: 99999, currency: "USD" }, ctx)).toEqual({ ok: true, discount: 10000 });
  });

  it.each([
    [{ active: false }, "no longer active"],
    [{ startsAt: new Date("2026-12-01") }, "not active yet"],
    [{ expiresAt: new Date("2026-11-14T12:00:00Z") }, "expired"],
    [{ gameSlug: "valorant" }, "not valid for this game"],
    [{ serviceSlug: "win-boost" }, "not valid for this service"],
    [{ maxRedemptions: 3 }, "fully used", { totalUses: 3 }],
    [{}, "already used", { customerUses: 1 }],
    [{ minSubtotal: 20000 }, "minimum amount"],
  ] as [Partial<CouponRow>, string, Partial<typeof ctx>?][])("%o -> %s", (patch, reason, ctxPatch = {}) => {
    const r = evaluateCoupon({ ...base, ...patch }, { ...ctx, ...ctxPatch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it("skips the per-customer check on an anonymous quote", () => {
    expect(evaluateCoupon(base, { ...ctx, customerUses: null }).ok).toBe(true);
  });

  it("normalizes codes", () => {
    expect(normalizeCouponCode("  welcome10 ")).toBe("WELCOME10");
  });
});

describe("computeDiscount (platform cap)", () => {
  it("never exceeds the platform fee and ignores invalid input", () => {
    expect(computeDiscount(1000, 4500)).toBe(1000);
    expect(computeDiscount(9000, 4500)).toBe(4500);
    expect(computeDiscount(-5, 4500)).toBe(0);
    expect(computeDiscount(0.5, 4500)).toBe(0);
  });
});

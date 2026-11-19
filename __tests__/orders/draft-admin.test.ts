/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const state = { role: "ADMIN" as string, order: null as any };
  const tx = {
    order: {
      findUnique: vi.fn(async () => state.order),
      update: vi.fn(async ({ data }: any) => ({ ...state.order, ...data })),
    },
    orderEvent: { create: vi.fn(async ({ data }: any) => ({ id: "ev-1", ...data })) },
  };
  return { state, tx };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(async () => ({ role: m.state.role })) },
    $transaction: vi.fn(async (cb: any) => cb(m.tx)),
  },
}));
vi.mock("@/lib/notifications/service", () => ({ createNotificationsForEvent: vi.fn(), createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/broadcast", () => ({ broadcastToOrder: vi.fn() }));

import {
  DraftOrderError,
  republishDraftOrder,
  updateDraftOrder,
  validateOrderConfiguration,
} from "@/lib/orders/draft-admin.service";
import { createNotificationsForEvent } from "@/lib/notifications/service";

const validConfig = { currentRank: { tierId: "gold", divisionId: "iv" }, targetRank: { tierId: "platinum", divisionId: "iv" } };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    userId: "cust-1",
    status: "DRAFT",
    gameSlug: "league-of-legends",
    serviceSlug: "rank-boost",
    configuration: validConfig,
    selectedOptions: [],
    selectedMode: "solo",
    price: null,
    currency: null,
    assignments: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.state.role = "ADMIN";
  m.state.order = draft();
});

describe("admin-only draft management", () => {
  for (const role of ["CUSTOMER", "BOOSTER"]) {
    it(`${role} cannot edit a draft`, async () => {
      m.state.role = role;
      await expect(updateDraftOrder("order-1", "u", { selectedMode: "duo" })).rejects.toMatchObject({ status: 403 });
      expect(m.tx.order.update).not.toHaveBeenCalled();
    });
    it(`${role} cannot republish a draft`, async () => {
      m.state.role = role;
      await expect(republishDraftOrder("order-1", "u")).rejects.toMatchObject({ status: 403 });
      expect(m.tx.order.update).not.toHaveBeenCalled();
    });
  }

  it("admin edits a draft with an audit event holding the previous values", async () => {
    await updateDraftOrder("order-1", "admin-1", { selectedMode: "duo", price: "59.90", note: "repriced" });
    const upd = m.tx.order.update.mock.calls[0][0] as any;
    expect(upd.where).toEqual({ id: "order-1", status: "DRAFT" });
    expect(upd.data.selectedMode).toBe("duo");
    const ev = (m.tx.orderEvent.create.mock.calls[0][0] as any).data;
    expect(ev.type).toBe("DRAFT_EDITED");
    expect(ev.message).toBe("repriced");
    expect(ev.metadata.previous.selectedMode).toBe("solo");
    expect(ev.metadata.changedFields).toEqual(["selectedMode", "price"]);
  });

  it("a paid draft: the same price sent back is ignored, other fields are saved", async () => {
    const { Prisma } = await import("@/app/generated/prisma/client");
    m.state.order = draft({ price: new Prisma.Decimal("100"), currency: "EUR", pricingSnapshot: { id: "snap-1" } });
    await updateDraftOrder("order-1", "admin-1", { selectedMode: "duo", price: "100.00", currency: "EUR" });
    const upd = m.tx.order.update.mock.calls[0][0] as any;
    expect(upd.data.selectedMode).toBe("duo");
    expect(upd.data).not.toHaveProperty("price");
    expect(upd.data).not.toHaveProperty("currency");
    expect((m.tx.orderEvent.create.mock.calls[0][0] as any).data.metadata.changedFields).toEqual(["selectedMode"]);
  });

  it("a paid draft: changing the price or currency is refused", async () => {
    const { Prisma } = await import("@/app/generated/prisma/client");
    m.state.order = draft({ price: new Prisma.Decimal("100"), currency: "EUR", pricingSnapshot: { id: "snap-1" } });
    await expect(updateDraftOrder("order-1", "admin-1", { price: "80" })).rejects.toMatchObject({ status: 409 });
    await expect(updateDraftOrder("order-1", "admin-1", { currency: "USD" })).rejects.toMatchObject({ status: 409 });
    expect(m.tx.order.update).not.toHaveBeenCalled();
  });

  it("cannot edit an order that is not a draft", async () => {
    m.state.order = draft({ status: "PENDING" });
    await expect(updateDraftOrder("order-1", "admin-1", { selectedMode: "duo" })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an invalid edit (target below current)", async () => {
    await expect(
      updateDraftOrder("order-1", "admin-1", {
        configuration: { currentRank: { tierId: "gold", divisionId: "i" }, targetRank: { tierId: "silver", divisionId: "i" } },
      })
    ).rejects.toBeInstanceOf(DraftOrderError);
    expect(m.tx.order.update).not.toHaveBeenCalled();
  });

  it("admin republishes a paid draft: DRAFT -> PENDING, audited, customer notified once", async () => {
    m.state.order = draft({ paymentVerifiedAt: new Date("2026-11-01T00:00:00Z") });
    const out = await republishDraftOrder("order-1", "admin-1", "fixed");
    expect(out.status).toBe("PENDING");
    const upd = m.tx.order.update.mock.calls[0][0] as any;
    expect(upd).toEqual({
      where: { id: "order-1", status: "DRAFT", paymentVerifiedAt: { not: null } },
      // Back in the pool = a new bidding round.
      data: { biddingRound: { increment: 1 }, biddingClosesAt: null, status: "PENDING" },
    });
    expect((m.tx.orderEvent.create.mock.calls[0][0] as any).data.type).toBe("ORDER_REPUBLISHED");
    expect(createNotificationsForEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotificationsForEvent).mock.calls[0][0]).toMatchObject({ type: "ORDER_REOPENED", dedupeKey: "ORDER_REPUBLISHED:ev-1" });
  });

  it("cannot republish a non-draft", async () => {
    m.state.order = draft({ status: "IN_PROGRESS" });
    await expect(republishDraftOrder("order-1", "admin-1")).rejects.toMatchObject({ status: 409 });
  });

  it("cannot republish while an assignment is still active", async () => {
    m.state.order = draft({ assignments: [{ id: "as-1" }] });
    await expect(republishDraftOrder("order-1", "admin-1")).rejects.toMatchObject({ status: 409 });
  });

  it("cannot republish an invalid draft", async () => {
    m.state.order = draft({ configuration: {}, paymentVerifiedAt: new Date("2026-11-01T00:00:00Z") });
    await expect(republishDraftOrder("order-1", "admin-1")).rejects.toMatchObject({ status: 400 });
    expect(m.tx.order.update).not.toHaveBeenCalled();
  });
});

describe("validateOrderConfiguration", () => {
  const base = { selectedOptions: [], selectedMode: null, price: null };
  it("accepts a valid rank boost", () => {
    expect(validateOrderConfiguration("league-of-legends", "rank-boost", { ...base, configuration: validConfig })).toEqual([]);
  });
  it("flags missing fields, unknown options, bad price", () => {
    const errs = validateOrderConfiguration("league-of-legends", "rank-boost", {
      configuration: {},
      selectedOptions: ["not-an-option"],
      selectedMode: "trio",
      price: "-5",
    });
    expect(errs.join(" ")).toMatch(/Missing required field/);
    expect(errs.join(" ")).toMatch(/Unknown option/);
    expect(errs.join(" ")).toMatch(/Unknown boost mode/);
    expect(errs.join(" ")).toMatch(/Price/);
  });
  it("enforces number bounds", () => {
    const errs = validateOrderConfiguration("league-of-legends", "win-boost", {
      ...base,
      configuration: { currentRank: { tierId: "gold", divisionId: "iv" }, wins: 500 },
    });
    expect(errs.join(" ")).toMatch(/at most 3/); // Net Wins: 1-3 wins per order (client PDF 2026-11-19)
  });
});

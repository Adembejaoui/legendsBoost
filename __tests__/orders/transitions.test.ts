import { describe, expect, it, vi } from "vitest";
import { $Enums } from "@/app/generated/prisma/client";
import {
  assertTransition,
  canTransition,
  IllegalOrderTransitionError,
  ORDER_TRANSITIONS,
  transitionOrder,
  transitionOrders,
  type OrderStatus,
} from "@/lib/orders/transitions";

const ALL = Object.values($Enums.OrderStatus) as OrderStatus[];

// Single source of truth, restated as an explicit table: [from, to, legal].
const LEGAL: [OrderStatus, OrderStatus][] = [
  ["AWAITING_PAYMENT", "PENDING"],
  ["AWAITING_PAYMENT", "CANCELLED"],
  ["PENDING", "CLAIMED"],
  ["PENDING", "CANCELLED"],
  ["CLAIMED", "IN_PROGRESS"],
  ["CLAIMED", "CLAIMED"],
  ["CLAIMED", "PENDING"],
  ["CLAIMED", "DRAFT"],
  ["CLAIMED", "CANCELLED"],
  ["IN_PROGRESS", "IN_PROGRESS"],
  ["IN_PROGRESS", "PAUSED"],
  ["IN_PROGRESS", "COMPLETED"],
  ["IN_PROGRESS", "CANCELLED"],
  ["IN_PROGRESS", "DRAFT"],
  ["IN_PROGRESS", "PENDING"],
  ["PAUSED", "IN_PROGRESS"],
  ["PAUSED", "CANCELLED"],
  ["PAUSED", "DRAFT"],
  ["PAUSED", "PENDING"],
  ["DRAFT", "PENDING"],
  ["DRAFT", "CANCELLED"],
];

describe("order transition table", () => {
  it("covers every status", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it.each(ALL.flatMap((from) => ALL.map((to) => [from, to] as const)))("%s -> %s", (from, to) => {
    const legal = LEGAL.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(legal);
    if (!legal) expect(() => assertTransition(from, to)).toThrow(IllegalOrderTransitionError);
  });

  it("completed and cancelled orders are terminal; an unpaid hold can never be worked on", () => {
    for (const to of ALL) {
      expect(canTransition("COMPLETED", to)).toBe(false);
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
    expect(canTransition("AWAITING_PAYMENT", "IN_PROGRESS")).toBe(false);
    // Work starts only from a claimed order (never straight from the pool).
    expect(canTransition("PENDING", "IN_PROGRESS")).toBe(false);
  });

  it("entering the pool always starts a new bidding round", async () => {
    const d = { order: { update: vi.fn(async (x: unknown) => x), updateMany: vi.fn(async () => ({ count: 1 })) } };
    await transitionOrder(d as never, { where: { id: "o1", status: "DRAFT" }, to: "PENDING" });
    expect(d.order.update).toHaveBeenCalledWith({
      where: { id: "o1", status: "DRAFT" },
      data: { biddingRound: { increment: 1 }, biddingClosesAt: null, status: "PENDING" },
    });
  });
});

describe("transitionOrder / transitionOrders", () => {
  const db = () => ({ order: { update: vi.fn(async (a: unknown) => a), updateMany: vi.fn(async () => ({ count: 1 })) } });

  it("performs the caller's conditional write with the new status", async () => {
    const d = db();
    await transitionOrder(d as never, { where: { id: "o1", status: "IN_PROGRESS" }, to: "COMPLETED", data: { completedAt: new Date(0) } });
    expect(d.order.update).toHaveBeenCalledWith({ where: { id: "o1", status: "IN_PROGRESS" }, data: { completedAt: new Date(0), status: "COMPLETED" } });
  });

  it("checks every status allowed by `where.status: { in }`", async () => {
    const d = db();
    await transitionOrders(d as never, { where: { id: "o1", status: { in: ["IN_PROGRESS", "PAUSED"] } }, to: "CANCELLED" });
    await expect(transitionOrders(d as never, { where: { id: "o1", status: { in: ["PENDING", "COMPLETED"] } }, to: "CANCELLED" })).rejects.toThrow(
      IllegalOrderTransitionError
    );
  });

  it("refuses illegal moves and unconditional writes before touching the database", async () => {
    const d = db();
    await expect(transitionOrder(d as never, { where: { id: "o1", status: "COMPLETED" }, to: "PENDING" })).rejects.toThrow(IllegalOrderTransitionError);
    await expect(transitionOrder(d as never, { where: { id: "o1" }, to: "PENDING" })).rejects.toThrow(/where.status/);
    expect(d.order.update).not.toHaveBeenCalled();
  });
});

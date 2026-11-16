/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake DB plumbing */
/**
 * Minimal in-memory stand-in for the Prisma client used by the order
 * services. It reproduces the database behaviours the safety rules rely on:
 *   - conditional updates throw P2025 when `where` (id, userId, status,
 *     paymentVerifiedAt) no longer matches the row;
 *   - the unique `activeOrderId` index throws P2002.
 * Transactions are not rolled back; tests only assert on paths that fail
 * before writing, or on the order row itself.
 *
 * Usage (same module instance in the mock factory and the test):
 *   vi.mock("@/lib/prisma", async () => ({ default: (await import("./support/fake-order-db")).fake.client }));
 *   import { fake } from "./support/fake-order-db";
 */
import { vi } from "vitest";

export const ACTIVE = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PAUSED"];

/** Pool permission for the fake catalog's "test-game" (no rank system). */
export const TEST_GAME_PERMISSIONS = [{ gameSlug: "test-game", rankSystemId: "none", maxTargetRankValue: 0, regions: [], serviceSlugs: [] }];

const db = {
  users: new Map<string, any>(),
  orders: new Map<string, any>(),
  assignments: [] as any[],
  events: [] as any[],
  snapshots: new Map<string, any>(),
};

const prismaErr = (code: string) => Object.assign(new Error(code), { code });
const matchStatus = (cond: any, v: string) =>
  cond === undefined ? true : typeof cond === "string" ? v === cond : cond?.in ? cond.in.includes(v) : true;
const matchPaid = (cond: any, v: unknown) => {
  if (cond === undefined) return true;
  if (cond === null) return v === null || v === undefined;
  if (cond.not === null) return v !== null && v !== undefined;
  return true;
};
const activeFor = (orderId: string) => db.assignments.filter((a) => a.orderId === orderId && ACTIVE.includes(a.status));
const rowMatches = (where: any, o: any) =>
  matchStatus(where.status, o.status) &&
  matchPaid(where.paymentVerifiedAt, o.paymentVerifiedAt) &&
  (where.userId === undefined || where.userId === o.userId);

const client: any = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => db.users.get(where.id) ?? null),
    findMany: vi.fn(async () => [...db.users.values()].filter((u) => u.role === "ADMIN")),
  },
  order: {
    findUnique: vi.fn(async ({ where, include }: any) => {
      const o = db.orders.get(where.id);
      if (!o) return null;
      const row: any = { ...o };
      if (include?.assignments) {
        row.assignments = db.assignments.filter(
          (a) => a.orderId === o.id && matchStatus(include.assignments.where?.status, a.status)
        );
      }
      if (include?.events) row.events = db.events.filter((e) => e.orderId === o.id);
      return row;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...db.orders.values()]
        .filter((o) => rowMatches(where, o) && !(where.assignments?.none && activeFor(o.id).length > 0))
        .filter((o) => where.biddingClosesAt?.lte === undefined || (o.biddingClosesAt && o.biddingClosesAt <= where.biddingClosesAt.lte))
        .map((o) => ({ ...o, assignments: activeFor(o.id), user: { id: o.userId, name: "Customer" } }))
    ),
    create: vi.fn(async ({ data }: any) => {
      const o = { id: `order-new-${db.orders.size + 1}`, paymentVerifiedAt: null, createdAt: new Date(), ...data };
      db.orders.set(o.id, o);
      return { ...o };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const o = db.orders.get(where.id);
      if (!o || !rowMatches(where, o)) throw prismaErr("P2025");
      Object.assign(o, data);
      return { ...o };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = [...db.orders.values()].filter((o) => (where.id === undefined || o.id === where.id) && rowMatches(where, o));
      for (const o of rows) Object.assign(o, data);
      return { count: rows.length };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const o = db.orders.get(where.id);
      if (!o) throw prismaErr("P2025");
      return { ...o, pricingSnapshot: db.snapshots.get(o.id) ?? null };
    }),
  },
  orderPricingSnapshot: {
    create: vi.fn(async ({ data }: any) => {
      db.snapshots.set(data.orderId, { id: `snap-${data.orderId}`, ...data });
      return db.snapshots.get(data.orderId);
    }),
  },
  // No payment attempts exist in these in-memory tests.
  payment: {
    findUnique: vi.fn(async () => null),
    update: vi.fn(async ({ data }: any) => data),
  },
  orderBoosterAssignment: {
    findFirst: vi.fn(
      async ({ where }: any) =>
        db.assignments.find(
          (a) =>
            a.orderId === where.orderId &&
            matchStatus(where.status, a.status) &&
            (where.boosterId === undefined || a.boosterId === where.boosterId) &&
            (where.activeOrderId === undefined || a.activeOrderId === where.activeOrderId)
        ) ?? null
    ),
    count: vi.fn(
      async ({ where }: any) =>
        db.assignments.filter((a) => (where.boosterId === undefined || a.boosterId === where.boosterId) && matchStatus(where.status, a.status)).length
    ),
    findUnique: vi.fn(async ({ where, include }: any) => {
      const a = db.assignments.find((x) => x.id === where.id);
      if (!a) return null;
      return include?.order ? { ...a, order: { ...db.orders.get(a.orderId) } } : { ...a };
    }),
    create: vi.fn(async ({ data }: any) => {
      if (data.activeOrderId && db.assignments.some((a) => a.activeOrderId === data.activeOrderId)) {
        throw prismaErr("P2002");
      }
      const a = { id: `as-new-${db.assignments.length + 1}`, assignedAt: new Date(), ...data };
      db.assignments.push(a);
      return { ...a };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const a = db.assignments.find((x) => x.id === where.id);
      if (!a) throw prismaErr("P2025");
      Object.assign(a, data);
      return { ...a };
    }),
  },
  // Booster row lock / trial counter used when an order is taken.
  boosterProfile: {
    updateMany: vi.fn(async ({ where, data }: any) => {
      const u = db.users.get(where.userId);
      const p = u?.boosterProfile;
      if (!p || (where.verificationStatus && p.verificationStatus !== where.verificationStatus)) return { count: 0 };
      if (where.trialOrdersRemaining?.gt !== undefined && !((p.trialOrdersRemaining ?? 0) > where.trialOrdersRemaining.gt)) return { count: 0 };
      if (data.trialOrdersRemaining?.decrement) p.trialOrdersRemaining -= data.trialOrdersRemaining.decrement;
      return { count: 1 };
    }),
  },
  // No money and no bids in these in-memory tests.
  boosterEarning: { findUnique: vi.fn(async () => null) },
  orderBid: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  boosterStrike: { create: vi.fn(async ({ data }: any) => ({ id: "strike-1", orderId: null, ...data })) },
    orderEvent: {
    create: vi.fn(async ({ data }: any) => {
      const e = { id: `ev-${db.events.length + 1}`, createdAt: new Date(), ...data };
      db.events.push(e);
      return e;
    }),
  },
};
client.$transaction = vi.fn(async (cb: any) => cb(client));

function reset(users: any[]) {
  db.users.clear();
  db.orders.clear();
  db.assignments.length = 0;
  db.events.length = 0;
  db.snapshots.clear();
  for (const u of users) db.users.set(u.id, u);
}

function seedOrder(o: Record<string, unknown>) {
  const order = {
    userId: "cust-1",
    gameSlug: "test-game",
    serviceSlug: "test-boost",
    configuration: {},
    selectedOptions: [],
    selectedMode: null,
    price: null,
    currency: null,
    paymentVerifiedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...o,
  } as any;
  db.orders.set(order.id, order);
  return order;
}

function seedAssignment(a: Record<string, unknown>) {
  const row = { assignedById: a.boosterId, assignedAt: new Date(), startedAt: new Date(), ...a } as any;
  db.assignments.push(row);
  return row;
}

export const fake = { db, client, reset, seedOrder, seedAssignment };

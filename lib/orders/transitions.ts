/**
 * The ONLY way to change Order.status [registry F4].
 *
 * A table of legal transitions plus two thin wrappers around Prisma. Callers
 * keep their own conditional `where` (e.g. "and still unpaid", "and owned by
 * this customer"): the wrapper only checks that every status the `where`
 * allows may legally move to `to`, then performs the same conditional write.
 * Concurrency semantics are unchanged: a row that no longer matches makes
 * `transitionOrder` throw P2025 (update) or `transitionOrders` return 0.
 *
 * Adding a status or a transition in a later phase = adding a table row
 * (and a test row in __tests__/orders/transitions.test.ts).
 */
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export type OrderStatus = $Enums.OrderStatus;

/** from -> allowed next statuses. Terminal statuses have none. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Checkout hold: paid (webhook) or closed without payment.
  AWAITING_PAYMENT: ["PENDING", "CANCELLED"],
  // Paid, in the marketplace: taken (bid won / claim now / priority /
  // preferred), or cancelled (admin / refund / legacy unpaid).
  PENDING: ["CLAIMED", "CANCELLED"],
  // Taken, not started: booster starts; admin reassigns (CLAIMED -> CLAIMED)
  // or releases; booster abandons (DRAFT); cancelled.
  CLAIMED: ["IN_PROGRESS", "CLAIMED", "PENDING", "DRAFT", "CANCELLED"],
  // Being worked on. IN_PROGRESS -> IN_PROGRESS = admin reassignment.
  IN_PROGRESS: ["IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED", "DRAFT", "PENDING"],
  // Paused by the customer.
  PAUSED: ["IN_PROGRESS", "CANCELLED", "DRAFT", "PENDING"],
  // Pulled off the marketplace (abandoned / unpaid): admin republish or cancel.
  DRAFT: ["PENDING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export class IllegalOrderTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Illegal order transition ${from} -> ${to}`);
    this.name = "IllegalOrderTransitionError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new IllegalOrderTransitionError(from, to);
}

/** Statuses a Prisma `where.status` condition can match. */
function statusesOf(where: { status?: unknown }): OrderStatus[] {
  const s = where.status;
  if (typeof s === "string") return [s as OrderStatus];
  if (s && typeof s === "object" && Array.isArray((s as { in?: unknown }).in)) return (s as { in: OrderStatus[] }).in;
  if (s && typeof s === "object" && typeof (s as { equals?: unknown }).equals === "string") return [(s as { equals: OrderStatus }).equals];
  // A transition must always be conditional on the current status.
  throw new Error("transitionOrder: `where.status` (string or { in: [...] }) is required");
}

type Db = Pick<Prisma.TransactionClient, "order">;

/**
 * Entering the pool (PENDING) always starts a new bidding round with no
 * window running, so bids of an earlier round can never win (lib/pool).
 */
function poolEntry(to: OrderStatus) {
  return to === "PENDING" ? { biddingRound: { increment: 1 }, biddingClosesAt: null } : {};
}

/** Conditional single-row transition (throws P2025 if the row no longer matches). */
export async function transitionOrder(
  db: Db,
  args: {
    where: Prisma.OrderWhereUniqueInput;
    to: OrderStatus;
    data?: Omit<Prisma.OrderUpdateInput, "status"> | Omit<Prisma.OrderUncheckedUpdateInput, "status">;
  }
) {
  for (const from of statusesOf(args.where)) assertTransition(from, args.to);
  const data = { ...(args.data ?? {}), ...poolEntry(args.to), status: args.to } as Prisma.OrderUpdateInput;
  return db.order.update({ where: args.where, data });
}

/** Conditional multi-row transition (returns { count }; 0 when nothing matched). */
export async function transitionOrders(
  db: Db,
  args: { where: Prisma.OrderWhereInput; to: OrderStatus; data?: Omit<Prisma.OrderUpdateManyMutationInput, "status"> }
) {
  for (const from of statusesOf(args.where)) assertTransition(from, args.to);
  return db.order.updateMany({ where: args.where, data: { ...(args.data ?? {}), ...poolEntry(args.to), status: args.to } });
}

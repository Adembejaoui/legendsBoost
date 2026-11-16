// Server-only module.
/**
 * Live page signals (2026-11-16: booster and customer pages update without a
 * refresh). Signals carry no data: the page that receives one refetches its
 * own server-rendered data, so permissions and filters (rank ceiling, the
 * customer price hidden from boosters...) are always applied by the server.
 *
 *   signalPool   -> private-pool          every booster's available-orders page
 *   signalUsers  -> private-user:{id}     that user's pages (lists, counts)
 *   signalOrder  -> private-order:{id}    the order page (both participants)
 *
 * Never throws: call after the database write committed.
 */
import { broadcastEvent, broadcastToOrder } from "./broadcast";
import { poolChannel, userChannel } from "./channel-names";

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* a missed signal is recovered by the 20 s fallback / next refresh */
  }
}

export function signalPool(reason: "added" | "removed" | "bid"): Promise<void> {
  return safe(() => broadcastEvent({ channel: poolChannel(), event: "pool.changed", payload: { reason } }));
}

export async function signalUsers(userIds: (string | null | undefined)[], scope: string): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  await Promise.all(ids.map((id) => safe(() => broadcastEvent({ channel: userChannel(id), event: "live.refresh", payload: { scope } }))));
}

export function signalOrder(orderId: string, reason: string): Promise<void> {
  return safe(() => broadcastToOrder({ orderId, event: "order.updated", payload: { orderId, reason } }));
}

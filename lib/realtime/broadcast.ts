import { getRealtimeServerConfig } from "@/lib/supabase/server";
import type { RealtimeEventName } from "./events";

const BROADCAST_TIMEOUT_MS = 5_000;

/**
 * Centralized server-side broadcasting service.
 *
 * All Realtime broadcasts originate here. A broadcast is only performed AFTER
 * the relevant database transaction has succeeded, so persisted data is the
 * source of truth and a broadcast failure never deletes data.
 *
 * Uses the service-role client (server-only) so broadcasts are delivered even
 * to recipients whose own client session may not be active. The service-role
 * key never leaves the server.
 *
 * Uses the Realtime REST broadcast endpoint (`httpSend`) so the server does
 * not need a persistent WebSocket connection to deliver events.
 */

let broadcastEnabled = true;

/**
 * Temporarily disable broadcasts (used in tests / maintenance).
 */
export function setBroadcastEnabled(enabled: boolean): void {
  broadcastEnabled = enabled;
}

export function isBroadcastEnabled(): boolean {
  return broadcastEnabled;
}

interface BroadcastResult {
  success: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  error?: unknown;
}

/**
 * Deliver one event through the Realtime REST broadcast API.
 *
 * - `private: true` is required: subscribers join with `config.private = true`,
 *   and Supabase treats public and private topics as distinct. Broadcasting to
 *   the public topic would (a) never reach private subscribers and (b) be
 *   readable by anyone holding the public anon key.
 * - The service-role key bypasses `realtime.messages` RLS, so only the server
 *   can publish. Browsers have no INSERT policy and cannot forge events.
 * - Never throws: callers invoke this after the database write has committed,
 *   and a delivery failure must not turn a persisted message into an API error
 *   (which would make the client retry and create a duplicate). Missed events
 *   are recovered by the client's catch-up fetch on (re)subscribe.
 */
async function httpBroadcast(channel: string, event: string, payload: unknown): Promise<boolean> {
  if (!broadcastEnabled) {
    return false;
  }

  const config = getRealtimeServerConfig();
  if (!config) {
    console.error(
      `[realtime/broadcast] skipped ${event} to ${channel}: SUPABASE_SERVICE_ROLE_KEY or Supabase URL not configured`
    );
    return false;
  }

  try {
    const res = await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      body: JSON.stringify({
        messages: [{ topic: channel, event, payload, private: true }],
      }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });

    if (res.status !== 202 && !res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[realtime/broadcast] failed to broadcast ${event} to ${channel}: status=${res.status} ${body.slice(0, 200)}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `[realtime/broadcast] failed to broadcast ${event} to ${channel}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Broadcast a persisted event to a private Realtime channel.
 *
 * @param channel - Private channel name (e.g. `private-order:{orderId}`)
 * @param event - Typed event name
 * @param payload - Typed event payload (no secrets)
 * @returns true if the broadcast was dispatched, false if broadcasting is disabled or failed
 */
export async function broadcastEvent({
  channel,
  event,
  payload,
}: {
  channel: string;
  event: RealtimeEventName;
  payload: unknown;
}): Promise<boolean> {
  return httpBroadcast(channel, event, payload);
}

/**
 * Broadcast to an order channel.
 */
export async function broadcastToOrder(params: {
  orderId: string;
  event: RealtimeEventName;
  payload: unknown;
}): Promise<boolean> {
  return httpBroadcast(`private-order:${params.orderId}`, params.event, params.payload);
}

/**
 * Broadcast to a user's private notification channel.
 */
export async function broadcastToUser(params: {
  userId: string;
  event: RealtimeEventName;
  payload: unknown;
}): Promise<boolean> {
  return httpBroadcast(`private-user:${params.userId}`, params.event, params.payload);
}

/**
 * Broadcast to a support ticket channel.
 */
export async function broadcastToSupport(params: {
  ticketId: string;
  event: RealtimeEventName;
  payload: unknown;
}): Promise<boolean> {
  return httpBroadcast(`private-support:${params.ticketId}`, params.event, params.payload);
}

/**
 * Revoke a user's real-time access to an order channel.
 *
 * Broadcasts `order.access_revoked` to the user's private channel so their
 * client unsubscribes from `private-order:{orderId}` and stops receiving
 * order events. Called on reassignment/release/complete/cancel/abandon so a
 * former booster can no longer receive new messages or private events.
 *
 * Database-level authorization (canAccessOrder) additionally rejects any
 * subsequent token request for that channel, so the user cannot re-subscribe.
 */
export async function revokeOrderAccess(params: {
  userId: string;
  orderId: string;
  reason?: string;
}): Promise<void> {
  await broadcastToUser({
    userId: params.userId,
    event: "order.access_revoked",
    payload: {
      orderId: params.orderId,
      reason: params.reason,
      revokedAt: new Date().toISOString(),
    },
  });
}

export type { BroadcastResult };

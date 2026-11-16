/**
 * Supabase Realtime channel names.
 *
 * Supabase Realtime requires the `private-` prefix for channels that enforce
 * authentication. LegendsBoost uses private channels for all user- and
 * resource-specific communication:
 *
 *  - private-order:{orderId}   order chat + order lifecycle events
 *  - private-user:{userId}     private notifications + presence
 *  - private-support:{ticketId} support ticket chat
 *  - private-pool              "the order pool changed" signals for boosters
 *                              (no order data: each booster refetches their
 *                              own filtered pool)
 *
 * Public (non-private) channels are intentionally not used for any
 * authenticated data.
 */

const PRIVATE_PREFIX = "private";

export type ChannelKind = "order" | "user" | "support" | "pool";

export function orderChannel(orderId: string): string {
  return `${PRIVATE_PREFIX}-order:${orderId}`;
}

export function userChannel(userId: string): string {
  return `${PRIVATE_PREFIX}-user:${userId}`;
}

export function supportChannel(ticketId: string): string {
  return `${PRIVATE_PREFIX}-support:${ticketId}`;
}

export function poolChannel(): string {
  return `${PRIVATE_PREFIX}-pool`;
}

export function isPrivateChannel(channel: string): boolean {
  return channel.startsWith(`${PRIVATE_PREFIX}-`);
}

export interface ParsedOrderChannel {
  kind: "order";
  orderId: string;
}
export interface ParsedUserChannel {
  kind: "user";
  userId: string;
}
export interface ParsedSupportChannel {
  kind: "support";
  ticketId: string;
}
export interface ParsedPoolChannel {
  kind: "pool";
}
export type ParsedChannel = ParsedOrderChannel | ParsedUserChannel | ParsedSupportChannel | ParsedPoolChannel;

const ORDER_RE = /^private-order:(.+)$/;
const USER_RE = /^private-user:(.+)$/;
const SUPPORT_RE = /^private-support:(.+)$/;

export function parseChannel(channel: string): ParsedChannel | null {
  const m = channel.match(ORDER_RE);
  if (m) return { kind: "order", orderId: m[1] };
  const m2 = channel.match(USER_RE);
  if (m2) return { kind: "user", userId: m2[1] };
  const m3 = channel.match(SUPPORT_RE);
  if (m3) return { kind: "support", ticketId: m3[1] };
  if (channel === "private-pool") return { kind: "pool" };
  return null;
}

/**
 * Pure helpers for keeping an order-chat message list consistent while
 * messages arrive from three sources that can race each other:
 *
 *   1. the initial server render / REST history,
 *   2. Realtime broadcasts (`chat.message.created`),
 *   3. the sender's own POST response.
 *
 * Invariants maintained by `mergeMessages`:
 *   - one entry per server message id (no duplicates, whichever source wins);
 *   - an optimistic (pending/failed) entry is replaced by its confirmed message
 *     when either the broadcast or the POST response carries its
 *     `clientMessageId`;
 *   - confirmed messages are ordered by (createdAt, id); unconfirmed local
 *     messages always render after them, in the order they were sent, so a
 *     skewed browser clock can never reorder the conversation.
 *
 * No React or browser APIs here; covered by __tests__/chat/message-sync.test.ts.
 */

export type ChatMessageStatus = "sent" | "sending" | "failed";

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  content: string;
  messageType: string;
  readAt: string | null;
  createdAt: string;
  sender?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  /** Local-only fields. Absent/"sent" for confirmed server messages. */
  status?: ChatMessageStatus;
  clientMessageId?: string | null;
  error?: string | null;
}

export interface ChatMessageCreatedPayload {
  messageId: string;
  conversationId: string;
  orderId: string;
  senderId: string | null;
  senderName: string | null;
  senderImage: string | null;
  content: string;
  messageType?: string;
  createdAt: string;
  clientMessageId?: string | null;
}

export function isConfirmed(m: ChatMessage): boolean {
  return m.status === undefined || m.status === "sent";
}

function compareConfirmed(a: ChatMessage, b: ChatMessage): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Shape of a message row from Prisma (SSR) or its JSON form (REST). */
export interface RawServerMessage {
  id: string;
  conversationId: string;
  senderId?: string | null;
  content?: string | null;
  messageType?: string | null;
  readAt?: Date | string | null;
  createdAt: Date | string;
  sender?: { id: string; name?: string | null; image?: string | null } | null;
  clientMessageId?: string | null;
}

/** Normalize a REST/SSR message (Date objects or strings) into a ChatMessage. */
export function normalizeServerMessage(raw: RawServerMessage): ChatMessage {
  const createdAt =
    raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt);
  const readAt =
    raw.readAt == null
      ? null
      : raw.readAt instanceof Date
        ? raw.readAt.toISOString()
        : String(raw.readAt);
  return {
    id: String(raw.id),
    conversationId: String(raw.conversationId),
    senderId: raw.senderId ?? null,
    content: String(raw.content ?? ""),
    messageType: raw.messageType ?? "text",
    readAt,
    createdAt,
    sender: raw.sender
      ? { id: raw.sender.id, name: raw.sender.name ?? null, image: raw.sender.image ?? null }
      : null,
    status: "sent",
    clientMessageId: raw.clientMessageId ?? null,
  };
}

/** Convert a `chat.message.created` broadcast payload into a ChatMessage. */
export function messageFromBroadcast(p: ChatMessageCreatedPayload): ChatMessage {
  return {
    id: p.messageId,
    conversationId: p.conversationId,
    senderId: p.senderId,
    content: p.content,
    messageType: p.messageType ?? "text",
    readAt: null,
    createdAt: p.createdAt,
    sender: p.senderId
      ? { id: p.senderId, name: p.senderName, image: p.senderImage }
      : null,
    status: "sent",
    clientMessageId: p.clientMessageId ?? null,
  };
}

/**
 * Merge incoming messages into the current list. Pure: returns a new array
 * (or the same array when nothing changed, so React can bail out of renders).
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;

  const confirmed = new Map<string, ChatMessage>();
  const pending: ChatMessage[] = [];
  for (const m of current) {
    if (isConfirmed(m)) confirmed.set(m.id, m);
    else pending.push(m);
  }

  let changed = false;
  const resolvedClientIds = new Set<string>();

  for (const m of incoming) {
    if (isConfirmed(m)) {
      const existing = confirmed.get(m.id);
      if (!existing) {
        confirmed.set(m.id, m);
        changed = true;
      } else if (m.readAt && !existing.readAt) {
        // A later copy can carry read state the earlier one lacked.
        confirmed.set(m.id, { ...existing, readAt: m.readAt });
        changed = true;
      }
      if (m.clientMessageId) resolvedClientIds.add(m.clientMessageId);
    } else {
      // Local optimistic message: insert or replace by clientMessageId.
      const idx = pending.findIndex((p) => p.clientMessageId === m.clientMessageId);
      if (idx >= 0) pending[idx] = m;
      else pending.push(m);
      changed = true;
    }
  }

  // Drop pending bubbles that a confirmed message now represents. Also covers
  // a confirmed message that arrived *before* its pending entry was replaced.
  const confirmedClientIds = new Set(resolvedClientIds);
  for (const m of confirmed.values()) {
    if (m.clientMessageId) confirmedClientIds.add(m.clientMessageId);
  }
  const remainingPending = pending.filter(
    (p) => !(p.clientMessageId && confirmedClientIds.has(p.clientMessageId))
  );
  if (remainingPending.length !== pending.length) changed = true;

  if (!changed) return current;

  return [...Array.from(confirmed.values()).sort(compareConfirmed), ...remainingPending];
}

/** Apply a `chat.message.read` event: mark the listed messages as read. */
export function applyReadReceipt(
  current: ChatMessage[],
  messageIds: string[],
  readAt: string
): ChatMessage[] {
  if (messageIds.length === 0) return current;
  const ids = new Set(messageIds);
  let changed = false;
  const next = current.map((m) => {
    if (ids.has(m.id) && !m.readAt) {
      changed = true;
      return { ...m, readAt };
    }
    return m;
  });
  return changed ? next : current;
}

/** Remove a local (pending/failed) message by its clientMessageId. */
export function removePending(current: ChatMessage[], clientMessageId: string): ChatMessage[] {
  const next = current.filter((m) => isConfirmed(m) || m.clientMessageId !== clientMessageId);
  return next.length === current.length ? current : next;
}

/**
 * Cursor for catch-up fetches: the newest confirmed `createdAt`. The server
 * query is inclusive (>=), so messages sharing that millisecond are re-sent
 * and deduped here rather than skipped.
 */
export function latestConfirmedTimestamp(messages: ChatMessage[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const m of messages) {
    if (!isConfirmed(m)) continue;
    const t = Date.parse(m.createdAt);
    if (t > latestMs) {
      latestMs = t;
      latest = m.createdAt;
    }
  }
  return latest;
}

/** Oldest confirmed `createdAt`, used as the `before` cursor for history. */
export function oldestConfirmedTimestamp(messages: ChatMessage[]): string | null {
  for (const m of messages) if (isConfirmed(m)) return m.createdAt;
  return null;
}

/** Collision-resistant id for optimistic messages (matches server validation). */
export function createClientMessageId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

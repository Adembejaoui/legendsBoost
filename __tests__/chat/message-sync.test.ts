import { describe, it, expect } from "vitest";
import {
  applyReadReceipt,
  latestConfirmedTimestamp,
  mergeMessages,
  messageFromBroadcast,
  normalizeServerMessage,
  oldestConfirmedTimestamp,
  removePending,
  type ChatMessage,
} from "@/lib/chat/message-sync";

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: "conv-1",
  senderId: "u-customer",
  content: `content ${id}`,
  messageType: "text",
  readAt: null,
  createdAt,
  sender: null,
  status: "sent",
  ...extra,
});

const pending = (clientMessageId: string, content = "hi"): ChatMessage =>
  msg(`local-${clientMessageId}`, new Date().toISOString(), {
    status: "sending",
    clientMessageId,
    content,
  });

describe("mergeMessages", () => {
  it("dedupes the same server message arriving from several sources", () => {
    const a = msg("m1", "2026-11-12T10:00:00.000Z");
    let list = mergeMessages([], [a]);
    list = mergeMessages(list, [{ ...a }]); // broadcast echo
    list = mergeMessages(list, [{ ...a }]); // catch-up overlap
    expect(list.map((m) => m.id)).toEqual(["m1"]);
  });

  it("returns the same array reference when nothing changed (no re-render)", () => {
    const list = mergeMessages([], [msg("m1", "2026-11-12T10:00:00.000Z")]);
    expect(mergeMessages(list, [msg("m1", "2026-11-12T10:00:00.000Z")])).toBe(list);
  });

  it("keeps chronological order regardless of arrival order, tie-broken by id", () => {
    const list = mergeMessages(
      [],
      [
        msg("m3", "2026-11-12T10:00:02.000Z"),
        msg("m1", "2026-11-12T10:00:00.000Z"),
        msg("m2b", "2026-11-12T10:00:01.000Z"),
        msg("m2a", "2026-11-12T10:00:01.000Z"),
      ]
    );
    expect(list.map((m) => m.id)).toEqual(["m1", "m2a", "m2b", "m3"]);
  });

  it("replaces the optimistic bubble when the broadcast echo arrives first", () => {
    let list = mergeMessages([msg("m1", "2026-11-12T10:00:00.000Z")], [pending("c1")]);
    expect(list).toHaveLength(2);

    const echo = msg("m2", "2026-11-12T10:00:05.000Z", { clientMessageId: "c1" });
    list = mergeMessages(list, [echo]);
    // Then the POST response for the same message.
    list = mergeMessages(list, [{ ...echo }]);

    expect(list.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(list.every((m) => m.status === "sent")).toBe(true);
  });

  it("replaces the optimistic bubble when the POST response arrives first", () => {
    let list = mergeMessages([], [pending("c1")]);
    const confirmed = msg("m2", "2026-11-12T10:00:05.000Z", { clientMessageId: "c1" });
    list = mergeMessages(list, [confirmed]);
    // Broadcast echo arrives later (same id).
    list = mergeMessages(list, [messageFromBroadcast({
      messageId: "m2",
      conversationId: "conv-1",
      orderId: "o1",
      senderId: "u-customer",
      senderName: null,
      senderImage: null,
      content: "hi",
      createdAt: "2026-11-12T10:00:05.000Z",
      clientMessageId: "c1",
    })]);
    expect(list.map((m) => m.id)).toEqual(["m2"]);
  });

  it("keeps unconfirmed messages after confirmed ones even with a skewed clock", () => {
    const local = { ...pending("c1"), createdAt: "2000-01-01T00:00:00.000Z" };
    const list = mergeMessages([local], [msg("m1", "2026-11-12T10:00:00.000Z")]);
    expect(list.map((m) => m.id)).toEqual(["m1", "local-c1"]);
  });

  it("marks a pending message failed and back to sending on retry without duplicating", () => {
    let list = mergeMessages([], [pending("c1")]);
    list = mergeMessages(list, [{ ...list[0], status: "failed", error: "boom" }]);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("failed");
    list = mergeMessages(list, [{ ...list[0], status: "sending", error: null }]);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("sending");
  });

  it("removePending discards only the local message", () => {
    const list = mergeMessages([msg("m1", "2026-11-12T10:00:00.000Z")], [pending("c1")]);
    expect(removePending(list, "c1").map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("cursors and receipts", () => {
  it("computes catch-up and history cursors from confirmed messages only", () => {
    const list = mergeMessages(
      [],
      [msg("m1", "2026-11-12T10:00:00.000Z"), msg("m2", "2026-11-12T10:00:03.000Z"), pending("c1")]
    );
    expect(latestConfirmedTimestamp(list)).toBe("2026-11-12T10:00:03.000Z");
    expect(oldestConfirmedTimestamp(list)).toBe("2026-11-12T10:00:00.000Z");
    expect(latestConfirmedTimestamp([pending("c2")])).toBeNull();
  });

  it("applies read receipts", () => {
    const list = mergeMessages([], [msg("m1", "2026-11-12T10:00:00.000Z")]);
    const next = applyReadReceipt(list, ["m1"], "2026-11-12T10:01:00.000Z");
    expect(next[0].readAt).toBe("2026-11-12T10:01:00.000Z");
    expect(applyReadReceipt(next, ["m1"], "later")).toBe(next);
  });

  it("normalizes Prisma rows with Date objects", () => {
    const m = normalizeServerMessage({
      id: "m1",
      conversationId: "c",
      senderId: null,
      content: "x",
      messageType: "text",
      readAt: null,
      createdAt: new Date("2026-11-12T10:00:00.000Z"),
      sender: null,
    });
    expect(m.createdAt).toBe("2026-11-12T10:00:00.000Z");
    expect(m.status).toBe("sent");
  });
});

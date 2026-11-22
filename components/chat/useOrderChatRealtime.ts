"use client";

import { armSoundUnlock } from "@/components/realtime/new-order-alert";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat/message-sync";
import {
  OrderChatSync,
  createBrowserRealtimeClient,
  createMessageFetcher,
  fetchRealtimeToken,
  type ChatConnectionState,
  type OrderLifecycleEvent,
  type ReadReceiptPayload,
} from "@/lib/chat/realtime-sync";

interface UseOrderChatRealtimeOptions {
  orderId: string;
  currentUserId: string;
  /** Returns the newest confirmed message timestamp currently displayed. */
  getCursor: () => string | null;
  onMessages: (messages: ChatMessage[]) => void;
  onRead: (payload: ReadReceiptPayload) => void;
  onOrderEvent?: (event: OrderLifecycleEvent, payload: { orderId: string; newStatus?: string }) => void;
  /** Allow sound on the first click (the chat plays a ding for incoming messages). */
  soundOnIncoming?: boolean;
}

const READ_SYNC_DEBOUNCE_MS = 1_500;

const HAS_REALTIME_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Subscribes the chat to `private-order:{orderId}` for as long as the
 * component is mounted. Exactly one channel and one socket per mounted chat;
 * switching orders tears down the previous subscription before the next one
 * starts (the effect is keyed on orderId).
 */
export function useOrderChatRealtime({
  orderId,
  currentUserId,
  getCursor,
  onMessages,
  onRead,
  onOrderEvent,
  soundOnIncoming = false,
}: UseOrderChatRealtimeOptions) {
  const [state, setState] = useState<ChatConnectionState>(
    HAS_REALTIME_ENV ? "connecting" : "unavailable"
  );
  const syncRef = useRef<OrderChatSync | null>(null);

  // Keep the latest callbacks without re-running the subscription effect.
  const cb = useRef({ getCursor, onMessages, onRead, onOrderEvent, currentUserId, soundOnIncoming });
  useLayoutEffect(() => {
    cb.current = { getCursor, onMessages, onRead, onOrderEvent, currentUserId, soundOnIncoming };
  });
  // Browsers allow sound only after a click or key press on the page.
  useEffect(() => {
    if (soundOnIncoming) armSoundUnlock();
  }, [soundOnIncoming]);

  useEffect(() => {
    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";
    const fetchSince = createMessageFetcher(orderId, isVisible);

    if (!HAS_REALTIME_ENV) {
      // Realtime not configured in this deployment: load once, show the state.
      console.error(
        "[chat] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing; realtime chat disabled"
      );
      fetchSince(cb.current.getCursor())
        .then(({ messages }) => cb.current.onMessages(messages))
        .catch(() => {});
      return;
    }

    let readTimer: ReturnType<typeof setTimeout> | null = null;

    const sync = new OrderChatSync({
      orderId,
      createClient: (accessToken) => createBrowserRealtimeClient(accessToken)!,
      fetchToken: fetchRealtimeToken,
      fetchSince,
      getCursor: () => cb.current.getCursor(),
      onMessages: (messages) => cb.current.onMessages(messages),
      onRead: (payload) => cb.current.onRead(payload),
      onOrderEvent: (event, payload) => cb.current.onOrderEvent?.(event, payload),
      onState: setState,
      onIncoming: (message) => {
        // A message from the other participant arrived while the chat is open:
        // a debounced catch-up marks it read on the server (which broadcasts
        // the read receipt to the sender) and double-checks consistency.
        if (message.senderId === cb.current.currentUserId || !isVisible()) return;
        if (readTimer) clearTimeout(readTimer);
        readTimer = setTimeout(() => void sync.catchUp(), READ_SYNC_DEBOUNCE_MS);
      },
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      log: (msg, detail) => {
        if (process.env.NODE_ENV !== "production") console.debug(`[chat realtime] ${msg}`, detail ?? "");
      },
    });
    syncRef.current = sync;
    void sync.start();

    const onOnline = () => sync.nudge();
    const onOffline = () => setState((s) => (s === "unauthorized" ? s : "offline"));
    const onVisible = () => {
      if (document.visibilityState === "visible") sync.nudge();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      if (readTimer) clearTimeout(readTimer);
      syncRef.current = null;
      void sync.stop();
    };
  }, [orderId]);

  return {
    connectionState: state,
    /** Trigger a catch-up fetch (e.g. after a send failed ambiguously). */
    resync: () => void syncRef.current?.catchUp(),
  };
}

"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { LiveChannel, type LiveState } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";
import { userChannel } from "@/lib/realtime/channel-names";
import { LIVE_POLL_MS } from "@/components/realtime/LiveRefresh";

const HAS_REALTIME_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** A new notification, the same shape whether it came live or from the fallback check. */
export interface AlertNotification {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  orderId?: string | null;
}

/** Notifications older than the page by more than this are never alerted (clock skew margin). */
const SLACK_MS = 5_000;

/**
 * Calls `onNotification` once for every notification created for this user
 * while the page is open, for pop-ups and sounds.
 *
 * Real time through the user's private channel. While that channel is not
 * live (connecting, down, realtime not configured), the latest notifications
 * are checked every 20 s instead, also in a background tab; when the channel
 * comes back, one check catches what arrived during the gap. Each
 * notification is handled once, whichever way it arrives
 * (realtime test 2026-11-22).
 */
export function useNotificationAlerts(userId: string | null | undefined, onNotification: (n: AlertNotification) => void) {
  const cb = useRef(onNotification);
  useLayoutEffect(() => {
    cb.current = onNotification;
  });

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const since = Date.now() - SLACK_MS;
    const seen = new Set<string>();
    const handle = (n: AlertNotification) => {
      if (!n.id || seen.has(n.id)) return;
      seen.add(n.id);
      try {
        cb.current(n);
      } catch {
        /* an alert never breaks the page */
      }
    };

    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/notifications?page=1&limit=10", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as {
          notifications?: { id: string; type?: string; title?: string; message?: string; orderId?: string | null; createdAt?: string }[];
        };
        const fresh = (data.notifications ?? [])
          .filter((n) => n.createdAt && new Date(n.createdAt).getTime() >= since)
          .reverse(); // oldest first
        for (const n of fresh) handle(n);
      } catch {
        /* offline: the next check retries */
      } finally {
        inFlight = false;
      }
    };

    let state: LiveState | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const update = () => {
      const live = HAS_REALTIME_ENV && state === "live";
      if (live && poll) {
        clearInterval(poll);
        poll = null;
        void check(); // catch what arrived while the channel was down
      } else if (!live && !poll) {
        poll = setInterval(() => void check(), LIVE_POLL_MS);
      }
    };

    const channel = HAS_REALTIME_ENV
      ? new LiveChannel({
          channel: userChannel(userId),
          events: ["notification.created"],
          createClient: createBrowserRealtimeClient,
          fetchToken: fetchRealtimeToken,
          onSignal: (_event, raw) => {
            const p = (raw ?? {}) as { notificationId?: string; type?: string; title?: string; message?: string; orderId?: string | null };
            if (p.notificationId) handle({ id: p.notificationId, type: p.type, title: p.title, message: p.message, orderId: p.orderId });
          },
          onState: (s) => {
            state = s;
            update();
          },
        })
      : null;
    update();
    void channel?.start();
    return () => {
      alive = false;
      if (poll) clearInterval(poll);
      void channel?.stop();
    };
  }, [userId]);
}

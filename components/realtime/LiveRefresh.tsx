"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { LiveChannel, type LiveState } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";

/** Fallback while realtime is unavailable or down (decision 2026-11-16: 20 s). */
export const LIVE_POLL_MS = 20_000;
const REFRESH_DEBOUNCE_MS = 400;

const HAS_REALTIME_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export interface LiveSubscription {
  channel: string;
  events: readonly string[];
}

/**
 * Keep the current server-rendered page fresh: subscribe to the given private
 * channels and re-render (router.refresh) when a signal arrives. While any
 * channel is not live (or realtime is not configured), refresh every 20 s
 * instead, while the tab is visible. `onSignal` lets a page react too
 * (e.g. a "new order" alert).
 */
export function useLiveRefresh(subscriptions: LiveSubscription[], onSignal?: (channel: string, event: string, payload: unknown) => void) {
  const router = useRouter();
  const cb = useRef(onSignal);
  useLayoutEffect(() => {
    cb.current = onSignal;
  });
  const key = JSON.stringify(subscriptions);

  useEffect(() => {
    const subs = JSON.parse(key) as LiveSubscription[];
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const states = new Map<string, LiveState>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const updatePolling = () => {
      const allLive = HAS_REALTIME_ENV && subs.length > 0 && subs.every((s) => states.get(s.channel) === "live");
      if (allLive && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      } else if (!allLive && !pollTimer) {
        pollTimer = setInterval(() => {
          if (document.visibilityState === "visible") router.refresh();
        }, LIVE_POLL_MS);
      }
    };

    const channels = HAS_REALTIME_ENV
      ? subs.map(
          (s) =>
            new LiveChannel({
              channel: s.channel,
              events: s.events,
              createClient: createBrowserRealtimeClient,
              fetchToken: fetchRealtimeToken,
              onSignal: (event, payload) => {
                cb.current?.(s.channel, event, payload);
                refresh();
              },
              onState: (state) => {
                states.set(s.channel, state);
                updatePolling();
              },
            })
        )
      : [];
    updatePolling();
    for (const c of channels) void c.start();

    const nudge = () => {
      for (const c of channels) c.nudge();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") nudge();
    };
    window.addEventListener("online", nudge);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", nudge);
      document.removeEventListener("visibilitychange", onVisible);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (pollTimer) clearInterval(pollTimer);
      for (const c of channels) void c.stop();
    };
  }, [key, router]);
}

/** Drop-in for server pages: `<LiveRefresh subscriptions={...} />`. Renders nothing. */
export function LiveRefresh({ subscriptions }: { subscriptions: LiveSubscription[] }) {
  useLiveRefresh(subscriptions);
  return null;
}

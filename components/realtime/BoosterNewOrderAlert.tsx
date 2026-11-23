"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { Bell, BellOff } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { LiveChannel, type LiveState } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";
import { poolChannel } from "@/lib/realtime/channel-names";
import { LIVE_POLL_MS } from "@/components/realtime/LiveRefresh";
import {
  armSoundUnlock,
  desktopPermission,
  playNewOrderSound,
  requestDesktopPermission,
  showDesktopNotification,
  setSoundMuted,
  soundMuted,
  soundUnlocked,
  subscribeSound,
  unlockSound,
} from "@/components/realtime/new-order-alert";

const HAS_REALTIME_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Booster-wide "new order" alert: on every dashboard page, a pop-up and a
 * sound when an order this booster may take appears in the pool. Listens to
 * the pool channel; falls back to checking every 20 s while realtime is down.
 * Also shows a small sound switch (sound needs one click to be allowed).
 *
 * Sound test 2026-11-22: the alert must also work while the dashboard is
 * behind another tab or window. So it keeps checking in the background
 * (browsers slow timers down there, never below once a minute), checks every
 * minute even while live (a background tab can miss a realtime message while
 * it reconnects), and shows a desktop notification when the booster allowed
 * it. Mounted on the dashboard and, for boosters, on the public pages too.
 */
/** Safety check while live: a missed realtime message is caught within a minute. */
const SAFETY_POLL_MS = 60_000;

export function BoosterNewOrderAlert() {
  // Only show the switch once the server confirmed this booster can see the pool.
  const [allowed, setAllowed] = useState(false);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    armSoundUnlock();
    let known: Set<string> | null = null;
    let alive = true;
    let inFlight = false;

    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/booster/orders/available", { cache: "no-store" });
        if (!res.ok || !alive) return;
        setAllowed(true);
        const data = (await res.json()) as { orders?: { id: string }[] };
        const ids = new Set((data.orders ?? []).map((o) => o.id));
        const prev = known;
        known = ids;
        if (!prev) return; // first load: nothing is "new"
        const fresh = [...ids].filter((id) => !prev.has(id));
        if (fresh.length === 0) return;
        toastRef.current({
          title: fresh.length === 1 ? "New order available" : `${fresh.length} new orders available`,
          description: soundUnlocked() ? undefined : "Click anywhere on the page once to turn on sound alerts.",
          type: "order",
          duration: 10_000,
          action: (
            <Link href="/dashboard/booster/available-orders" className="text-xs font-semibold text-[#C8AA6E] hover:underline">
              View
            </Link>
          ),
        });
        playNewOrderSound();
        showDesktopNotification({
          title: fresh.length === 1 ? "New order available" : `${fresh.length} new orders available`,
          body: "Open LegendsBoost to claim it before someone else does.",
          url: "/dashboard/booster/available-orders",
          tag: "lb-new-order",
        });
      } catch {
        /* offline: next signal or poll retries */
      } finally {
        inFlight = false;
      }
    };

    let state: LiveState | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const updatePolling = () => {
      const live = HAS_REALTIME_ENV && state === "live";
      if (live && poll) {
        clearInterval(poll);
        poll = null;
      } else if (!live && !poll) {
        // Also while the tab is hidden: that is when the booster needs the alert most.
        poll = setInterval(() => void check(), LIVE_POLL_MS);
      }
    };
    const safety = setInterval(() => void check(), SAFETY_POLL_MS);

    const channel = HAS_REALTIME_ENV
      ? new LiveChannel({
          channel: poolChannel(),
          events: ["pool.changed"],
          createClient: createBrowserRealtimeClient,
          fetchToken: fetchRealtimeToken,
          onSignal: () => void check(),
          onState: (s) => {
            state = s;
            updatePolling();
          },
        })
      : null;
    void check();
    updatePolling();
    void channel?.start();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (poll) clearInterval(poll);
      clearInterval(safety);
      void channel?.stop();
    };
  }, []);

  const unlocked = useSyncExternalStore(subscribeSound, soundUnlocked, () => true);
  const muted = useSyncExternalStore(subscribeSound, soundMuted, () => false);
  const desktop = useSyncExternalStore(subscribeSound, desktopPermission, () => "unsupported" as const);

  if (!allowed) return null;
  const on = unlocked && !muted;
  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-1.5">
      {on && desktop === "default" ? (
        <button
          type="button"
          onClick={() => void requestDesktopPermission()}
          title="Get a pop-up with sound when a new order arrives while this tab is in the background"
          className="rounded-full border border-[#C8AA6E]/30 bg-[#111319]/90 px-3 py-1.5 text-xs text-[#C8AA6E] shadow-lg backdrop-blur hover:text-white"
        >
          Alert me in other tabs too
        </button>
      ) : null}
    <button
      type="button"
      onClick={() => {
        if (on) {
          setSoundMuted(true);
          return;
        }
        unlockSound();
        setSoundMuted(false);
        playNewOrderSound({ force: true }); // let the booster hear it once
        void requestDesktopPermission(); // pop-ups for when the tab is in the background
      }}
      title={on ? "New order sound is on (click to mute)" : "Turn on the new order sound"}
      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#111319]/90 px-3 py-1.5 text-xs text-zinc-300 shadow-lg backdrop-blur hover:text-white"
    >
      {on ? <Bell className="h-3.5 w-3.5 text-[#C8AA6E]" /> : <BellOff className="h-3.5 w-3.5 text-zinc-500" />}
      {on ? "Order sound on" : "Turn on order sound"}
    </button>
    </div>
  );
}

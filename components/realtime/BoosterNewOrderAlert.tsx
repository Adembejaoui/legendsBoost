"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { LiveChannel, type LiveState } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";
import { poolChannel } from "@/lib/realtime/channel-names";
import { LIVE_POLL_MS } from "@/components/realtime/LiveRefresh";
import {
  armSoundUnlock,
  playNewOrderSound,
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
 */
export function BoosterNewOrderAlert() {
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
        poll = setInterval(() => {
          if (document.visibilityState === "visible") void check();
        }, LIVE_POLL_MS);
      }
    };

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
      void channel?.stop();
    };
  }, []);

  const unlocked = useSyncExternalStore(subscribeSound, soundUnlocked, () => true);
  const muted = useSyncExternalStore(subscribeSound, soundMuted, () => false);

  const on = unlocked && !muted;
  return (
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
      }}
      title={on ? "New order sound is on (click to mute)" : "Turn on the new order sound"}
      className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#111319]/90 px-3 py-1.5 text-xs text-zinc-300 shadow-lg backdrop-blur hover:text-white"
    >
      {on ? <Bell className="h-3.5 w-3.5 text-[#C8AA6E]" /> : <BellOff className="h-3.5 w-3.5 text-zinc-500" />}
      {on ? "Order sound on" : "Turn on order sound"}
    </button>
  );
}

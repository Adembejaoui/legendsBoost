"use client";

import { useEffect } from "react";
import { LiveChannel } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";
import { userChannel } from "@/lib/realtime/channel-names";
import { armSoundUnlock, playMessageSound } from "@/components/realtime/new-order-alert";

const HAS_REALTIME_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Customer and booster: a ding when the other person writes in an order chat
 * while they are on another dashboard page (client PDFs 2026-11-22). On that
 * order's own page the chat plays the sound itself.
 */
export function MessageSoundAlert({ userId }: { userId: string }) {
  useEffect(() => {
    armSoundUnlock();
    if (!HAS_REALTIME_ENV) return;
    const channel = new LiveChannel({
      channel: userChannel(userId),
      events: ["notification.created"],
      createClient: createBrowserRealtimeClient,
      fetchToken: fetchRealtimeToken,
      onSignal: (_event, raw) => {
        const p = (raw ?? {}) as { type?: string; orderId?: string | null };
        if (p.type !== "NEW_MESSAGE") return;
        if (p.orderId && window.location.pathname === `/dashboard/${p.orderId}`) return;
        playMessageSound();
      },
      onState: () => {},
    });
    void channel.start();
    return () => void channel.stop();
  }, [userId]);
  return null;
}

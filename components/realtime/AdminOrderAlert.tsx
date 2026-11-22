"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { LiveChannel } from "@/lib/realtime/live-client";
import { createBrowserRealtimeClient, fetchRealtimeToken } from "@/lib/chat/realtime-sync";
import { userChannel } from "@/lib/realtime/channel-names";
import { armSoundUnlock, playAlertSound, soundUnlocked } from "@/components/realtime/new-order-alert";
import { NOTIFICATION_TITLES } from "@/lib/notifications/types";

const HAS_REALTIME_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Notifications that need an admin on the order right away (client PDF 2026-11-22). */
const ALERT_TITLES = new Set([NOTIFICATION_TITLES.BOOSTER_CHANGE_REQUESTED, NOTIFICATION_TITLES.BOOSTER_ABANDONED]);

interface CreatedPayload {
  type?: string;
  title?: string;
  message?: string;
  orderId?: string | null;
}

/**
 * Admin-wide alert: a pop-up and a sound when a customer asks for a
 * different booster or a booster abandons an order. The button opens the
 * admin order editor for that order.
 */
export function AdminOrderAlert({ userId }: { userId: string }) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    armSoundUnlock();
    if (!HAS_REALTIME_ENV) return;
    const channel = new LiveChannel({
      channel: userChannel(userId),
      events: ["notification.created"],
      createClient: createBrowserRealtimeClient,
      fetchToken: fetchRealtimeToken,
      onSignal: (_event, raw) => {
        const p = (raw ?? {}) as CreatedPayload;
        if (!p.title || !ALERT_TITLES.has(p.title)) return;
        toastRef.current({
          title: p.title,
          description: `${p.message ?? ""}${soundUnlocked() ? "" : " Click anywhere once to turn on sound alerts."}`,
          type: "warning",
          duration: 30_000,
          action: p.orderId ? (
            <Link href={`/dashboard/admin/orders/${p.orderId}`} className="text-xs font-semibold text-[#C8AA6E] hover:underline">
              Open order
            </Link>
          ) : undefined,
        });
        playAlertSound();
      },
      onState: () => {},
    });
    void channel.start();
    return () => void channel.stop();
  }, [userId]);

  return null;
}

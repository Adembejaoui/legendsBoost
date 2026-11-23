"use client";

import { useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { useNotificationAlerts } from "@/components/realtime/useNotificationAlerts";
import { armSoundUnlock, playAlertSound, soundUnlocked } from "@/components/realtime/new-order-alert";
import { NOTIFICATION_TITLES } from "@/lib/notifications/types";

/** Notifications that need an admin on the order right away (client PDF 2026-11-22). */
const ALERT_TITLES = new Set([
  NOTIFICATION_TITLES.BOOSTER_CHANGE_REQUESTED,
  NOTIFICATION_TITLES.BOOSTER_ABANDONED,
  // Sound test 2026-11-22: a booster sent the completion screenshots for approval.
  NOTIFICATION_TITLES.COMPLETION_REVIEW,
]);

/**
 * Admin-wide alert: a pop-up and a sound when a customer asks for a
 * different booster, a booster abandons an order or a booster sends an order
 * for completion review. The button opens the
 * admin order editor for that order.
 */
export function AdminOrderAlert({ userId }: { userId: string }) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => armSoundUnlock(), []);

  // Real time, with a 20 s check while the live connection is down.
  useNotificationAlerts(userId, (p) => {
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
  });

  return null;
}

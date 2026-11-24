"use client";

import { useEffect, useRef } from "react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast";
import { armSoundUnlock, playMessageSound, playPauseSound, playTipSound, showDesktopNotification } from "@/components/realtime/new-order-alert";
import { useNotificationAlerts } from "@/components/realtime/useNotificationAlerts";
import { NOTIFICATION_TITLES } from "@/lib/notifications/types";
import { stripLocale } from "@/lib/i18n/alternates";

/**
 * Customer and booster alerts on every page:
 *  - a ding when the other person writes in an order chat while they are not
 *    on that order's page (there the chat plays the sound itself);
 *  - booster: a pop-up and a sound when the customer pauses an order or
 *    sends a tip (sound test 2026-11-22).
 * Real time, with a 20 s check while the live connection is down.
 */
export function MessageSoundAlert({ userId }: { userId: string }) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(() => armSoundUnlock(), []);

  useNotificationAlerts(userId, (n) => {
    const open = n.orderId ? (
      <Link href={`/dashboard/${n.orderId}`} className="text-xs font-semibold text-[#C8AA6E] hover:underline">
        Open order
      </Link>
    ) : undefined;
    if (n.title === NOTIFICATION_TITLES.TIP_RECEIVED) {
      toastRef.current({ title: n.title, description: n.message, type: "success", duration: 10_000, action: open });
      playTipSound();
      return;
    }
    if (n.title === NOTIFICATION_TITLES.ORDER_PAUSED_BY_CUSTOMER) {
      toastRef.current({ title: n.title, description: n.message, type: "warning", duration: 30_000, action: open });
      playPauseSound();
      return;
    }
    // Stalled order alerts (2026-11-24): sound, pop-up and, in the background, a desktop notification.
    const stall = [
      NOTIFICATION_TITLES.STALL_NO_CONTACT,
      NOTIFICATION_TITLES.STALL_WARNING,
      NOTIFICATION_TITLES.STALL_FINAL_WARNING,
      NOTIFICATION_TITLES.ORDER_AUTO_RELEASED,
    ];
    if (n.title && stall.includes(n.title)) {
      const urgent = n.title !== NOTIFICATION_TITLES.STALL_WARNING;
      toastRef.current({ title: n.title, description: n.message, type: "warning", duration: urgent ? 60_000 : 20_000, action: open });
      playPauseSound();
      showDesktopNotification({ title: n.title ?? "", body: n.message, url: n.orderId ? `/dashboard/${n.orderId}?view=chat` : undefined, tag: `lb-stall-${n.orderId ?? ""}` });
      return;
    }
    if (n.type !== "NEW_MESSAGE") return;
    if (n.orderId && stripLocale(window.location.pathname) === `/dashboard/${n.orderId}`) return;
    playMessageSound();
  });
  return null;
}

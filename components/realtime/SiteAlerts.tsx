"use client";

import { usePathname } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import { ToastProvider } from "@/components/ui/toast";
import { BoosterNewOrderAlert } from "@/components/realtime/BoosterNewOrderAlert";
import { MessageSoundAlert } from "@/components/realtime/MessageSoundAlert";

/**
 * Alerts on the public pages (home, games, services...), realtime test
 * 2026-11-22: a signed-in customer or booster still hears chat messages, and
 * a booster still gets the new order alert and the pause / tip pop-ups.
 * The dashboard mounts its own alerts in its layout, so these stay out of
 * /dashboard. The new order alert shows nothing until the server confirms
 * the booster may see the pool.
 */
export function SiteAlerts() {
  const pathname = usePathname() ?? "";
  const { data } = useSession();
  const user = data?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role === "ADMIN" || pathname.startsWith("/dashboard")) return null;
  return (
    <ToastProvider>
      <MessageSoundAlert userId={user.id} />
      {user.role === "BOOSTER" ? <BoosterNewOrderAlert /> : null}
    </ToastProvider>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";

/** How often the open page asks "was a new game played?". */
export const RIOT_CHECK_INTERVAL_MS = 60_000;

/**
 * Keeps the order page's Riot data live: checks right away, then every
 * minute while the tab is visible (and immediately when it becomes visible
 * again). The server answers with one cheap Riot call and only re-syncs when
 * a new game was played; the page re-renders only when data changed.
 */
export function useRiotAutoRefresh(data: WorkspaceDTO) {
  const router = useRouter();
  const inFlight = useRef(false);
  const enabled =
    !!data.riot.account?.platform &&
    !data.riot.account.platformUnsupported &&
    data.access.canSyncRiot &&
    data.riot.capabilities.dataAccess;
  const orderId = data.order.id;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    async function check() {
      if (stopped || inFlight.current || document.visibilityState !== "visible") return;
      inFlight.current = true;
      try {
        const res = await fetch(`/api/orders/${orderId}/riot/check`, { method: "POST", cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { changed?: boolean } | null;
        if (!stopped && res.ok && body?.changed) router.refresh();
      } catch {
        /* offline / transient: the next tick retries */
      } finally {
        inFlight.current = false;
      }
    }

    void check();
    const timer = setInterval(() => void check(), RIOT_CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, orderId, router]);
}

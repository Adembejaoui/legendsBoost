"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const KEY = "lb.cookieNotice";
let listeners: (() => void)[] = [];

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "seen";
  } catch {
    return true; // storage blocked: do not nag
  }
}

/**
 * Cookie notice (Phase 9). The site only uses necessary cookies (sign-in,
 * checkout) and cookie-free anonymous page statistics, so this is
 * information, not a consent form.
 */
export function CookieNotice() {
  const t = useTranslations("CookieNotice");
  const seen = useSyncExternalStore(
    (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    read,
    () => true
  );
  if (seen) return null;
  return (
    <div role="region" aria-label={t("region")} className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-white/10 bg-[#111319]/95 p-4 text-sm text-zinc-300 shadow-xl backdrop-blur">
      <p>
        {t("text")}{" "}
        <Link href="/privacy" className="text-violet-300 underline-offset-2 hover:underline">
          {t("privacy")}
        </Link>
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "seen");
          } catch {
            /* ignore */
          }
          listeners.forEach((l) => l());
        }}
        className="mt-3 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black"
      >
        {t("ok")}
      </button>
    </div>
  );
}

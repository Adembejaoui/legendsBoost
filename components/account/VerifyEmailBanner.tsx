"use client";

import { useState, useSyncExternalStore } from "react";
import { MailWarning, X } from "lucide-react";

const HIDE_KEY = "lb.verifyEmailHidden";
let listeners: (() => void)[] = [];
function readHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Optional reminder (decision 2026-11-15): nothing is blocked. Shown in the
 * dashboard until the email is confirmed; can be hidden for this browser
 * session.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const hidden = useSyncExternalStore(
    (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    readHidden,
    () => false
  );
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (hidden) return null;

  async function resend() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/account/verify-email", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send the email.");
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the email.");
      setState("idle");
    }
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100"
    >
      <MailWarning className="size-4 shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1">
        {state === "sent" ? (
          <>
            We sent a link to <span className="font-semibold">{email}</span>. Check your inbox and spam folder.
          </>
        ) : (
          <>
            Please confirm your email address <span className="font-semibold">{email}</span> so we can reach you about your orders.
          </>
        )}
        {error ? <span className="ms-2 text-rose-300">{error}</span> : null}
      </p>
      {state !== "sent" && (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === "sending"}
          className="rounded-md bg-amber-400 px-3 py-1 text-xs font-semibold text-[#0A0E14] hover:bg-amber-300 disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send the email again"}
        </button>
      )}
      <button
        type="button"
        aria-label="Hide"
        onClick={() => {
          try {
            sessionStorage.setItem(HIDE_KEY, "1");
          } catch {
            /* ignore */
          }
          listeners.forEach((l) => l());
        }}
        className="rounded-md p-1 text-amber-200/70 hover:bg-white/10 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

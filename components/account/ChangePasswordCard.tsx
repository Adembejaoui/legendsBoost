"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useToast } from "@/components/ui/toast";

const input = "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/30";

/**
 * Change the password (or set one on a Google-only account). Every device is
 * signed out; this one is signed in again right away with the new password.
 */
export function ChangePasswordCard() {
  const { toast } = useToast();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/account/password", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hasPassword?: boolean } | null) => {
        if (alive && d) setHasPassword(Boolean(d.hasPassword));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("The new password must be at least 8 characters.");
    if (next !== confirm) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not change the password.");
      // All sessions (this one too) are now ended: sign this device in again.
      const again = data.email ? await signIn("credentials", { email: data.email, password: next, redirect: false }) : null;
      if (!again || again.error) {
        window.location.assign("/login");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setHasPassword(true);
      toast({ type: "success", title: "Password changed", description: "Your other devices were signed out." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm">
      <h2 className="font-semibold text-white">{hasPassword === false ? "Set a password" : "Change password"}</h2>
      <p className="text-zinc-400">
        {hasPassword === false
          ? "You sign in with Google. You can add a password to also sign in with your email."
          : "Changing your password signs out all your other devices."}
      </p>
      <form onSubmit={onSubmit} className="grid max-w-md gap-2.5">
        {hasPassword !== false && (
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Current password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={busy}
            className={input}
          />
        )}
        <input
          type="password"
          autoComplete="new-password"
          aria-label="New password"
          placeholder="New password (at least 8 characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={busy}
          className={input}
        />
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Repeat the new password"
          placeholder="Repeat the new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          className={input}
        />
        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        <div>
          <button
            type="submit"
            disabled={busy || hasPassword === null || !next || !confirm || (hasPassword === true && !current)}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Saving…" : hasPassword === false ? "Set password" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "./auth-ui";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not reset the password.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">This link is not complete. Open the link from the email again, or ask for a new one.</p>
        <Link href="/forgot-password" className="inline-block text-[#C8AA6E] hover:underline">
          Ask for a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
          Your password is changed and all devices were signed out. Sign in with the new password.
        </p>
        <Button asChild className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field id="password" label="New password">
        <PasswordInput id="password" value={password} onChange={setPassword} disabled={busy} placeholder="At least 8 characters" invalid={false} />
      </Field>
      <Field id="confirm" label="Repeat the new password" error={error ?? undefined}>
        <PasswordInput id="confirm" value={confirm} onChange={setConfirm} disabled={busy} placeholder="Same password again" invalid={Boolean(error)} />
      </Field>
      <Button type="submit" disabled={busy} className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
        {busy ? "Saving…" : "Set new password"}
      </Button>
      {error && error.includes("no longer valid") ? (
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-[#C8AA6E] hover:underline">
            Ask for a new link
          </Link>
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "./auth-ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
          If an account exists for <span className="font-semibold">{email.trim().toLowerCase()}</span>, we sent a link to choose a new
          password. It works once and expires in 1 hour.
        </p>
        <p className="text-zinc-400">Nothing in your inbox? Check the spam folder, or try again in a few minutes.</p>
        <Link href="/login" className="inline-block text-[#C8AA6E] hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field id="email" label="Email" error={error ?? undefined}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="you@example.com"
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
      </Field>
      <Button type="submit" disabled={busy} className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
        {busy ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-zinc-500">
        Remembered it?{" "}
        <Link href="/login" className="text-[#C8AA6E] hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

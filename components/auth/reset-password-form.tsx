"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "./auth-ui";
import { useTranslations } from "next-intl";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("Auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t("reset.short"));
    if (password !== confirm) return setError(t("reset.mismatch"));
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t("reset.failed"));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">{t("reset.incomplete")}</p>
        <Link href="/forgot-password" className="inline-block text-[#C8AA6E] hover:underline">
          {t("reset.newLink")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
          {t("reset.done")}
        </p>
        <Button asChild className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field id="password" label={t("reset.new")}>
        <PasswordInput id="password" value={password} onChange={setPassword} disabled={busy} placeholder={t("reset.newPlaceholder")} invalid={false} />
      </Field>
      <Field id="confirm" label={t("reset.repeat")} error={error ?? undefined}>
        <PasswordInput id="confirm" value={confirm} onChange={setConfirm} disabled={busy} placeholder={t("reset.repeatPlaceholder")} invalid={Boolean(error)} />
      </Field>
      <Button type="submit" disabled={busy} className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
        {busy ? t("reset.saving") : t("reset.save")}
      </Button>
      {error && error.includes("no longer valid") ? (
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-[#C8AA6E] hover:underline">
            {t("reset.newLink")}
          </Link>
        </p>
      ) : null}
    </form>
  );
}

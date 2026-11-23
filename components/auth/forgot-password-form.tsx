"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "./auth-ui";
import { useTranslations } from "next-intl";

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("login.enterEmail"));
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
      if (!res.ok) throw new Error(data.error ?? t("error"));
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-sm text-zinc-300">
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">
          {t.rich("forgot.sent", {
            email: email.trim().toLowerCase(),
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
        <p className="text-zinc-400">{t("forgot.spam")}</p>
        <Link href="/login" className="inline-block text-[#C8AA6E] hover:underline">
          {t("forgot.back")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field id="email" label={t("email")} error={error ?? undefined}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder={t("emailPlaceholder")}
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
      </Field>
      <Button type="submit" disabled={busy} className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
        {busy ? t("forgot.sending") : t("forgot.send")}
      </Button>
      <p className="text-center text-sm text-zinc-500">
        {t("forgot.remembered")}{" "}
        <Link href="/login" className="text-[#C8AA6E] hover:underline">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}

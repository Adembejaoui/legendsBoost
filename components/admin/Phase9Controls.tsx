"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";

const input = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30";
const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

/** Re-render the page every `seconds` while the tab is visible (live board). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Admin: approve (anonymise) or reject an account deletion request. */
export function DeletionDecision({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    const note = approve ? "" : window.prompt("Why reject this request? (shown in the audit log)") ?? "";
    if (!approve && note.trim().length < 3) return;
    if (approve && !window.confirm("Delete this account? Personal data is anonymised and cannot be restored.")) return;
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/account-deletions/${requestId}`, "POST", { approve, ...(note.trim() ? { note: note.trim() } : {}) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void decide(true)} className={`${btn} bg-rose-500 text-white`}>
        Delete account
      </button>
      <button type="button" disabled={busy} onClick={() => void decide(false)} className={`${btn} bg-white/10 text-white`}>
        Reject
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}

/** Admin: edit one setting as JSON, save or reset to the default. */
export function ConfigRow({ configKey, value, defaultValue, overridden }: { configKey: string; value: unknown; defaultValue: unknown; overridden: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const multiline = typeof value === "object" && value !== null;

  async function save(reset: boolean) {
    let parsed: unknown = null;
    if (!reset) {
      try {
        parsed = JSON.parse(text);
      } catch {
        setMsg("Not valid JSON");
        return;
      }
    } else if (!window.confirm(`Reset ${configKey} to its default?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await send("/api/admin/config", "PUT", { key: configKey, value: reset ? null : parsed });
      setMsg(reset ? "Reset" : "Saved");
      if (reset) setText(JSON.stringify(defaultValue, null, 2));
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm font-semibold text-white">{configKey}</code>
        {overridden ? <span className="rounded bg-[#C8AA6E]/20 px-1.5 py-0.5 text-[11px] text-[#e3c98f]">changed</span> : <span className="text-[11px] text-zinc-500">default</span>}
      </div>
      {multiline ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, text.split("\n").length + 1)} spellCheck={false} className={`${input} w-full font-mono text-xs`} />
      ) : (
        <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className={`${input} w-64 font-mono`} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void save(false)} className={`${btn} bg-white text-black`}>
          Save
        </button>
        {overridden ? (
          <button type="button" disabled={busy} onClick={() => void save(true)} className={`${btn} bg-white/10 text-zinc-300`}>
            Reset to default
          </button>
        ) : null}
        <span className="text-[11px] text-zinc-500">Default: {JSON.stringify(defaultValue).slice(0, 120)}</span>
        {msg ? <span className="text-xs text-zinc-300">{msg}</span> : null}
      </div>
    </div>
  );
}

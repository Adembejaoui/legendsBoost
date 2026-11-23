"use client";

import { Link } from "@/i18n/navigation";
import { ClipboardList, Copy, Check, LifeBuoy } from "lucide-react";
import { useState } from "react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { Panel, Pill, Row, ORDER_STATUS_TONE, GameArt } from "./Panel";

function formatMoney(price: string | null, currency: string | null) {
  if (!price) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return price;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "EUR" }).format(n);
  } catch {
    return `${price} ${currency ?? ""}`.trim();
  }
}

/** Minor units -> "45,00 €" for the booster payout. */
function formatMinor(amount: number, currency: string) {
  return formatMoney((amount / 100).toFixed(2), currency);
}

export function OrderInfoPanel({ data }: { data: WorkspaceDTO }) {
  const { order, people, viewer } = data;
  const [copied, setCopied] = useState(false);
  const money = formatMoney(order.price, order.currency);

  return (
    <Panel
      dense
      title="Order information"
      icon={<ClipboardList className="size-3.5" />}
      action={
        data.viewer.role === "customer" ? (
          <Link
            href={`/dashboard/support/new?orderId=${encodeURIComponent(order.id)}`}
            className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
          >
            <LifeBuoy className="size-3.5" /> Get help
          </Link>
        ) : null
      }
    >
      <div className="mb-2 flex items-center gap-2.5">
        <GameArt src={order.gameImage} alt="" fallback={order.gameName} className="size-9 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{order.serviceName}</p>
          <p className="truncate text-xs text-zinc-500">{order.gameName}</p>
        </div>
        <Pill tone={ORDER_STATUS_TONE[order.status] ?? "neutral"} className="ms-auto">
          {order.statusLabel}
        </Pill>
      </div>
      <dl className="divide-y divide-white/[0.04]">
        <Row
          label="Order ID"
          mono
          value={
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(order.id).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1.5 text-zinc-100 hover:text-white"
              aria-label={`Copy order ID ${order.id}`}
              title={order.id}
            >
              #{order.shortId}
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5 text-zinc-500" />}
            </button>
          }
        />
        <Row label="Game" value={order.gameName} />
        <Row label="Service" value={order.serviceName} />
        <Row label="Created" value={new Date(order.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })} />
        {order.completedAt && (
          <Row label="Completed" value={new Date(order.completedAt).toLocaleDateString(undefined, { dateStyle: "medium" })} />
        )}
        <Row label="Server" value={order.platformLabel ?? <span className="text-zinc-500">Not provided</span>} />
        {order.mode && <Row label="Boost mode" value={order.mode} />}
        {order.details.map((d) => (
          <Row key={d.label} label={d.label} value={d.value} />
        ))}
        {money && <Row label="Price" value={<span className="font-semibold text-[var(--g-light)]">{money}</span>} />}
        {order.boosterPayout && (
          <Row
            label="Your payout"
            value={<span className="font-semibold text-[var(--g-light)]">{formatMinor(order.boosterPayout.amount, order.boosterPayout.currency)}</span>}
          />
        )}
        {viewer.role !== "customer" && <Row label="Customer" value={people.customerName ?? "—"} />}
        <Row
          label="Booster"
          value={
            viewer.role === "booster" && people.boosterName
              ? `${people.boosterName} (you)`
              : people.boosterName ?? <span className="text-zinc-500">Not assigned</span>
          }
        />
        {data.progress.kind === "rank" && data.progress.percent !== null && (
          <Row label="Progress" value={`${data.progress.percent}%`} />
        )}
        {data.progress.kind === "wins" && data.progress.wins && (
          <Row label="Wins" value={`${data.progress.wins.attributed} / ${data.progress.wins.ordered ?? "?"}`} />
        )}
        <Row label="Rank updates" value={String(data.updates.list.length)} />
        {viewer.role === "admin" && people.customerEmail && <Row label="Customer email" value={people.customerEmail} />}
        {viewer.role === "admin" && people.boosterEmail && <Row label="Booster email" value={people.boosterEmail} />}
      </dl>
      {order.options.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Selected options</p>
          <div className="flex flex-wrap gap-1.5">
            {order.options.map((o) => (
              <Pill key={o}>{o}</Pill>
            ))}
          </div>
        </div>
      )}
      {order.rules.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            {viewer.role === "customer" ? "Your booster follows" : "Booster rules"}
          </p>
          <ul className="space-y-1">
            {order.rules.map((r) => (
              <li key={r.label} className="flex gap-2 text-xs text-zinc-300">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--g-accent)]" />
                <span>
                  <span className="font-semibold text-white">{r.label}:</span> {r.rule}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

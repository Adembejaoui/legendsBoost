"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getGame,
  getGameServiceOffer,
  getChampions,
} from "@/lib/catalog/catalog-utils";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { asRecord, RankRoute, readRank } from "@/components/dashboard/rank-route";
import { formatMoney, toDecimalString } from "@/lib/money";
import { vpnCountryName } from "@/lib/catalog/vpn-countries";
import { useLiveRefresh } from "@/components/realtime/LiveRefresh";
import { poolChannel } from "@/lib/realtime/channel-names";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface AvailableOrder {
  id: string;
  gameSlug: string;
  serviceSlug: string;
  createdAt: string | Date;
  selectedMode?: string | null;
  // JSON columns: validated where they're read.
  configuration?: unknown;
  championsRoles?: unknown;
  selectedOptions?: unknown;
  region?: string | null;
  isPriority: boolean;
  preferredForMe: boolean;
  preferredUntil: string | Date | null;
  currency: string;
  /** Booster payout ceiling (minor units). Never the customer price. */
  payoutCeiling: number;
  claimNowAmount: number;
  minBid: number;
  biddingClosesAt: string | Date | null;
  bidCount: number;
  lowestBid: number | null;
  myBid: number | null;
}

function secondsLeft(at: string | Date | null, now: number): number | null {
  if (!at) return null;
  return Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

type Champion = ReturnType<typeof getChampions>[number];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function getExtrasLabels(gameSlug: string, serviceSlug: string, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const config = getCheckoutConfig(gameSlug, serviceSlug);
  if (!config) return ids;
  return ids.map((id) => config.options.find((o) => o.id === id)?.label ?? id);
}

function formatAge(dateString: string | Date, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(dateString).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Avatar({ src, name }: { src?: string | null; name: string }) {
  return src ? (
    <Image
      src={src}
      alt=""
      width={36}
      height={36}
      className="size-9 rounded-full border border-white/10 bg-white/5 object-cover"
    />
  ) : (
    <div
      aria-hidden="true"
      className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "gold" }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        tone === "gold"
          ? "border-[#C8AA6E]/30 bg-[#C8AA6E]/10 text-[#C8AA6E]"
          : "border-white/10 bg-white/[0.04] text-zinc-300",
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Order card                                                          */
/* ------------------------------------------------------------------ */

/** "12.40 EUR": amount and currency code, so the booster sees the wallet it lands in. */
function moneyCode(amount: number, currency: string): string {
  try {
    return `${toDecimalString(amount, currency)} ${currency}`;
  } catch {
    return formatMoney(amount, currency);
  }
}

/** Label of a select field's saved value ("EUW1" -> "Europe West"), from the offer definition. */
function selectLabel(gameSlug: string, serviceSlug: string, key: string, value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const field = getGameServiceOffer(gameSlug, serviceSlug)?.fields.find((f) => f.key === key);
  if (field && (field.type === "select" || field.type === "multi-select")) return field.options.find((o) => o.value === value)?.label ?? value;
  return value;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 truncate text-end text-sm font-medium text-zinc-100">{children}</dd>
    </div>
  );
}

function OrderCard({
  order,
  now,
  championsById,
  claiming,
  anyClaiming,
  onClaim,
  onBid,
  onWithdraw,
  blocked,
}: {
  order: AvailableOrder;
  now: number;
  championsById: Map<string, Champion>;
  claiming: boolean;
  anyClaiming: boolean;
  onClaim: (id: string) => void;
  onBid: (id: string, amount: number) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
  blocked: boolean;
}) {
  const [bidText, setBidText] = useState(order.myBid !== null ? (order.myBid / 100).toFixed(2) : "");
  const [bidBusy, setBidBusy] = useState(false);
  // Bidding is folded under "Or bid" (open when the booster already bid).
  const [bidOpen, setBidOpen] = useState(order.myBid !== null);
  const money = (n: number) => moneyCode(n, order.currency);
  const left = secondsLeft(order.biddingClosesAt, now);
  const prefLeft = secondsLeft(order.preferredUntil, now);
  const directOnly = order.isPriority || order.preferredForMe;
  const claimAmount = directOnly ? order.payoutCeiling : order.claimNowAmount;
  // A bid can never exceed the payout, and must beat the current lowest bid.
  const maxBid = order.lowestBid !== null && order.lowestBid !== order.myBid ? Math.min(order.payoutCeiling, order.lowestBid - 1) : order.payoutCeiling;
  async function submitBid() {
    const cents = Math.round(Number(bidText.replace(",", ".")) * 100);
    setBidBusy(true);
    try {
      await onBid(order.id, cents);
    } finally {
      setBidBusy(false);
    }
  }
  const game = getGame(order.gameSlug);
  const gameName = game?.name ?? order.gameSlug;
  const serviceTitle = getGameServiceOffer(order.gameSlug, order.serviceSlug)?.title ?? order.serviceSlug;

  const config = asRecord(order.configuration);
  const cr = asRecord(order.championsRoles);
  const champions = asStringArray(cr.champions);
  const roles = asStringArray(cr.roles);
  const otpId = typeof cr.otpChampion === "string" ? cr.otpChampion : null;
  const selectedIds = asStringArray(order.selectedOptions);
  const vpnCode = selectedIds.includes("vpn") && typeof cr.vpnCountry === "string" ? cr.vpnCountry : null;
  // OTP and VPN have their own rows; the other extras stay as chips.
  const extras = getExtrasLabels(
    order.gameSlug,
    order.serviceSlug,
    selectedIds.filter((id) => id !== "otp-champion" && id !== "vpn"),
  );

  const currentRank = readRank(order.gameSlug, order.serviceSlug, "currentRank", config);
  const targetRank = readRank(order.gameSlug, order.serviceSlug, "targetRank", config);
  const wins = config["wins"];
  const isWinBoost = order.serviceSlug === "win-boost";
  const mode = getCheckoutConfig(order.gameSlug, order.serviceSlug)?.modes?.find((m) => m.id === (order.selectedMode ?? "solo"))?.label ?? order.selectedMode ?? "Solo";
  const server = selectLabel(order.gameSlug, order.serviceSlug, "server", config.server) ?? order.region;
  const queue = selectLabel(order.gameSlug, order.serviceSlug, "queueType", config.queueType) ?? selectLabel(order.gameSlug, order.serviceSlug, "gameMode", config.gameMode);
  const otp = otpId ? championsById.get(otpId) : undefined;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0f19]">
      {/* Payout first */}
      <header className="border-b border-white/10 bg-gradient-to-br from-[#C8AA6E]/[0.08] to-transparent p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={game?.image} name={gameName} />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">{serviceTitle}</h3>
              <p className="truncate text-xs text-zinc-400">{gameName}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {order.preferredForMe && <Chip tone="gold">Chosen for you</Chip>}
            {order.isPriority && <Chip tone="gold">Priority</Chip>}
          </div>
        </div>
        <div className="mt-4 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold tracking-tight text-white">{money(order.payoutCeiling)}</span>
          <span className="text-xs text-zinc-500">{directOnly ? "your payout" : "your payout, up to"}</span>
        </div>
        {order.preferredForMe && prefLeft !== null && (
          <p className="mt-1 text-xs text-[#C8AA6E]" suppressHydrationWarning>
            Reserved for you for {formatCountdown(prefLeft)}, then it goes to the pool.
          </p>
        )}
      </header>

      <div className="flex flex-1 flex-col p-5">
        <RankRoute from={currentRank} to={targetRank} wins={wins} isWinBoost={isWinBoost} />

        <dl className="mt-4 divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {server ? <DetailRow label="Server">{server}</DetailRow> : null}
          {queue ? <DetailRow label="Queue type">{queue}</DetailRow> : null}
          <DetailRow label="Mode">{mode}</DetailRow>
          {selectedIds.includes("otp-champion") ? (
            <DetailRow label="OTP Champ">
              {otp?.iconSrc ? <Image src={otp.iconSrc} alt="" width={20} height={20} className="size-5 rounded-full" /> : null}
              <span className="truncate">{otp?.name ?? otpId ?? "Not chosen"}</span>
            </DetailRow>
          ) : null}
          {selectedIds.includes("vpn") ? (
            <DetailRow label="VPN">{vpnCode ? vpnCountryName(vpnCode) : "Customer's country"}</DetailRow>
          ) : null}
          {roles.length > 0 ? <DetailRow label="Roles"><span className="capitalize">{roles.join(", ")}</span></DetailRow> : null}
        </dl>

        {champions.length > 0 && (
          <section className="mt-4">
            <h4 className="mb-2 text-xs text-zinc-500">Champions</h4>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {champions.map((id) => {
                const champ = championsById.get(id);
                const name = champ?.name ?? id;
                return (
                  <li key={id} className="flex w-12 shrink-0 flex-col items-center gap-1" title={name}>
                    <Avatar src={champ?.iconSrc} name={name} />
                    <span className="w-full truncate text-center text-xs text-zinc-400">{name}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {extras.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Extras">
            {extras.map((extra) => (
              <li key={extra}>
                <Chip>+ {extra}</Chip>
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-auto pt-5">
          <Button
            className="h-11 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85] disabled:opacity-70"
            onClick={() => onClaim(order.id)}
            disabled={anyClaiming || blocked}
          >
            {claiming ? "Claiming…" : `Claim for ${money(claimAmount)}`}
          </Button>

          {directOnly ? (
            <p className="mt-2 text-center text-xs text-zinc-500">
              {order.preferredForMe
                ? "The customer chose you: no bidding, full payout."
                : "Priority order: no bidding, the first booster to claim gets the full payout."}
            </p>
          ) : (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setBidOpen((v) => !v)}
                aria-expanded={bidOpen}
                className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <span>
                  Or bid (lowest wins){order.bidCount > 0 ? ` · ${order.bidCount} bid${order.bidCount === 1 ? "" : "s"}` : ""}
                  {order.myBid !== null ? ` · yours ${money(order.myBid)}` : ""}
                </span>
                <span aria-hidden>{bidOpen ? "▴" : "▾"}</span>
              </button>
              {bidOpen ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <p className="mb-2 text-xs text-zinc-400" suppressHydrationWarning>
                    {left !== null ? `Closes in ${formatCountdown(left)}` : "Starts with the first bid"}
                    {order.lowestBid !== null ? ` · lowest ${money(order.lowestBid)}` : ""}
                  </p>
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      aria-label="Your bid"
                      value={bidText}
                      onChange={(e) => setBidText(e.target.value)}
                      placeholder={`${(order.minBid / 100).toFixed(2)} – ${(maxBid / 100).toFixed(2)} ${order.currency}`}
                      className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2.5 text-sm text-white outline-none focus:border-white/30"
                      disabled={blocked || bidBusy}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 border-white/15 bg-transparent text-white hover:bg-white/[0.06]"
                      onClick={() => void submitBid()}
                      disabled={blocked || bidBusy || bidText.trim() === "" || Math.round(Number(bidText.replace(",", ".")) * 100) > maxBid}
                    >
                      {order.myBid !== null ? "Update" : "Bid"}
                    </Button>
                  </div>
                  {order.myBid !== null && (
                    <p className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                      <span>Your bid: {money(order.myBid)}</span>
                      <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => void onWithdraw(order.id)}>
                        Withdraw
                      </button>
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-600">
            <span suppressHydrationWarning>Posted {formatAge(order.createdAt, now)}</span>
            <span className="font-mono">#{order.id.slice(-8).toUpperCase()}</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export default function AvailableOrdersClient({
  initialOrders,
  blockedReason,
}: {
  initialOrders: AvailableOrder[];
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, startRefresh] = useTransition();

  // Pick up fresh data after router.refresh().
  useEffect(() => setOrders(initialOrders), [initialOrders]);

  // Live: the pool refetches when an order is added, taken or bid on.
  useLiveRefresh([{ channel: poolChannel(), events: ["pool.changed"] }]);

  // The "new order" pop-up and sound live in the dashboard layout
  // (BoosterNewOrderAlert), so they work on every booster page.

  // Countdowns tick every second; the list reloads when a window ends.
  const nextDeadline = useMemo(() => {
    const times = orders
      .flatMap((o) => [o.biddingClosesAt, o.preferredUntil])
      .filter((t): t is string | Date => !!t)
      .map((t) => new Date(t).getTime());
    return times.length ? Math.min(...times) : null;
  }, [orders]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), nextDeadline ? 1_000 : 60_000);
    return () => clearInterval(t);
  }, [nextDeadline]);
  useEffect(() => {
    if (!nextDeadline) return;
    const wait = Math.max(1_000, nextDeadline - Date.now() + 1_500);
    const t = setTimeout(() => startRefresh(() => router.refresh()), wait);
    return () => clearTimeout(t);
  }, [nextDeadline, router]);

  async function send(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
    return data;
  }

  async function handleBid(orderId: string, amount: number) {
    setError(null);
    try {
      await send(`/api/booster/orders/${orderId}/bid`, "POST", { amount });
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place the bid.");
    }
  }

  async function handleWithdraw(orderId: string) {
    setError(null);
    try {
      await send(`/api/booster/orders/${orderId}/bid`, "DELETE");
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw the bid.");
    }
  }

  const championsById = useMemo(
    () => new Map(getChampions().map((c) => [c.id, c])),
    [],
  );

  // Filters are built from the orders that exist, so there is never an empty tab.
  const games = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) counts.set(o.gameSlug, (counts.get(o.gameSlug) ?? 0) + 1);
    return [...counts.entries()].map(([slug, count]) => ({
      slug,
      count,
      name: getGame(slug)?.name ?? slug,
    }));
  }, [orders]);

  const activeFilter = games.some((g) => g.slug === filter) ? filter : "all";
  const visibleOrders =
    activeFilter === "all" ? orders : orders.filter((o) => o.gameSlug === activeFilter);

  async function handleClaim(orderId: string) {
    setClaiming(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/booster/orders/${orderId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        // Stay in the claiming state until the navigation completes.
        
        router.push(`/dashboard/${orderId}`);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Someone else got there first.
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      }
      setError(data.error ?? "Failed to claim order.");
    } catch {
      setError("Failed to claim order. Check your connection and try again.");
    }
    setClaiming(null);
  }

  const pillClass = (active: boolean) =>
    cn(
      "rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40",
      active
        ? "border-[#C8AA6E]/50 bg-[#C8AA6E]/15 text-[#C8AA6E]"
        : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
    );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by game">
          <button
            type="button"
            aria-pressed={activeFilter === "all"}
            onClick={() => setFilter("all")}
            className={pillClass(activeFilter === "all")}
          >
            All games ({orders.length})
          </button>
          {games.map((g) => (
            <button
              key={g.slug}
              type="button"
              aria-pressed={activeFilter === g.slug}
              onClick={() => setFilter(g.slug)}
              className={pillClass(activeFilter === g.slug)}
            >
              {g.name} ({g.count})
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-white/10 bg-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-white"
          disabled={isRefreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {blockedReason && (
        <div role="status" className="mb-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-200">
          {blockedReason}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-red-300/70 hover:text-red-200"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {visibleOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-6 py-14 text-center">
          <p className="text-sm font-medium text-white">No orders available right now</p>
          <p className="mt-1 text-sm text-zinc-400">
            New orders you can take (your games, rank ceiling and regions) show up here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              championsById={championsById}
              claiming={claiming === order.id}
              anyClaiming={claiming !== null}
              onClaim={handleClaim}
              onBid={handleBid}
              onWithdraw={handleWithdraw}
              blocked={!!blockedReason}
            />
          ))}
        </div>
      )}
    </div>
  );
}
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
import { LOL_ROLES } from "@/lib/catalog/champions";
import { countLabel, orderGameCount } from "@/lib/orders/game-count";
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

const ROLE_LABEL = new Map(LOL_ROLES.map((r) => [r.id as string, r.label]));
const roleLabel = (id: string) => ROLE_LABEL.get(id) ?? id;

/** Amount typed by the booster ("12,40" or "12.40") in minor units, or null. */
function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
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
  const money = (n: number) => moneyCode(n, order.currency);
  const plain = (n: number) => (n / 100).toFixed(2);
  const left = secondsLeft(order.biddingClosesAt, now);
  const prefLeft = secondsLeft(order.preferredUntil, now);
  const directOnly = order.isPriority || order.preferredForMe;
  // Claim: the order price minus 25 % (priority and "chosen for you": full price).
  const claimAmount = directOnly ? order.payoutCeiling : order.claimNowAmount;
  // Bids: from the order price minus 24.5 % up to the order price, and below
  // the lowest bid of the other boosters.
  const otherLowest = order.lowestBid !== null && order.lowestBid !== order.myBid ? order.lowestBid : null;
  const maxBid = otherLowest !== null ? Math.min(order.payoutCeiling, otherLowest - 1) : order.payoutCeiling;
  const bidAmount = parseAmount(bidText);
  const bidProblem =
    bidText.trim() === ""
      ? null
      : bidAmount === null
        ? "Enter an amount, e.g. 12.40."
        : bidAmount < order.minBid
          ? `The lowest bid is ${money(order.minBid)}.`
          : bidAmount > maxBid
            ? otherLowest !== null && maxBid < order.payoutCeiling
              ? `Bid lower than the current lowest bid (${money(otherLowest)}).`
              : `The highest bid is ${money(order.payoutCeiling)}.`
            : null;
  const canBid = !blocked && !bidBusy && bidAmount !== null && bidProblem === null && maxBid >= order.minBid;

  async function submitBid() {
    if (bidAmount === null) return;
    setBidBusy(true);
    try {
      await onBid(order.id, bidAmount);
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
  // Roles are saved in order: [main, secondary] (older orders may list more).
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
  const games = orderGameCount(order.gameSlug, order.serviceSlug, config);
  const count = games ? { caption: games.caption, value: countLabel(games.total, games.unit) } : null;
  const mode = getCheckoutConfig(order.gameSlug, order.serviceSlug)?.modes?.find((m) => m.id === (order.selectedMode ?? "solo"))?.label ?? order.selectedMode ?? "Solo";
  const field = (key: string) => selectLabel(order.gameSlug, order.serviceSlug, key, config[key]);
  const server = field("server") ?? order.region;
  const queue = field("queueType") ?? field("gameMode");
  const lpGain = field("lpGain");
  const currentLp = field("currentLp");
  const otp = otpId ? championsById.get(otpId) : undefined;
  const isLeague = order.gameSlug === "league-of-legends";

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0f19]">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={game?.image} name={gameName} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">{serviceTitle}</h3>
            <p className="truncate text-xs text-zinc-400">
              {gameName} · <span className="font-mono">#{order.id.slice(-8).toUpperCase()}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {order.preferredForMe && <Chip tone="gold">Chosen for you</Chip>}
          {order.isPriority && <Chip tone="gold">Priority</Chip>}
        </div>
      </header>

      <div className="flex flex-1 flex-col p-5">
        <RankRoute from={currentRank} to={targetRank} count={count} />

        <dl className="mt-4 divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {server ? <DetailRow label="Server">{server}</DetailRow> : null}
          {queue ? <DetailRow label="Queue type">{queue}</DetailRow> : null}
          <DetailRow label="Mode">{mode}</DetailRow>
          {games?.kind === "arena-wins" ? <DetailRow label="Win rule">1st place only</DetailRow> : null}
          {lpGain ? <DetailRow label="LP gains">{lpGain}</DetailRow> : null}
          {currentLp ? <DetailRow label="Current LP">{currentLp}</DetailRow> : null}
          {roles.length > 2 ? (
            <DetailRow label="Roles">{roles.map(roleLabel).join(", ")}</DetailRow>
          ) : isLeague || roles.length > 0 ? (
            <>
              <DetailRow label="Main role">{roles[0] ? roleLabel(roles[0]) : <span className="text-zinc-500">Any</span>}</DetailRow>
              <DetailRow label="Secondary role">{roles[1] ? roleLabel(roles[1]) : <span className="text-zinc-500">Any</span>}</DetailRow>
            </>
          ) : null}
          {selectedIds.includes("otp-champion") ? (
            <DetailRow label="OTP Champ">
              {otp?.iconSrc ? <Image src={otp.iconSrc} alt="" width={20} height={20} className="size-5 rounded-full" /> : null}
              <span className="truncate">{otp?.name ?? otpId ?? "Not chosen"}</span>
            </DetailRow>
          ) : null}
          {selectedIds.includes("vpn") ? (
            <DetailRow label="VPN">{vpnCode ? vpnCountryName(vpnCode) : "Customer's country"}</DetailRow>
          ) : null}
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

        {/* Price, then bid, then claim. */}
        <footer className="mt-auto pt-5">
          <div className="rounded-xl border border-[#C8AA6E]/25 bg-gradient-to-b from-[#C8AA6E]/[0.10] to-[#C8AA6E]/[0.02] p-4">
            <div className="text-center">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#C8AA6E]/80">Order price</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-white">{money(order.payoutCeiling)}</p>
              {order.preferredForMe && prefLeft !== null ? (
                <p className="mt-1 text-xs text-[#C8AA6E]" suppressHydrationWarning>
                  Reserved for you for {formatCountdown(prefLeft)}, then it goes to the pool.
                </p>
              ) : null}
            </div>

            {directOnly ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center text-xs text-zinc-400">
                {order.preferredForMe
                  ? "The customer chose you: no bidding, you get the full price."
                  : "Priority order: no bidding, the first booster to claim gets the full price."}
              </p>
            ) : (
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                  <label htmlFor={`bid-${order.id}`} className="font-medium text-zinc-200">
                    Your bid <span className="font-normal text-zinc-500">(lowest wins)</span>
                  </label>
                  <span className="text-zinc-500">
                    {plain(order.minBid)} – {plain(order.payoutCeiling)} {order.currency}
                  </span>
                </div>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      id={`bid-${order.id}`}
                      inputMode="decimal"
                      value={bidText}
                      onChange={(e) => setBidText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canBid) void submitBid();
                      }}
                      placeholder={plain(maxBid)}
                      aria-invalid={bidProblem !== null}
                      className={cn(
                        "h-10 w-full rounded-lg border bg-black/30 ps-3 pe-12 text-sm text-white outline-none placeholder:text-zinc-600",
                        bidProblem ? "border-red-400/50 focus:border-red-400/70" : "border-white/10 focus:border-[#C8AA6E]/60",
                      )}
                      disabled={blocked || bidBusy}
                    />
                    <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">{order.currency}</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 border-[#C8AA6E]/40 bg-transparent px-4 text-[#C8AA6E] hover:bg-[#C8AA6E]/10 hover:text-[#d8bc85]"
                    onClick={() => void submitBid()}
                    disabled={!canBid}
                  >
                    {bidBusy ? "…" : order.myBid !== null ? "Update" : "Bid"}
                  </Button>
                </div>
                {bidProblem ? <p className="mt-1.5 text-xs text-red-300">{bidProblem}</p> : null}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <span suppressHydrationWarning>
                    {order.bidCount > 0 ? `${order.bidCount} bid${order.bidCount === 1 ? "" : "s"}` : "No bids yet"}
                    {order.lowestBid !== null ? ` · lowest ${money(order.lowestBid)}` : ""}
                    {left !== null ? ` · closes in ${formatCountdown(left)}` : ""}
                  </span>
                  {order.myBid !== null ? (
                    <span className="flex items-center gap-2">
                      <span className="text-zinc-300">Yours: {money(order.myBid)}</span>
                      <button type="button" className="underline-offset-2 hover:text-zinc-300 hover:underline" onClick={() => void onWithdraw(order.id)}>
                        Withdraw
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            )}

            <Button
              className="mt-4 h-11 w-full bg-[#C8AA6E] text-base font-semibold text-[#0A0E14] hover:bg-[#d8bc85] disabled:opacity-70"
              onClick={() => onClaim(order.id)}
              disabled={anyClaiming || blocked}
            >
              {claiming ? "Claiming…" : `Claim for ${money(claimAmount)}`}
            </Button>
            {!directOnly ? <p className="mt-1.5 text-center text-[11px] text-zinc-500">Claim now: order price − 25%, no waiting.</p> : null}
          </div>

          <p className="mt-3 text-end text-[11px] text-zinc-600" suppressHydrationWarning>
            Posted {formatAge(order.createdAt, now)}
          </p>
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
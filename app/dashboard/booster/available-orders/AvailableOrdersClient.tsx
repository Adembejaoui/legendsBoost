"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

function OrderCard({
  order,
  now,
  championsById,
  claiming,
  anyClaiming,
  onClaim,
}: {
  order: AvailableOrder;
  now: number;
  championsById: Map<string, Champion>;
  claiming: boolean;
  anyClaiming: boolean;
  onClaim: (id: string) => void;
}) {
  const game = getGame(order.gameSlug);
  const gameName = game?.name ?? order.gameSlug;
  const serviceTitle =
    getGameServiceOffer(order.gameSlug, order.serviceSlug)?.title ?? order.serviceSlug;

  const config = asRecord(order.configuration);
  const { champions = [], roles = [] } = (() => {
    const cr = asRecord(order.championsRoles);
    return { champions: asStringArray(cr.champions), roles: asStringArray(cr.roles) };
  })();
  const extras = getExtrasLabels(
    order.gameSlug,
    order.serviceSlug,
    asStringArray(order.selectedOptions),
  );

  const currentRank = readRank(order.gameSlug, order.serviceSlug, "currentRank", config);
  const targetRank = readRank(order.gameSlug, order.serviceSlug, "targetRank", config);
  const wins = config["wins"];
  const isWinBoost = order.serviceSlug === "win-boost";
  const mode = order.selectedMode ?? "solo";

  return (
    <article className="flex flex-col rounded-xl border border-white/10 bg-[#0b0f19] p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={game?.image} name={gameName} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">{serviceTitle}</h3>
            <p className="truncate text-xs text-zinc-400">{gameName}</p>
          </div>
        </div>
        <Chip tone="gold">{mode}</Chip>
      </header>

      <RankRoute
        className="mt-5"
        from={currentRank}
        to={targetRank}
        wins={wins}
        isWinBoost={isWinBoost}
      />

      {(champions.length > 0 || roles.length > 0 || extras.length > 0) && (
        <div className="mt-5 space-y-4">
          {champions.length > 0 && (
            <section>
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

          {roles.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs text-zinc-500">Roles</h4>
              <ul className="flex flex-wrap gap-1.5">
                {roles.map((role) => (
                  <li key={role}>
                    <Chip>{role}</Chip>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {extras.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs text-zinc-500">Extras</h4>
              <ul className="flex flex-wrap gap-1.5">
                {extras.map((extra) => (
                  <li key={extra}>
                    <Chip>+ {extra}</Chip>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <footer className="mt-auto pt-5">
        <div className="mb-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-500">
          <span suppressHydrationWarning>Posted {formatAge(order.createdAt, now)}</span>
          <span className="font-mono">#{order.id.slice(-8).toUpperCase()}</span>
        </div>
        <Button
          className="h-10 w-full bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85] disabled:opacity-70"
          onClick={() => onClaim(order.id)}
          disabled={anyClaiming}
        >
          {claiming ? "Claiming…" : "Claim order"}
        </Button>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export default function AvailableOrdersClient({
  initialOrders,
}: {
  initialOrders: AvailableOrder[];
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

  // Keep "Posted 5m ago" honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

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
        router.push(`/dashboard/booster/orders/${orderId}`);
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
            New orders show up here as customers place them.
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
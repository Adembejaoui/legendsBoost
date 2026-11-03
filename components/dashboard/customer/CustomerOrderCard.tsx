import Link from "next/link";
import { $Enums } from "@/app/generated/prisma/client";
import { formatRankLabel } from "@/lib/catalog/rank-systems";
import { getGame, getServiceTemplate, getGameServiceOffer } from "@/lib/catalog/catalog-utils";
import { ORDER_STATUS_CONFIG, formatStatusLabel } from "@/lib/orders/status-display";
import { RankDisplay } from "@/components/dashboard/customer/RankDisplay";

interface CustomerOrderCardProps {
  order: {
    id: string;
    gameSlug: string;
    serviceSlug: string;
    status: $Enums.OrderStatus;
    createdAt: Date;
    selectedMode: string | null;
    price: number | null;
    currency: string | null;
    configuration: Record<string, unknown> | null;
  };
}

function getRankSelection(
  cfg: Record<string, unknown> | null,
  key: string,
): { tierId: string; divisionId: string | null } | undefined {
  if (!cfg) return undefined;
  const value = cfg[key];
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tierId !== "string") return undefined;
  return {
    tierId: obj.tierId,
    divisionId: typeof obj.divisionId === "string" ? obj.divisionId : null,
  };
}

function getRankSystemId(gameSlug: string, serviceSlug: string): string | undefined {
  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  return offer?.rankSystemId;
}

export function CustomerOrderCard({ order }: CustomerOrderCardProps) {
  const game = getGame(order.gameSlug);
  const template = getServiceTemplate(order.serviceSlug);
  const statusCfg = ORDER_STATUS_CONFIG[order.status];
  const rankSystemId = getRankSystemId(order.gameSlug, order.serviceSlug);
  const currentRank = getRankSelection(order.configuration, "currentRank");
  const targetRank = getRankSelection(order.configuration, "targetRank");
  const displayName = order.id.slice(-6).toUpperCase();
  const date = new Date(order.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const modeLabel = order.selectedMode ? ` &middot; ${order.selectedMode}` : "";

  return (
    <Link
      href={`/dashboard/customer/orders/${order.id}`}
      className="group flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/8 sm:flex-row sm:items-center sm:gap-5"
    >
      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-white/8 overflow-hidden">
        {game?.image ? (
          <img src={game.image} alt={game.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">
            {game?.shortName?.slice(0, 2) ?? order.gameSlug.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h3 className="font-semibold text-white truncate">
            {template?.title ?? order.serviceSlug}
          </h3>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
              statusCfg.color === "completed"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : statusCfg.color === "active"
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                  : statusCfg.color === "cancelled"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-white/20 bg-white/5 text-zinc-400"
            }`}
          >
            {statusCfg.label}
          </span>
        </div>

        <div className="text-sm text-zinc-400">
          {game?.name ?? order.gameSlug} &middot; {date}{modeLabel}
        </div>

        {(currentRank || targetRank) && rankSystemId && (
          <div className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
            {currentRank && (
              <span className="flex items-center gap-1">
                <span className="text-white/60">Current:</span>
                <RankDisplay
                  gameSlug={order.gameSlug}
                  serviceSlug={order.serviceSlug}
                  selection={currentRank}
                />
              </span>
            )}
            {targetRank && (
              <span className="flex items-center gap-1 ml-3">
                <span className="text-white/60">Target:</span>
                <RankDisplay
                  gameSlug={order.gameSlug}
                  serviceSlug={order.serviceSlug}
                  selection={targetRank}
                />
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {order.price != null && order.currency ? (
          <div className="text-right hidden sm:block">
            <div className="text-xs text-zinc-500">Total</div>
            <div className="text-sm font-bold tabular-nums text-white">
              {order.price.toString()} {order.currency}
            </div>
          </div>
        ) : null}
        <div className="text-xs text-zinc-500 uppercase tracking-wider hidden sm:block">
          Order #{displayName}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="size-4 text-zinc-500 group-hover:text-violet-400 transition-colors"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

import { cn } from "@/lib/utils";
import { getGameServiceOffer, formatSelection } from "@/lib/catalog/catalog-utils";
import { display } from "@/lib/fonts";

export type Rank = { label: string; tierId: string };
type RankSelection = { tierId: string; divisionId: string | null };

const TIER_COLORS: Record<string, string> = {
  iron: "#7b7b80",
  bronze: "#a06a45",
  silver: "#9aa6b2",
  gold: "#c8aa6e",
  platinum: "#4e9996",
  emerald: "#2da36b",
  diamond: "#576bce",
  master: "#9d48e0",
  grandmaster: "#c2453d",
  challenger: "#f4c874",
  ascendant: "#2da36b",
  immortal: "#c2453d",
  radiant: "#f4c874",
};

function tierColor(tierId?: string): string {
  const id = (tierId ?? "").toLowerCase();
  const key = Object.keys(TIER_COLORS).find((k) => id.includes(k));
  return key ? TIER_COLORS[key] : "#52525b";
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readRank(
  gameSlug: string,
  serviceSlug: string,
  key: string,
  config: Record<string, unknown>,
): Rank | null {
  const raw = config[key];
  if (!raw || typeof raw !== "object") return null;
  // The field's own rank system first: Net Win Boost has none at service
  // level, only on its "Current rank" field (client PDF 2026-11-24).
  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  const field = offer?.fields.find((f) => f.key === key);
  const rankSystemId = (field && "rankSystemId" in field && typeof field.rankSystemId === "string" ? field.rankSystemId : undefined) ?? offer?.rankSystemId;
  if (!rankSystemId) return null;
  const selection = raw as RankSelection;
  return { label: formatSelection(rankSystemId, selection), tierId: selection.tierId };
}

function Side({
  caption,
  rank,
  text,
  align,
}: {
  caption: string;
  rank?: Rank | null;
  text?: string;
  align: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-end")}>
      <div className="text-xs text-zinc-500">{caption}</div>
      <div
        className={cn(
          display.className,
          "mt-1 flex items-center gap-2 text-2xl font-semibold leading-tight text-white",
          align === "right" && "justify-end",
        )}
      >
        {rank && (
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: tierColor(rank.tierId) }}
          />
        )}
        <span className={cn("truncate", !rank && !text && "text-base font-normal text-zinc-500")}>
          {rank?.label ?? text ?? "Not specified"}
        </span>
      </div>
    </div>
  );
}

/**
 * "From → To" panel. Orders counted in games (net wins, placement games)
 * show the count ordered on the right instead of a target rank.
 */
export function RankRoute({
  from,
  to,
  count,
  className,
}: {
  from: Rank | null;
  to?: Rank | null;
  count?: { caption: string; value: string } | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3.5",
        className,
      )}
    >
      <Side caption="From" rank={from} align="left" />
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 text-zinc-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      {count ? (
        <Side caption={count.caption} text={count.value} align="right" />
      ) : (
        <Side caption="To" rank={to} align="right" />
      )}
    </div>
  );
}
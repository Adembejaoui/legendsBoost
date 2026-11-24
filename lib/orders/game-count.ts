/**
 * Orders counted in games instead of ranks (client PDFs 2026-11-24):
 * Net Win Boost (net wins) and Placement Boost (placement games played, won
 * or lost), and Arena Boost (Arena wins, a win = a 1st place finish, client
 * 2026-11-24). The total is what the customer ordered; the booster posts the
 * count done so far (0/5 -> 5/5). Safe for client and server.
 */
import { getGameServiceOffer } from "@/lib/catalog/game-services";

export type GameCountKind = "net-wins" | "wins" | "placements" | "arena-wins";

/** Texts per kind: workspace title, the number ordered, how the booster counts. */
export const GAME_COUNT_TEXT: Record<GameCountKind, { progress: string; ordered: string; howToCount: string }> = {
  "net-wins": {
    progress: "Net win progress",
    ordered: "Net wins ordered",
    howToCount: "Count the net wins so far (wins minus losses since the start of the order).",
  },
  wins: { progress: "Win progress", ordered: "Wins ordered", howToCount: "Count the games won so far since the start of the order." },
  placements: { progress: "Placement progress", ordered: "Placement games ordered", howToCount: "Count every placement game played so far, won or lost." },
  "arena-wins": {
    progress: "Arena win progress",
    ordered: "Arena wins ordered",
    howToCount: "Count the Arena games finished in 1st place so far. 2nd to 8th place does not count as a win.",
  },
};

/** Shown with Arena orders (customer, booster, admin). */
export const ARENA_WIN_RULE = "An Arena win is a 1st place finish.";

export interface GameCount {
  kind: GameCountKind;
  /** Configuration field that holds the total ("wins", "placementsRemaining"). */
  fieldKey: string;
  /** Games ordered. */
  total: number;
  /** "net wins", "wins", "placement games". */
  unit: string;
  /** "Net wins ordered", "Placement games ordered". */
  caption: string;
}

const COUNT_FIELDS: Record<string, "wins" | "placements" | "arena-wins"> = {
  wins: "wins",
  placementsRemaining: "placements",
  arenaWins: "arena-wins",
};

/** The game count of an order, or null when it is not counted in games. */
export function orderGameCount(gameSlug: string, serviceSlug: string, configuration: unknown): GameCount | null {
  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  if (!offer) return null;
  const field = offer.fields.find((f) => f.type === "number" && f.key in COUNT_FIELDS);
  if (!field) return null;
  const cfg = (configuration && typeof configuration === "object" ? configuration : {}) as Record<string, unknown>;
  const raw = cfg[field.key];
  const total = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(total) || total < 1) return null;
  if (COUNT_FIELDS[field.key] === "placements") {
    return { kind: "placements", fieldKey: field.key, total, unit: "placement games", caption: GAME_COUNT_TEXT.placements.ordered };
  }
  if (COUNT_FIELDS[field.key] === "arena-wins") {
    return { kind: "arena-wins", fieldKey: field.key, total, unit: "Arena wins", caption: GAME_COUNT_TEXT["arena-wins"].ordered };
  }
  const net = "unit" in field && typeof field.unit === "string" && field.unit.startsWith("net");
  return net
    ? { kind: "net-wins", fieldKey: field.key, total, unit: "net wins", caption: "Net wins ordered" }
    : { kind: "wins", fieldKey: field.key, total, unit: "wins", caption: "Wins ordered" };
}

/** "1 net win", "5 net wins", "3 placement games". */
export function countLabel(n: number, unit: string): string {
  return `${n} ${n === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit}`;
}

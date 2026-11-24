/**
 * Orders counted in games instead of ranks (client PDFs 2026-11-24):
 * Net Win Boost (net wins) and Placement Boost (placement games played, won
 * or lost), and Arena Boost (Arena wins, a win = a 1st place finish, client
 * 2026-11-24), and Normal Games Boost (games or wins, client PDF 2026-11-25).
 * The total is what the customer ordered; the booster posts the
 * count done so far (0/5 -> 5/5). Safe for client and server.
 */
import { getGameServiceOffer } from "@/lib/catalog/game-services";

export type GameCountKind = "net-wins" | "wins" | "placements" | "arena-wins" | "normal-games" | "normal-wins";

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
  // Normal Games Boost (client PDF 2026-11-25): games or wins, chosen at checkout.
  "normal-games": {
    progress: "Normal games progress",
    ordered: "Normal games ordered",
    howToCount: "Count every normal game played so far, won or lost.",
  },
  "normal-wins": {
    progress: "Normal wins progress",
    ordered: "Normal wins ordered",
    howToCount: "Count the normal games won so far. Lost games do not count.",
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

const COUNT_FIELDS: Record<string, "wins" | "placements" | "arena-wins" | "normal"> = {
  wins: "wins",
  placementsRemaining: "placements",
  arenaWins: "arena-wins",
  // Normal Games Boost: games or wins, from the countType field.
  matches: "normal",
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
  if (COUNT_FIELDS[field.key] === "normal") {
    // Only LoL Normal Games (VALORANT Unrated also has a "matches" field).
    if (gameSlug !== "league-of-legends" || serviceSlug !== "normal-matches") return null;
    return cfg.countType === "wins"
      ? { kind: "normal-wins", fieldKey: field.key, total, unit: "normal wins", caption: GAME_COUNT_TEXT["normal-wins"].ordered }
      : { kind: "normal-games", fieldKey: field.key, total, unit: "normal games", caption: GAME_COUNT_TEXT["normal-games"].ordered };
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

/**
 * Both sides of the route for services without ranks (client PDF 2026-11-25):
 * Champion Mastery shows "Level 4 -> Level 6"; Normal Games shows games or
 * wins on the left (the count ordered comes from orderGameCount).
 */
export function serviceRoute(
  gameSlug: string,
  serviceSlug: string,
  config: Record<string, unknown>,
): { start: { caption: string; value: string } | null; count: { caption: string; value: string } | null } | null {
  if (gameSlug !== "league-of-legends") return null;
  if (serviceSlug === "champion-mastery") {
    const level = (v: unknown) => (typeof v === "number" ? `Level ${v}` : null);
    const from = level(config.currentLevel);
    const to = level(config.targetLevel);
    return {
      start: from ? { caption: "Current mastery", value: from } : null,
      count: to ? { caption: "Desired mastery", value: to } : null,
    };
  }
  if (serviceSlug === "normal-matches") {
    return { start: { caption: "Counted in", value: config.countType === "wins" ? "Wins" : "Games" }, count: null };
  }
  return null;
}

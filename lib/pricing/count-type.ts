/**
 * Normal Games Boost: the customer orders games (every game played counts)
 * or wins (only games won count). Client PDF 2026-11-25: a win costs 50%
 * more than a game. The engine applies this to the per-unit line only.
 * Orders without the field (older orders, API clients) count as games.
 * Changing a value here changes NEW quotes only: every order keeps the
 * price snapshot it was paid with.
 */
export const COUNT_TYPE_FIELD = "countType";

/** Surcharge on the per-unit line, in basis points (1% = 100 bps). */
export const COUNT_TYPE_ADJUST_BPS: Record<string, number> = {
  games: 0,
  wins: 5000,
};

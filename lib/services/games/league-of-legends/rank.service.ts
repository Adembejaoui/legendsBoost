import type { RiotClient } from "./riot-client";
import { resolveRiotRouting } from "./routing";
import { normalizeRank } from "./progression.service";
import { leagueEntriesSchema } from "./riot.schemas";
import type { LeagueRank, RiotLeagueEntryDto, RiotPlatform } from "./riot.types";

export type RankedQueue = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

/** League-V4 ranked entries for a PUUID (platform-routed). */
export async function fetchLeagueEntries(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  ctx: { correlationId?: string; orderId?: string } = {}
): Promise<RiotLeagueEntryDto[]> {
  const { platformHost } = resolveRiotRouting(platform);
  return client.get(platformHost, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`, {
    schema: leagueEntriesSchema,
    cacheTtlMs: 60 * 1000,
    ...ctx,
  });
}

/** Pick one queue's entry. Unranked in that queue -> null (not an error). */
export function pickQueueRank(
  entries: RiotLeagueEntryDto[],
  queue: RankedQueue
): LeagueRank | null {
  const entry = entries.find((e) => e.queueType === queue);
  if (!entry || !entry.tier) return null;
  return normalizeRank(entry.tier, entry.rank ?? null, entry.leaguePoints);
}

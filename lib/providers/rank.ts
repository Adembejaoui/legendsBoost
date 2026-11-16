// Server-only module.
/**
 * RankProvider [registry F7]: where rank and match data come from.
 *
 *  - riot:   official Riot APIs (existing services; needs a key Riot allows,
 *            which a boosting product may not get).
 *  - mock:   scripted data for tests and demos.
 *  - manual: booster-submitted rank + screenshot, verified by support
 *            (build plan Phase 5; not implemented yet).
 * Selected by config `tracker_provider`. Phase 5 moves the sync service onto
 * this interface; until then the sync keeps calling the Riot services
 * directly (the same functions RiotRankProvider wraps).
 */
import { getConfig } from "@/lib/config";
import { getRiotClient } from "@/lib/services/games/league-of-legends/shared-client";
import { resolveAccountByRiotId } from "@/lib/services/games/league-of-legends/account.service";
import { fetchLeagueEntries } from "@/lib/services/games/league-of-legends/rank.service";
import { fetchLatestMatchIds } from "@/lib/services/games/league-of-legends/profile.service";
import { fetchMatch } from "@/lib/services/games/league-of-legends/match-history.service";
import type { RiotLeagueEntryDto, RiotMatchDto, RiotPlatform } from "@/lib/services/games/league-of-legends/riot.types";

export interface ResolvedAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface RankProvider {
  readonly kind: "riot" | "mock" | "manual";
  /** Throws a not-found error when the Riot ID does not exist. */
  resolveAccount(platform: RiotPlatform, gameName: string, tagLine: string): Promise<ResolvedAccount>;
  getRankedEntries(platform: RiotPlatform, puuid: string): Promise<RiotLeagueEntryDto[]>;
  getRecentMatchIds(platform: RiotPlatform, puuid: string, count: number): Promise<string[]>;
  getMatch(platform: RiotPlatform, matchId: string): Promise<RiotMatchDto>;
}

export class RiotRankProvider implements RankProvider {
  readonly kind = "riot" as const;
  private client = getRiotClient();
  async resolveAccount(platform: RiotPlatform, gameName: string, tagLine: string) {
    const a = await resolveAccountByRiotId(this.client, platform, gameName, tagLine);
    return { puuid: a.puuid, gameName: a.gameName ?? gameName, tagLine: a.tagLine ?? tagLine };
  }
  getRankedEntries(platform: RiotPlatform, puuid: string) {
    return fetchLeagueEntries(this.client, platform, puuid);
  }
  getRecentMatchIds(platform: RiotPlatform, puuid: string, count: number) {
    return fetchLatestMatchIds(this.client, platform, puuid, count);
  }
  getMatch(platform: RiotPlatform, matchId: string) {
    return fetchMatch(this.client, platform, matchId);
  }
}

function notFound(): Error {
  return Object.assign(new Error("Not found on Riot"), { name: "RiotNotFoundError", status: 404 });
}

/** Scripted provider for tests and demos (no network). */
export class MockRankProvider implements RankProvider {
  readonly kind = "mock" as const;
  constructor(
    private data: {
      accounts?: Record<string, ResolvedAccount>;
      entries?: Record<string, RiotLeagueEntryDto[]>;
      matchIds?: Record<string, string[]>;
      matches?: Record<string, RiotMatchDto>;
    } = {}
  ) {}
  async resolveAccount(_platform: RiotPlatform, gameName: string, tagLine: string) {
    const a = this.data.accounts?.[`${gameName}#${tagLine}`.toLowerCase()];
    if (!a) throw notFound();
    return a;
  }
  async getRankedEntries(_platform: RiotPlatform, puuid: string) {
    return this.data.entries?.[puuid] ?? [];
  }
  async getRecentMatchIds(_platform: RiotPlatform, puuid: string, count: number) {
    return (this.data.matchIds?.[puuid] ?? []).slice(0, count);
  }
  async getMatch(_platform: RiotPlatform, matchId: string) {
    const m = this.data.matches?.[matchId];
    if (!m) throw notFound();
    return m;
  }
}

/** The configured provider. `manual` arrives in Phase 5. */
export async function getRankProvider(): Promise<RankProvider> {
  const kind = await getConfig("tracker_provider");
  if (kind === "mock") return new MockRankProvider();
  if (kind === "manual") throw new Error("Manual rank tracking is not available yet (build plan Phase 5).");
  return new RiotRankProvider();
}

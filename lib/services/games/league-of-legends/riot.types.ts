/**
 * Types for the subset of Riot's official League of Legends APIs this app
 * uses. Shapes follow the public Riot Developer Portal reference; only the
 * fields we read are declared.
 */

/**
 * Platforms this app supports. Each one is listed in Riot's docs platform
 * table AND served by Summoner-V4 + League-V4 by-puuid (Riot API reference).
 * See routing.ts for the excluded values (PH2, TH2, ME1) and why.
 */
export type RiotPlatform =
  | "BR1" | "EUN1" | "EUW1" | "JP1" | "KR" | "LA1" | "LA2"
  | "NA1" | "OC1" | "RU" | "SG2" | "TR1" | "TW2" | "VN2";

/** Platform values that exist(ed) but are not supported here. */
export type UnsupportedRiotPlatform = "PH2" | "TH2" | "ME1";

/** Match-V5 regional routing values. */
export type RiotMatchRegion = "americas" | "asia" | "europe" | "sea";
/** Account-V1 regional clusters (Account-V1 is not served on `sea`). */
export type RiotAccountCluster = "americas" | "asia" | "europe";

export interface RiotRouting {
  platform: RiotPlatform;
  platformHost: string;
  matchRegion: RiotMatchRegion;
  matchHost: string;
  accountCluster: RiotAccountCluster;
  accountHost: string;
}

// Response DTOs are derived from the runtime schemas (riot.schemas.ts) so
// the types can never drift from what is actually validated.
export type {
  RiotAccountDto,
  RiotAccountRegionDto,
  RiotSummonerDto,
  RiotLeagueEntryDto,
  RiotParticipantDto,
  RiotMatchDto,
} from "./riot.schemas";

export type RankTier =
  | "IRON" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "EMERALD" | "DIAMOND"
  | "MASTER" | "GRANDMASTER" | "CHALLENGER";

export type RankDivision = "IV" | "III" | "II" | "I";

/** A League rank, normalized. `division` is null for apex tiers. */
export interface LeagueRank {
  tier: RankTier;
  division: RankDivision | null;
  lp: number;
}

/** Where a rank value came from. Never conflate these. */
export type RankSource =
  | "riot" // observed from an authorized League-V4 response
  | "order"; // configured on the order (customer-declared starting rank / target)

export interface SourcedRank extends LeagueRank {
  source: RankSource;
  at: Date | null;
  /** True when LP was not provided and 0 was assumed. */
  lpAssumed?: boolean;
}

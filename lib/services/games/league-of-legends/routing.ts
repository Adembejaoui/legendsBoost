import { z } from "zod";
import type {
  RiotAccountCluster,
  RiotMatchRegion,
  RiotPlatform,
  RiotRouting,
  UnsupportedRiotPlatform,
} from "./riot.types";

/**
 * Riot platform -> regional routing.
 *
 * Platform-routed APIs (Summoner-V4, League-V4) use `{platform}.api.riotgames.com`.
 * Match-V5 uses the regional host (americas/asia/europe/sea).
 * Account-V1 is served on americas/asia/europe only; SEA platforms use asia.
 *
 * Verification (2026-11-12):
 *  - Every platform below is in the docs/lol platform table and is listed by
 *    Riot's API reference for Summoner-V4 and League-V4 `by-puuid`.
 *  - Riot documents the regional hosts but publishes no platform->region
 *    table; it says to "execute a sample request". The mapping below is
 *    Riot's established routing convention and MUST be confirmed with one
 *    authorized sample request per region before enabling production
 *    (docs/ORDER-WORKSPACE.md, deployment checklist).
 *
 * Hosts are only ever built from this closed table, so user input can never
 * produce an arbitrary outbound hostname (SSRF).
 */
const MATCH_REGION: Record<RiotPlatform, RiotMatchRegion> = {
  NA1: "americas",
  BR1: "americas",
  LA1: "americas",
  LA2: "americas",
  EUW1: "europe",
  EUN1: "europe",
  TR1: "europe",
  RU: "europe",
  KR: "asia",
  JP1: "asia",
  OC1: "sea",
  SG2: "sea",
  TW2: "sea",
  VN2: "sea",
};

/**
 * Platform values deliberately NOT supported, with the reason shown to users
 * whose stored account still uses one.
 */
export const UNSUPPORTED_RIOT_PLATFORMS: Record<UnsupportedRiotPlatform, string> = {
  PH2: "Philippines (PH2) is not served by Riot's Summoner-V4/League-V4 APIs. Choose the region your account currently plays on.",
  TH2: "Thailand (TH2) is not served by Riot's Summoner-V4/League-V4 APIs. Choose the region your account currently plays on.",
  ME1: "Middle East (ME1) is not supported yet: Riot does not document its Match-V5 routing.",
};

export function unsupportedPlatformReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return UNSUPPORTED_RIOT_PLATFORMS[value.trim().toUpperCase() as UnsupportedRiotPlatform] ?? null;
}

export const RIOT_PLATFORMS = Object.keys(MATCH_REGION) as RiotPlatform[];

export const RIOT_PLATFORM_LABELS: Record<RiotPlatform, string> = {
  NA1: "North America",
  BR1: "Brazil",
  LA1: "Latin America North",
  LA2: "Latin America South",
  EUW1: "Europe West",
  EUN1: "Europe Nordic & East",
  TR1: "Türkiye",
  RU: "Russia",
  KR: "Korea",
  JP1: "Japan",
  OC1: "Oceania",
  SG2: "Singapore",
  TW2: "Taiwan",
  VN2: "Vietnam",
};

export const riotPlatformSchema = z.enum(RIOT_PLATFORMS as [RiotPlatform, ...RiotPlatform[]]);

export function normalizePlatform(value: unknown): RiotPlatform {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Riot platform is required");
  }
  return riotPlatformSchema.parse(value.trim().toUpperCase());
}

export function isRiotPlatform(value: unknown): value is RiotPlatform {
  try {
    normalizePlatform(value);
    return true;
  } catch {
    return false;
  }
}

export function getPlatformHost(platform: RiotPlatform): string {
  const p = normalizePlatform(platform);
  return `${p.toLowerCase()}.api.riotgames.com`;
}

export function getMatchRegion(platform: RiotPlatform): RiotMatchRegion {
  return MATCH_REGION[normalizePlatform(platform)];
}

export function getAccountCluster(platform: RiotPlatform): RiotAccountCluster {
  const region = getMatchRegion(platform);
  return region === "sea" ? "asia" : region;
}

export function resolveRiotRouting(platform: unknown): RiotRouting {
  const p = normalizePlatform(platform);
  const matchRegion = getMatchRegion(p);
  const accountCluster = getAccountCluster(p);
  return {
    platform: p,
    platformHost: getPlatformHost(p),
    matchRegion,
    matchHost: `${matchRegion}.api.riotgames.com`,
    accountCluster,
    accountHost: `${accountCluster}.api.riotgames.com`,
  };
}

const ALLOWED_HOSTS = new Set<string>([
  ...RIOT_PLATFORMS.map((p) => `${p.toLowerCase()}.api.riotgames.com`),
  "americas.api.riotgames.com",
  "asia.api.riotgames.com",
  "europe.api.riotgames.com",
  "sea.api.riotgames.com",
]);

export function isAllowedRiotHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host);
}

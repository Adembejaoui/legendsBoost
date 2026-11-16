// Server-only module: never import from a "use client" file.
import { getRiotCapabilities } from "./capabilities";
import { RiotApiError, RiotNotFoundError, RiotRateLimitedError, type RiotClient } from "./riot-client";
import { getRiotClient } from "./shared-client";
import { resolveAccountByRiotId } from "./account.service";
import { verifyAccountRegion } from "./region.service";
import { RIOT_PLATFORM_LABELS } from "./routing";
import type { RiotPlatform } from "./riot.types";

/**
 * Does this Riot ID exist, and does it play League on this server?
 * Checked when the Riot ID is saved, so a typo is caught immediately and no
 * later sync / auto-refresh ever calls Riot for an account that isn't there.
 *
 *  - verified:    Account-V1 found it AND Summoner-V4 confirms a League
 *                 profile on the server. Riot's PUUID and canonical spelling
 *                 are returned so they can be stored right away.
 *  - not_found:   no Riot account has this name#tag.
 *  - wrong_region: the account exists but not on this server (Riot's
 *                 suggestion, if any, in suggestedPlatform).
 *  - unverified:  Riot can't be asked right now (integration off, rate
 *                 limit, outage). The caller may save without verification;
 *                 the next sync verifies it.
 */
export type RiotIdCheck =
  | { status: "verified"; puuid: string; gameName: string; tagLine: string }
  | { status: "not_found"; message: string }
  | { status: "wrong_region"; message: string; suggestedPlatform: RiotPlatform | null }
  | { status: "unverified"; message: string };

export async function checkRiotIdExists(
  platform: RiotPlatform,
  gameName: string,
  tagLine: string,
  opts: { client?: RiotClient; orderId?: string } = {}
): Promise<RiotIdCheck> {
  if (!getRiotCapabilities().dataAccess) {
    return { status: "unverified", message: "Riot verification is not available right now." };
  }
  const client = opts.client ?? getRiotClient();
  const ctx = { orderId: opts.orderId };
  try {
    let dto;
    try {
      dto = await resolveAccountByRiotId(client, platform, gameName, tagLine, ctx);
    } catch (error) {
      if (error instanceof RiotNotFoundError) {
        return {
          status: "not_found",
          message: `No Riot account named ${gameName}#${tagLine} exists. Check the game name and the tag (the part after #).`,
        };
      }
      throw error;
    }
    const region = await verifyAccountRegion(client, platform, dto.puuid, ctx);
    if (!region.ok) {
      const where = `${RIOT_PLATFORM_LABELS[platform]} (${platform})`;
      const hint = region.suggestedPlatform
        ? ` It plays on ${RIOT_PLATFORM_LABELS[region.suggestedPlatform]} (${region.suggestedPlatform}).`
        : "";
      return {
        status: "wrong_region",
        message: `${gameName}#${tagLine} exists but has no League of Legends profile on ${where}.${hint} Choose the right server.`,
        suggestedPlatform: region.suggestedPlatform,
      };
    }
    return {
      status: "verified",
      puuid: dto.puuid,
      gameName: dto.gameName || gameName,
      tagLine: dto.tagLine || tagLine,
    };
  } catch (error) {
    if (error instanceof RiotRateLimitedError) {
      return { status: "unverified", message: "Riot is busy, so the account could not be checked yet. It will be checked on the next sync." };
    }
    if (error instanceof RiotApiError) {
      return { status: "unverified", message: "Riot could not be reached, so the account could not be checked yet. It will be checked on the next sync." };
    }
    throw error;
  }
}

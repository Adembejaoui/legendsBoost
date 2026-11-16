import type { RiotClient } from "./riot-client";
import { RiotApiError, RiotNotFoundError } from "./riot-client";
import { isRiotPlatform, resolveRiotRouting } from "./routing";
import { accountRegionSchema, summonerSchema } from "./riot.schemas";
import type { RiotPlatform } from "./riot.types";

/**
 * Region validation.
 *
 * Account-V1 resolves a Riot ID on any regional cluster regardless of where
 * the player plays League, so a PUUID alone does not prove the selected
 * region. Summoner-V4 `by-puuid` is platform-routed (docs/lol: "retrieve
 * summoner data by PUUID") and answers 404 "Data not found" when the PUUID
 * has no League profile on that platform. That is the authoritative check.
 *
 * When it fails, Account-V1 "Get active region" (GET
 * /riot/account/v1/region/by-game/lol/by-puuid/{puuid}, listed in Riot's
 * API reference) is asked only to SUGGEST the right region in the message.
 * Its answer is never used to change the order's region automatically.
 */
export type RegionCheck =
  | { ok: true }
  | { ok: false; code: "wrong_region"; suggestedPlatform: RiotPlatform | null };

export async function verifyAccountRegion(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  ctx: { correlationId?: string; orderId?: string } = {}
): Promise<RegionCheck> {
  const { platformHost } = resolveRiotRouting(platform);
  try {
    await client.get(platformHost, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`, {
      schema: summonerSchema,
      ...ctx,
    });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof RiotNotFoundError)) throw error;
  }
  return { ok: false, code: "wrong_region", suggestedPlatform: await suggestPlatform(client, platform, puuid, ctx) };
}

async function suggestPlatform(
  client: RiotClient,
  platform: RiotPlatform,
  puuid: string,
  ctx: { correlationId?: string; orderId?: string }
): Promise<RiotPlatform | null> {
  try {
    const { accountHost } = resolveRiotRouting(platform);
    const dto = await client.get(
      accountHost,
      `/riot/account/v1/region/by-game/lol/by-puuid/${encodeURIComponent(puuid)}`,
      { schema: accountRegionSchema, ...ctx }
    );
    const candidate = dto.region.trim().toUpperCase();
    return isRiotPlatform(candidate) && candidate !== platform ? (candidate as RiotPlatform) : null;
  } catch (error) {
    if (error instanceof RiotApiError) return null; // a suggestion is optional
    throw error;
  }
}

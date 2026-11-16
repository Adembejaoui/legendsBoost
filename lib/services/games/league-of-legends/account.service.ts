import { z } from "zod";
import type { RiotClient } from "./riot-client";
import { resolveRiotRouting } from "./routing";
import { accountSchema } from "./riot.schemas";
import type { RiotAccountDto, RiotPlatform } from "./riot.types";

/**
 * Riot ID rules: game name 3-16 characters, tagline 3-5 alphanumeric
 * characters. Only the public Riot ID is ever collected: never a password,
 * login or session of any kind.
 */
export const riotIdSchema = z.object({
  gameName: z
    .string()
    .trim()
    .min(3, "Game name must be at least 3 characters")
    .max(16, "Game name must be at most 16 characters")
    .refine((v) => !/[#<>\\/]/.test(v), "Game name contains invalid characters"),
  tagLine: z
    .string()
    .trim()
    .transform((v) => v.replace(/^#/, ""))
    .pipe(
      z
        .string()
        .min(3, "Tagline must be 3-5 characters")
        .max(5, "Tagline must be 3-5 characters")
        .regex(/^[\p{L}\p{N}]+$/u, "Tagline must be letters and numbers only")
    ),
});

/**
 * Riot IDs are case-insensitive (Riot resolves "faker#kr1" and "Faker#KR1" to
 * the same account), so comparisons must be too. Whitespace is trimmed and a
 * leading "#" on the tagline ignored, matching riotIdSchema.
 */
export function riotIdKey(gameName: string, tagLine: string): string {
  return `${gameName.trim().toLocaleLowerCase("en-US")}#${tagLine.trim().replace(/^#/, "").toLocaleLowerCase("en-US")}`;
}

export function sameRiotId(
  a: { gameName: string; tagLine: string },
  b: { gameName: string; tagLine: string }
): boolean {
  return riotIdKey(a.gameName, a.tagLine) === riotIdKey(b.gameName, b.tagLine);
}

/** Account-V1 by Riot ID (validated). Not cached: it is called rarely and its result is persisted. */
export async function resolveAccountByRiotId(
  client: RiotClient,
  platform: RiotPlatform,
  gameName: string,
  tagLine: string,
  ctx: { correlationId?: string; orderId?: string } = {}
): Promise<RiotAccountDto> {
  const { accountHost } = resolveRiotRouting(platform);
  return client.get(
    accountHost,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { schema: accountSchema, ...ctx }
  );
}

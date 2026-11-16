/**
 * Runtime validation for the Riot responses this app reads.
 *
 * Responses are never trusted as TypeScript casts: anything that does not
 * match is rejected as `invalid_response` instead of being stored. Unknown
 * extra fields are stripped. Optional fields Riot may omit get safe defaults
 * only where a default is semantically neutral (e.g. CS counters); fields
 * that decide attribution (puuid, timestamps, queue, win) are required.
 */
import { z } from "zod";

const int = z.number().int();
const nonNegInt = int.min(0);

export const accountSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
});

export const accountRegionSchema = z.object({
  puuid: z.string().min(1),
  game: z.string(),
  region: z.string(),
});

export const summonerSchema = z.object({
  puuid: z.string().min(1),
  profileIconId: int.optional(),
  summonerLevel: nonNegInt.optional(),
});

export const championMasterySchema = z.object({
  championId: nonNegInt,
  championLevel: nonNegInt.default(0),
  championPoints: nonNegInt.default(0),
  lastPlayTime: nonNegInt.optional(),
});
export const championMasteriesSchema = z.array(championMasterySchema);

export const activeGameSchema = z.object({
  gameId: z.number(),
  gameMode: z.string().optional(),
  gameQueueConfigId: int.optional(),
  gameStartTime: nonNegInt.optional(),
  gameLength: int.optional(),
  participants: z
    .array(z.object({ puuid: z.string().nullable().optional(), championId: nonNegInt, teamId: int.optional() }))
    .default([]),
});

export const leagueEntrySchema = z.object({
  queueType: z.string(),
  tier: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: nonNegInt.default(0),
  wins: nonNegInt.default(0),
  losses: nonNegInt.default(0),
});
export const leagueEntriesSchema = z.array(leagueEntrySchema);

export const MATCH_ID_PATTERN = /^[A-Z0-9]+_\d+$/;
export const matchIdsSchema = z.array(z.string().regex(MATCH_ID_PATTERN));

export const participantSchema = z.object({
  puuid: z.string(),
  championId: nonNegInt,
  championName: z.string().default(""),
  win: z.boolean(),
  kills: nonNegInt.default(0),
  deaths: nonNegInt.default(0),
  assists: nonNegInt.default(0),
  totalMinionsKilled: nonNegInt.default(0),
  neutralMinionsKilled: nonNegInt.default(0),
  gameEndedInEarlySurrender: z.boolean().optional(),
});

export const matchSchema = z.object({
  metadata: z.object({
    matchId: z.string().regex(MATCH_ID_PATTERN),
    participants: z.array(z.string()).default([]),
  }),
  info: z.object({
    gameStartTimestamp: nonNegInt,
    gameEndTimestamp: nonNegInt.optional(),
    gameDuration: nonNegInt,
    queueId: int,
    participants: z.array(participantSchema),
  }),
});

export type RiotAccountDto = z.infer<typeof accountSchema>;
export type RiotAccountRegionDto = z.infer<typeof accountRegionSchema>;
export type RiotSummonerDto = z.infer<typeof summonerSchema>;
export type RiotChampionMasteryDto = z.infer<typeof championMasterySchema>;
export type RiotActiveGameDto = z.infer<typeof activeGameSchema>;
export type RiotLeagueEntryDto = z.infer<typeof leagueEntrySchema>;
export type RiotParticipantDto = z.infer<typeof participantSchema>;
export type RiotMatchDto = z.infer<typeof matchSchema>;

import { getTier } from "@/lib/catalog/rank-systems";
import { readRiotProfile } from "@/lib/services/games/league-of-legends/profile.service";
import { QUEUE_LABELS } from "@/lib/services/games/league-of-legends/match-history.service";
import { getDdragonChampionMap, resolveMatchChampion } from "@/lib/services/games/league-of-legends/champion-assets";
import type { WorkspaceRiotProfileDTO } from "./workspace-types";

const RANKED_QUEUE_LABELS: Record<string, string> = {
  RANKED_SOLO_5x5: "Solo/Duo",
  RANKED_FLEX_SR: "Flex 5v5",
  RANKED_TFT_DOUBLE_UP: "TFT Double Up",
};

const DDRAGON_VERSION = /^\d+\.\d+\.\d+$/;

/** Stored Riot profile snapshot -> browser-safe DTO (no PUUIDs). */
export async function toProfileDTO(
  raw: unknown,
  syncedAt: Date | null,
  ddragonVersion: string | null
): Promise<WorkspaceRiotProfileDTO | null> {
  const p = readRiotProfile(raw);
  if (!p) return null;
  const needsChamps = (p.mastery?.length ?? 0) > 0 || !!p.liveGame?.championId || (p.recentMatches?.length ?? 0) > 0;
  const champions = needsChamps ? await getDdragonChampionMap(ddragonVersion) : null;
  const champ = (id: number) => resolveMatchChampion(ddragonVersion, champions, id, "");
  const live = p.liveGame?.inGame && p.liveGame.championId ? champ(p.liveGame.championId) : null;

  return {
    syncedAt: syncedAt?.toISOString() ?? null,
    level: p.summonerLevel,
    iconUrl:
      ddragonVersion && DDRAGON_VERSION.test(ddragonVersion) && p.profileIconId !== null
        ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${p.profileIconId}.png`
        : null,
    activeRegion: p.activeRegion,
    ranked:
      p.ranked?.map((r) => ({
        queue: r.queue,
        label: RANKED_QUEUE_LABELS[r.queue] ?? r.queue,
        tier: r.tier,
        division: r.division,
        lp: r.lp,
        wins: r.wins,
        losses: r.losses,
        winRate: r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : null,
        iconSrc: r.tier ? getTier("lol-ranked", r.tier.toLowerCase())?.iconSrc ?? null : null,
      })) ?? null,
    mastery:
      p.mastery?.map((m) => {
        const c = champ(m.championId);
        return { championId: m.championId, name: c.name || `Champion ${m.championId}`, icon: c.icon, level: m.level, points: m.points };
      }) ?? null,
    liveGame: p.liveGame
      ? {
          inGame: p.liveGame.inGame,
          championName: live?.name ?? null,
          championIcon: live?.icon ?? null,
          queue: p.liveGame.queueId ? QUEUE_LABELS[p.liveGame.queueId] ?? p.liveGame.gameMode : p.liveGame.gameMode,
          startedAt: p.liveGame.startedAt,
        }
      : null,
    recentMatches:
      p.recentMatches?.map((m) => {
        const c = resolveMatchChampion(ddragonVersion, champions, m.championId, m.championName);
        return {
          matchId: m.matchId,
          championName: c.name,
          championIcon: c.icon,
          win: m.win,
          remake: m.remake,
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          cs: m.cs,
          durationSec: m.durationSec,
          queue: QUEUE_LABELS[m.queueId] ?? `Queue ${m.queueId}`,
          endedAt: m.endedAt,
        };
      }) ?? null,
  };
}

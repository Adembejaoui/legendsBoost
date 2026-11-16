import type { Champion } from '@/types/catalog'
import type { LolLane } from './lol-champion-types'
import { LOL_CHAMPION_DATA, LOL_DDRAGON_VERSION } from './lol-champions.generated'

/**
 * Every League of Legends champion (generated from Riot Data Dragon by
 * scripts/sync-lol-champions.ts; re-run it when a new champion is released).
 * Icons come from Riot's official Data Dragon CDN.
 */

/** Lanes ("roles") a customer can ask the booster to play. */
export const LOL_ROLES: { id: LolLane; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'mid', label: 'Mid' },
  { id: 'adc', label: 'ADC' },
  { id: 'support', label: 'Support' },
]
export const LOL_ROLE_IDS = new Set<string>(LOL_ROLES.map((r) => r.id))

/** Ids stored on older orders before the full list existed. */
const LEGACY_IDS: Record<string, string> = {
  kaihasa: 'kaisa',
}

export const champions: Champion[] = LOL_CHAMPION_DATA.map((c) => ({
  id: c.id,
  name: c.name,
  title: c.title,
  key: c.key,
  ddragonId: c.ddragonId,
  tags: c.tags,
  lanes: c.lanes,
  iconSrc: `https://ddragon.leagueoflegends.com/cdn/${LOL_DDRAGON_VERSION}/img/champion/${c.ddragonId}.png`,
}))

const byId = new Map(champions.map((c) => [c.id, c]))

/** Current id for a stored id (handles legacy ids); undefined if unknown. */
export function normalizeChampionId(id: string): string | undefined {
  const current = LEGACY_IDS[id] ?? id
  return byId.has(current) ? current : undefined
}

export function getChampions(): Champion[] {
  return champions
}

export function getChampion(id: string): Champion | undefined {
  return byId.get(LEGACY_IDS[id] ?? id)
}

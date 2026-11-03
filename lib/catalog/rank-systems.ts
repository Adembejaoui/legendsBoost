import type { RankDivision, RankSelection, RankSystem, RankTier } from '@/types/catalog'

const lolDivisions: RankDivision[] = [
  { id: 'iv', label: 'IV' },
  { id: 'iii', label: 'III' },
  { id: 'ii', label: 'II' },
  { id: 'i', label: 'I' },
]

const valorantDivisions: RankDivision[] = [
  { id: '3', label: '3' },
  { id: '2', label: '2' },
  { id: '1', label: '1' },
]

function tier(id: string, name: string, order: number, divisions?: RankDivision[], iconSrc?: string): RankTier {
  return {
    id,
    name,
    order,
    iconSrc: iconSrc ?? `/images/ranks/${id}.png`,
    divisions,
  }
}

export const rankSystems: RankSystem[] = [
  {
    id: 'lol-ranked',
    gameSlug: 'league-of-legends',
    name: 'League of Legends Ranked',
    tiers: [
      tier('iron', 'Iron', 1, lolDivisions, '/images/ranks/lol-rank-images/iron.png'),
      tier('bronze', 'Bronze', 2, lolDivisions, '/images/ranks/lol-rank-images/bronze.png'),
      tier('silver', 'Silver', 3, lolDivisions, '/images/ranks/lol-rank-images/silver.png'),
      tier('gold', 'Gold', 4, lolDivisions, '/images/ranks/lol-rank-images/gold.png'),
      tier('platinum', 'Platinum', 5, lolDivisions, '/images/ranks/lol-rank-images/platinum.png'),
      tier('emerald', 'Emerald', 6, lolDivisions, '/images/ranks/lol-rank-images/emerald.png'),
      tier('diamond', 'Diamond', 7, lolDivisions, '/images/ranks/lol-rank-images/diamond.png'),
      tier('master', 'Master', 8, undefined, '/images/ranks/lol-rank-images/master.png'),

    ],
  },
  {
    id: 'valorant-competitive',
    gameSlug: 'valorant',
    name: 'VALORANT Competitive',
    tiers: [
      tier('iron', 'Iron', 1, valorantDivisions, '/images/ranks/valorant-rank-icons/iron.png'),
      tier('bronze', 'Bronze', 2, valorantDivisions, '/images/ranks/valorant-rank-icons/bronze.png'),
      tier('silver', 'Silver', 3, valorantDivisions, '/images/ranks/valorant-rank-icons/silver.png'),
      tier('gold', 'Gold', 4, valorantDivisions, '/images/ranks/valorant-rank-icons/gold.png'),
      tier('platinum', 'Platinum', 5, valorantDivisions, '/images/ranks/valorant-rank-icons/platinum.png'),
      tier('diamond', 'Diamond', 6, valorantDivisions, '/images/ranks/valorant-rank-icons/diamond.png'),
      tier('ascendant', 'Ascendant', 7, valorantDivisions, '/images/ranks/valorant-rank-icons/ascendant.png'),
      tier('immortal', 'Immortal', 8, valorantDivisions, '/images/ranks/valorant-rank-icons/immortal.png'),
      tier('radiant', 'Radiant', 9, undefined, '/images/ranks/valorant-rank-icons/radiant.png'),
    ],
  },
  {
    id: 'tft-ranked',
    gameSlug: 'teamfight-tactics',
    name: 'TFT Ranked',
    mode: 'Ranked',
    tiers: [
      tier('iron', 'Iron', 1, lolDivisions, '/images/ranks/lol-rank-images/iron.png'),
      tier('bronze', 'Bronze', 2, lolDivisions, '/images/ranks/lol-rank-images/bronze.png'),
      tier('silver', 'Silver', 3, lolDivisions, '/images/ranks/lol-rank-images/silver.png'),
      tier('gold', 'Gold', 4, lolDivisions, '/images/ranks/lol-rank-images/gold.png'),
      tier('platinum', 'Platinum', 5, lolDivisions, '/images/ranks/lol-rank-images/platinum.png'),
      tier('emerald', 'Emerald', 6, lolDivisions, '/images/ranks/lol-rank-images/emerald.png'),
      tier('diamond', 'Diamond', 7, lolDivisions, '/images/ranks/lol-rank-images/diamond.png'),
      tier('master', 'Master', 8, undefined, '/images/ranks/lol-rank-images/master.png'),

    ],
  },
  {
    id: 'tft-double-up',
    gameSlug: 'teamfight-tactics',
    name: 'TFT Double Up',
    mode: 'Double Up',
    tiers: [
      tier('iron', 'Iron', 1, lolDivisions, '/images/ranks/lol-rank-images/iron.png'),
      tier('bronze', 'Bronze', 2, lolDivisions, '/images/ranks/lol-rank-images/bronze.png'),
      tier('silver', 'Silver', 3, lolDivisions, '/images/ranks/lol-rank-images/silver.png'),
      tier('gold', 'Gold', 4, lolDivisions, '/images/ranks/lol-rank-images/gold.png'),
      tier('platinum', 'Platinum', 5, lolDivisions, '/images/ranks/lol-rank-images/platinum.png'),
      tier('emerald', 'Emerald', 6, lolDivisions, '/images/ranks/lol-rank-images/emerald.png'),
      tier('diamond', 'Diamond', 7, lolDivisions, '/images/ranks/lol-rank-images/diamond.png'),
      tier('master', 'Master', 8, undefined, '/images/ranks/lol-rank-images/master.png'),

    ],
  },
]

export function getRankSystem(id: string): RankSystem | undefined {
  return rankSystems.find((system) => system.id === id)
}

export function getRankSystemsByGame(gameSlug: string): RankSystem[] {
  return rankSystems.filter((system) => system.gameSlug === gameSlug)
}

export function getTier(rankSystemId: string, tierId: string): RankTier | undefined {
  const system = getRankSystem(rankSystemId)
  return system?.tiers.find((tier) => tier.id === tierId)
}

export function getDivision(
  rankSystemId: string,
  tierId: string,
  divisionId: string,
): RankDivision | undefined {
  const tier = getTier(rankSystemId, tierId)
  return tier?.divisions?.find((division) => division.id === divisionId)
}

export function getDivisionOrder(
  rankSystemId: string,
  tierId: string,
  divisionId: string | null,
): number {
  if (!divisionId) return 0
  const tier = getTier(rankSystemId, tierId)
  const division = tier?.divisions?.find((d) => d.id === divisionId)
  return division && tier ? (tier.divisions ?? []).indexOf(division) + 1 : 0
}

export function rankScore(
  rankSystemId: string,
  selection: RankSelection | null,
): number | null {
  if (!selection) return null
  const tier = getTier(rankSystemId, selection.tierId)
  if (!tier) return null
  return tier.order * 10 + getDivisionOrder(rankSystemId, selection.tierId, selection.divisionId)
}

export function isTargetAboveCurrent(
  rankSystemId: string,
  current: RankSelection | null,
  target: RankSelection | null,
): boolean {
  if (!current || !target) return false
  const currentScore = rankScore(rankSystemId, current)
  const targetScore = rankScore(rankSystemId, target)
  return currentScore !== null && targetScore !== null && targetScore > currentScore
}

export function formatRankLabel(
  rankSystemId: string,
  selection: RankSelection | null,
): string {
  if (!selection) return 'Not selected'
  const tier = getTier(rankSystemId, selection.tierId)
  const division = selection.divisionId
    ? getDivision(rankSystemId, selection.tierId, selection.divisionId)
    : undefined
  const parts = [tier?.name ?? selection.tierId, division?.label].filter(Boolean)
  return parts.join(' ')
}

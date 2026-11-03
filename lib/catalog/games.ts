import type { GameDefinition } from '@/types/catalog'

export const games: GameDefinition[] = [
  {
    id: 'league-of-legends',
    slug: 'league-of-legends',
    name: 'League of Legends',
    shortName: 'League',
    shortDescription: 'Ranked support for every stage of your climb.',
    description:
      'Explore League of Legends services built around the ranked ladder. Every offer is configured per game and reviewed for eligibility before publication.',
    image: '/images/games/league.png',
    accent: '#8b5cf6',
    rankSystemIds: ['lol-ranked'],
    serviceSlugs: [
      'rank-boost',
      'win-boost',
      'placement-boost',
      'arena-boost',
      'normal-matches',
      'champion-mastery',
    ],
    availabilityLabel: 'Eligibility under review',
  },
  {
    id: 'valorant',
    slug: 'valorant',
    name: 'VALORANT',
    shortName: 'VAL',
    shortDescription: 'Sharpen your edge across the competitive ladder.',
    description:
      'Explore VALORANT services built around the competitive ladder. Every offer is configured per game and reviewed for eligibility before publication.',
    image: '/images/games/valorant.png',
    accent: '#f59e0b',
    rankSystemIds: ['valorant-competitive'],
    serviceSlugs: ['rank-boost', 'win-boost', 'placement-boost', 'unrated-matches'],
    availabilityLabel: 'Eligibility under review',
  },
  {
    id: 'teamfight-tactics',
    slug: 'teamfight-tactics',
    name: 'Teamfight Tactics',
    shortName: 'TFT',
    shortDescription: 'Make smarter plays and reach your next tier.',
    description:
      'Explore Teamfight Tactics services for Ranked and Double Up. Every offer is configured per game and reviewed for eligibility before publication.',
    image: '/images/games/tft.png',
    accent: '#22d3ee',
    rankSystemIds: ['tft-ranked', 'tft-double-up'],
    serviceSlugs: ['rank-boost', 'win-boost', 'placement-boost', 'double-up-boost'],
    availabilityLabel: 'Eligibility under review',
  },
]

export function getGame(slug: string): GameDefinition | undefined {
  return games.find((game) => game.slug === slug)
}

export function getGames(): GameDefinition[] {
  return games
}

export function getGameServiceSlugs(gameSlug: string): string[] {
  const game = getGame(gameSlug)
  return game ? game.serviceSlugs : []
}

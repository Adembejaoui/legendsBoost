import type { GameFaqItem } from '@/types/game'

export const gameFaqs: Record<string, GameFaqItem[]> = {
  'league-of-legends': [
    {
      q: 'What League of Legends services are offered?',
      a: 'Coaching sessions review your recent gameplay and give you a focused improvement plan. Account-sharing boosting and queue/rank manipulation are not offered unless their compliance with Riot Games current rules has been reviewed and approved.',
    },
    {
      q: 'Do you need my account password?',
      a: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
    },
    {
      q: 'When will services become available?',
      a: 'Services are reviewed for eligibility before publication. Only approved services appear as purchasable. Check back as the catalog grows.',
    },
  ],
  'valorant': [
    {
      q: 'What VALORANT services are offered?',
      a: 'Coaching sessions review your recent gameplay and give you a focused improvement plan. Account-sharing boosting and queue/rank manipulation are not offered unless their compliance with Riot Games current rules has been reviewed and approved.',
    },
    {
      q: 'Do you need my account password?',
      a: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
    },
    {
      q: 'When will services become available?',
      a: 'Services are reviewed for eligibility before publication. Only approved services appear as purchasable. Check back as the catalog grows.',
    },
  ],
  'teamfight-tactics': [
    {
      q: 'What TFT services are offered?',
      a: 'Coaching sessions review your recent lobbies and give you a focused improvement plan. Account-sharing boosting and queue/rank manipulation are not offered unless their compliance with Riot Games current rules has been reviewed and approved.',
    },
    {
      q: 'Do you need my account password?',
      a: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
    },
    {
      q: 'When will services become available?',
      a: 'Services are reviewed for eligibility before publication. Only approved services appear as purchasable. Check back as the catalog grows.',
    },
  ],
}

export function getGameFaqs(gameSlug: string): GameFaqItem[] {
  return gameFaqs[gameSlug] ?? gameFaqs['league-of-legends']
}
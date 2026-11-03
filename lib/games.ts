import type { Game } from '@/types/game'
import type { Service } from '@/types/service'
import { GraduationCap } from 'lucide-react'

export const games: Game[] = [
  {
    slug: 'league-of-legends',
    name: 'League of Legends',
    shortName: 'League',
    description: 'Ranked support for every stage of your climb.',
    serviceSummary: 'Eligible services are being reviewed for publication.',
    image: '/images/games/league.png',
    accent: '#8b5cf6',
    available: false,
    availabilityLabel: 'Coming soon',
  },
  {
    slug: 'teamfight-tactics',
    name: 'Teamfight Tactics',
    shortName: 'TFT',
    description: 'Make smarter plays and reach your next tier.',
    serviceSummary: 'A focused service catalog is in preparation.',
    image: '/images/games/tft.png',
    accent: '#22d3ee',
    available: false,
    availabilityLabel: 'Coming soon',
  },
  {
    slug: 'valorant',
    name: 'VALORANT',
    shortName: 'VAL',
    description: 'Sharpen your edge across the competitive ladder.',
    serviceSummary: 'Services will appear after eligibility review.',
    image: '/images/games/valorant.png',
    accent: '#f59e0b',
    available: false,
    availabilityLabel: 'Coming soon',
  },
]

export const services: Service[] = [
  {
    slug: 'league-coaching',
    gameSlug: 'league-of-legends',
    title: 'League Coaching',
    shortDescription: '1-on-1 review of your gameplay with a focused improvement plan.',
    description: 'A personalized coaching session reviews your recent matches, identifies the highest-impact mistakes, and gives you a clear action plan to climb faster. Sessions are conducted at your schedule.',
    category: 'Coaching',
    icon: GraduationCap,
    available: false,
    availabilityLabel: 'Under review',
    price: 99,
    priceLabel: 'from',
    inclusions: [
      'Video review of your recent gameplay',
      'Written notes on highest-impact fixes',
      'Follow-up Q&A within 7 days',
    ],
    exclusions: [
      'Account access or account sharing',
      'Direct queue/rank manipulation',
    ],
    faqs: [
      {
        question: 'Do I need to share my account password?',
        answer: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
      },
      {
        question: 'How long is a session?',
        answer: 'Each session is scheduled for 60 minutes, with optional follow-up questions available within a week.',
      },
    ],
    relatedServices: [],
  },
  {
    slug: 'valorant-coaching',
    gameSlug: 'valorant',
    title: 'VALORANT Coaching',
    shortDescription: 'Refine your aim, positioning, and decision-making with a pro reviewer.',
    description: 'A focused coaching session reviews your recent VODs, identifies mechanical and strategic gaps, and gives you a practical plan to climb the ladder.',
    category: 'Coaching',
    icon: GraduationCap,
    available: false,
    availabilityLabel: 'Under review',
    price: 99,
    priceLabel: 'from',
    inclusions: [
      'Video review of your recent gameplay',
      'Written notes on highest-impact fixes',
      'Follow-up Q&A within 7 days',
    ],
    exclusions: [
      'Account access or account sharing',
      'Direct queue/rank manipulation',
    ],
    faqs: [
      {
        question: 'Do I need to share my account password?',
        answer: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
      },
      {
        question: 'How long is a session?',
        answer: 'Each session is scheduled for 60 minutes, with optional follow-up questions available within a week.',
      },
    ],
    relatedServices: [],
  },
  {
    slug: 'tft-coaching',
    gameSlug: 'teamfight-tactics',
    title: 'TFT Coaching',
    shortDescription: 'Learn the meta, improve your economy, and climb with a clearer plan.',
    description: 'A focused coaching session reviews your recent lobbies, identifies economy and positioning mistakes, and gives you a practical plan to climb.',
    category: 'Coaching',
    icon: GraduationCap,
    available: false,
    availabilityLabel: 'Under review',
    price: 99,
    priceLabel: 'from',
    inclusions: [
      'Video review of your recent gameplay',
      'Written notes on highest-impact fixes',
      'Follow-up Q&A within 7 days',
    ],
    exclusions: [
      'Account access or account sharing',
      'Direct queue/rank manipulation',
    ],
    faqs: [
      {
        question: 'Do I need to share my account password?',
        answer: 'No. Coaching is conducted through screen sharing and voice. We never request or store game account passwords.',
      },
      {
        question: 'How long is a session?',
        answer: 'Each session is scheduled for 60 minutes, with optional follow-up questions available within a week.',
      },
    ],
    relatedServices: [],
  },
]

export function getGameBySlug(slug: string): Game | undefined {
  return games.find((game) => game.slug === slug)
}

export function getGames(): Game[] {
  return games
}

export function getGameServices(gameSlug: string): Service[] {
  return services
    .filter((service) => service.gameSlug === gameSlug)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function getServiceBySlug(gameSlug: string, serviceSlug: string): Service | undefined {
  return services.find(
    (service) => service.gameSlug === gameSlug && service.slug === serviceSlug,
  )
}

export function getRelatedServices(service: Service): Service[] {
  const relatedSlugs = service.relatedServices ?? []
  return services
    .filter((s) => s.slug !== service.slug && relatedSlugs.includes(s.slug))
    .slice(0, 3)
}

export function getOtherGames(gameSlug: string): Game[] {
  return games.filter((game) => game.slug !== gameSlug)
}
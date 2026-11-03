import type { ServiceTemplate } from '@/types/catalog'
import { FileText, Gamepad2, Medal, ShieldCheck, Star, Target, Trophy, User } from 'lucide-react'

export const serviceTemplates: ServiceTemplate[] = [
  {
    id: 'rank-boost',
    slug: 'rank-boost',
    title: 'Rank Boost',
    description:
      'Play from your current rank to a target rank on the competitive ladder. Tier and division selection depends on the game\'s rank system.',
    icon: Trophy,
    category: 'Ranked',
  },
  {
    id: 'win-boost',
    slug: 'win-boost',
    title: 'Win Boost',
    description:
      'A set number of wins. Available options depend on the game-specific configuration.',
    icon: Target,
    category: 'Wins',
  },
  {
    id: 'placement-boost',
    slug: 'placement-boost',
    title: 'Placement Boost',
    description:
      'Placement matches played at the start of a ranked season or after a rank reset. Quantity depends on the game-specific configuration.',
    icon: FileText,
    category: 'Placements',
  },
  {
    id: 'arena-boost',
    slug: 'arena-boost',
    title: 'Arena Boost',
    description:
      'Arena mode wins. This service does not use a ranked ladder; its fields are defined by the Arena offer configuration.',
    icon: Star,
    category: 'Arena',
  },
  {
    id: 'normal-matches',
    slug: 'normal-matches',
    title: 'Normal Matches',
    description: 'Normal (unranked) matches played with optional game-mode preferences.',
    icon: Gamepad2,
    category: 'Normal',
  },
  {
    id: 'champion-mastery',
    slug: 'champion-mastery',
    title: 'Champion Mastery',
    description:
      'Mastery progress on a specific champion. Champion options come from a configurable champion data source.',
    icon: Medal,
    category: 'Mastery',
  },
  {
    id: 'unrated-matches',
    slug: 'unrated-matches',
    title: 'Unrated Matches',
    description: 'Unrated matches played with optional preferences when configured.',
    icon: ShieldCheck,
    category: 'Unrated',
  },
  {
    id: 'double-up-boost',
    slug: 'double-up-boost',
    title: 'Double Up Boost',
    description:
      'Climb the TFT Double Up ladder with current rank and target rank selection. Divisions are handled dynamically.',
    icon: User,
    category: 'Double Up',
  },
]

export function getServiceTemplate(slug: string): ServiceTemplate | undefined {
  return serviceTemplates.find((template) => template.slug === slug)
}

export function getServiceTemplates(): ServiceTemplate[] {
  return serviceTemplates
}

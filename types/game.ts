import type { LucideIcon } from 'lucide-react'

export interface Game {
  slug: string
  name: string
  shortName: string
  description: string
  serviceSummary: string
  image: string
  accent: string
  available: boolean
  availabilityLabel: string
  href?: string
  icon?: LucideIcon
}

export interface GameFaqItem {
  q: string
  a: string
}
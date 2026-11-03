import type { LucideIcon } from 'lucide-react'

export interface ServiceOptionChoice {
  label: string
  value: string
  priceModifier?: number
}

export interface ServiceOption {
  id: string
  label: string
  type: 'select' | 'checkbox' | 'radio' | 'toggle'
  required: boolean
  description?: string
  choices?: ServiceOptionChoice[]
  defaultValue?: string
}

export interface ServiceFAQ {
  question: string
  answer: string
}

export interface Service {
  slug: string
  gameSlug: string
  title: string
  shortDescription: string
  description: string
  category: string
  icon: LucideIcon
  available: boolean
  availabilityLabel: string
  price?: number
  priceLabel?: string
  inclusions?: string[]
  exclusions?: string[]
  options?: ServiceOption[]
  faqs?: ServiceFAQ[]
  relatedServices?: string[]
}
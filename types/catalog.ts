import type { LucideIcon } from 'lucide-react'

export type ServiceAvailability = 'draft' | 'pending-review' | 'available' | 'disabled'

export type ServiceVisibility = 'visible' | 'hidden'
export type OrderCapability = 'draft-only' | 'request-only' | 'live-order'
export type ComplianceStatus = 'pending-review' | 'approved' | 'rejected'

export interface GameDefinition {
  id: string
  slug: string
  name: string
  shortName: string
  shortDescription: string
  description: string
  image: string
  artwork?: string
  accent: string
  rankSystemIds: string[]
  serviceSlugs: string[]
  availabilityLabel?: string
}

export interface ServiceTemplate {
  id: string
  slug: string
  title: string
  description: string
  icon?: LucideIcon
  category?: string
}

export interface ConfigOption {
  label: string
  value: string
  iconSrc?: string
}

export interface VisibilityCondition {
  key: string
  value?: unknown
  operator?: 'equals' | 'present' | 'absent'
}

export interface ConfigFieldBase {
  key: string
  label: string
  description?: string
  required?: boolean
  defaultValue?: unknown
  visibleWhen?: VisibilityCondition | VisibilityCondition[]
}

export interface RankPickerField extends ConfigFieldBase {
  type: 'rank-picker'
  rankSystemId: string
}

export interface SelectField extends ConfigFieldBase {
  type: 'select'
  options: ConfigOption[]
}

export interface MultiSelectField extends ConfigFieldBase {
  type: 'multi-select'
  options: ConfigOption[]
}

export interface NumberField extends ConfigFieldBase {
  type: 'number'
  min?: number
  max?: number
  step?: number
  unit?: string
}

export interface CheckboxField extends ConfigFieldBase {
  type: 'checkbox'
}

export interface ChampionPickerField extends ConfigFieldBase {
  type: 'champion-picker'
}

export type ConfigField =
  | RankPickerField
  | SelectField
  | MultiSelectField
  | NumberField
  | CheckboxField
  | ChampionPickerField

export interface PricingFixed {
  type: 'fixed'
  amount: number
  label?: string
}

export interface PricingPerUnit {
  type: 'per-unit'
  amount: number
  unit: string
  label?: string
}

export interface PricingDynamic {
  type: 'dynamic'
  label?: string
}

export interface PricingNone {
  type: 'none'
}

export type PricingConfig = PricingFixed | PricingPerUnit | PricingDynamic | PricingNone

export interface GameServiceOffer {
  gameSlug: string
  serviceSlug: string
  title?: string
  description?: string
  icon?: LucideIcon
  order?: number
  availability: ServiceAvailability
  availabilityLabel?: string
  visibility?: ServiceVisibility
  orderCapability?: OrderCapability
  complianceStatus?: ComplianceStatus
  rankSystemId?: string
  pricing?: PricingConfig
  fields: ConfigField[]
  artwork?: string
}

export interface RankDivision {
  id: string
  label: string
  iconSrc?: string
}

export interface RankTier {
  id: string
  name: string
  order: number
  iconSrc?: string
  divisions?: RankDivision[]
}

export interface RankSystem {
  id: string
  gameSlug: string
  name: string
  mode?: string
  tiers: RankTier[]
}

export interface RankSelection {
  tierId: string
  divisionId: string | null
}

export interface Champion {
  id: string
  name: string
  iconSrc?: string
}

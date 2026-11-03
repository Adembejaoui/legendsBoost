export type OrderDraftStatus = 'draft' | 'pending-review'

export interface OrderDraft {
  id: string
  gameSlug: string
  serviceSlug: string
  configuration: Record<string, unknown>
  selectedMode?: 'solo' | 'duo'
  selectedOptions: string[]
  championsRoles?: {
    roles: string[]
    champions: string[]
  }
  createdAt: string
  status: OrderDraftStatus
  reviewNote?: string
}

export interface OrderReview {
  draft: OrderDraft
  summary: {
    gameName: string
    serviceName: string
    configurationLines: Array<{ label: string; value: string }>
    modeLabel?: string
    extras: Array<{ id: string; label: string }>
    championsRoles?: {
      roles: string[]
      champions: string[]
    }
  }
}
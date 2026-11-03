import type { OrderDraft, OrderDraftStatus } from '@/types/order'

const drafts = new Map<string, OrderDraft>()

function generateId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return 'draft_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function createOrderDraft(input: {
  gameSlug: string
  serviceSlug: string
  configuration: Record<string, unknown>
  selectedMode?: 'solo' | 'duo'
  selectedOptions: string[]
  championsRoles?: { roles: string[]; champions: string[] }
  status?: OrderDraftStatus
}): OrderDraft {
  const id = generateId()
  const draft: OrderDraft = {
    id,
    gameSlug: input.gameSlug,
    serviceSlug: input.serviceSlug,
    configuration: input.configuration,
    selectedMode: input.selectedMode,
    selectedOptions: input.selectedOptions,
    championsRoles: input.championsRoles,
    createdAt: new Date().toISOString(),
    status: input.status ?? 'draft',
  }
  drafts.set(id, draft)
  return draft
}

export function getOrderDraft(id: string): OrderDraft | undefined {
  return drafts.get(id)
}

export function listOrderDrafts(): OrderDraft[] {
  return Array.from(drafts.values())
}
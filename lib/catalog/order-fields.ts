/**
 * Order-form fields shared by the League pages (client PDFs 2026-11-19).
 * Saved in the order configuration and validated by the server like every
 * catalog field. The server (region) also pre-fills the order's region.
 */
import type { ConfigField } from '@/types/catalog'
import { RIOT_PLATFORM_LABELS, RIOT_PLATFORMS } from '@/lib/services/games/league-of-legends/routing'

export const SERVER_FIELD = 'server'
export const QUEUE_TYPE_FIELD = 'queueType'

export function serverField(): ConfigField {
  return {
    type: 'select',
    key: SERVER_FIELD,
    label: 'Server',
    // Optional for older drafts; the form always sends its default.
    required: false,
    defaultValue: 'EUW1',
    options: RIOT_PLATFORMS.map((p) => ({ label: RIOT_PLATFORM_LABELS[p], value: p })),
  }
}

export function queueTypeField(): ConfigField {
  return {
    type: 'select',
    key: QUEUE_TYPE_FIELD,
    label: 'Queue Type',
    // Optional for older drafts; the form always sends its default.
    required: false,
    defaultValue: 'ranked-solo',
    options: [
      { label: 'Ranked Solo/Duo', value: 'ranked-solo' },
      { label: 'Ranked Flex', value: 'ranked-flex' },
    ],
  }
}

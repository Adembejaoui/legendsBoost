export type CheckoutMode = 'solo' | 'duo'

export interface CheckoutOption {
  id: string
  label: string
  description?: string
  badge?: string
  type: 'toggle' | 'select' | 'number' | 'configurable-toggle'
  configurationType?: string
  defaultEnabled?: boolean
  enabled: boolean
  priceAdjustment?: {
    type: 'fixed' | 'percentage'
    value: number
  }
  availableModes?: CheckoutMode[]
  options?: { label: string; value: string }[]
}

export interface GameCheckoutConfig {
  gameSlug: string
  serviceSlug: string
  availability: 'available' | 'pending-review' | 'disabled'
  visibility?: 'visible' | 'hidden'
  orderCapability?: 'draft-only' | 'request-only' | 'live-order'
  complianceStatus?: 'pending-review' | 'approved' | 'rejected'
  modes?: {
    id: CheckoutMode
    label: string
    enabled: boolean
  }[]
  options: CheckoutOption[]
  basePriceConfigured?: boolean
  allowOrder?: boolean
  allowDraft?: boolean
}

export const checkoutConfigs: GameCheckoutConfig[] = [
  // League of Legends
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'rank-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [
      // Solo-only options have availableModes solo; Duo-only duo; shared both
      {
        id: 'challenger-booster',
        label: 'Challenger Booster',
        badge: 'Auto',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'priority-completion',
        label: 'Priority Boost Completion',
        badge: '+25%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'stream-games',
        label: 'Stream Games',
        badge: '+15%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'champions-roles',
        label: 'Champions and Roles Selection',
        badge: 'Free',
        type: 'configurable-toggle',
        configurationType: 'champions-roles',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'solo-only-queue',
        label: 'Solo Only Queue',
        badge: '+20%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'bonus-win',
        label: '+1 Bonus Win',
        badge: 'Auto',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'premium-coaching',
        label: 'Premium Coaching',
        badge: '+15%',
        type: 'toggle',
        enabled: false,
        availableModes: ['duo'],
      },
      {
        id: 'champions-roles',
        label: 'Your Champions and Roles',
        badge: 'Free',
        type: 'configurable-toggle',
        configurationType: 'champions-roles',
        enabled: false,
        availableModes: ['duo'],
      },
      {
        id: 'hidden-duo',
        label: 'Hidden Duo',
        badge: '+25%',
        type: 'toggle',
        enabled: false,
        availableModes: ['duo'],
      },
    ],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'win-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [
      // Solo-only options have availableModes solo; Duo-only duo; shared both
      {
        id: 'challenger-booster',
        label: 'Challenger Booster',
        badge: 'Auto',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'priority-completion',
        label: 'Priority Boost Completion',
        badge: '+25%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'stream-games',
        label: 'Stream Games',
        badge: '+15%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'champions-roles',
        label: 'Champions and Roles Selection',
        badge: 'Free',
        type: 'configurable-toggle',
        configurationType: 'champions-roles',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'solo-only-queue',
        label: 'Solo Only Queue',
        badge: '+20%',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo'],
      },
      {
        id: 'bonus-win',
        label: '+1 Bonus Win',
        badge: 'Auto',
        type: 'toggle',
        enabled: false,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'premium-coaching',
        label: 'Premium Coaching',
        badge: '+15%',
        type: 'toggle',
        enabled: false,
        availableModes: ['duo'],
      },
      {
        id: 'champions-roles',
        label: 'Your Champions and Roles',
        badge: 'Free',
        type: 'configurable-toggle',
        configurationType: 'champions-roles',
        enabled: false,
        availableModes: ['duo'],
      },
      {
        id: 'hidden-duo',
        label: 'Hidden Duo',
        badge: '+25%',
        type: 'toggle',
        enabled: false,
        availableModes: ['duo'],
      },
    ],
    allowOrder: false,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'placement-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
    ],
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'arena-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'normal-matches',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'champion-mastery',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [
      {
        id: 'priority-scheduling',
        label: 'Priority session scheduling',
        description: 'Get a faster available slot.',
        badge: 'Popular',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'live-stream',
        label: 'Live stream of session',
        description: 'Watch or share the coaching session.',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'champion-selection',
        label: 'Champion selection',
        description: 'Focus on a specific champion.',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'role-selection',
        label: 'Role selection',
        description: 'Focus on your preferred role.',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'replay-analysis',
        label: 'Replay analysis',
        description: 'Review past games with feedback.',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'additional-time',
        label: 'Additional coaching time',
        description: 'Extend the session duration.',
        badge: '+',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
      {
        id: 'post-session-report',
        label: 'Post-session performance report',
        description: 'Detailed actionable feedback report.',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
        priceAdjustment: { type: 'fixed', value: 0 },
      },
    ],
    allowOrder: false,
  },

  // VALORANT
  {
    gameSlug: 'valorant',
    serviceSlug: 'rank-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'win-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'placement-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'unrated-matches',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [
      {
        id: 'priority-scheduling',
        label: 'Priority session scheduling',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'live-stream',
        label: 'Live stream',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'agent-selection',
        label: 'Agent selection',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'role-playstyle-focus',
        label: 'Role or playstyle focus',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'aim-training-review',
        label: 'Aim training review',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'vod-analysis',
        label: 'VOD analysis',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'additional-time',
        label: 'Additional coaching time',
        badge: '+',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'post-session-report',
        label: 'Post-session performance report',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
    ],
    allowOrder: false,
  },

  // Teamfight Tactics
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'rank-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
    ],
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'win-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'placement-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: false,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'double-up-boost',
    availability: 'pending-review',
    visibility: 'visible',
    orderCapability: 'draft-only',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [
      {
        id: 'priority-scheduling',
        label: 'Priority session scheduling',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'live-stream',
        label: 'Live stream',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'composition-review',
        label: 'Composition review',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'economy-leveling',
        label: 'Economy and leveling analysis',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'augment-decision',
        label: 'Augment decision review',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'positioning-analysis',
        label: 'Positioning analysis',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'replay-analysis',
        label: 'Replay analysis',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
      {
        id: 'additional-time',
        label: 'Additional coaching time',
        badge: '+',
        type: 'toggle',
        enabled: true,
        availableModes: ['solo', 'duo'],
      },
    ],
    allowOrder: false,
  },
]

export function getCheckoutConfig(gameSlug: string, serviceSlug: string): GameCheckoutConfig | undefined {
  return checkoutConfigs.find((c) => c.gameSlug === gameSlug && c.serviceSlug === serviceSlug)
}

export function getCheckoutOptionsForMode(
  config: GameCheckoutConfig | undefined,
  mode: CheckoutMode,
): CheckoutOption[] {
  if (!config) return []
  return config.options.filter((o) => !o.availableModes || o.availableModes.includes(mode))
}

export interface ChampionsRolesConfig {
  roles: string[]
  champions: string[]
}

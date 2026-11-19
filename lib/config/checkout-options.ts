export type CheckoutMode = 'solo' | 'duo'

export interface CheckoutOption {
  id: string
  label: string
  /** Hover text (info icon). */
  description?: string
  /** Hover text when Duo is selected (defaults to description). */
  descriptionDuo?: string
  /** What the booster must do when this extra is bought (shown on the order page). */
  boosterRule?: string
  /** lucide icon name for the order summary row. */
  icon?: string
  /** Rows of the second group are shown under a divider. */
  group?: 'main' | 'secondary'
  /** Display position per mode (an extra sold in both modes can sit elsewhere in each list). */
  modeOrder?: Partial<Record<CheckoutMode, number>>
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

/**
 * Extras sold on the League pages (client PDFs 2026-11-19). The badge is the
 * catalog price: scripts/apply-extras-prices.ts turns "+25%" into the stored
 * price (bps of the service price, before Duo); the server always prices from
 * the stored ServicePrice. Ids are kept from earlier versions where the extra
 * is the same, so older orders still show their labels.
 */
type ExtraDef = Omit<CheckoutOption, 'availableModes' | 'enabled' | 'type'> & { type?: CheckoutOption['type'] }

export const EXTRAS = {
  soloQueueOnly: {
    id: 'solo-only-queue', label: 'Solo Queue Only', badge: '+30%', icon: 'User', group: 'main',
    description: 'Your booster will queue alone for every game on your account.',
    boosterRule: 'Queue alone for every game (no duo partner).',
  },
  bonusWin: {
    id: 'bonus-win', label: '+1 Bonus Win', badge: '+7.5%', icon: 'Trophy', group: 'main',
    description: 'After reaching your desired rank, your booster will win one extra game.',
    descriptionDuo: 'After you reach your desired rank, play with your booster for one extra win.',
    boosterRule: 'Win one extra game after the target is reached.',
  },
  priority: {
    id: 'priority-completion', label: 'Priority Order', badge: '+25%', icon: 'Zap', group: 'main',
    description: 'Your order moves ahead of standard orders in the queue for booster pickup.',
    boosterRule: 'Priority order: start as soon as possible.',
  },
  liveStreaming: {
    id: 'stream-games', label: 'Live Streaming', badge: '+20%', icon: 'Video', group: 'main',
    description: 'Watch your booster play live and pick up tips from their games.',
    boosterRule: 'Stream every game live and share the link with the customer in chat.',
  },
  championRole: {
    id: 'champions-roles', label: 'Specific Champion and Role', badge: 'Free', icon: 'Swords', group: 'secondary',
    type: 'configurable-toggle', configurationType: 'champions-roles',
    description: 'Choose your preferred champions and role for the boost.',
    boosterRule: 'Play only the champions and roles the customer chose.',
  },
  vpn: {
    id: 'vpn', label: 'VPN', badge: 'Free', icon: 'Globe', group: 'secondary',
    description: 'Your booster will use a VPN while playing on your account.',
    boosterRule: 'Always use a VPN set to the customer\'s country.',
  },
  appearOffline: {
    id: 'appear-offline', label: 'Appear Offline', badge: 'Free', icon: 'EyeOff', group: 'secondary',
    description: 'You will appear offline to friends while your booster plays.',
    boosterRule: 'Appear offline in the client (never online to friends).',
  },
  undercoverWinrate: {
    id: 'undercover-winrate', label: 'Undercover Winrate', badge: '+25%', icon: 'Drama', group: 'secondary',
    description: 'Your booster will keep the win rate for your order at 65% or lower.',
    descriptionDuo: 'Your booster will keep the win rate for your Duo order at 65% or lower.',
    boosterRule: 'Keep the order win rate at 65% or lower.',
  },
  moderateKda: {
    id: 'moderate-kda', label: 'Moderate KDA', badge: '+25%', icon: 'LineChart', group: 'secondary',
    description: 'Your booster will maintain an average KDA of 4.5 across your order.',
    descriptionDuo: 'Your booster will maintain an average KDA of 4.5 across your Duo order.',
    boosterRule: 'Keep an average KDA around 4.5 (not higher).',
  },
  otpChampion: {
    id: 'otp-champion', label: 'OTP Champ Only', badge: '+35%', icon: 'Crosshair', group: 'secondary',
    type: 'configurable-toggle', configurationType: 'otp-champion',
    description: 'Choose one champion. Your booster will play only that champion for your order.',
    boosterRule: 'Play only the one champion the customer chose.',
  },
  voiceChat: {
    id: 'voice-chat', label: 'Voice Chat', badge: '+20%', icon: 'Mic', group: 'main',
    description: 'Talk with your booster during your games.',
    boosterRule: 'Be on voice chat with the customer during games.',
  },
  hiddenDuo: {
    id: 'hidden-duo', label: 'Hidden Duo', badge: '+50%', icon: 'Drama', group: 'secondary',
    description: 'Your booster will switch to a different account every 2 to 3 games.',
    boosterRule: 'Switch to a different account every 2 to 3 games.',
  },
} satisfies Record<string, ExtraDef>

/**
 * One option entry per extra and service. An extra sold in both modes keeps
 * ONE entry (ids are unique per service and its price is the same in both).
 */
export function extrasFor(solo: ExtraDef[], duo: ExtraDef[] = []): CheckoutOption[] {
  const out = new Map<string, CheckoutOption>()
  const add = (e: ExtraDef, mode: CheckoutMode, index: number) => {
    const cur = out.get(e.id)
    if (cur) {
      cur.availableModes = [...(cur.availableModes ?? []), mode]
      cur.modeOrder = { ...cur.modeOrder, [mode]: index }
    } else out.set(e.id, { type: 'toggle', enabled: true, ...e, availableModes: [mode], modeOrder: { [mode]: index } })
  }
  solo.forEach((e, i) => add(e, 'solo', i))
  duo.forEach((e, i) => add(e, 'duo', i))
  return [...out.values()]
}

const SOLO_DUO_MODES: GameCheckoutConfig['modes'] = [
  { id: 'solo', label: 'Solo (pro on your account)', enabled: true },
  { id: 'duo', label: 'Duo (play with a pro)', enabled: true },
]

/** Net Wins, Placements and Arena Solo (8 extras). */
const STANDARD_SOLO = [
  EXTRAS.priority, EXTRAS.soloQueueOnly, EXTRAS.liveStreaming,
  EXTRAS.vpn, EXTRAS.championRole, EXTRAS.appearOffline, EXTRAS.moderateKda, EXTRAS.otpChampion,
]
/** Net Wins and Placements Duo (4 extras). */
const STANDARD_DUO = [EXTRAS.priority, EXTRAS.voiceChat, EXTRAS.moderateKda, EXTRAS.hiddenDuo]

export const checkoutConfigs: GameCheckoutConfig[] = [
  // League of Legends (client PDFs 2026-11-19)
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'rank-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: SOLO_DUO_MODES,
    options: extrasFor(
      [
        EXTRAS.soloQueueOnly, EXTRAS.bonusWin, EXTRAS.priority, EXTRAS.liveStreaming,
        EXTRAS.championRole, EXTRAS.vpn, EXTRAS.appearOffline, EXTRAS.undercoverWinrate, EXTRAS.moderateKda, EXTRAS.otpChampion,
      ],
      [EXTRAS.bonusWin, EXTRAS.priority, EXTRAS.voiceChat, EXTRAS.undercoverWinrate, EXTRAS.moderateKda, EXTRAS.hiddenDuo],
    ),
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'win-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: SOLO_DUO_MODES,
    options: extrasFor(STANDARD_SOLO, STANDARD_DUO),
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'placement-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: SOLO_DUO_MODES,
    options: extrasFor(STANDARD_SOLO, STANDARD_DUO),
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'arena-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: SOLO_DUO_MODES,
    // Client PDF 2026-11-19: 8 Solo extras; Duo: Priority, Your Champions and Roles +10%, Hidden Duo +25%.
    options: extrasFor(STANDARD_SOLO, [
      EXTRAS.priority,
      {
        ...EXTRAS.championRole,
        id: 'duo-champions-roles',
        label: 'Your Champions and Roles',
        badge: '+10%',
        group: 'main',
        description: 'Choose the champions and roles you and your booster will play.',
        boosterRule: 'Play the champions and roles the customer chose.',
      },
      { ...EXTRAS.hiddenDuo, badge: '+25%' },
    ]),
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'normal-matches',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'league-of-legends',
    serviceSlug: 'champion-mastery',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: [{ id: 'solo', label: 'Solo', enabled: true }],
    // Client PDF 2026-11-19: Priority Order +25%, Stream Games +15%, Appear Offline.
    options: extrasFor([EXTRAS.priority, { ...EXTRAS.liveStreaming, label: 'Stream Games', badge: '+15%' }, EXTRAS.appearOffline]),
    allowOrder: true,
    allowDraft: true,
  },

  // VALORANT
  {
    gameSlug: 'valorant',
    serviceSlug: 'rank-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
      { id: 'duo', label: 'Duo', enabled: true },
    ],
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'win-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'placement-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'valorant',
    serviceSlug: 'unrated-matches',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
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
    allowOrder: true,
  },

  // Teamfight Tactics
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'rank-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    modes: [
      { id: 'solo', label: 'Solo', enabled: true },
    ],
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'win-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'placement-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
    complianceStatus: 'pending-review',
    options: [],
    allowOrder: true,
    allowDraft: true,
  },
  {
    gameSlug: 'teamfight-tactics',
    serviceSlug: 'double-up-boost',
    availability: 'available',
    visibility: 'visible',
    orderCapability: 'live-order',
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
    allowOrder: true,
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
  return config.options
    .filter((o) => !o.availableModes || o.availableModes.includes(mode))
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (a.o.modeOrder?.[mode] ?? a.i) - (b.o.modeOrder?.[mode] ?? b.i))
    .map(({ o }) => o)
}

export interface ChampionsRolesConfig {
  roles: string[]
  champions: string[]
  /** OTP Champ Only: the one champion to play. */
  otpChampion?: string
}

import { NextRequest, NextResponse } from 'next/server'
import { createOrderDraft } from '@/lib/orders/draft-store'
import { getGameServiceOffer } from '@/lib/catalog/game-services'
import { getCheckoutConfig } from '@/lib/config/checkout-options'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { gameSlug, serviceSlug, configuration, selectedMode, selectedOptions, championsRoles } = body || {}

    if (!gameSlug || !serviceSlug) {
      return NextResponse.json({ error: 'Missing gameSlug or serviceSlug' }, { status: 400 })
    }

    const offer = getGameServiceOffer(gameSlug, serviceSlug)
    if (!offer) {
      return NextResponse.json({ error: 'Invalid game/service combination' }, { status: 400 })
    }

    if (offer.visibility === 'hidden') {
      return NextResponse.json({ error: 'Service not available' }, { status: 403 })
    }

    // Basic required field validation
    if (Array.isArray(offer.fields)) {
      for (const field of offer.fields) {
        if (field.required) {
          const val = configuration?.[field.key]
          if (val === undefined || val === null || val === '') {
            return NextResponse.json({ error: `Missing required field: ${field.label}` }, { status: 400 })
          }
        }
      }
    }

    const checkoutConfig = getCheckoutConfig(gameSlug, serviceSlug)
    const allowDraft = checkoutConfig?.allowDraft ?? true
    if (!allowDraft && checkoutConfig?.orderCapability === 'live-order' && checkoutConfig?.allowOrder !== true) {
      // Don't block drafts entirely
    }

    const draft = createOrderDraft({
      gameSlug,
      serviceSlug,
      configuration: configuration || {},
      selectedMode,
      selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
      championsRoles,
      status: offer.orderCapability === 'draft-only' || offer.complianceStatus === 'pending-review' ? 'pending-review' : 'draft',
    })

    return NextResponse.json({ draft }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
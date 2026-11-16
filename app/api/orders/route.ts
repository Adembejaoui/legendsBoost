import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { $Enums } from '@/app/generated/prisma/client'
import { getSessionUser } from '@/lib/auth/guards'
import { orderRequestSchema } from '@/lib/pricing/order-input'
import { createOrderForCustomer, IDEMPOTENCY_KEY_PATTERN, OrderCreationError } from '@/lib/orders/order-creation.service'
import { toPublicOrder } from '@/lib/orders/public-order'
import { closeStaleCheckoutHolds } from '@/lib/payments/checkout.service'
import { CUSTOMER_VISIBLE_ORDER_WHERE } from '@/lib/orders/payment-gate'

/**
 * Create an order for the signed-in CUSTOMER.
 *
 * The price is computed on the server (lib/pricing). The body is validated
 * strictly: a browser-supplied price or any unknown field is rejected. The
 * optional `expectedTotal` must equal the server quote (409 otherwise).
 * Requires an `Idempotency-Key` header; repeating a request with the same key
 * returns the original order (200) instead of creating another one.
 * What this creates is a CHECKOUT HOLD (status AWAITING_PAYMENT), not yet an
 * order: it is invisible to the customer, boosters and the dashboards, and
 * becomes an order only when the Stripe webhook verifies the payment. The
 * client goes straight on to POST /api/orders/[id]/checkout and Stripe. A
 * hold that is not paid is closed (cancel page, Stripe expiry/failure, or
 * after CHECKOUT_HOLD_TTL_MS). No "order created" notification is sent here:
 * the customer is notified when the payment succeeds.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Only customers place orders. Boosters and admins must not be able to
    // create (and later self-claim or self-approve) orders.
    if (user.role !== 'CUSTOMER') return NextResponse.json({ error: 'Only customer accounts can place orders.' }, { status: 403 })

    const idempotencyKey = req.headers.get('idempotency-key') ?? ''
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ error: 'A valid Idempotency-Key header is required.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    const parsed = orderRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    }

    // Housekeeping: close this customer's abandoned holds (best effort).
    await closeStaleCheckoutHolds(user.id).catch(() => 0)

    const { order, replayed } = await createOrderForCustomer(user.id, parsed.data, idempotencyKey)

    return NextResponse.json({ order: toPublicOrder(order) }, { status: replayed ? 200 : 201 })
  } catch (err) {
    if (err instanceof OrderCreationError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status })
    }
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const rawStatus = searchParams.get('status')
    const validStatuses = Object.values($Enums.OrderStatus)
    const status = rawStatus && validStatuses.includes(rawStatus as $Enums.OrderStatus) ? (rawStatus as $Enums.OrderStatus) : undefined
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10))
    const skip = (page - 1) * limit

    // Only real orders; checkout holds are never listed (payment-gate.ts).
    const where: { userId: string; status?: $Enums.OrderStatus } & typeof CUSTOMER_VISIBLE_ORDER_WHERE = {
      userId: user.id,
      ...CUSTOMER_VISIBLE_ORDER_WHERE,
    }
    if (status) where.status = status

    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { pricingSnapshot: true } }),
      prisma.order.count({ where }),
    ])

    // Customer-facing shape only (no idempotency hash, payment references...).
    return NextResponse.json({ orders: orders.map((o) => toPublicOrder(o)), total, page, limit })
  } catch (err) {
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
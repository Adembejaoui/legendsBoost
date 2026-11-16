import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth/guards'
import { toPublicOrder } from '@/lib/orders/public-order'

/**
 * The owner's order. Internal fields (idempotency hash, commission split,
 * payment references) are not returned; `pricing` is the customer-facing
 * price snapshot.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orderId } = await params
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { events: { orderBy: { createdAt: 'asc' } }, pricingSnapshot: true },
    })
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    return NextResponse.json({
      order: {
        ...toPublicOrder(order),
        championsRoles: order.championsRoles,
        completedAt: order.completedAt?.toISOString() ?? null,
        paymentVerifiedAt: order.paymentVerifiedAt?.toISOString() ?? null,
        events: order.events.map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
      },
    })
  } catch {
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}

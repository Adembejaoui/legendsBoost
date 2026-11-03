import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { $Enums } from '@/app/generated/prisma/client'
import { getSessionUser } from '@/lib/auth/guards'
import { getGameServiceOffer } from '@/lib/catalog/game-services'

const createOrderSchema = z.object({
  gameSlug: z.string().min(1),
  serviceSlug: z.string().min(1),
  configuration: z.record(z.string(), z.unknown()).optional().default({}),
  selectedMode: z.enum(['solo', 'duo']).optional(),
  selectedOptions: z.array(z.string()).optional().default([]),
  championsRoles: z.object({ roles: z.array(z.string()), champions: z.array(z.string()) }).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = createOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
    }

    const { gameSlug, serviceSlug, configuration, selectedMode, selectedOptions, championsRoles } = parsed.data

    const offer = getGameServiceOffer(gameSlug, serviceSlug)
    if (!offer) return NextResponse.json({ error: 'Invalid game/service combination' }, { status: 400 })
    if (offer.visibility === 'hidden') return NextResponse.json({ error: 'Service not available' }, { status: 403 })

    if (Array.isArray(offer.fields)) {
      for (const field of offer.fields) {
        if (field.required) {
          const val = (configuration as Record<string, unknown>)?.[field.key]
          if (val === undefined || val === null || val === '') {
            return NextResponse.json({ error: `Missing required field: ${field.label}` }, { status: 400 })
          }
        }
      }
    }

    const status: $Enums.OrderStatus = $Enums.OrderStatus.PENDING

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        gameSlug,
        serviceSlug,
        configuration: configuration as any,
        selectedMode: selectedMode ?? null,
        selectedOptions,
        championsRoles: (championsRoles as any) ?? null,
        status: status,
      },
    })

    await prisma.orderEvent.create({
      data: { orderId: order.id, type: 'ORDER_CREATED', message: 'Order created' },
    })

    return NextResponse.json({ order }, { status: 201 })
  } catch (err) {
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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))
    const skip = (page - 1) * limit

    const where: { userId: string; status?: $Enums.OrderStatus } = { userId: user.id }
    if (status) where.status = status

    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.order.count({ where }),
    ])

    return NextResponse.json({ orders, total, page, limit })
  } catch (err) {
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
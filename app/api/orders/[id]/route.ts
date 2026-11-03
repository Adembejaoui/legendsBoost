import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSessionUser } from '@/lib/auth/guards'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const order = await prisma.order.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } })
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    return NextResponse.json({ order })
  } catch (err) {
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
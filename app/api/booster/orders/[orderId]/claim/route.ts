import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { claimOrder } from '@/lib/assignments/service';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'BOOSTER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orderId } = await params;
    const assignment = await claimOrder(orderId, user.id);

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('already claimed') || error.message.includes('already has an active assignment')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.message.includes('Booster') || error.message.includes('not eligible')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to claim order' },
      { status: 400 }
    );
  }
}


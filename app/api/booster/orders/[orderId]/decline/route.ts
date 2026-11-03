import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { declineAssignment } from '@/lib/assignments/service';

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
    const body = await req.json().catch(() => ({}));
    const assignmentId = body.assignmentId;
    const reason = body.reason;

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const assignment = await declineAssignment(assignmentId, user.id, reason);

    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Booster')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to decline' },
      { status: 400 }
    );
  }
}


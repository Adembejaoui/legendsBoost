import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { releaseAssignment } from '@/lib/assignments/service';

function isBoosterOrAdmin(user: { role: string } | null): boolean {
  return user !== null && (user.role === 'BOOSTER' || user.role === 'ADMIN');
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isBoosterOrAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orderId } = await params;
    const body = await req.json().catch(() => ({}));
    const assignmentId = body.assignmentId;
    const reason = body.reason;

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const assignment = await releaseAssignment(assignmentId, user.id, user.role, reason);

    if (assignment.orderId !== orderId) {
      return NextResponse.json({ error: 'Assignment does not belong to this order' }, { status: 403 });
    }

    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotBoosterOwnerError') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message === 'Assignment not found') {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to release' },
      { status: 400 }
    );
  }
}

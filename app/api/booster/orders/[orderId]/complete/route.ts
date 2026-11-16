import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { rejectIfAssignmentNotInOrder } from '@/lib/assignments/route-guard';
import { completeAssignment } from '@/lib/assignments/service';

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

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const mismatch = await rejectIfAssignmentNotInOrder(assignmentId, orderId);
    if (mismatch) return mismatch;

    const result = await completeAssignment(assignmentId, user.id, user.role);

    if (result.assignment.orderId !== orderId) {
      return NextResponse.json({ error: 'Assignment does not belong to this order' }, { status: 403 });
    }

    return NextResponse.json({ assignment: result.assignment });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotBoosterOwnerError') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.name === 'CompletionNotConfirmedError') {
        const e = error as Error & { result: string; reason: string; current: string | null; target: string | null };
        return NextResponse.json(
          { error: e.message, code: e.result === 'not_reached' ? 'TARGET_NOT_REACHED' : 'CANNOT_VERIFY', reason: e.reason, current: e.current, target: e.target },
          { status: 409 }
        );
      }
      if (error.name === 'OrderStateConflictError') {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.message === 'Assignment not found') {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to complete' },
      { status: 400 }
    );
  }
}

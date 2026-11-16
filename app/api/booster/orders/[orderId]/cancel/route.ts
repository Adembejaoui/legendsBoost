import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { rejectIfAssignmentNotInOrder } from '@/lib/assignments/route-guard';
import { cancelAssignment } from '@/lib/assignments/service';
import { BoosterCancellationForbiddenError } from '@/lib/assignments/types';

/**
 * Cancel the order an assignment belongs to. ADMIN ONLY.
 *
 * Boosters cannot cancel a customer's order; they must use
 * POST /api/booster/orders/:orderId/abandon, which returns the order to
 * DRAFT for admin review. The service layer enforces the same rule.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role === 'BOOSTER') {
      return NextResponse.json({ error: new BoosterCancellationForbiddenError().message }, { status: 403 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orderId } = await params;
    const body = await req.json().catch(() => ({}));
    const assignmentId = body.assignmentId;
    const reason = body.reason;

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const mismatch = await rejectIfAssignmentNotInOrder(assignmentId, orderId);
    if (mismatch) return mismatch;

    const result = await cancelAssignment(assignmentId, user.id, user.role, reason);

    if (result.assignment.orderId !== orderId) {
      return NextResponse.json({ error: 'Assignment does not belong to this order' }, { status: 403 });
    }

    return NextResponse.json({ assignment: result.assignment });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotBoosterOwnerError' || error.name === 'BoosterCancellationForbiddenError') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message === 'Assignment not found') {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel order' },
      { status: 400 }
    );
  }
}

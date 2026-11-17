import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { rejectIfAssignmentNotInOrder } from '@/lib/assignments/route-guard';
import { completeAssignment } from '@/lib/assignments/service';
import { submitCompletion } from '@/lib/orders/completion-request.service';
import { PROOF_MAX_FILES } from '@/lib/storage/order-proofs';

function isBoosterOrAdmin(user: { role: string } | null): boolean {
  return user !== null && (user.role === 'BOOSTER' || user.role === 'ADMIN');
}

/**
 * Complete an order.
 *  - Booster: multipart/form-data with `assignmentId`, 1-3 `proof` images
 *    (final rank) and an optional `note`. The order then waits for the
 *    customer's confirmation (lib/orders/completion-request.service.ts).
 *  - Admin: JSON `{ assignmentId }`, completes an in-progress order directly.
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
    if (!isBoosterOrAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orderId } = await params;

    if (user.role === 'BOOSTER') {
      const form = await req.formData().catch(() => null);
      if (!form) return NextResponse.json({ error: 'Add at least one screenshot of the final rank.' }, { status: 400 });
      const assignmentId = form.get('assignmentId');
      if (typeof assignmentId !== 'string' || !assignmentId) {
        return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
      }
      const files = form.getAll('proof').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
      if (files.length > PROOF_MAX_FILES) {
        return NextResponse.json({ error: `Add at most ${PROOF_MAX_FILES} screenshots.` }, { status: 400 });
      }
      const note = form.get('note');
      const mismatch = await rejectIfAssignmentNotInOrder(assignmentId, orderId);
      if (mismatch) return mismatch;
      const r = await submitCompletion({
        orderId,
        assignmentId,
        boosterId: user.id,
        files,
        note: typeof note === 'string' ? note : null,
      });
      return NextResponse.json({ completion: { id: r.requestId, status: r.status, autoConfirmAt: r.autoConfirmAt.toISOString() } });
    }

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
      if (error.name === 'ProofError' || error.name === 'CompletionFlowError') {
        return NextResponse.json({ error: error.message }, { status: (error as Error & { status: number }).status });
      }
      if (error.name === 'NotBoosterOwnerError' || error.name === 'BoosterNotEligibleError') {
        return NextResponse.json({ error: error.message }, { status: 403 });
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

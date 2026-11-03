import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/guards';
import { acceptAssignment } from '@/lib/assignments/service';

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

    await params;
    const body = await req.json().catch(() => ({}));
    const assignmentId = body.assignmentId;

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });
    }

    const assignment = await acceptAssignment(assignmentId, user.id);

    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Booster')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message.includes('does not belong')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to accept' },
      { status: 400 }
    );
  }
}


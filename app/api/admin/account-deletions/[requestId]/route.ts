import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { AccountDeletionError, decideAccountDeletion } from "@/lib/account/deletion";

const body = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).strict();

/** Admin: approve (anonymise the account) or reject a deletion request. */
export async function POST(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { requestId } = await params;
    return NextResponse.json(await decideAccountDeletion(user.id, requestId, parsed.data.approve, parsed.data.note));
  } catch (e) {
    if (e instanceof AccountDeletionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

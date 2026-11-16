import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { AccountDeletionError, cancelAccountDeletion, deletionBlockers, requestAccountDeletion } from "@/lib/account/deletion";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const body = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function errorResponse(e: unknown) {
  if (e instanceof AccountDeletionError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** The signed-in user's deletion request and what still blocks it. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [pending, blockers] = await Promise.all([
    prisma.accountDeletionRequest.findFirst({ where: { userId: user.id, status: "REQUESTED" }, select: { id: true, requestedAt: true } }),
    deletionBlockers(user.id),
  ]);
  return NextResponse.json({ pending, blockers });
}

/** Ask to delete the account (an admin approves). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await sharedRateLimit("account-deletion", user.id, LIMITS.accountDeletionPerUser);
  if (!limit.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const parsed = body.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Reason is too long." }, { status: 400 });
  try {
    const r = await requestAccountDeletion(user.id, parsed.data.reason);
    return NextResponse.json({ request: { id: r.id, requestedAt: r.requestedAt } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Cancel a pending request. */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await cancelAccountDeletion(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

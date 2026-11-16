import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";

/** Admin: mark a chat moderation flag as reviewed. */
export async function POST(_req: Request, { params }: { params: Promise<{ flagId: string }> }) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { flagId } = await params;
  const r = await prisma.chatModerationFlag.updateMany({ where: { id: flagId, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedById: admin.id } });
  if (r.count === 0) return NextResponse.json({ error: "Already reviewed or not found" }, { status: 404 });
  await audit({ actorId: admin.id, action: "CHAT_FLAG_REVIEWED", entityType: "chatModerationFlag", entityId: flagId });
  return NextResponse.json({ reviewed: true });
}

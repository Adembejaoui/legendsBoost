import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { transitionBooster } from "@/lib/boosters/transitions";
import { boosterErrorResponse } from "@/lib/boosters/admin.service";

const bodySchema = z.object({ onBreak: z.boolean() }).strict();

/**
 * Booster: start or end a break. On a break the booster keeps working on
 * current orders but takes no new ones (ACTIVE <-> ON_BREAK).
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const profile = await prisma.boosterProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!profile) return NextResponse.json({ error: "Booster profile not found" }, { status: 404 });
    const updated = await prisma.$transaction((tx) =>
      transitionBooster(tx, { profileId: profile.id, to: parsed.data.onBreak ? "ON_BREAK" : "APPROVED", actorId: user.id, actor: "self" })
    );
    return NextResponse.json({ verificationStatus: updated.verificationStatus });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

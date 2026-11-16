import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { lowerOwnCeiling } from "@/lib/boosters/permissions";
import { boosterErrorResponse } from "@/lib/boosters/admin.service";

/** Booster: own permissions (games and rank ceilings). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await prisma.boosterProfile.findUnique({ where: { userId: user.id }, include: { permissions: true } });
  return NextResponse.json({ permissions: profile?.permissions ?? [] });
}

const lowerSchema = z
  .object({
    gameSlug: z.string().min(1),
    maxTargetRank: z.object({ tierId: z.string().min(1), divisionId: z.string().nullable() }).strict(),
  })
  .strict();

/** Booster: LOWER their own rank ceiling for a game (raising needs an admin). */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = lowerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const permission = await prisma.$transaction((tx) => lowerOwnCeiling(tx, user.id, parsed.data.gameSlug, parsed.data.maxTargetRank));
    return NextResponse.json({ permission });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

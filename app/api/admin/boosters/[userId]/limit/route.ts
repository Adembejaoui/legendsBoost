import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";

const bodySchema = z.object({ maxConcurrentOrders: z.number().int().min(1).max(20).nullable() }).strict();

/** Admin: per-booster active order limit (null = config max_concurrent_orders). */
export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a limit between 1 and 20, or the default." }, { status: 400 });
  const { userId } = await params;
  const profile = await prisma.boosterProfile.findUnique({ where: { userId }, select: { id: true, maxConcurrentOrders: true } });
  if (!profile) return NextResponse.json({ error: "Booster not found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.boosterProfile.update({ where: { id: profile.id }, data: { maxConcurrentOrders: parsed.data.maxConcurrentOrders } });
    await tx.boosterEvent.create({
      data: { boosterProfileId: profile.id, type: "ORDER_LIMIT_SET", actorId: admin.id, metadata: { from: profile.maxConcurrentOrders, to: parsed.data.maxConcurrentOrders } },
    });
    await audit({ actorId: admin.id, action: "BOOSTER_ORDER_LIMIT_SET", entityType: "boosterProfile", entityId: profile.id, metadata: { from: profile.maxConcurrentOrders, to: parsed.data.maxConcurrentOrders } }, tx);
  });
  return NextResponse.json({ maxConcurrentOrders: parsed.data.maxConcurrentOrders });
}

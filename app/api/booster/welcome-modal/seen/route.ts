import { NextResponse } from "next/server";
import { requireBooster } from "@/lib/auth/guards";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST() {
  try {
    const user = await requireBooster();
    await prisma.boosterProfile.update({
      where: {
        userId: user.id,
      },
      data: {
        welcomeModalSeen: true,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }
    logger.error("Mark welcome modal seen failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

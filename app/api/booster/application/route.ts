import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const boosterProfile = await prisma.boosterProfile.findUnique({
      where: { userId: user.id },
    });

    return NextResponse.json({ boosterProfile });
  } catch (err) {
    logger.error("Get booster application failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

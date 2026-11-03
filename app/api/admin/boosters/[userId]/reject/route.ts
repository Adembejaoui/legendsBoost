import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";

type RouteContext = { params: Promise<{ userId: string }> };

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required").max(1000),
});

async function loadTarget({ params }: RouteContext) {
  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { boosterProfile: true },
  });

  if (!user) {
    return { error: "User not found", status: 404 as const };
  }
  if (!user.boosterProfile) {
    return { error: "Booster profile not found", status: 404 as const };
  }
  if (user.boosterProfile.verificationStatus !== "PENDING") {
    return {
      error: `Application is already ${user.boosterProfile.verificationStatus.toLowerCase()}`,
      status: 409 as const,
    };
  }

  return { user };
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    if (admin.id === userId) {
      return NextResponse.json({ error: "You cannot review your own application" }, { status: 403 });
    }

    const body = await _req.json();
    const parsed = rejectSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: first }, { status: 400 });
    }

    const loaded = await loadTarget({ params });
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    const now = new Date();
    const result = await prisma.boosterProfile.update({
      where: {
        userId,
        verificationStatus: "PENDING",
      },
      data: {
        verificationStatus: "REJECTED",
        rejectionReason: parsed.data.reason,
        reviewedAt: now,
        reviewerId: admin.id,
      },
    });

    return NextResponse.json({
      ok: true,
      boosterProfile: {
        id: result.id,
        verificationStatus: result.verificationStatus,
        rejectionReason: result.rejectionReason,
        reviewedAt: result.reviewedAt,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: "Application was already reviewed by another administrator" },
        { status: 409 },
      );
    }
    if (err instanceof Response) {
      return err;
    }
    logger.error("Reject booster application failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

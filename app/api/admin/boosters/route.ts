import { NextResponse } from "next/server";
import { $Enums, Prisma } from "@/app/generated/prisma/client";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";

type BoosterView = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: Date;
  boosterProfile: {
    id: string;
    verificationStatus: string;
    rejectionReason: string | null;
    reviewedAt: Date | null;
    approvedAt: Date | null;
    welcomeModalSeen: boolean;
    createdAt: Date;
    applicationData: unknown;
  } | null;
  customerProfile: { country: string | null } | null;
};

export async function GET(req: Request) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const validStatuses = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

    const where: Prisma.UserWhereInput = {
      OR: [
        { role: "BOOSTER", boosterProfile: { isNot: null } },
        { role: "CUSTOMER", boosterProfile: { isNot: null } },
      ],
    };

    if (status && validStatuses.includes(status as $Enums.BoosterVerificationStatus)) {
      where.boosterProfile = { verificationStatus: status as $Enums.BoosterVerificationStatus };
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        boosterProfile: true,
        customerProfile: {
          select: { country: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const boosters: BoosterView[] = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? "CUSTOMER",
      createdAt: u.createdAt,
      boosterProfile: u.boosterProfile
        ? {
            id: u.boosterProfile.id,
            verificationStatus: u.boosterProfile.verificationStatus,
            rejectionReason: u.boosterProfile.rejectionReason,
            reviewedAt: u.boosterProfile.reviewedAt,
            approvedAt: u.boosterProfile.approvedAt,
            welcomeModalSeen: u.boosterProfile.welcomeModalSeen,
            createdAt: u.boosterProfile.createdAt,
            applicationData: u.boosterProfile.applicationData,
          }
        : null,
      customerProfile: u.customerProfile,
    }));

    return NextResponse.json({ boosters });
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }
    logger.error("Get boosters failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

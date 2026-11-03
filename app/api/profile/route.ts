import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phoneNumber: z.string().trim().min(1).max(50).nullable().optional(),
  country: z.string().trim().min(1).max(100).nullable().optional(),
});

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        customerProfile: true,
        boosterProfile: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
      },
      customerProfile: dbUser.customerProfile,
      boosterProfile: dbUser.boosterProfile,
    });
  } catch (err) {
    logger.error("Get profile failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = profileUpdateSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { customerProfile: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, ...profileData } = parsed.data;

    if (name !== undefined) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { name },
      });
    }

    const customerProfile = await prisma.customerProfile.upsert({
      where: { userId: dbUser.id },
      update: profileData,
      create: {
        userId: dbUser.id,
        ...profileData,
      },
    });

    return NextResponse.json({ customerProfile });
  } catch (err) {
    logger.error("Update profile failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

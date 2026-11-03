import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import prisma from "@/lib/prisma";

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "BOOSTER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { biography, experienceYears, languages, availabilityStatus } = body;

    const boosterProfile = await prisma.boosterProfile.findUnique({
      where: { userId: user.id },
    });

    if (!boosterProfile) {
      return NextResponse.json({ error: "Booster profile not found" }, { status: 404 });
    }

    if (boosterProfile.verificationStatus !== "APPROVED") {
      return NextResponse.json({ error: "Only approved boosters can update profile" }, { status: 403 });
    }

    const updateData: any = {};
    if (biography !== undefined) updateData.biography = biography;
    if (experienceYears !== undefined) updateData.experienceYears = Number(experienceYears);
    if (languages !== undefined) updateData.languages = languages;
    if (availabilityStatus !== undefined) {
      // Only allow valid statuses
      if (["AVAILABLE", "BUSY", "UNAVAILABLE"].includes(availabilityStatus)) {
        updateData.availabilityStatus = availabilityStatus;
      }
    }

    const updated = await prisma.boosterProfile.update({
      where: { userId: user.id },
      data: updateData,
    });

    return NextResponse.json({ boosterProfile: updated });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

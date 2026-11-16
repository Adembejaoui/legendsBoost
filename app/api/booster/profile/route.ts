import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import prisma from "@/lib/prisma";
import { hasBoosterAccess } from "@/lib/boosters/status";
import { DISPLAY_NAME_PATTERN } from "@/lib/pool/preferred";

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
    const { biography, experienceYears, languages, availabilityStatus, displayName } = body;

    const boosterProfile = await prisma.boosterProfile.findUnique({
      where: { userId: user.id },
    });

    if (!boosterProfile) {
      return NextResponse.json({ error: "Booster profile not found" }, { status: 404 });
    }

    if (!hasBoosterAccess(boosterProfile.verificationStatus)) {
      return NextResponse.json({ error: "Only approved boosters can update profile" }, { status: 403 });
    }

    const updateData: any = {};
    if (displayName !== undefined) {
      // Public name customers see when choosing a booster. Never the real name.
      const name = typeof displayName === "string" ? displayName.trim() : "";
      if (name === "") updateData.displayName = null;
      else if (!DISPLAY_NAME_PATTERN.test(name)) {
        return NextResponse.json({ error: "Display name: 3 to 20 letters, numbers, dots, dashes or underscores." }, { status: 400 });
      } else {
        const taken = await prisma.boosterProfile.findFirst({ where: { displayName: { equals: name, mode: "insensitive" }, NOT: { userId: user.id } }, select: { id: true } });
        if (taken) return NextResponse.json({ error: "This display name is already used." }, { status: 409 });
        updateData.displayName = name;
      }
    }
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

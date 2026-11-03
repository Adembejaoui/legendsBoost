import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { z, ZodError } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";
import { boosterApplicationSchema, type BoosterApplicationInput } from "@/lib/boosters/application-schema";
import { getGame, getRankSystemsByGame, getTier, getDivision } from "@/lib/catalog/catalog-utils";

export const runtime = "nodejs";

async function validateGameExpertise(games: BoosterApplicationInput["games"]) {
  for (const game of games) {
    const g = getGame(game.gameSlug);
    if (!g) {
      throw new Error(`Unsupported game: ${game.gameSlug}`);
    }
    const systems = getRankSystemsByGame(game.gameSlug);
    if (systems.length === 0) {
      throw new Error(`No rank system configured for ${g.name}`);
    }
    const rankSystem = systems[0];

    const currentTier = getTier(rankSystem.id, game.currentRank.tierId);
    if (!currentTier) {
      throw new Error(`Invalid current rank tier for ${g.name}`);
    }
    if (game.currentRank.divisionId && !getDivision(rankSystem.id, game.currentRank.tierId, game.currentRank.divisionId)) {
      throw new Error(`Invalid current rank division for ${g.name}`);
    }

    const peakTier = getTier(rankSystem.id, game.peakRank.tierId);
    if (!peakTier) {
      throw new Error(`Invalid peak rank tier for ${g.name}`);
    }
    if (game.peakRank.divisionId && !getDivision(rankSystem.id, game.peakRank.tierId, game.peakRank.divisionId)) {
      throw new Error(`Invalid peak rank division for ${g.name}`);
    }
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.role !== "CUSTOMER") {
      return NextResponse.json(
        { error: "Only CUSTOMER accounts can submit a booster application" },
        { status: 403 },
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { boosterProfile: true, customerProfile: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = dbUser.boosterProfile;
    if (existing) {
      switch (existing.verificationStatus) {
        case "APPROVED":
          return NextResponse.json({ error: "Already approved as booster" }, { status: 400 });
        case "PENDING":
          return NextResponse.json(
            { error: "You already have a pending booster application" },
            { status: 409 },
          );
        case "SUSPENDED":
          return NextResponse.json(
            { error: "Booster account is suspended; applications are blocked" },
            { status: 403 },
          );
        case "REJECTED":
          // Resubmission after rejection is allowed.
          break;
      }
    }

    const body = await req.json();
    let data: z.infer<typeof boosterApplicationSchema>;
    try {
      data = boosterApplicationSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0]?.message ?? "Invalid input";
        return NextResponse.json({ error: first, issues: err.issues }, { status: 400 });
      }
      throw err;
    }

    await validateGameExpertise(data.games);

    if (!dbUser.customerProfile) {
      await prisma.customerProfile.create({
        data: { userId: dbUser.id },
      });
    }

    const applicationData = {
      personal: {
        fullName: data.personal.fullName,
        email: dbUser.email,
        country: data.personal.country,
        phoneNumber: data.personal.phoneNumber ?? null,
        discordUsername: data.personal.discordUsername,
      },
      games: data.games,
      experience: {
        biography: data.experience.biography,
        previousExperience: data.experience.previousExperience ?? null,
        achievements: data.experience.achievements ?? null,
        portfolioLinks: data.experience.portfolioLinks ?? [],
      },
      availability: {
        languages: data.availability.languages,
        availableDays: data.availability.availableDays,
        availableTimeSlots: data.availability.availableTimeSlots,
        timezone: data.availability.timezone ?? null,
      },
      declaration: {
        codeOfConduct: data.declaration.codeOfConduct,
        informationAccurate: data.declaration.informationAccurate,
      },
      submittedAt: new Date().toISOString(),
    };

    const experienceYears =
      data.games.length > 0
        ? Math.max(0, ...data.games.map((game) => game.yearsExperience))
        : 0;

    const languages = Array.from(new Set(data.availability.languages));
    const specializations = data.games.map((game) => game.mainRole);

    const boosterProfile = await prisma.boosterProfile.upsert({
      where: { userId: dbUser.id },
      update: {
        applicationData,
        biography: data.experience.biography,
        experienceYears,
        languages,
        specializations,
        verificationStatus: "PENDING",
        rejectionReason: null,
        reviewedAt: null,
        reviewerId: null,
        approvedAt: null,
        availabilityStatus: existing?.availabilityStatus ?? "UNAVAILABLE",
      },
      create: {
        userId: dbUser.id,
        applicationData,
        biography: data.experience.biography,
        experienceYears,
        languages,
        specializations,
        verificationStatus: "PENDING",
        availabilityStatus: "UNAVAILABLE",
      },
    });

    return NextResponse.json({
      ok: true,
      boosterProfile: {
        id: boosterProfile.id,
        verificationStatus: boosterProfile.verificationStatus,
        submittedAt: applicationData.submittedAt,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A booster profile already exists for this account" },
        { status: 409 },
      );
    }
    logger.error("Booster application failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

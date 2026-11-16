import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { z, ZodError } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";
import { boosterApplicationSchema, BOOSTER_RULES_VERSION, type BoosterApplicationInput } from "@/lib/boosters/application-schema";
import { transitionBooster } from "@/lib/boosters/transitions";
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
        case "TRIAL":
        case "ON_BREAK":
          return NextResponse.json({ error: "Already approved as booster" }, { status: 400 });
        case "PENDING":
        case "UNDER_REVIEW":
          return NextResponse.json(
            { error: "You already have a pending booster application" },
            { status: 409 },
          );
        case "SUSPENDED":
        case "TERMINATED":
          return NextResponse.json(
            { error: "Booster account is suspended; applications are blocked" },
            { status: 403 },
          );
        case "REJECTED":
        case "NEEDS_INFO":
          // Resubmission (after a rejection, or with the requested information) is allowed.
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

    const now = new Date();
    const fields = {
      applicationData,
      biography: data.experience.biography,
      experienceYears,
      languages,
      specializations,
      rulesVersion: BOOSTER_RULES_VERSION,
      rulesAcceptedAt: now,
    };
    // Status changes go through transitionBooster (resubmission -> PENDING).
    const boosterProfile = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.boosterProfile.update({ where: { id: existing.id }, data: fields });
        return transitionBooster(tx, { profileId: existing.id, to: "PENDING", actorId: dbUser.id, actor: "self" });
      }
      const created = await tx.boosterProfile.create({
        data: { userId: dbUser.id, ...fields, verificationStatus: "PENDING", availabilityStatus: "UNAVAILABLE" },
      });
      await tx.boosterEvent.create({
        data: { boosterProfileId: created.id, type: "APPLICATION_SUBMITTED", toStatus: "PENDING", actorId: dbUser.id },
      });
      return created;
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

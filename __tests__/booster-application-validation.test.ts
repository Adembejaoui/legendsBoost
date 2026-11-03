import { describe, expect, test } from "vitest";
import { boosterApplicationSchema } from "@/lib/boosters/application-schema";

const validBase = {
  personal: {
    fullName: "Ada Example",
    country: "Germany",
    phoneNumber: "+49 123 4567",
    discordUsername: "ada#1234",
  },
  games: [
    {
      gameSlug: "league-of-legends",
      region: "EUW",
      currentRank: { tierId: "gold", divisionId: "ii" },
      peakRank: { tierId: "platinum", divisionId: null },
      mainRole: "Jungle",
      yearsExperience: 3,
    },
  ],
  experience: {
    biography: "I have been boosting for several years and love teaching.",
    previousExperience: null,
    achievements: null,
    portfolioLinks: [],
  },
  availability: {
    languages: ["English", "German"],
    availableDays: ["Saturday", "Sunday"],
    availableTimeSlots: ["Evening (17:00-22:00)"],
    timezone: "Europe/Berlin",
  },
  declaration: { codeOfConduct: true, informationAccurate: true },
};

describe("boosterApplicationSchema", () => {
  test("accepts a complete valid application", () => {
    const result = boosterApplicationSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.games).toHaveLength(1);
      expect(result.data.declaration.codeOfConduct).toBe(true);
    }
  });

  test("rejects empty games list", () => {
    const result = boosterApplicationSchema.safeParse({
      ...validBase,
      games: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid portfolio URL", () => {
    const result = boosterApplicationSchema.safeParse({
      ...validBase,
      experience: { ...validBase.experience, portfolioLinks: ["not-a-url"] },
    });
    expect(result.success).toBe(false);
  });

  test("requires both declarations to be true", () => {
    const result = boosterApplicationSchema.safeParse({
      ...validBase,
      declaration: { codeOfConduct: true, informationAccurate: false },
    });
    expect(result.success).toBe(false);
  });

  test("requires full name and discord", () => {
    const noName = boosterApplicationSchema.safeParse({
      ...validBase,
      personal: { ...validBase.personal, fullName: "" },
    });
    expect(noName.success).toBe(false);

    const noDiscord = boosterApplicationSchema.safeParse({
      ...validBase,
      personal: { ...validBase.personal, discordUsername: "" },
    });
    expect(noDiscord.success).toBe(false);
  });

  test("accepts optional phone number omitted", () => {
    const result = boosterApplicationSchema.safeParse({
      ...validBase,
      personal: { ...validBase.personal, phoneNumber: null },
    });
    expect(result.success).toBe(true);
  });

  test("limits portfolio links to five", () => {
    const links = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    const result = boosterApplicationSchema.safeParse({
      ...validBase,
      experience: { ...validBase.experience, portfolioLinks: links },
    });
    expect(result.success).toBe(false);
  });
});

import { z } from "zod";

const MAX_PORTFOLIO_LINKS = 5;
const MAX_GAMES = 10;

const rankSelectionSchema = z.object({
  tierId: z.string().min(1, "Select a tier"),
  divisionId: z.string().nullable(),
});

const gameExpertiseSchema = z.object({
  gameSlug: z.string().min(1, "Select a game"),
  region: z.string().trim().min(1, "Region is required").max(50, "Region is too long"),
  currentRank: rankSelectionSchema,
  peakRank: rankSelectionSchema,
  mainRole: z.string().trim().min(1, "Main role is required").max(100, "Main role is too long"),
  yearsExperience: z
    .number()
    .int("Years must be a whole number")
    .min(0, "Years cannot be negative")
    .max(50, "Years cannot exceed 50"),
});

export const boosterApplicationSchema = z.object({
  personal: z.object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters")
      .max(100, "Full name is too long"),
    country: z.string().trim().min(1, "Country is required").max(100, "Country is too long"),
    phoneNumber: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .max(50, "Phone number is too long")
      .optional()
      .nullable(),
    discordUsername: z
      .string()
      .trim()
      .min(1, "Discord username is required")
      .max(50, "Discord username is too long"),
  }),
  games: z
    .array(gameExpertiseSchema)
    .min(1, "Select at least one game")
    .max(MAX_GAMES, `You can select up to ${MAX_GAMES} games`),
  experience: z.object({
    biography: z
      .string()
      .trim()
      .min(10, "Biography must be at least 10 characters")
      .max(2000, "Biography is too long"),
    previousExperience: z.string().trim().max(2000, "Too long").optional().nullable(),
    achievements: z.string().trim().max(2000, "Too long").optional().nullable(),
    portfolioLinks: z
      .array(z.string().url("Invalid URL").max(500, "Link is too long"))
      .max(MAX_PORTFOLIO_LINKS, `Up to ${MAX_PORTFOLIO_LINKS} portfolio links`),
  }),
  availability: z.object({
    languages: z
      .array(z.string().trim().min(1).max(50))
      .min(1, "Select at least one language")
      .max(20, "Too many languages"),
    availableDays: z
      .array(z.string().min(1))
      .min(1, "Select at least one day")
      .max(7, "Select up to 7 days"),
    availableTimeSlots: z
      .array(z.string().min(1))
      .min(1, "Select at least one time slot")
      .max(14, "Too many time slots"),
    timezone: z.string().trim().max(100, "Timezone is too long").optional().nullable(),
  }),
  declaration: z.object({
    codeOfConduct: z
      .boolean()
      .refine((value) => value === true, {
        message: "You must agree to the code of conduct",
      }),
    informationAccurate: z
      .boolean()
      .refine((value) => value === true, {
        message: "You must confirm your information is accurate",
      }),
  }),
});

export type BoosterApplicationInput = z.infer<typeof boosterApplicationSchema>;

export function applicationErrorPath(issue: { path: (string | number)[] }): string {
  return issue.path.length === 0 ? "form" : issue.path.join(".");
}

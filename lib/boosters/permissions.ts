// Server-only module.
/**
 * Per-game booster permissions and rank ceiling [plan Phase 2].
 *
 * The ceiling is the highest TARGET rank a booster may take in a game
 * (stored as lib/domain/rank.ts value + tier/division for display). Admins
 * set it; a booster may only LOWER their own (raising needs an admin). Every
 * change writes a BoosterEvent + audit row. Enforcement on the order pool,
 * claims and bids comes in Phase 3.
 */
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { audit } from "@/lib/audit";
import { rankValue } from "@/lib/domain/rank";
import { gameServices } from "@/lib/catalog/game-services";
import { RIOT_PLATFORMS } from "@/lib/services/games/league-of-legends/routing";

type Tx = Prisma.TransactionClient;

/** The ranked ladder a ceiling is expressed in, per game. */
export const CEILING_RANK_SYSTEM: Record<string, string> = {
  "league-of-legends": "lol-ranked",
  valorant: "valorant-competitive",
  "teamfight-tactics": "tft-ranked",
};

export class PermissionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PermissionError";
  }
}

const rankSchema = z.object({ tierId: z.string().min(1), divisionId: z.string().nullable() }).strict();

export const permissionInputSchema = z
  .object({
    gameSlug: z.string().min(1),
    maxTargetRank: rankSchema,
    regions: z.array(z.string()).max(30).default([]),
    serviceSlugs: z.array(z.string()).max(30).default([]),
  })
  .strict();

function resolveCeiling(gameSlug: string, rank: { tierId: string; divisionId: string | null }) {
  const rankSystemId = CEILING_RANK_SYSTEM[gameSlug];
  if (!rankSystemId) throw new PermissionError("This game has no ranked ladder.", 400);
  const value = rankValue(rankSystemId, rank);
  if (value === null) throw new PermissionError("Choose a valid rank for this game.", 400);
  return { rankSystemId, value };
}

/**
 * Default permissions from the application: one per game the applicant
 * listed, ceiling = their stated PEAK rank (decision 2026-11-14). Existing
 * permissions are never overwritten.
 */
export function defaultPermissionsFromApplication(applicationData: unknown) {
  const games = (applicationData as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) return [];
  const out: { gameSlug: string; rankSystemId: string; value: number; tierId: string; divisionId: string | null }[] = [];
  for (const g of games as { gameSlug?: unknown; peakRank?: unknown }[]) {
    if (typeof g?.gameSlug !== "string" || out.some((o) => o.gameSlug === g.gameSlug)) continue;
    const peak = rankSchema.safeParse(g.peakRank);
    const rankSystemId = CEILING_RANK_SYSTEM[g.gameSlug];
    if (!peak.success || !rankSystemId) continue;
    const value = rankValue(rankSystemId, peak.data);
    if (value === null) continue;
    out.push({ gameSlug: g.gameSlug, rankSystemId, value, tierId: peak.data.tierId, divisionId: peak.data.divisionId });
  }
  return out;
}

export async function ensureDefaultPermissions(tx: Tx, boosterProfileId: string, applicationData: unknown, actorId: string | null) {
  const defaults = defaultPermissionsFromApplication(applicationData);
  for (const d of defaults) {
    const existing = await tx.boosterPermission.findUnique({ where: { boosterProfileId_gameSlug: { boosterProfileId, gameSlug: d.gameSlug } } });
    if (existing) continue;
    await tx.boosterPermission.create({
      data: {
        boosterProfileId,
        gameSlug: d.gameSlug,
        rankSystemId: d.rankSystemId,
        maxTargetRankValue: d.value,
        maxTargetTierId: d.tierId,
        maxTargetDivisionId: d.divisionId,
        updatedById: actorId,
      },
    });
    await tx.boosterEvent.create({
      data: { boosterProfileId, type: "CEILING_SET", actorId, note: "Default from application peak rank", metadata: { gameSlug: d.gameSlug, value: d.value } },
    });
  }
  return defaults.length;
}

/** Admin: create or replace a game permission (may raise or lower). */
export async function setPermissionByAdmin(tx: Tx, adminId: string, boosterProfileId: string, raw: unknown) {
  const parsed = permissionInputSchema.safeParse(raw);
  if (!parsed.success) throw new PermissionError(parsed.error.issues[0]?.message ?? "Invalid permission", 400);
  const p = parsed.data;
  const { rankSystemId, value } = resolveCeiling(p.gameSlug, p.maxTargetRank);
  const badRegion = p.regions.find((r) => !(RIOT_PLATFORMS as string[]).includes(r));
  if (badRegion) throw new PermissionError(`Unknown region: ${badRegion}`, 400);
  const known = new Set(gameServices.filter((s) => s.gameSlug === p.gameSlug).map((s) => s.serviceSlug));
  const badService = p.serviceSlugs.find((s) => !known.has(s));
  if (badService) throw new PermissionError(`Unknown service: ${badService}`, 400);

  const before = await tx.boosterPermission.findUnique({ where: { boosterProfileId_gameSlug: { boosterProfileId, gameSlug: p.gameSlug } } });
  const data = {
    rankSystemId,
    maxTargetRankValue: value,
    maxTargetTierId: p.maxTargetRank.tierId,
    maxTargetDivisionId: p.maxTargetRank.divisionId,
    regions: p.regions,
    serviceSlugs: p.serviceSlugs,
    updatedById: adminId,
  };
  const saved = await tx.boosterPermission.upsert({
    where: { boosterProfileId_gameSlug: { boosterProfileId, gameSlug: p.gameSlug } },
    create: { boosterProfileId, gameSlug: p.gameSlug, ...data },
    update: data,
  });
  await tx.boosterEvent.create({
    data: {
      boosterProfileId,
      type: before ? "PERMISSION_CHANGED" : "PERMISSION_ADDED",
      actorId: adminId,
      metadata: { gameSlug: p.gameSlug, fromValue: before?.maxTargetRankValue ?? null, toValue: value, regions: p.regions, serviceSlugs: p.serviceSlugs },
    },
  });
  await audit({ actorId: adminId, action: "BOOSTER_PERMISSION_SET", entityType: "boosterProfile", entityId: boosterProfileId, metadata: { gameSlug: p.gameSlug, value } }, tx);
  return saved;
}

/** Admin: remove a game permission (the booster can no longer take that game). */
export async function removePermissionByAdmin(tx: Tx, adminId: string, boosterProfileId: string, gameSlug: string) {
  const r = await tx.boosterPermission.deleteMany({ where: { boosterProfileId, gameSlug } });
  if (r.count === 0) throw new PermissionError("No permission for this game.", 404);
  await tx.boosterEvent.create({ data: { boosterProfileId, type: "PERMISSION_REMOVED", actorId: adminId, metadata: { gameSlug } } });
  await audit({ actorId: adminId, action: "BOOSTER_PERMISSION_REMOVED", entityType: "boosterProfile", entityId: boosterProfileId, metadata: { gameSlug } }, tx);
}

/** Booster: lower their own ceiling (never raise it). */
export async function lowerOwnCeiling(tx: Tx, boosterUserId: string, gameSlug: string, rank: { tierId: string; divisionId: string | null }) {
  const profile = await tx.boosterProfile.findUnique({ where: { userId: boosterUserId }, select: { id: true } });
  if (!profile) throw new PermissionError("Booster not found", 404);
  const current = await tx.boosterPermission.findUnique({ where: { boosterProfileId_gameSlug: { boosterProfileId: profile.id, gameSlug } } });
  if (!current) throw new PermissionError("You have no permission for this game.", 404);
  const { value } = resolveCeiling(gameSlug, rank);
  if (value > current.maxTargetRankValue) throw new PermissionError("You can only lower your ceiling. Ask an admin to raise it.", 403);
  if (value === current.maxTargetRankValue) return current;
  // Conditional: never lower from a value that changed concurrently.
  const updated = await tx.boosterPermission.update({
    where: { id: current.id, maxTargetRankValue: current.maxTargetRankValue },
    data: { maxTargetRankValue: value, maxTargetTierId: rank.tierId, maxTargetDivisionId: rank.divisionId, updatedById: boosterUserId },
  });
  await tx.boosterEvent.create({
    data: { boosterProfileId: profile.id, type: "CEILING_LOWERED", actorId: boosterUserId, metadata: { gameSlug, fromValue: current.maxTargetRankValue, toValue: value } },
  });
  return updated;
}

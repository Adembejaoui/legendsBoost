// Server-only module.
/**
 * Public booster profiles (Phase 8). Only active boosters (APPROVED) who chose
 * a public display name are listed. Shown: public name, games with their rank
 * ceiling, completed orders, rating and visible reviews. Never the real name,
 * email, earnings, or anything about customers.
 */
import prisma from "@/lib/prisma";
import { getGame } from "@/lib/catalog/games";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { publicReviews, ratingSummary, type RatingSummary } from "@/lib/reviews/service";

export interface PublicBoosterCard {
  id: string;
  displayName: string;
  games: { slug: string; name: string; upTo: string }[];
  completedOrders: number;
  rating: RatingSummary;
}

function rankLabel(rankSystemId: string, tierId: string, divisionId: string | null) {
  const tier = getRankSystem(rankSystemId)?.tiers.find((t) => t.id === tierId);
  const div = tier?.divisions?.find((d) => d.id === divisionId);
  return `${tier?.name ?? tierId}${div ? ` ${div.label}` : ""}`;
}

async function toCard(p: {
  userId: string;
  displayName: string | null;
  permissions: { gameSlug: string; rankSystemId: string; maxTargetTierId: string; maxTargetDivisionId: string | null }[];
}): Promise<PublicBoosterCard> {
  const [completedOrders, rating] = await Promise.all([
    prisma.orderBoosterAssignment.count({ where: { boosterId: p.userId, status: "COMPLETED" } }),
    ratingSummary(p.userId),
  ]);
  return {
    id: p.userId,
    displayName: p.displayName!,
    games: p.permissions.map((g) => ({ slug: g.gameSlug, name: getGame(g.gameSlug)?.name ?? g.gameSlug, upTo: rankLabel(g.rankSystemId, g.maxTargetTierId, g.maxTargetDivisionId) })),
    completedOrders,
    rating,
  };
}

const PUBLIC_WHERE = { verificationStatus: "APPROVED" as const, displayName: { not: null }, user: { role: "BOOSTER" as const } };
const CARD_SELECT = {
  userId: true,
  displayName: true,
  permissions: { select: { gameSlug: true, rankSystemId: true, maxTargetTierId: true, maxTargetDivisionId: true } },
};

export async function listPublicBoosters(): Promise<PublicBoosterCard[]> {
  const rows = await prisma.boosterProfile.findMany({ where: PUBLIC_WHERE, select: CARD_SELECT, take: 200 });
  const cards = await Promise.all(rows.map(toCard));
  // Best rated with enough reviews first, then most experienced.
  return cards.sort(
    (a, b) =>
      (b.rating.average ?? 0) * Math.min(b.rating.count, 10) - (a.rating.average ?? 0) * Math.min(a.rating.count, 10) ||
      b.completedOrders - a.completedOrders
  );
}

export async function getPublicBooster(displayName: string) {
  const row = await prisma.boosterProfile.findFirst({
    where: { ...PUBLIC_WHERE, displayName: { equals: displayName, mode: "insensitive" } },
    select: CARD_SELECT,
  });
  if (!row) return null;
  const [card, reviews] = await Promise.all([toCard(row), publicReviews(row.userId, 20)]);
  return { ...card, reviews };
}

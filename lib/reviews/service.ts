// Server-only module.
/**
 * Customer reviews (Phase 8, decisions 2026-11-16).
 *
 *  - Only the customer who bought a COMPLETED order, once per order.
 *  - 1-5 stars, preset tags, optional text. The booster may reply once.
 *  - Text and replies go through the chat filter (contact / payment details
 *    hidden), because reviews are public on the booster profile.
 *  - Admins can hide a review (with a reason); hidden reviews count nowhere.
 */
import { z } from "zod";
import prisma from "@/lib/prisma";
import { moderateChatText } from "@/lib/chat/moderation";
import { createNotification } from "@/lib/notifications/service";
import { audit } from "@/lib/audit";

export const REVIEW_TAGS = [
  "Very skilled",
  "Fast delivery",
  "Friendly booster",
  "Great communication",
  "Would order again",
  "Consistent performance",
  "Tilt proof",
  "Followed instructions",
  "Clean and discreet",
] as const;

export class ReviewError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ReviewError";
  }
}

export const reviewInputSchema = z
  .object({
    rating: z.number().int().min(1, "Choose 1 to 5 stars").max(5),
    tags: z.array(z.enum(REVIEW_TAGS)).max(REVIEW_TAGS.length).default([]),
    text: z.string().trim().max(1000, "Keep it under 1000 characters").optional(),
  })
  .strict();

function clean(text: string | undefined | null): string | null {
  const t = text?.trim();
  return t ? moderateChatText(t).text : null;
}

export async function createReview(customerId: string, orderId: string, raw: unknown) {
  const parsed = reviewInputSchema.safeParse(raw);
  if (!parsed.success) throw new ReviewError(parsed.error.issues[0]?.message ?? "Invalid review", 400);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, status: true, review: { select: { id: true } }, assignments: { where: { status: "COMPLETED" }, select: { boosterId: true } } },
  });
  if (!order || order.userId !== customerId) throw new ReviewError("Order not found.", 404);
  if (order.status !== "COMPLETED") throw new ReviewError("You can review an order once it is completed.", 409);
  if (order.review) throw new ReviewError("You already reviewed this order.", 409);
  const boosterId = order.assignments[0]?.boosterId;
  if (!boosterId) throw new ReviewError("This order has no booster to review.", 409);
  const { rating, tags, text } = parsed.data;
  let review;
  try {
    review = await prisma.orderReview.create({
      data: { orderId, customerId, boosterId, rating, tags: [...new Set(tags)], text: clean(text) },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ReviewError("You already reviewed this order.", 409);
    throw e;
  }
  await createNotification(boosterId, "REVIEW_RECEIVED", orderId, { rating }, customerId, { dedupeKey: `review:${review.id}` }).catch(() => {});
  return review;
}

export async function replyToReview(boosterId: string, reviewId: string, reply: string) {
  const text = clean(reply);
  if (!text || text.length < 2) throw new ReviewError("Write a reply.", 400);
  if (text.length > 1000) throw new ReviewError("Keep it under 1000 characters.", 400);
  const r = await prisma.orderReview.updateMany({
    where: { id: reviewId, boosterId, reply: null },
    data: { reply: text, repliedAt: new Date() },
  });
  if (r.count === 0) throw new ReviewError("You can reply once to your own reviews.", 409);
  return { replied: true };
}

export async function setReviewHidden(adminId: string, reviewId: string, hidden: boolean, reason?: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true } });
  if (!admin || admin.role !== "ADMIN") throw new ReviewError("Only administrators can do this.", 403);
  const why = reason?.trim();
  if (hidden && (!why || why.length < 3)) throw new ReviewError("Give a reason for hiding the review.", 400);
  const r = await prisma.orderReview.updateMany({
    where: { id: reviewId },
    data: hidden ? { hiddenAt: new Date(), hiddenById: adminId, hiddenReason: why!.slice(0, 300) } : { hiddenAt: null, hiddenById: null, hiddenReason: null },
  });
  if (r.count === 0) throw new ReviewError("Review not found.", 404);
  await audit({ actorId: adminId, action: hidden ? "REVIEW_HIDDEN" : "REVIEW_SHOWN", entityType: "orderReview", entityId: reviewId, metadata: { reason: why ?? null } });
  return { hidden };
}

export interface RatingSummary {
  count: number;
  average: number | null;
  fiveStarPercent: number | null;
  tags: { tag: string; count: number }[];
}

/** Visible reviews only. */
export async function ratingSummary(boosterId: string): Promise<RatingSummary> {
  const rows = await prisma.orderReview.findMany({ where: { boosterId, hiddenAt: null }, select: { rating: true, tags: true } });
  if (rows.length === 0) return { count: 0, average: null, fiveStarPercent: null, tags: [] };
  const tagCounts = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  return {
    count: rows.length,
    average: Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 10) / 10,
    fiveStarPercent: Math.round((rows.filter((r) => r.rating === 5).length / rows.length) * 100),
    tags: [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
  };
}

export async function publicReviews(boosterId: string, take = 20) {
  return prisma.orderReview.findMany({
    where: { boosterId, hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, rating: true, tags: true, text: true, reply: true, createdAt: true, order: { select: { gameSlug: true, serviceSlug: true } } },
  });
}

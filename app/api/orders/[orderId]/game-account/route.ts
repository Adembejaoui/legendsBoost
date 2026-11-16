import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { riotIdSchema, sameRiotId } from "@/lib/services/games/league-of-legends/account.service";
import { riotPlatformSchema } from "@/lib/services/games/league-of-legends/routing";
import { getRiotAccountLock } from "@/lib/orders/riot-account-lock";
import { recordOrderEvent } from "@/lib/orders/tracking-service";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { checkRiotIdExists, type RiotIdCheck } from "@/lib/services/games/league-of-legends/riot-id-verification";
import { Prisma } from "@/app/generated/prisma/client";

/**
 * Riot account identification for an order.
 *
 * Only the public Riot ID (game name + tagline) and region are accepted here.
 * Login details are stored separately, encrypted (account-credentials).
 *
 * Existence check: a NEW or CHANGED Riot ID is looked up on Riot before it is
 * saved (riot-id-verification.ts). A name#tag that does not exist, or that
 * has no League profile on the chosen server, is refused (422) and nothing
 * is stored, so later syncs never call Riot for a non-existent account. If
 * Riot cannot be asked right now the ID is saved unverified (MANUAL) with a
 * warning; the next sync verifies it.
 *
 * Locking (lib/orders/riot-account-lock.ts): once boosting has started, or
 * once any order match exists, the account cannot be re-pointed. Order
 * matches are NEVER deleted by this route. The lock is re-checked inside the
 * same transaction as the write.
 */
const schema = riotIdSchema.extend({ platform: riotPlatformSchema });

class LockedError extends Error {}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function lockFor(tx: Tx, orderId: string, baselineAt: Date | null | undefined, isAdmin: boolean) {
  const [assignments, matchCount] = await Promise.all([
    tx.orderBoosterAssignment.findMany({ where: { orderId }, select: { startedAt: true, status: true } }),
    tx.orderMatch.count({ where: { orderId } }),
  ]);
  return getRiotAccountLock({ baselineAt, assignments, matchCount }, isAdmin);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (!g.access.canEditRiotAccount) return forbidden("You cannot change the Riot account on this order.");
    const isAdmin = g.access.viewerRole === "admin";

    const body = await req.json().catch(() => ({}));
    // Backward compatibility with the previous { gameName, tagline } payload.
    const parsed = schema.safeParse({ ...body, tagLine: body?.tagLine ?? body?.tagline });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { gameName, tagLine, platform } = parsed.data;

    // 1. Before calling Riot: is this actually a change, and is it allowed?
    const before = await prisma.orderRiotAccount.findUnique({ where: { orderId } });
    const isChange = !before || !sameRiotId(before, { gameName, tagLine }) || before.platform !== platform;
    let check: RiotIdCheck | null = null;
    if (isChange) {
      if (before) {
        const lock = await lockFor(prisma as unknown as Tx, orderId, before.baselineAt, isAdmin);
        if (lock.locked) return NextResponse.json({ error: lock.message }, { status: 409 });
      }
      // Each lookup costs Riot calls: limit it per user.
      const limit = await sharedRateLimit("riot-id-check", g.user.id, LIMITS.riotIdCheckPerUser);
      if (!limit.success) return NextResponse.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });

      // 2. Does the account exist on Riot, on this server?
      check = await checkRiotIdExists(platform, gameName, tagLine, { orderId });
      if (check.status === "not_found") {
        return NextResponse.json({ error: check.message, code: "not_found" }, { status: 422 });
      }
      if (check.status === "wrong_region") {
        return NextResponse.json(
          { error: check.message, code: "wrong_region", suggestedPlatform: check.suggestedPlatform },
          { status: 422 }
        );
      }
    }
    const verified = check?.status === "verified" ? check : null;
    // Store Riot's canonical spelling when we have it.
    const name = verified?.gameName ?? gameName;
    const tag = verified?.tagLine ?? tagLine;
    const identity = verified
      ? { puuid: verified.puuid, linkStatus: "RESOLVED" as const, regionVerifiedAt: new Date() }
      : { puuid: null, linkStatus: "MANUAL" as const, regionVerifiedAt: null };

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.orderRiotAccount.findUnique({ where: { orderId } });
      // Riot IDs are case-insensitive: a capitalisation change is the same account.
      const changed = !existing || !sameRiotId(existing, { gameName, tagLine }) || existing.platform !== platform;
      if (!changed) return { account: existing!, changed: false };

      if (existing) {
        const lock = await lockFor(tx, orderId, existing.baselineAt, isAdmin);
        if (lock.locked) throw new LockedError(lock.message);
      }

      const account = await tx.orderRiotAccount.upsert({
        where: { orderId },
        create: { orderId, gameName: name, tagLine: tag, platform, ...identity },
        update: {
          gameName: name,
          tagLine: tag,
          platform,
          // A different Riot ID or region: drop everything derived from the
          // old one. (No order match can exist here: the lock refuses that.)
          ...identity,
          profile: Prisma.DbNull,
          profileSyncedAt: null,
          observedTier: null,
          observedDivision: null,
          observedLp: null,
          observedAt: null,
          lastSyncedAt: null,
          lastSyncError: null,
          lastSyncErrorCode: null,
          baselineTier: null,
          baselineDivision: null,
          baselineLp: null,
          baselineAt: null,
          baselineSource: null,
          matchScanUntil: null,
          pendingMatchIds: [],
        },
      });
      return { account, changed: true };
    });

    if (result.changed) {
      await recordOrderEvent({
        orderId,
        type: "RIOT_ACCOUNT_UPDATED",
        actorUserId: g.user.id,
        message: "Riot account details updated",
      });
    }

    const a = result.account;
    return NextResponse.json({
      account: { gameName: a.gameName, tagLine: a.tagLine, platform: a.platform, linkStatus: a.linkStatus },
      changed: result.changed,
      verified: result.changed ? !!verified : a.linkStatus !== "MANUAL",
      ...(check?.status === "unverified" ? { warning: check.message } : {}),
    });
  } catch (error) {
    if (error instanceof LockedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

/** Unlink: allowed only while the account is not locked. Never deletes order matches. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (!g.access.canEditRiotAccount) return forbidden("You cannot change the Riot account on this order.");
    const isAdmin = g.access.viewerRole === "admin";

    const removed = await prisma.$transaction(async (tx) => {
      const existing = await tx.orderRiotAccount.findUnique({ where: { orderId } });
      if (!existing) return false;
      const lock = await lockFor(tx, orderId, existing.baselineAt, isAdmin);
      if (lock.locked) throw new LockedError(lock.message);
      await tx.orderRiotAccount.delete({ where: { orderId } });
      return true;
    });
    if (removed) {
      await recordOrderEvent({
        orderId,
        type: "RIOT_ACCOUNT_UPDATED",
        actorUserId: g.user.id,
        message: "Riot account unlinked",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof LockedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { checkForNewGame } from "@/lib/services/games/league-of-legends/auto-sync.service";

/**
 * POST: "has a new game been played?" Called by the open order page about
 * once a minute. Runs a full Riot sync only when a new game (or the periodic
 * refresh) is due; otherwise it costs one Riot call. Returns { changed } so
 * the page reloads its data only when something new was stored.
 *
 * Throttled per order (shared by everyone viewing it) and per user, on top
 * of the shared Riot rate limiter and the per-order sync lease.
 */
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  if (!g.access.canSyncRiot) return forbidden("Riot sync is not available for this order.");

  const perUser = await sharedRateLimit("riot-check", `${g.user.id}:${orderId}`, LIMITS.riotCheckPerUser);
  const perOrder = await sharedRateLimit("riot-check-order", orderId, LIMITS.riotCheckPerOrder);
  if (!perUser.success || !perOrder.success) {
    return NextResponse.json({ changed: false, reason: "throttled" }, { headers: { "Cache-Control": "no-store" } });
  }

  const result = await checkForNewGame(orderId);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

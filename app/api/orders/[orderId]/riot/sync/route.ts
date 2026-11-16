import { NextResponse } from "next/server";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { syncOrderRiotData } from "@/lib/services/games/league-of-legends/sync.service";

/**
 * Refresh this order's Riot data (rank + attributed matches) through the
 * official, server-side Riot APIs.
 *  - Per user+order limit (below) stops one browser from hammering the route.
 *  - Riot's per-key/per-region limits are enforced across all instances by
 *    the shared limiter in the Riot client; concurrent syncs of the same
 *    order are refused by the sync lease (409 "busy").
 */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const g = await guardWorkspace(orderId);
  if (!g.ok) return g.response;
  if (!g.access.canSyncRiot) return forbidden("Riot sync is not available for this order.");

  const limit = await sharedRateLimit("riot-sync", `${g.user.id}:${orderId}`, LIMITS.riotSyncPerUser);
  if (!limit.success) {
    return NextResponse.json(
      { status: "error", reason: "Please wait a minute before syncing again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const outcome = await syncOrderRiotData(orderId);
  const httpStatus: Record<typeof outcome.status, number> = {
    synced: 200,
    unavailable: 503,
    needs_account: 409,
    account_error: 422,
    busy: 409,
    error: outcome.status === "error" && outcome.retryAfterSec ? 429 : 502,
  };
  const headers: Record<string, string> = {};
  if (outcome.status === "error" && outcome.retryAfterSec) headers["Retry-After"] = String(outcome.retryAfterSec);
  return NextResponse.json(outcome, { status: httpStatus[outcome.status], headers });
}

// Server-only module: never import from a "use client" file.
import prisma from "@/lib/prisma";
import { getRiotCapabilities } from "./capabilities";
import { RiotApiError, RiotRateLimitedError, type RiotClient } from "./riot-client";
import { getRiotClient } from "./shared-client";
import { fetchLatestMatchIds, readRiotProfile } from "./profile.service";
import { isRiotPlatform } from "./routing";
import { syncOrderRiotData, type SyncOutcome } from "./sync.service";
import type { RiotPlatform } from "./riot.types";
import { getConfig } from "@/lib/config";

/**
 * Automatic refresh for the order page ("is there a new game?").
 *
 * The page calls this about once a minute while it is open. It costs ONE
 * Riot call (the newest match id) unless something changed:
 *  - no PUUID / no profile yet           -> full sync;
 *  - newest match id differs from stored -> full sync (new game played);
 *  - last full sync older than FULL_REFRESH_MS -> full sync (rank / live
 *    game can change without a finished game, e.g. a game just started).
 * Otherwise nothing is written and `changed` is false.
 */
export const FULL_REFRESH_MS = 5 * 60_000;

export type AutoSyncResult =
  | { changed: false; reason: "up_to_date" | "unavailable" | "needs_account" | "rate_limited" | "error" }
  | { changed: true; trigger: "first_sync" | "new_game" | "periodic"; outcome: SyncOutcome["status"] };

export async function checkForNewGame(
  orderId: string,
  opts: { client?: RiotClient; now?: Date } = {}
): Promise<AutoSyncResult> {
  if (!getRiotCapabilities().dataAccess) return { changed: false, reason: "unavailable" };
  if ((await getConfig("tracker_provider")) !== "riot") return { changed: false, reason: "unavailable" };
  const now = opts.now ?? new Date();
  const account = await prisma.orderRiotAccount.findUnique({
    where: { orderId },
    select: { puuid: true, platform: true, profile: true, profileSyncedAt: true, syncLeaseUntil: true, lastSyncErrorCode: true },
  });
  if (!account?.platform || !isRiotPlatform(account.platform)) return { changed: false, reason: "needs_account" };
  // Riot already said this name#tag does not exist / is not on this server:
  // never call Riot again automatically. The customer must correct the Riot ID
  // (which resets this code), or someone presses "Sync" manually.
  if (account.lastSyncErrorCode === "not_found" || account.lastSyncErrorCode === "wrong_region") {
    return { changed: false, reason: "needs_account" };
  }
  // Another sync is running for this order: let it finish.
  if (account.syncLeaseUntil && account.syncLeaseUntil > now) return { changed: false, reason: "up_to_date" };

  const profile = readRiotProfile(account.profile);
  const run = async (trigger: "first_sync" | "new_game" | "periodic"): Promise<AutoSyncResult> => {
    const outcome = await syncOrderRiotData(orderId, { client: opts.client, now });
    // Even a failed sync may have stored an error message worth showing.
    if (outcome.status === "busy") return { changed: false, reason: "up_to_date" };
    return { changed: true, trigger, outcome: outcome.status };
  };

  if (!account.puuid || !profile || !account.profileSyncedAt) return run("first_sync");

  try {
    const [latest] = await fetchLatestMatchIds(
      opts.client ?? getRiotClient(),
      account.platform as RiotPlatform,
      account.puuid,
      1,
      { orderId }
    );
    if ((latest ?? null) !== profile.latestMatchId) return run("new_game");
  } catch (error) {
    if (error instanceof RiotRateLimitedError) return { changed: false, reason: "rate_limited" };
    if (error instanceof RiotApiError) return { changed: false, reason: "error" };
    throw error;
  }

  const fullRefreshMs = (await getConfig("riot_full_refresh_min")) * 60_000;
  if (now.getTime() - account.profileSyncedAt.getTime() >= fullRefreshMs) return run("periodic");
  return { changed: false, reason: "up_to_date" };
}

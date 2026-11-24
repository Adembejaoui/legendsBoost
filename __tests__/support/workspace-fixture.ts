import type { WorkspaceDTO, WorkspaceMatchDTO } from "@/lib/orders/workspace-types";

/**
 * In-memory WorkspaceDTO for UI tests. Contains no real customer data and is
 * never written anywhere.
 */
export type FixtureGame = "league-of-legends" | "valorant" | "teamfight-tactics";
export type FixtureRole = "customer" | "booster" | "admin";

const GAME_NAME: Record<FixtureGame, string> = {
  "league-of-legends": "League of Legends",
  valorant: "VALORANT",
  "teamfight-tactics": "Teamfight Tactics",
};

export function fixtureMatches(n: number): WorkspaceMatchDTO[] {
  const base = Date.UTC(2026, 10, 12, 20, 0, 0);
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    matchId: `EUW1_${7000 - i}`,
    win: i % 3 !== 1,
    championName: ["Ahri", "Lee Sin", "Jinx", "Thresh", "Garen"][i % 5],
    championIcon: null,
    kills: 4 + (i % 7),
    deaths: 1 + (i % 4),
    assists: 6 + (i % 5),
    cs: 150 + i * 7,
    durationSec: 1500 + i * 37,
    queue: "Ranked Solo/Duo",
    playedAt: new Date(base - i * 3_600_000).toISOString(),
    playedBy: "BOOSTER" as const,
    lpDelta: null,
  }));
}

export function workspaceFixture(
  opts: {
    role?: FixtureRole;
    status?: string;
    game?: FixtureGame;
    matches?: number;
    paused?: boolean;
    chat?: boolean;
  } = {}
): WorkspaceDTO {
  const role = opts.role ?? "customer";
  const game = opts.game ?? "league-of-legends";
  const status = opts.status ?? (opts.paused ? "PAUSED" : "IN_PROGRESS");
  const paused = status === "PAUSED";
  const working = status === "IN_PROGRESS" || paused;
  const lol = game === "league-of-legends";
  const matches = fixtureMatches(lol ? opts.matches ?? 12 : 0);
  const icon = (sys: string, tier: string) =>
    sys === "valorant" ? `/images/ranks/valorant-rank-icons/${tier}.webp` : `/images/ranks/lol-rank-images/${tier}.webp`;
  const sys = game === "valorant" ? "valorant" : "lol";

  return {
    viewer: { id: `${role}-1`, name: role === "customer" ? "Test Customer" : role === "booster" ? "Test Booster" : "Admin", image: null, role },
    access: {
      readOnly: !["PENDING", "IN_PROGRESS", "PAUSED"].includes(status),
      canChat: opts.chat ?? true,
      canManageAssignment: role === "booster" && working,
      canCompleteOrder: role === "booster" && status === "IN_PROGRESS",
      canAbandonOrder: role === "booster" && status === "IN_PROGRESS",
    canStartOrder: false,
      canPauseOrder: role === "customer" && status === "IN_PROGRESS",
      canResumeOrder: role === "customer" && paused,
      canEditRiotAccount: false,
      canSyncRiot: role !== "booster",
      canManageDraft: false,
      canCancelOrder: role === "customer" && status === "AWAITING_PAYMENT",
    },
    order: {
      id: "cfixture000000000order0001",
      shortId: "ORDER0001",
      gameSlug: game,
      gameName: GAME_NAME[game],
      gameImage: null,
      serviceSlug: "rank-boost",
      serviceName: "Rank Boost",
      status,
      statusLabel: paused ? "Paused" : status === "IN_PROGRESS" ? "In progress" : status.charAt(0) + status.slice(1).toLowerCase(),
      statusDescription: paused ? "Work on this order is paused and can be resumed." : "A booster is working on this order.",
      createdAt: "2026-11-10T10:00:00.000Z",
      completedAt: status === "COMPLETED" ? "2026-11-12T10:00:00.000Z" : null,
      platform: lol ? "EUW1" : null,
      platformLabel: lol ? "Europe West" : null,
      mode: "Solo",
      options: ["Priority", "Stream games"],
      rules: [],
      price: "89.90",
      currency: "EUR",
      boosterPayout: null,
      details: [
        { label: "Current rank", value: game === "valorant" ? "Gold 2" : "Gold IV" },
        { label: "Target rank", value: game === "valorant" ? "Platinum 1" : "Platinum IV" },
      ],
    },
    people: {
      customerName: "Test Customer",
      customerEmail: role === "admin" ? "customer@example.test" : null,
      boosterName: status === "PENDING" ? null : "Test Booster",
      boosterEmail: null,
    },
    assignment: role === "booster" && working ? { id: "as-1", status: paused ? "PAUSED" : "IN_PROGRESS" } : null,
    riot: {
      account: {
        gameName: "TestSummoner",
        tagLine: "EUW",
        platform: lol ? "EUW1" : null,
        linkStatus: "RESOLVED",
        lastSyncedAt: "2026-11-13T09:00:00.000Z",
        lastSyncError: null,
        lastSyncErrorCode: null,
        pendingMatches: 0,
        regionVerified: true,
        platformUnsupported: null,
        locked: true,
        lockMessage: "Locked while the order is being worked on.",
      },
      capabilities: { dataAccess: true, rso: false, reason: null },
      profile: null,
      platforms: [{ value: "EUW1", label: "Europe West (EUW1)" }],
    },
    ranks: {
      start: {
        tier: "GOLD",
        division: game === "valorant" ? "2" : "IV",
        lp: 0,
        label: game === "valorant" ? "Gold 2" : "Gold IV",
        iconSrc: icon(sys, "gold"),
        source: "order",
        at: null,
        lpAssumed: true,
      },
      current: lol
        ? { tier: "GOLD", division: "I", lp: 64, label: "Gold I · 64 LP", iconSrc: icon(sys, "gold"), source: "riot", at: "2026-11-13T09:00:00.000Z", lpAssumed: false }
        : null,
      target: {
        tier: "PLATINUM",
        division: game === "valorant" ? "1" : "IV",
        lp: 0,
        label: game === "valorant" ? "Platinum 1" : "Platinum IV",
        iconSrc: icon(sys, "platinum"),
        source: "order",
        at: null,
        lpAssumed: true,
      },
      tracking: lol ? "riot" : "unsupported",
    },
    progress: lol
      ? { kind: "rank", status: "in_progress", percent: 81, lpDelta: 364, lpRemaining: 36, stepsDelta: 3, demoted: false, stale: false, startLpAssumed: true }
      : { kind: "none", status: "unavailable", percent: null, lpDelta: null, lpRemaining: null, stepsDelta: null, demoted: false, stale: false, startLpAssumed: false },
    preferences: { roles: [{ id: "mid", label: "Mid" }], champions: [] },
    matches: { matches: matches.slice(0, 10), nextCursor: matches.length > 10 ? "m-9" : null, total: matches.length },
    pause: paused ? { since: "2026-11-13T08:30:00.000Z", byCustomer: true } : null,
    abandonment: null,
    conversationId: opts.chat === false ? null : "conv-1",
    cancellation: { canRequest: false, latest: null },
    customerActions:
      role === "customer"
        ? { hasBooster: true, boosterChange: { canRequest: true, latest: null }, nextPokeAt: null }
        : null,
    credentials: {
      configured: true,
      saved: false,
      usernameHint: null,
      updatedAt: null,
      revealCount: 0,
      lastRevealedAt: null,
      canEdit: false,
      canReveal: false,
      canDelete: false,
      duo: false,
      sessionRequired: false,
    },
    sessions: { canManage: false, open: null, recent: [], rules: [] },
    adminCompletion: null,
    completion: { request: null, canConfirm: false, canDispute: false, canDecide: false, autoConfirmHours: 72 },
    updates: { list: [], games: null, canPost: false, pointsLabel: "LP", rankOptions: [], selfCheck: null, stale: false },
    releaseGraceUntil: null,
    feedback: { review: null, tags: [], canReview: false, canReply: false, canHide: false, canTip: false, tipped: null, cashback: null },
  };
}

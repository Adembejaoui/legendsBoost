/**
 * Serializable view model for the order workspace. Browser-safe: contains no
 * PUUIDs, API keys, emails (except for admins) or internal metadata.
 */
import type { WorkspaceViewerRole } from "./workspace-access";

export interface WorkspaceRankDTO {
  tier: string;
  division: string | null;
  lp: number;
  label: string;
  iconSrc: string | null;
  /** booster = reported by the booster; order = declared at checkout; riot = legacy Riot data. */
  source: "riot" | "order" | "booster";
  at: string | null;
  lpAssumed: boolean;
}

export interface WorkspaceProgressDTO {
  kind: "rank" | "wins" | "none";
  /** waiting = no rank reported by the booster yet. */
  status: "unavailable" | "invalid" | "waiting" | "in_progress" | "complete" | "indeterminate";
  percent: number | null;
  lpDelta: number | null;
  lpRemaining: number | null;
  stepsDelta: number | null;
  demoted: boolean;
  stale: boolean;
  startLpAssumed: boolean;
  wins?: { attributed: number; ordered: number | null };
  /**
   * Rank orders: the target rank the booster still has to post in Rank
   * Update before completing ("Gold IV"), or null when nothing is missing.
   */
  finalRankMissing?: string | null;
}

export interface WorkspaceMatchDTO {
  id: string;
  matchId: string;
  win: boolean;
  championName: string;
  championIcon: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  durationSec: number;
  queue: string;
  playedAt: string;
  /** BOOSTER (counts for the order), CUSTOMER or PAUSED. */
  playedBy: "BOOSTER" | "CUSTOMER" | "PAUSED";
  /** LP won / lost in this game, when it can be told from rank snapshots. */
  lpDelta: number | null;
}

/** Riot profile snapshot (refreshed by each sync). League of Legends only. */
export interface WorkspaceRiotProfileDTO {
  syncedAt: string | null;
  level: number | null;
  iconUrl: string | null;
  /** Region Riot reports the account currently plays on. */
  activeRegion: string | null;
  ranked: {
    queue: string;
    label: string;
    tier: string | null;
    division: string | null;
    lp: number;
    wins: number;
    losses: number;
    winRate: number | null;
    iconSrc: string | null;
  }[] | null;
  mastery: { championId: number; name: string; icon: string | null; level: number; points: number }[] | null;
  liveGame: { inGame: boolean; championName: string | null; championIcon: string | null; queue: string | null; startedAt: string | null } | null;
  /** Last games on the account (any queue), newest first. */
  recentMatches: {
    matchId: string;
    championName: string;
    championIcon: string | null;
    win: boolean;
    remake: boolean;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    durationSec: number;
    queue: string;
    endedAt: string | null;
  }[] | null;
}

/** Encrypted game-account login (status only; the password is never in this DTO). */
export interface WorkspaceCredentialsDTO {
  /** Server has an encryption key configured. */
  configured: boolean;
  saved: boolean;
  usernameHint: string | null;
  updatedAt: string | null;
  revealCount: number;
  lastRevealedAt: string | null;
  canEdit: boolean;
  canReveal: boolean;
  canDelete: boolean;
  /** Duo order: no login is shared. */
  duo: boolean;
  /** Booster must start a session before revealing. */
  sessionRequired: boolean;
}

export interface WorkspaceSessionDTO {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface WorkspaceSessionsDTO {
  /** The viewer is the booster working on the order and may start / end sessions. */
  canManage: boolean;
  open: WorkspaceSessionDTO | null;
  recent: WorkspaceSessionDTO[];
  rules: string[];
}

export interface WorkspaceMatchPage {
  matches: WorkspaceMatchDTO[];
  nextCursor: string | null;
  total: number;
}

export interface WorkspaceDTO {
  viewer: {
    id: string;
    name: string | null;
    image: string | null;
    role: WorkspaceViewerRole;
  };
  access: {
    readOnly: boolean;
    canChat: boolean;
    canManageAssignment: boolean;
    /** Booster: complete / abandon (false while paused). */
    canCompleteOrder: boolean;
    canAbandonOrder: boolean;
    /** Booster: start a claimed order. */
    canStartOrder: boolean;
    /** Customer owner: pause / resume. */
    canPauseOrder: boolean;
    canResumeOrder: boolean;
    canEditRiotAccount: boolean;
    canSyncRiot: boolean;
    canManageDraft: boolean;
    /** Owning customer may cancel this unpaid order (server-computed). */
    canCancelOrder: boolean;
  };
  order: {
    id: string;
    shortId: string;
    gameSlug: string;
    gameName: string;
    gameImage: string | null;
    serviceSlug: string;
    serviceName: string;
    status: string;
    statusLabel: string;
    statusDescription: string;
    createdAt: string;
    completedAt: string | null;
    platform: string | null;
    platformLabel: string | null;
    mode: string | null;
    options: string[];
    /** What the booster must follow for each bought extra (client PDFs 2026-11-19). */
    rules: { label: string; rule: string }[];
    /** What the customer paid. Null for boosters (they never see it). */
    price: string | null;
    currency: string | null;
    /** Booster viewer only: their agreed payout (winning bid, claim now...), minor units. */
    boosterPayout: { amount: number; currency: string } | null;
    details: { label: string; value: string }[];
  };
  people: {
    customerName: string | null;
    customerEmail: string | null; // admin only
    boosterName: string | null;
    boosterEmail: string | null; // admin only
  };
  assignment: { id: string; status: string } | null;
  riot: {
    account: {
      gameName: string;
      tagLine: string;
      platform: string | null;
      linkStatus: "MANUAL" | "RESOLVED" | "RSO_VERIFIED";
      lastSyncedAt: string | null;
      lastSyncError: string | null;
      /** e.g. "wrong_region", "not_found", "rate_limited" */
      lastSyncErrorCode: string | null;
      /** Match ids discovered but not processed yet (more syncs needed). */
      pendingMatches: number;
      /** Summoner-V4 confirmed a League profile on the selected region. */
      regionVerified: boolean;
      /** Set when the stored region is no longer supported. */
      platformUnsupported: string | null;
      locked: boolean;
      lockMessage: string | null;
    } | null;
    capabilities: { dataAccess: boolean; rso: boolean; reason: string | null };
    profile: WorkspaceRiotProfileDTO | null;
    platforms: { value: string; label: string }[];
  };
  ranks: {
    start: WorkspaceRankDTO | null;
    /** Riot-observed only (never manually reported). Null when unavailable. */
    current: WorkspaceRankDTO | null;
    target: WorkspaceRankDTO | null;
    /**
     * riot: this game's current rank is synchronised automatically.
     * unsupported: no automatic rank source for this game (VALORANT, TFT),
     * so only the ordered start and target ranks are shown.
     */
    tracking: "riot" | "booster" | "unsupported";
  };
  /** Booster progress updates (decision 2026-11-17: replaces Riot tracking). */
  updates: {
    list: { id: string; label: string; tierId: string; divisionId: string | null; lp: number | null; iconSrc: string | null; at: string }[];
    /** The working booster may post an update now. */
    canPost: boolean;
    /** "LP" (League, TFT) or "RR" (VALORANT). */
    pointsLabel: "LP" | "RR";
    /** Ranks the booster can pick (the order's rank system), lowest first. */
    rankOptions: { tierId: string; name: string; iconSrc: string | null; divisions: { id: string; label: string }[] }[];
    /** Public profile link for the customer to check the rank (OP.GG / tracker.gg). */
    selfCheck: { label: string; url: string } | null;
    /** No update for 24 h while in progress. */
    stale: boolean;
  };
  progress: WorkspaceProgressDTO;
  preferences: {
    roles: { id: string; label: string }[];
    champions: { id: string; name: string; icon: string | null }[];
  };
  matches: WorkspaceMatchPage;
  /** Set while the order is PAUSED. */
  pause: { since: string | null; byCustomer: boolean } | null;
  abandonment: { reason: string | null; at: string; boosterName: string | null } | null;
  conversationId: string | null;
  credentials: WorkspaceCredentialsDTO;
  sessions: WorkspaceSessionsDTO;
  /** Completion with proof (decision 2026-11-16): latest request and what the viewer may do. */
  completion: {
    request: {
      id: string;
      status: string;
      submittedAt: string;
      autoConfirmAt: string;
      boosterNote: string | null;
      disputeReason: string | null;
      disputedAt: string | null;
      adminNote: string | null;
      decidedAt: string | null;
      proofs: { id: string; url: string }[];
    } | null;
    /** Customer: confirm (pending or disputed request). */
    canConfirm: boolean;
    /** Customer: report a problem (pending request). */
    canDispute: boolean;
    /** Admin: complete or send back (pending or disputed request). */
    canDecide: boolean;
    autoConfirmHours: number;
  };
  /** Admin only: the in-progress assignment an admin may complete (no Riot check). */
  adminCompletion: { assignmentId: string } | null;
  /** Booster on a claimed, not started order: free release (no strike) until this time. */
  releaseGraceUntil: string | null;
  /** Phase 8: review and tips of a completed order. */
  feedback: {
    review: {
      id: string;
      rating: number;
      tags: string[];
      text: string | null;
      reply: string | null;
      hidden: boolean;
      hiddenReason: string | null;
    } | null;
    tags: string[];
    canReview: boolean;
    canReply: boolean;
    canHide: boolean;
    canTip: boolean;
    /** Customer: total they tipped; booster: their share of tips. */
    tipped: { amount: number; currency: string } | null;
  };
  /** Customer cancellation request (admin-reviewed); customers never cancel directly. */
  cancellation: {
    canRequest: boolean;
    latest: {
      id: string;
      status: "REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";
      reason: string;
      createdAt: string;
      adminNote: string | null;
      decidedAt: string | null;
      refundAmount: number | null;
    } | null;
  };
  /** Customer header actions (client PDF 2026-11-21). Null for boosters and admins. */
  customerActions: {
    /** A booster holds the order (Change booster / Poke apply). */
    hasBooster: boolean;
    boosterChange: {
      canRequest: boolean;
      latest: { status: "REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN"; adminNote: string | null; createdAt: string } | null;
    };
    /** ISO time the customer may poke again; null = now. */
    nextPokeAt: string | null;
  } | null;
}

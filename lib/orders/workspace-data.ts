import prisma from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/guards";
import { getGame } from "@/lib/catalog/games";
import { getServiceTemplate } from "@/lib/catalog/service-templates";
import { getGameServiceOffer } from "@/lib/catalog/game-services";
import { getTier, getDivision, formatRankLabel } from "@/lib/catalog/rank-systems";
import { getChampion } from "@/lib/catalog/champions";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getStatusConfig } from "@/lib/orders/status-display";
import { resolveWorkspaceAccess } from "./workspace-access";
import type {
  WorkspaceDTO,
  WorkspaceMatchDTO,
  WorkspaceMatchPage,
  WorkspaceRankDTO,
} from "./workspace-types";
import {
  allowedRankOptions,
  computeReportedProgress,
  listProgressUpdates,
  missingFinalRank,
  orderRankSystemId,
  pointsLabel,
  PROGRESS_REMINDER_HOURS,
  rankRefOf,
  selfCheckLink,
} from "./progress-updates.service";
import { getRiotCapabilities, publicRiotCapabilities } from "@/lib/services/games/league-of-legends/capabilities";
import {
  RIOT_PLATFORMS,
  RIOT_PLATFORM_LABELS,
  isRiotPlatform,
  unsupportedPlatformReason,
} from "@/lib/services/games/league-of-legends/routing";
import { getRiotAccountLock } from "@/lib/orders/riot-account-lock";
import { QUEUE_LABELS } from "@/lib/services/games/league-of-legends/match-history.service";
import {
  championIconUrl,
  getDdragonVersion,
  getDdragonChampionMap,
  resolveMatchChampion,
  type DdragonChampionMap,
  toDdragonChampionId,
} from "@/lib/services/games/league-of-legends/champion-assets";
import type { RiotPlatform } from "@/lib/services/games/league-of-legends/riot.types";
import { getMessages, getOrCreateConversation } from "@/lib/chat/service";
import { canRequestCancellation } from "./cancellation-request.service";
import { HELD_ASSIGNMENT_STATUSES } from "./booster-change.service";
import { nextPokeAt } from "./poke.service";
import { TIPPABLE_ORDER } from "@/lib/tips/service";
import { credentialPermissions, getCredentialStatus } from "./account-credentials.service";
import { credentialsConfigured } from "@/lib/security/account-credentials";
import { getOpenSession, listSessions, SESSION_RULES } from "./sessions.service";
import { getConfig } from "@/lib/config";
import { REVIEW_TAGS } from "@/lib/reviews/service";
import { latestCompletionRequest } from "./completion-request.service";
import { vpnCountryName } from "@/lib/catalog/vpn-countries";

/** Review and tips block of the order page (Phase 8). */
async function feedbackFor(orderId: string, status: string, role: string, viewerId: string): Promise<WorkspaceDTO["feedback"]> {
  const [review, tips] = await Promise.all([
    prisma.orderReview.findUnique({ where: { orderId } }),
    prisma.orderTip.findMany({ where: { orderId, status: "PAID" }, select: { amount: true, boosterAmount: true, boosterId: true, currency: true } }),
  ]);
  const completed = status === "COMPLETED";
  const isCustomer = role === "customer";
  const isBooster = role === "booster";
  // The review is shown to the people of the order; a hidden one only to admins and its booster/customer with a note.
  const shown = review && (role === "admin" || isCustomer || (isBooster && review.boosterId === viewerId)) ? review : null;
  const mine = isBooster ? tips.filter((t) => t.boosterId === viewerId) : tips;
  const tippedAmount = mine.reduce((a, t) => a + (isBooster ? t.boosterAmount : t.amount), 0);
  return {
    review: shown
      ? { id: shown.id, rating: shown.rating, tags: shown.tags, text: shown.text, reply: shown.reply, hidden: !!shown.hiddenAt, hiddenReason: role === "admin" ? shown.hiddenReason : null }
      : null,
    tags: [...REVIEW_TAGS],
    canReview: isCustomer && completed && !review,
    canReply: isBooster && !!review && review.boosterId === viewerId && !review.reply,
    canHide: role === "admin" && !!review,
    // Processing or Completed (client PDF 2026-11-22).
    canTip: isCustomer && (TIPPABLE_ORDER as readonly string[]).includes(status),
    tipped: (isCustomer || isBooster) && tippedAmount > 0 ? { amount: tippedAmount, currency: mine[0].currency } : null,
  };
}

/** End of the free-release window, only while it is still open. */
function graceUntilIfOpen(assignedAt: Date, graceMin: number): string | null {
  const until = assignedAt.getTime() + graceMin * 60_000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

export const MATCH_PAGE_SIZE = 10;

const ROLE_LABELS: Record<string, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  adc: "ADC",
  support: "Support",
};

/**
 * Only these order events are read by the workspace: the latest pause (for
 * the PAUSED banner) and abandonment (admin review). The order activity
 * timeline was removed from the workspace; events are still recorded and
 * kept as operational history (and pause events drive match attribution).
 */
const WORKSPACE_EVENT_TYPES = ["ORDER_PAUSED", "BOOSTER_ABANDONED"];

/**
 * A rank declared on the order, read straight from the game's catalog rank
 * system (VALORANT tiers/divisions, TFT tiers...). No LP: none is known.
 */
function catalogRankDTO(rankSystemId: string, value: unknown): WorkspaceRankDTO | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { tierId?: unknown; divisionId?: unknown };
  if (typeof v.tierId !== "string") return null;
  const tier = getTier(rankSystemId, v.tierId);
  if (!tier) return null;
  const divisionId = typeof v.divisionId === "string" ? v.divisionId : null;
  const division = divisionId ? getDivision(rankSystemId, v.tierId, divisionId)?.label ?? null : null;
  return {
    tier: tier.id.toUpperCase(),
    division,
    lp: 0,
    label: formatRankLabel(rankSystemId, { tierId: v.tierId, divisionId }),
    iconSrc: tier.iconSrc ?? null,
    source: "order",
    at: null,
    lpAssumed: true,
  };
}

function formatConfigValue(value: unknown, rankSystemId?: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object" && value && "tierId" in value && rankSystemId) {
    return formatRankLabel(rankSystemId, value as { tierId: string; divisionId: string | null });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

export function toMatchDTO(
  m: {
    id: string;
    matchId: string;
    win: boolean;
    championId: number;
    championName: string;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    durationSec: number;
    queueId: number;
    gameStartAt: Date;
    playedBy?: string | null;
    lpDelta?: number | null;
  },
  ddragonVersion: string | null,
  champions: DdragonChampionMap | null = null
): WorkspaceMatchDTO {
  const champ = resolveMatchChampion(ddragonVersion, champions, m.championId, m.championName);
  return {
    id: m.id,
    matchId: m.matchId,
    win: m.win,
    championName: champ.name,
    championIcon: champ.icon,
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    cs: m.cs,
    durationSec: m.durationSec,
    queue: QUEUE_LABELS[m.queueId] ?? `Queue ${m.queueId}`,
    playedAt: m.gameStartAt.toISOString(),
    playedBy: m.playedBy === "CUSTOMER" || m.playedBy === "PAUSED" ? m.playedBy : "BOOSTER",
    lpDelta: m.lpDelta ?? null,
  };
}

/**
 * Keyset pagination over the order's attributed matches, newest first.
 * The cursor is an OrderMatch id; it is always scoped to `orderId`, so a
 * cursor from another order can never leak that order's matches.
 */
export async function getOrderMatchPage(
  orderId: string,
  opts: { cursor?: string | null; limit?: number; ddragonVersion?: string | null } = {}
): Promise<WorkspaceMatchPage> {
  const limit = Math.min(Math.max(opts.limit ?? MATCH_PAGE_SIZE, 1), 50);
  const [rows, total] = await Promise.all([
    prisma.orderMatch.findMany({
      where: { orderId },
      orderBy: [{ gameStartAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    }),
    prisma.orderMatch.count({ where: { orderId } }),
  ]);
  // Defence in depth: a cursor row from another order is silently dropped.
  const scoped = rows.filter((r) => r.orderId === orderId);
  const page = scoped.slice(0, limit);
  const version = opts.ddragonVersion === undefined ? await getDdragonVersion() : opts.ddragonVersion;
  const champions = page.length > 0 ? await getDdragonChampionMap(version) : null;
  return {
    matches: page.map((m) => toMatchDTO(m, version, champions)),
    nextCursor: scoped.length > limit ? page[page.length - 1].id : null,
    total,
  };
}

export async function getOrderWorkspace(
  orderId: string,
  viewer: SessionUser & { name?: string | null; image?: string | null }
): Promise<WorkspaceDTO | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: { booster: { select: { id: true, name: true, email: true } } },
      },
      events: { where: { type: { in: WORKSPACE_EVENT_TYPES } }, orderBy: { createdAt: "asc" } },
      riotAccount: true,
      pricingSnapshot: { select: { id: true, boosterShareAmount: true, currency: true } },
    },
  });
  const access = resolveWorkspaceAccess(viewer, order);
  if (!order || !access) return null;
  const isAdmin = access.viewerRole === "admin";

  const game = getGame(order.gameSlug);
  const template = getServiceTemplate(order.serviceSlug);
  const offer = getGameServiceOffer(order.gameSlug, order.serviceSlug);
  const cfg = (order.configuration ?? {}) as Record<string, unknown>;
  const statusCfg = getStatusConfig(order.status);
  const ra = order.riotAccount;

  // Legacy orders stored the Riot ID inside configuration.
  const legacyName = typeof cfg.riotGameName === "string" ? cfg.riotGameName : null;
  const legacyTag = typeof cfg.riotTagline === "string" ? cfg.riotTagline : "";

  // Region: the saved Riot ID region, else the server chosen at checkout.
  const platform =
    ra?.platform && isRiotPlatform(ra.platform)
      ? (ra.platform as RiotPlatform)
      : typeof cfg.server === "string" && isRiotPlatform(cfg.server)
        ? (cfg.server as RiotPlatform)
        : null;

  // Order details: render configuration fields from the offer definition, so
  // labels are real and nothing is invented.
  const details: { label: string; value: string }[] = [];
  for (const field of offer?.fields ?? []) {
    const v = formatConfigValue(cfg[field.key], "rankSystemId" in field ? field.rankSystemId : offer?.rankSystemId);
    if (v) details.push({ label: field.label, value: v });
  }
  const notes = typeof cfg.notes === "string" ? cfg.notes : typeof cfg.additionalInfo === "string" ? cfg.additionalInfo : null;
  if (notes) details.push({ label: "Additional information", value: notes });

  const checkout = getCheckoutConfig(order.gameSlug, order.serviceSlug);
  const vpnPick = (order.championsRoles as { vpnCountry?: unknown } | null)?.vpnCountry;
  const options = order.selectedOptions.map((id) => {
    const label = checkout?.options.find((o) => o.id === id)?.label ?? id;
    return id === "vpn" && typeof vpnPick === "string" ? `${label} (${vpnCountryName(vpnPick)})` : label;
  });
  // Booster rules for the extras the customer bought.
  const otpId = (order.championsRoles as { otpChampion?: unknown } | null)?.otpChampion;
  const vpnCode = (order.championsRoles as { vpnCountry?: unknown } | null)?.vpnCountry;
  const vpnName = typeof vpnCode === "string" ? vpnCountryName(vpnCode) : null;
  const rules = order.selectedOptions.flatMap((id) => {
    const o = checkout?.options.find((x) => x.id === id);
    if (!o?.boosterRule) return [];
    const champ = id === "otp-champion" && typeof otpId === "string" ? getChampion(otpId)?.name ?? otpId : null;
    if (id === "vpn" && vpnName) return [{ label: `${o.label}: ${vpnName}`, rule: `Always use a VPN set to ${vpnName}.` }];
    return [{ label: o.label, rule: champ ? `${o.boosterRule} Champion: ${champ}.` : o.boosterRule }];
  });
  const mode = order.selectedMode
    ? checkout?.modes?.find((m) => m.id === order.selectedMode)?.label ?? order.selectedMode
    : null;

  // Ranks, each with its provenance. The current rank comes ONLY from Riot
  // (League-V4 observation). Manual rank reports were removed: any legacy
  // reported* columns on OrderRiotAccount are ignored.
  const rankField = offer?.fields.find((f) => f.key === "targetRank" || f.key === "currentRank");
  const orderSystem = orderRankSystemId(order.gameSlug, order.serviceSlug);
  const rankSystemId =
    (rankField && "rankSystemId" in rankField ? rankField.rankSystemId : undefined) ??
    offer?.rankSystemId ??
    orderSystem ??
    "lol-ranked";
  // Riot tracking is off (decision 2026-11-17): stored matches only count for the Riot ID lock.
  const matchesTotal = await prisma.orderMatch.count({ where: { orderId } });

  // Progress from the booster's reported ranks.
  const updates = await listProgressUpdates(orderId);
  const latest = updates[0] ?? null;
  const startRef = rankRefOf(rankSystemId, cfg.currentRank);
  const targetRef = rankRefOf(rankSystemId, cfg.targetRank);
  const reported = computeReportedProgress(
    rankSystemId,
    startRef,
    latest ? { tierId: latest.tierId, divisionId: latest.divisionId, lp: latest.lp } : null,
    targetRef
  );
  const staleUpdates =
    order.status === "IN_PROGRESS" &&
    Date.now() - new Date(latest?.at ?? order.assignments.find((a) => a.activeOrderId === order.id)?.startedAt ?? Date.now()).getTime() >
      PROGRESS_REMINDER_HOURS * 3_600_000;
  const finalRankMissing = targetRef ? await missingFinalRank(orderId) : null;
  const progress: WorkspaceDTO["progress"] = {
    finalRankMissing,
    kind: startRef && targetRef ? "rank" : "none",
    status: reported.status,
    percent: reported.percent,
    lpDelta: null,
    lpRemaining: null,
    stepsDelta: reported.stepsDelta,
    demoted: (reported.stepsDelta ?? 0) < 0,
    stale: staleUpdates,
    startLpAssumed: true,
  };
  const pts = pointsLabel(order.gameSlug);
  const rankOptions = orderSystem ? allowedRankOptions(orderSystem, cfg) : [];
  const currentRank: WorkspaceRankDTO | null = latest
    ? {
        tier: latest.tierId.toUpperCase(),
        division: latest.divisionId ? getDivision(rankSystemId, latest.tierId, latest.divisionId)?.label ?? null : null,
        lp: latest.lp ?? 0,
        label: latest.label + (latest.lp !== null ? ` ${latest.lp} ${pts}` : ""),
        iconSrc: latest.iconSrc,
        source: "booster",
        at: latest.at,
        lpAssumed: latest.lp === null,
      }
    : null;

  const ddragonVersion = order.gameSlug === "league-of-legends" ? await getDdragonVersion() : null;

  // Same lock rule the game-account route enforces.
  const accountLock = getRiotAccountLock(
    { baselineAt: ra?.baselineAt, assignments: order.assignments, matchCount: matchesTotal },
    isAdmin
  );

  const cr = (order.championsRoles ?? null) as { roles?: unknown; champions?: unknown } | null;
  const roles = Array.isArray(cr?.roles) ? (cr!.roles as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const champs = Array.isArray(cr?.champions)
    ? (cr!.champions as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const activeAssignment = order.assignments.find((a) => a.activeOrderId === order.id) ?? null;
  const shownBooster =
    activeAssignment ??
    (order.status === "COMPLETED" ? order.assignments.find((a) => a.status === "COMPLETED") ?? null : null);

  const abandonEvent = [...order.events].reverse().find((e) => e.type === "BOOSTER_ABANDONED");
  let abandonment: WorkspaceDTO["abandonment"] = null;
  if (abandonEvent && order.status === "DRAFT" && isAdmin) {
    const meta = (abandonEvent.metadata ?? {}) as { reason?: string | null; boosterId?: string };
    const by = order.assignments.find((a) => a.booster.id === meta.boosterId)?.booster.name ?? null;
    abandonment = { reason: meta.reason ?? null, at: abandonEvent.createdAt.toISOString(), boosterName: by };
  }

  const lastPause = [...order.events].reverse().find((e) => e.type === "ORDER_PAUSED");
  const pause: WorkspaceDTO["pause"] =
    order.status === "PAUSED"
      ? {
          since: lastPause?.createdAt.toISOString() ?? null,
          byCustomer: (lastPause?.metadata as { actorRole?: string } | null)?.actorRole === "CUSTOMER",
        }
      : null;

  // Ranks shown in the workspace. Riot-tracked games use League-V4 data;
  // others show the ordered start/target from their own rank system.
  const rankStart = catalogRankDTO(rankSystemId, cfg.currentRank);
  const rankTarget = catalogRankDTO(rankSystemId, cfg.targetRank);

  // Play sessions (required for the booster to reveal the login).
  const viewerIsWorkingBooster =
    access.viewerRole === "booster" && !access.readOnly && access.activeAssignment?.status === "IN_PROGRESS" && order.status === "IN_PROGRESS";
  const openSession = viewerIsWorkingBooster ? await getOpenSession(orderId, viewer.id) : null;
  const recentSessions = await listSessions(orderId, 10);
  // The booster's agreed payout: their assignment's (bid / claim now /
  // priority), else the order's agreed payout, else the reserved share.
  const viewerAssignment =
    access.viewerRole === "booster"
      ? order.assignments.find((a) => a.boosterId === viewer.id && (a.activeOrderId === order.id || a.status === "COMPLETED")) ?? null
      : null;
  const payoutAmount = viewerAssignment
    ? viewerAssignment.payoutAmount ?? order.boosterPayoutAmount ?? order.pricingSnapshot?.boosterShareAmount ?? null
    : null;
  const viewerPayout =
    payoutAmount !== null ? { amount: payoutAmount, currency: order.pricingSnapshot?.currency ?? order.currency ?? "EUR" } : null;

  const credPerms = credentialPermissions(access, order.status, { duo: order.selectedMode === "duo", hasOpenSession: !!openSession });
  const latestCancel = await prisma.orderCancellationRequest.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
  });
  const cancellation: WorkspaceDTO["cancellation"] = {
    canRequest:
      access.viewerRole === "customer" && canRequestCancellation(order, latestCancel?.status === "REQUESTED"),
    latest:
      latestCancel && (access.viewerRole !== "booster")
        ? {
            id: latestCancel.id,
            status: latestCancel.status,
            reason: latestCancel.reason,
            createdAt: latestCancel.createdAt.toISOString(),
            adminNote: latestCancel.adminNote,
            decidedAt: latestCancel.decidedAt?.toISOString() ?? null,
            refundAmount: latestCancel.refundAmount,
          }
        : null,
  };
  // Customer header actions: Change booster (admin-reviewed) and Poke booster.
  let customerActions: WorkspaceDTO["customerActions"] = null;
  if (access.viewerRole === "customer") {
    const held = order.assignments.some((a) => (HELD_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status));
    const latestChange = await prisma.orderBoosterChangeRequest.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" } });
    const next = nextPokeAt(order.boosterPokedAt);
    customerActions = {
      hasBooster: held,
      boosterChange: {
        canRequest: held && !!order.paymentVerifiedAt && latestChange?.status !== "REQUESTED",
        latest: latestChange
          ? { status: latestChange.status, adminNote: latestChange.adminNote, createdAt: latestChange.createdAt.toISOString() }
          : null,
      },
      nextPokeAt: next ? next.toISOString() : null,
    };
  }
  // Client PDF 2026-11-22: once the order is Completed the booster no longer
  // gets the customer's Riot ID or OP.GG link (not sent at all, even on reopen).
  const hideAccountFromBooster = access.viewerRole === "booster" && order.status === "COMPLETED";
  const credStatus = await getCredentialStatus(orderId);
  // Riot tracking is off (decision 2026-11-17): no Riot profile on the page.
  const riotProfile = null;

  let conversationId: string | null = null;
  if (access.canChat) {
    conversationId = (await getOrCreateConversation(orderId)).id;
  }

  return {
    viewer: {
      id: viewer.id,
      name: viewer.name ?? null,
      image: viewer.image ?? null,
      role: access.viewerRole,
    },
    access: {
      readOnly: access.readOnly,
      canChat: access.canChat,
      canManageAssignment: access.canManageAssignment,
      canCompleteOrder: access.canCompleteOrder,
      canAbandonOrder: access.canAbandonOrder,
      canStartOrder: access.canStartOrder,
      canPauseOrder: access.canPauseOrder,
      canResumeOrder: access.canResumeOrder,
      canEditRiotAccount: access.canEditRiotAccount && !(ra && accountLock.locked),
      canSyncRiot: access.canSyncRiot,
      canManageDraft: access.canManageDraft,
      // Customers can only pause / resume; cancelling goes through support.
      canCancelOrder: false,
    },
    order: {
      id: order.id,
      shortId: order.id.slice(-8).toUpperCase(),
      gameSlug: order.gameSlug,
      gameName: game?.name ?? order.gameSlug,
      gameImage: game?.image ?? null,
      serviceSlug: order.serviceSlug,
      serviceName: template?.title ?? offer?.title ?? order.serviceSlug,
      status: order.status,
      statusLabel: statusCfg.label,
      statusDescription: statusCfg.description,
      createdAt: order.createdAt.toISOString(),
      completedAt: order.completedAt?.toISOString() ?? null,
      platform,
      platformLabel: platform ? RIOT_PLATFORM_LABELS[platform] : null,
      mode,
      options,
      rules,
      // Boosters never receive the customer price, only their own payout.
      price: access.viewerRole === "booster" ? null : order.price?.toString() ?? null,
      currency: order.currency ?? null,
      boosterPayout: viewerPayout,
      details,
    },
    people: {
      customerName: order.user.name,
      customerEmail: isAdmin ? order.user.email : null,
      boosterName: shownBooster?.booster.name ?? null,
      boosterEmail: isAdmin ? shownBooster?.booster.email ?? null : null,
    },
    assignment: access.activeAssignment
      ? { id: access.activeAssignment.id, status: access.activeAssignment.status }
      : null,
    riot: {
      account: hideAccountFromBooster
        ? null
        : ra
        ? {
            gameName: ra.gameName,
            tagLine: ra.tagLine,
            platform,
            linkStatus: ra.linkStatus,
            lastSyncedAt: ra.lastSyncedAt?.toISOString() ?? null,
            lastSyncError: ra.lastSyncError,
            lastSyncErrorCode: ra.lastSyncErrorCode,
            pendingMatches: ra.pendingMatchIds.length,
            regionVerified: !!ra.regionVerifiedAt,
            platformUnsupported: ra.platform ? unsupportedPlatformReason(ra.platform) : null,
            locked: accountLock.locked,
            lockMessage: accountLock.locked ? accountLock.message : null,
          }
        : legacyName
          ? {
              gameName: legacyName,
              tagLine: legacyTag,
              platform: null,
              linkStatus: "MANUAL",
              lastSyncedAt: null,
              lastSyncError: null,
              lastSyncErrorCode: null,
              pendingMatches: 0,
              regionVerified: false,
              platformUnsupported: null,
              locked: false,
              lockMessage: null,
            }
          : null,
      capabilities: publicRiotCapabilities(getRiotCapabilities()),
      profile: riotProfile,
      platforms: RIOT_PLATFORMS.map((p) => ({ value: p, label: `${RIOT_PLATFORM_LABELS[p]} (${p})` })),
    },
    ranks: {
      start: rankStart,
      current: currentRank,
      target: rankTarget,
      tracking: orderSystem ? "booster" : "unsupported",
    },
    updates: {
      list: updates,
      // Only rank boosts (start + target) get updates, within the bought range.
      canPost: viewerIsWorkingBooster && rankOptions.length > 0,
      pointsLabel: pts,
      rankOptions,
      selfCheck: hideAccountFromBooster ? null : selfCheckLink(order.gameSlug, ra ? { gameName: ra.gameName, tagLine: ra.tagLine, platform: platform } : legacyName ? { gameName: legacyName, tagLine: legacyTag, platform } : null),
      stale: staleUpdates,
    },
    progress,
    preferences: {
      roles: roles.map((r) => ({ id: r, label: ROLE_LABELS[r] ?? r })),
      champions: champs.map((c) => {
        const champ = getChampion(c);
        return {
          id: c,
          name: champ?.name ?? c,
          // Catalog icon (exact Data Dragon id, e.g. Wukong = MonkeyKing).
          icon: champ?.iconSrc ?? championIconUrl(ddragonVersion, toDdragonChampionId(c)),
        };
      }),
    },
    matches:
      matchesTotal > 0
        ? await getOrderMatchPage(orderId, { ddragonVersion })
        : { matches: [], nextCursor: null, total: 0 },
    pause,
    abandonment,
    conversationId,
    credentials: { configured: credentialsConfigured(), ...credStatus, ...credPerms },
    feedback: await feedbackFor(orderId, order.status, access.viewerRole, viewer.id),
    releaseGraceUntil:
      access.viewerRole === "booster" &&
      order.status === "CLAIMED" &&
      activeAssignment?.boosterId === viewer.id &&
      (activeAssignment.status === "ASSIGNED" || activeAssignment.status === "ACCEPTED")
        ? graceUntilIfOpen(activeAssignment.assignedAt, await getConfig("release_grace_min"))
        : null,
    adminCompletion:
      isAdmin && order.status === "IN_PROGRESS" && activeAssignment?.status === "IN_PROGRESS" ? { assignmentId: activeAssignment.id } : null,
    sessions: {
      canManage: viewerIsWorkingBooster,
      open: openSession
        ? { id: openSession.id, startedAt: openSession.startedAt.toISOString(), endedAt: null, endReason: null }
        : (recentSessions.find((s) => !s.endedAt) ?? null),
      recent: recentSessions,
      rules: [...SESSION_RULES],
    },
    cancellation,
    customerActions,
    completion: await completionFor(orderId, access.viewerRole),
  };
}

/** Completion with proof block of the order page. */
async function completionFor(orderId: string, role: string): Promise<WorkspaceDTO["completion"]> {
  const request = await latestCompletionRequest(orderId);
  const open = request?.status === "PENDING" || request?.status === "DISPUTED";
  return {
    request,
    // No customer confirmation since 2026-11-22: an admin marks the order Completed.
    canConfirm: false,
    canDispute: role === "customer" && request?.status === "PENDING",
    canDecide: role === "admin" && open,
    autoConfirmHours: await getConfig("auto_confirm_hours"),
  };
}

/** Initial chat page for the workspace (reuses the existing chat service). */
export async function getInitialChatMessages(conversationId: string) {
  const { messages } = await getMessages(conversationId, { page: 1, limit: 50 });
  return messages;
}

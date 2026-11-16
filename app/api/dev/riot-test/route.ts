import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";
import { getRiotApiKey, getRiotApiKeySource, getRiotCapabilities } from "@/lib/services/games/league-of-legends/capabilities";
import { riotIdSchema } from "@/lib/services/games/league-of-legends/account.service";
import { isAllowedRiotHost, resolveRiotRouting, riotPlatformSchema } from "@/lib/services/games/league-of-legends/routing";
import { getDdragonChampionMap, getDdragonVersion } from "@/lib/services/games/league-of-legends/champion-assets";

/**
 * Riot API diagnostic (test tool).
 *
 * Given a Riot ID + platform, calls every Riot endpoint the order workspace
 * depends on and returns, per step, the HTTP status, timing and the raw JSON
 * body, so an operator can see exactly which call works and which fails.
 *
 * Calls Riot directly (not through the shared DB limiter / app gate) on
 * purpose: it tests the key and routing themselves. The app's own gate
 * (getRiotCapabilities) is reported separately.
 *
 * Access: any signed-in user outside production; ADMIN only in production.
 * The API key never leaves the server (URLs in the response carry no key).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = riotIdSchema.extend({ platform: riotPlatformSchema });

interface Step {
  id: string;
  label: string;
  api: string;
  url: string;
  status: number | null;
  ok: boolean;
  ms: number;
  data: unknown;
  error: string | null;
  skipped?: string;
}

async function call(key: string, id: string, label: string, api: string, host: string, path: string): Promise<Step> {
  const url = `https://${host}${path}`;
  if (!isAllowedRiotHost(host)) {
    return { id, label, api, url, status: null, ok: false, ms: 0, data: null, error: "Host not in the allowed Riot routing table" };
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "X-Riot-Token": key, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    return {
      id, label, api, url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      data,
      error: res.ok ? null : explain(res.status, res.headers.get("Retry-After")),
    };
  } catch (e) {
    return {
      id, label, api, url, status: null, ok: false, ms: Date.now() - started, data: null,
      error: e instanceof Error && e.name === "TimeoutError" ? "Timed out after 8s" : "Network error: could not reach Riot",
    };
  }
}

function skip(id: string, label: string, api: string, reason: string): Step {
  return { id, label, api, url: "", status: null, ok: false, ms: 0, data: null, error: null, skipped: reason };
}

function explain(status: number, retryAfter: string | null): string {
  switch (status) {
    case 400: return "400 Bad request: parameters rejected by Riot.";
    case 401: return "401 Unauthorized: no API key reached Riot.";
    case 403: return "403 Forbidden: key invalid/expired (development keys expire every 24h) or endpoint not allowed for this key.";
    case 404: return "404 Not found: no data for this player on this route.";
    case 429: return `429 Rate limited${retryAfter ? `: retry in ${retryAfter}s` : ""}.`;
    default: return status >= 500 ? `${status} Riot server error / outage.` : `HTTP ${status}`;
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (process.env.NODE_ENV === "production" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const limit = await sharedRateLimit("riot-test", user.id, LIMITS.riotTestPerUser);
  if (!limit.success) return NextResponse.json({ error: "Too many tests. Wait a minute (dev keys allow 100 calls / 2 min)." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse({ ...(body ?? {}), platform: String(body?.platform ?? "").toUpperCase() });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { gameName, tagLine, platform } = parsed.data;

  const caps = getRiotCapabilities();
  const key = getRiotApiKey();
  const routing = resolveRiotRouting(platform);
  const ddragonVersion = await getDdragonVersion();
  const champMap = await getDdragonChampionMap(ddragonVersion);

  const config = {
    keyConfigured: key !== null,
    keySource: getRiotApiKeySource(),
    keyPreview: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : null,
    keyTier: caps.keyTier,
    productApproved: caps.productApproved,
    appDataAccess: caps.dataAccess,
    appReason: caps.reason,
    nodeEnv: process.env.NODE_ENV ?? null,
    routing,
    ddragonVersion,
  };

  if (!key) {
    return NextResponse.json({ config, steps: [], summary: null, error: "No Riot API key configured (RIOT_API_KEY)." });
  }

  const steps: Step[] = [];
  const enc = encodeURIComponent;

  // 1. Account-V1: Riot ID -> PUUID
  const account = await call(key, "account", "Account by Riot ID", "account-v1", routing.accountHost,
    `/riot/account/v1/accounts/by-riot-id/${enc(gameName)}/${enc(tagLine)}`);
  steps.push(account);
  const puuid = account.ok ? (account.data as { puuid?: string })?.puuid ?? null : null;

  if (!puuid) {
    const reason = "Needs a PUUID from step 1";
    steps.push(
      skip("region", "Active LoL region", "account-v1", reason),
      skip("summoner", "Summoner profile", "summoner-v4", reason),
      skip("league", "Ranked entries", "league-v4", reason),
      skip("mastery", "Top champion mastery", "champion-mastery-v4", reason),
      skip("matchIds", "Recent match IDs", "match-v5", reason),
      skip("matches", "Match details", "match-v5", reason),
      skip("live", "Live game", "spectator-v5", reason),
    );
    return NextResponse.json({ config, steps, summary: null });
  }

  const p = enc(puuid);
  const [region, summoner, league, mastery, matchIds, live] = await Promise.all([
    call(key, "region", "Active LoL region", "account-v1", routing.accountHost, `/riot/account/v1/region/by-game/lol/by-puuid/${p}`),
    call(key, "summoner", "Summoner profile", "summoner-v4", routing.platformHost, `/lol/summoner/v4/summoners/by-puuid/${p}`),
    call(key, "league", "Ranked entries", "league-v4", routing.platformHost, `/lol/league/v4/entries/by-puuid/${p}`),
    call(key, "mastery", "Top champion mastery", "champion-mastery-v4", routing.platformHost, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${p}/top?count=5`),
    call(key, "matchIds", "Recent match IDs", "match-v5", routing.matchHost, `/lol/match/v5/matches/by-puuid/${p}/ids?start=0&count=5`),
    call(key, "live", "Live game", "spectator-v5", routing.platformHost, `/lol/spectator/v5/active-games/by-summoner/${p}`),
  ]);
  if (live.status === 404) live.error = "404: player is not in a game right now (this is normal).";
  steps.push(region, summoner, league, mastery, matchIds, live);

  // Match details for the 3 most recent matches.
  const ids = matchIds.ok && Array.isArray(matchIds.data) ? (matchIds.data as string[]).slice(0, 3) : [];
  const matchSteps = await Promise.all(
    ids.map((id) => call(key, `match:${id}`, `Match ${id}`, "match-v5", routing.matchHost, `/lol/match/v5/matches/${enc(id)}`))
  );
  if (ids.length === 0) steps.push(skip("matches", "Match details", "match-v5", matchIds.ok ? "No recent matches" : "Match ID list failed"));
  steps.push(...matchSteps);

  // Human-readable summary built from whatever succeeded.
  type Part = { puuid: string; championName: string; win: boolean; kills: number; deaths: number; assists: number; totalMinionsKilled?: number; neutralMinionsKilled?: number; teamPosition?: string };
  const matches = matchSteps.filter((s) => s.ok).map((s) => {
    const m = s.data as { metadata: { matchId: string }; info: { queueId: number; gameDuration: number; gameEndTimestamp?: number; gameCreation?: number; gameMode?: string; participants: Part[] } };
    const me = m.info.participants.find((x) => x.puuid === puuid);
    return {
      matchId: m.metadata.matchId,
      queueId: m.info.queueId,
      gameMode: m.info.gameMode ?? null,
      durationSec: m.info.gameDuration,
      endedAt: m.info.gameEndTimestamp ?? m.info.gameCreation ?? null,
      champion: me?.championName ?? null,
      position: me?.teamPosition ?? null,
      win: me?.win ?? null,
      kda: me ? `${me.kills}/${me.deaths}/${me.assists}` : null,
      cs: me ? (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0) : null,
    };
  });

  const acc = account.data as { gameName?: string; tagLine?: string };
  const sum = summoner.ok ? (summoner.data as { profileIconId?: number; summonerLevel?: number; revisionDate?: number }) : null;
  const summary = {
    riotId: `${acc.gameName ?? gameName}#${acc.tagLine ?? tagLine}`,
    puuid,
    activeRegion: region.ok ? (region.data as { region?: string }).region ?? null : null,
    regionMatchesSelection: summoner.ok,
    level: sum?.summonerLevel ?? null,
    profileIconId: sum?.profileIconId ?? null,
    ranked: league.ok && Array.isArray(league.data)
      ? (league.data as { queueType: string; tier?: string; rank?: string; leaguePoints?: number; wins?: number; losses?: number }[]).map((e) => ({
          queue: e.queueType, tier: e.tier ?? null, division: e.rank ?? null, lp: e.leaguePoints ?? 0, wins: e.wins ?? 0, losses: e.losses ?? 0,
        }))
      : null,
    mastery: mastery.ok && Array.isArray(mastery.data)
      ? (mastery.data as { championId: number; championLevel: number; championPoints: number }[]).map((m) => ({
          championId: m.championId, champion: champMap?.[m.championId]?.id ?? null, championName: champMap?.[m.championId]?.name ?? null, level: m.championLevel, points: m.championPoints,
        }))
      : null,
    inGame: live.ok,
    matches,
  };

  return NextResponse.json({ config, steps, summary }, { headers: { "Cache-Control": "no-store" } });
}

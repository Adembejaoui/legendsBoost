"use client";

import { useState } from "react";

type Step = {
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
};

type Result = {
  error?: string;
  config: {
    keyConfigured: boolean;
    keySource: string | null;
    keyPreview: string | null;
    keyTier: string;
    productApproved: boolean;
    appDataAccess: boolean;
    appReason: string | null;
    nodeEnv: string | null;
    routing: { platform: string; platformHost: string; matchHost: string; accountHost: string };
    ddragonVersion: string | null;
  };
  steps: Step[];
  summary: null | {
    riotId: string;
    puuid: string;
    activeRegion: string | null;
    regionMatchesSelection: boolean;
    level: number | null;
    profileIconId: number | null;
    ranked: { queue: string; tier: string | null; division: string | null; lp: number; wins: number; losses: number }[] | null;
    mastery: { championId: number; champion: string | null; championName: string | null; level: number; points: number }[] | null;
    inGame: boolean;
    matches: { matchId: string; queueId: number; gameMode: string | null; durationSec: number; endedAt: number | null; champion: string | null; position: string | null; win: boolean | null; kda: string | null; cs: number | null }[];
  };
};

const card = "rounded-lg border border-white/10 bg-white/5 p-4";
const input = "w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/40";

function Badge({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const cls = ok === null ? "bg-zinc-500/20 text-zinc-300" : ok ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-zinc-400">{k}</span>
      <span className="break-all text-end text-zinc-100">{v}</span>
    </div>
  );
}

export default function RiotTestClient({ platforms }: { platforms: { value: string; label: string }[] }) {
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [platform, setPlatform] = useState("EUW1");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/dev/riot-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName, tagLine, platform }),
      });
      const json = await r.json();
      if (!r.ok) setErr(json.error ?? `HTTP ${r.status}`);
      else setRes(json);
    } catch {
      setErr("Request failed");
    } finally {
      setLoading(false);
    }
  }

  const v = res?.config.ddragonVersion;
  const s = res?.summary;
  const passed = res?.steps.filter((x) => x.ok).length ?? 0;
  const failed = res?.steps.filter((x) => !x.ok && !x.skipped && x.id !== "live").length ?? 0;

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={run} className={`${card} grid gap-3 sm:grid-cols-[1fr_140px_1fr_auto] sm:items-end`}>
        <label className="text-xs text-zinc-400">
          Game name
          <input className={`${input} mt-1`} value={gameName} onChange={(e) => setGameName(e.target.value)} placeholder="Faker" required />
        </label>
        <label className="text-xs text-zinc-400">
          Tag
          <input className={`${input} mt-1`} value={tagLine} onChange={(e) => setTagLine(e.target.value)} placeholder="KR1" required />
        </label>
        <label className="text-xs text-zinc-400">
          Server
          <select className={`${input} mt-1`} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => (
              <option key={p.value} value={p.value} className="bg-zinc-900">{p.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? "Testing…" : "Run test"}
        </button>
      </form>

      {err && <div className={`${card} border-red-500/40 text-sm text-red-300`}>{err}</div>}

      {res && (
        <>
          {/* Verdict */}
          <div className={`${card} flex flex-wrap items-center gap-3`}>
            <Badge ok={failed === 0 && passed > 0}>{failed === 0 && passed > 0 ? "Riot API working" : "Problems found"}</Badge>
            <span className="text-sm text-zinc-300">{passed} calls succeeded · {failed} failed</span>
            {res.error && <span className="text-sm text-red-300">{res.error}</span>}
          </div>

          {/* Configuration */}
          <div className={card}>
            <h2 className="mb-2 font-semibold text-white">Configuration</h2>
            <Row k="API key" v={res.config.keyConfigured ? `${res.config.keyPreview} (${res.config.keySource})` : "missing"} />
            <Row k="Key tier" v={res.config.keyTier} />
            <Row k="RIOT_PRODUCT_APPROVED" v={String(res.config.productApproved)} />
            <Row k="NODE_ENV" v={res.config.nodeEnv} />
            <Row
              k="App gate (order workspace may call Riot)"
              v={<Badge ok={res.config.appDataAccess}>{res.config.appDataAccess ? "ENABLED" : "DISABLED"}</Badge>}
            />
            {res.config.appReason && <Row k="Gate reason" v={res.config.appReason} />}
            <Row k="Account host" v={res.config.routing.accountHost} />
            <Row k="Platform host" v={res.config.routing.platformHost} />
            <Row k="Match host" v={res.config.routing.matchHost} />
          </div>

          {/* Player summary */}
          {s && (
            <div className={card}>
              <div className="flex items-center gap-4">
                {v && s.profileIconId !== null && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${s.profileIconId}.png`} alt="" className="h-16 w-16 rounded-lg" />
                )}
                <div>
                  <div className="text-lg font-semibold text-white">{s.riotId}</div>
                  <div className="text-sm text-zinc-400">
                    Level {s.level ?? "?"} · Active region {s.activeRegion ?? "?"}{" "}
                    {!s.regionMatchesSelection && <span className="text-amber-300">(no League profile on the selected server)</span>}
                    {s.inGame && <span className="ms-2 text-emerald-300">● in game now</span>}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-zinc-500">PUUID {s.puuid}</div>
                </div>
              </div>

              <h3 className="mt-5 mb-2 text-sm font-semibold text-zinc-200">Ranked</h3>
              {s.ranked === null ? (
                <p className="text-sm text-red-300">League-V4 call failed</p>
              ) : s.ranked.length === 0 ? (
                <p className="text-sm text-zinc-400">Unranked in all queues</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {s.ranked.map((r) => (
                    <div key={r.queue} className="rounded-md bg-black/20 p-3 text-sm">
                      <div className="text-xs text-zinc-400">{r.queue === "RANKED_SOLO_5x5" ? "Solo/Duo" : r.queue === "RANKED_FLEX_SR" ? "Flex" : r.queue}</div>
                      <div className="font-semibold text-white">{r.tier} {r.division} · {r.lp} LP</div>
                      <div className="text-xs text-zinc-400">
                        {r.wins}W {r.losses}L ({r.wins + r.losses ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0}%)
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {s.mastery && s.mastery.length > 0 && (
                <>
                  <h3 className="mt-5 mb-2 text-sm font-semibold text-zinc-200">Top mastery</h3>
                  <div className="flex flex-wrap gap-3">
                    {s.mastery.map((m) => (
                      <div key={m.championId} className="flex items-center gap-2 rounded-md bg-black/20 p-2 text-sm">
                        {v && m.champion && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${m.champion}.png`} alt="" className="h-8 w-8 rounded" />
                        )}
                        <div>
                          <div className="text-white">{m.championName ?? `#${m.championId}`}</div>
                          <div className="text-xs text-zinc-400">M{m.level} · {m.points.toLocaleString()} pts</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h3 className="mt-5 mb-2 text-sm font-semibold text-zinc-200">Recent matches</h3>
              {s.matches.length === 0 ? (
                <p className="text-sm text-zinc-400">No match details loaded</p>
              ) : (
                <div className="space-y-2">
                  {s.matches.map((m) => (
                    <div key={m.matchId} className={`flex flex-wrap items-center gap-3 rounded-md p-2 text-sm ${m.win ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                      {v && m.champion && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${m.champion}.png`} alt="" className="h-8 w-8 rounded" />
                      )}
                      <span className="w-24 text-white">{m.champion}</span>
                      <Badge ok={m.win}>{m.win ? "Win" : "Loss"}</Badge>
                      <span className="text-zinc-300">{m.kda}</span>
                      <span className="text-zinc-400">{m.cs} CS</span>
                      <span className="text-zinc-400">{Math.round(m.durationSec / 60)} min</span>
                      <span className="text-zinc-400">queue {m.queueId}{m.gameMode ? ` (${m.gameMode})` : ""}</span>
                      {m.position && <span className="text-zinc-500">{m.position}</span>}
                      <span className="ms-auto text-xs text-zinc-500">{m.endedAt ? new Date(m.endedAt).toLocaleString() : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Per-endpoint results */}
          <div className={card}>
            <h2 className="mb-3 font-semibold text-white">Endpoint calls</h2>
            <div className="space-y-2">
              {res.steps.map((st) => (
                <details key={st.id} className="rounded-md bg-black/20 p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                    <Badge ok={st.skipped ? null : st.id === "live" && st.status === 404 ? null : st.ok}>
                      {st.skipped ? "skipped" : st.status ?? "ERR"}
                    </Badge>
                    <span className="text-white">{st.label}</span>
                    <span className="font-mono text-xs text-zinc-500">{st.api}</span>
                    {!st.skipped && <span className="ms-auto text-xs text-zinc-500">{st.ms} ms</span>}
                  </summary>
                  {st.skipped && <p className="mt-2 text-xs text-zinc-400">{st.skipped}</p>}
                  {st.url && <p className="mt-2 break-all font-mono text-xs text-zinc-500">GET {st.url}</p>}
                  {st.error && <p className="mt-2 text-xs text-amber-300">{st.error}</p>}
                  {st.data !== null && st.data !== undefined && (
                    <pre className="mt-2 max-h-80 overflow-auto rounded bg-black/40 p-2 text-xs text-zinc-300">
                      {JSON.stringify(st.data, null, 2)}
                    </pre>
                  )}
                </details>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

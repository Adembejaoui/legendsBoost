import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { BOOSTER_TRANSITIONS } from "@/lib/boosters/transitions";
import { BOOSTER_STATUS_LABEL, type BoosterStatus } from "@/lib/boosters/status";
import { CEILING_RANK_SYSTEM } from "@/lib/boosters/permissions";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { getGame } from "@/lib/catalog/games";
import { gameServices } from "@/lib/catalog/game-services";
import { RIOT_PLATFORMS } from "@/lib/services/games/league-of-legends/routing";
import { getConfig } from "@/lib/config";
import { getFineSchedule, STRIKE_LABEL, strikeSummary } from "@/lib/boosters/discipline";
import { formatMoney } from "@/lib/money";
import { FineDecision, IssueFineForm, RemoveStrike } from "@/components/discipline/DisciplineControls";
import {
  BoosterStatusActions,
  KycControls,
  OrderLimitControl,
  PermissionEditor,
  type PermissionGame,
  type StatusAction,
} from "@/components/admin/BoosterAdminControls";

export const dynamic = "force-dynamic";

const ACTION: Record<string, Omit<StatusAction, "to">> = {
  UNDER_REVIEW: { label: "Start review", tone: "neutral", needsNote: false },
  NEEDS_INFO: { label: "Request more info", tone: "neutral", needsNote: true },
  TRIAL: { label: "Approve: start trial", tone: "primary", needsNote: false },
  APPROVED: { label: "Make active", tone: "primary", needsNote: false },
  REJECTED: { label: "Reject", tone: "danger", needsNote: true },
  ON_BREAK: { label: "Put on break", tone: "neutral", needsNote: false },
  SUSPENDED: { label: "Suspend", tone: "danger", needsNote: true },
  TERMINATED: { label: "Terminate", tone: "danger", needsNote: true },
};

const card = "space-y-3 rounded-lg border border-white/10 bg-white/5 p-4";

type Application = {
  personal?: { fullName?: string; country?: string; discordUsername?: string };
  games?: { gameSlug: string; region?: string; peakRank?: { tierId: string; divisionId: string | null }; mainRole?: string; proofUrl?: string }[];
  experience?: { biography?: string; portfolioLinks?: string[] };
  availability?: { languages?: string[]; timezone?: string | null };
  submittedAt?: string;
};

function safeLink(url: string | undefined) {
  return url && /^https:\/\//.test(url) ? url : null;
}

export default async function AdminBoosterPage({ params }: { params: Promise<{ userId: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      boosterProfile: {
        include: { permissions: true, events: { orderBy: { createdAt: "desc" }, take: 30 } },
      },
    },
  });
  if (!user?.boosterProfile) notFound();
  const p = user.boosterProfile;
  const status = p.verificationStatus as BoosterStatus;
  const app = (p.applicationData ?? {}) as Application;

  const actions: StatusAction[] = Object.entries(BOOSTER_TRANSITIONS[status] ?? {})
    .filter(([, who]) => who?.includes("admin"))
    .map(([to]) => ({ to, ...ACTION[to] }))
    .filter((a) => a.label);

  const defaultLimit = await getConfig("max_concurrent_orders");
  const [strikes, fines, schedule, worked] = await Promise.all([
    strikeSummary(user.id),
    prisma.boosterFine.findMany({ where: { boosterId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    getFineSchedule(),
    prisma.orderBoosterAssignment.findMany({
      where: { boosterId: user.id },
      orderBy: { assignedAt: "desc" },
      take: 30,
      select: { orderId: true, status: true, order: { select: { gameSlug: true, serviceSlug: true } } },
    }),
  ]);
  const fineOrders = [...new Map(worked.map((w) => [w.orderId, { id: w.orderId, label: `#${w.orderId.slice(-8).toUpperCase()} · ${w.order.serviceSlug} · ${w.status.toLowerCase()}` }])).values()];
  const permissionGames: PermissionGame[] = Object.entries(CEILING_RANK_SYSTEM).map(([gameSlug, rsId]) => {
    const tiers = [...(getRankSystem(rsId)?.tiers ?? [])].sort((a, b) => a.order - b.order);
    const current = p.permissions.find((x) => x.gameSlug === gameSlug);
    return {
      gameSlug,
      gameName: getGame(gameSlug)?.name ?? gameSlug,
      tiers: tiers.map((t) => ({ tierId: t.id, tierName: t.name, divisions: (t.divisions ?? []).map((d) => ({ id: d.id, label: d.label })) })),
      services: gameServices.filter((s) => s.gameSlug === gameSlug).map((s) => ({ slug: s.serviceSlug, title: s.title ?? s.serviceSlug })),
      current: current
        ? { tierId: current.maxTargetTierId, divisionId: current.maxTargetDivisionId, regions: current.regions, serviceSlugs: current.serviceSlugs }
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{app.personal?.fullName ?? user.name ?? "Booster"}</h1>
          <p className="text-sm text-zinc-400">
            {user.email} · Discord {app.personal?.discordUsername ?? "—"} · {app.personal?.country ?? "—"}
          </p>
        </div>
        <Link href="/dashboard/admin/applications" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">Back to applications</Link>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">{BOOSTER_STATUS_LABEL[status] ?? status}</span>
          {status === "TRIAL" ? <span className="text-zinc-300">Trial orders left: {p.trialOrdersRemaining ?? 0}</span> : null}
          {p.rulesVersion ? <span className="text-zinc-400">Rules accepted: v{p.rulesVersion}</span> : <span className="text-amber-300">Rules not accepted (older application)</span>}
          {p.reviewNote ? <span className="text-zinc-400">Info requested: {p.reviewNote}</span> : null}
          {p.rejectionReason ? <span className="text-zinc-400">Rejection: {p.rejectionReason}</span> : null}
        </div>
        <BoosterStatusActions userId={user.id} current={status} actions={actions} />
        <OrderLimitControl userId={user.id} current={p.maxConcurrentOrders} defaultLimit={defaultLimit} />
        {p.displayName ? <p className="text-xs text-zinc-400">Public name: {p.displayName}</p> : null}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Application</h2>
        <div className="space-y-2 text-sm">
          {(app.games ?? []).map((g, i) => (
            <div key={i} className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-black/20 p-2">
              <span className="font-medium">{getGame(g.gameSlug)?.name ?? g.gameSlug}</span>
              <span className="text-zinc-400">Peak {g.peakRank ? `${g.peakRank.tierId} ${g.peakRank.divisionId ?? ""}` : "—"}</span>
              <span className="text-zinc-400">{g.region ?? ""}</span>
              <span className="text-zinc-400">{g.mainRole ?? ""}</span>
              {safeLink(g.proofUrl) ? (
                <a href={safeLink(g.proofUrl)!} target="_blank" rel="noopener noreferrer" className="text-violet-300 underline-offset-2 hover:underline">
                  Proof link
                </a>
              ) : (
                <span className="text-amber-300">No proof link</span>
              )}
            </div>
          ))}
          {(app.experience?.portfolioLinks ?? []).filter((l) => safeLink(l)).map((l) => (
            <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-violet-300 hover:underline">
              {l}
            </a>
          ))}
          {app.experience?.biography ? <p className="whitespace-pre-wrap text-zinc-300">{app.experience.biography}</p> : null}
          <p className="text-xs text-zinc-500">
            Languages: {(app.availability?.languages ?? []).join(", ") || "—"} · Timezone: {app.availability?.timezone ?? "—"} · Submitted{" "}
            {app.submittedAt?.slice(0, 10) ?? "—"}
          </p>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Games and rank ceilings</h2>
        <p className="text-xs text-zinc-400">
          The highest target rank this booster may take per game. The booster can lower it but not raise it. The order pool only
          shows orders inside these limits.
        </p>
        {permissionGames.map((g) => (
          <PermissionEditor key={g.gameSlug} userId={user.id} game={g} regions={RIOT_PLATFORMS} />
        ))}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Identity verification (mock)</h2>
        <KycControls userId={user.id} status={p.kycStatus} />
      </section>

      <section className={card}>
        <h2 className="font-semibold">
          Strikes <span className="text-sm font-normal text-zinc-400">· {strikes.last30Days} in the last 30 days (no automatic suspension)</span>
        </h2>
        {strikes.strikes.length === 0 ? (
          <p className="text-sm text-zinc-500">No strikes.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {strikes.strikes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className={s.removedAt ? "text-zinc-600 line-through" : "text-zinc-300"}>
                  {s.createdAt.toISOString().slice(0, 10)} · {STRIKE_LABEL[s.code] ?? s.code}
                  {s.note ? ` · ${s.note}` : ""}
                  {s.orderId ? ` · #${s.orderId.slice(-8).toUpperCase()}` : ""}
                </span>
                {s.removedAt ? <span className="text-xs text-zinc-500">removed: {s.removeReason}</span> : <RemoveStrike strikeId={s.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Fines</h2>
        <IssueFineForm userId={user.id} orders={fineOrders} schedule={schedule} />
        {fines.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {fines.map((f) => (
              <li key={f.id} className="space-y-1 rounded-md bg-black/20 p-2">
                <div className="flex flex-wrap gap-2">
                  <span className="font-semibold">{formatMoney(f.amount, f.currency)}</span>
                  <span className="text-zinc-400">{f.code}</span>
                  <span className="text-xs text-zinc-500">{f.status.toLowerCase()} · #{f.orderId.slice(-8).toUpperCase()}</span>
                </div>
                <p className="text-zinc-300">{f.note}</p>
                {f.appealText ? <p className="text-zinc-200">Appeal: {f.appealText}</p> : null}
                <FineDecision fineId={f.id} appealed={f.status === "APPEALED"} reversible={f.status === "ISSUED" || f.status === "UPHELD"} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={card}>
        <h2 className="font-semibold">History</h2>
        {p.events.length === 0 ? (
          <p className="text-sm text-zinc-500">No events yet.</p>
        ) : (
          <ul className="space-y-1 text-xs text-zinc-300">
            {p.events.map((e) => (
              <li key={e.id}>
                <span className="text-zinc-500">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span> · {e.type}
                {e.fromStatus || e.toStatus ? ` ${e.fromStatus ?? ""} → ${e.toStatus ?? ""}` : ""}
                {e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

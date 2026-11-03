"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ChevronRight } from "lucide-react";
import { formatRankLabel } from "@/lib/catalog/rank-systems";
import { getGame } from "@/lib/catalog/games";

type BoosterView = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: Date;
  boosterProfile: {
    id: string;
    verificationStatus: string;
    rejectionReason: string | null;
    reviewedAt: Date | null;
    approvedAt: Date | null;
    welcomeModalSeen: boolean;
    createdAt: Date;
    applicationData: unknown;
  } | null;
  customerProfile: { country: string | null } | null;
};

type Filter = "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "SUSPENDED", label: "Suspended" },
];

const STATUS_CLASSES: Record<string, string> = {
  PENDING: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  SUSPENDED: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
};

function rankLabel(applicationData: unknown, gameSlug: string, field: string): string {
  const data = (applicationData as { games?: unknown[] } | null)?.games ?? [];
  const entry = data.find((g) => (g as { gameSlug?: string })?.gameSlug === gameSlug) as
    | { currentRank?: { tierId: string; divisionId: string | null }; peakRank?: { tierId: string; divisionId: string | null } }
    | undefined;
  const selection = entry?.[field as "currentRank" | "peakRank"];
  if (!selection) return "—";
  const game = getGame(gameSlug);
  const system = game?.rankSystemIds?.[0];
  if (!system) return "—";
  return formatRankLabel(system, selection);
}

export default function ApplicationsList() {
  const { toast } = useToast();
  const [items, setItems] = useState<BoosterView[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "ALL" ? "/api/admin/boosters" : `/api/admin/boosters?status=${filter}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load applications");
      const json = await res.json();
      setItems(json.boosters ?? []);
    } catch {
      toast({ title: "Failed to load applications", type: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    (async () => {
      await fetchItems();
    })();
  }, [fetchItems]);

  const filtered = useMemo(() => items, [items]);

  const handleApprove = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/boosters/${userId}/approve`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ title: json.error || "Approval failed", type: "destructive" });
        return;
      }
      toast({ title: "Application approved" });
      setSelectedId(null);
      fetchItems();
    } catch {
      toast({ title: "Approval failed", type: "destructive" });
    }
  };

  const handleReject = async (userId: string) => {
    if (!rejectReason.trim()) return;
    try {
      const res = await fetch(`/api/admin/boosters/${userId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ title: json.error || "Rejection failed", type: "destructive" });
        return;
      }
      toast({ title: "Application rejected" });
      setSelectedId(null);
      setRejectReason("");
      fetchItems();
    } catch {
      toast({ title: "Rejection failed", type: "destructive" });
    }
  };

  const item = selectedId ? filtered.find((i) => i.id === selectedId) ?? null : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Booster Applications</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Application Review</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Review, approve or reject booster applications. Approval promotes the applicant from
          CUSTOMER to BOOSTER.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-violet-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.25)]"
                  : "border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Applicant</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Email</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Games</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Submitted</th>
              <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Loading applications...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No applications found.
                </td>
              </tr>
            ) : (
              filtered.map((application) => {
                const profile = application.boosterProfile;
                const data = profile?.applicationData as
                  | { personal?: { fullName?: string; country?: string; discordUsername?: string }; games?: unknown[] }
                  | undefined;
                const games = (data?.games ?? []) as { gameSlug: string }[];
                const gameNames = games.map((g) => {
                  const game = getGame(g.gameSlug);
                  return game ? game.name : g.gameSlug;
                });

                return (
                  <tr key={application.id} className="hover:bg-white/3 transition-colors group cursor-pointer" onClick={() => setSelectedId(application.id)}>
                    <td className="px-4 py-4">
                      <div className="text-sm font-medium text-white">{application.name || "—"}</div>
                      <div className="text-xs text-zinc-400">{data?.personal?.country || "—"}</div>
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-300 truncate max-w-[200px]">{application.email}</td>
                    <td className="px-4 py-4 text-sm text-zinc-300">
                      {gameNames.slice(0, 3).join(", ")}
                      {gameNames.length > 3 && ` +${gameNames.length - 3} more`}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[profile?.verificationStatus ?? ""]}`}>
                        {profile?.verificationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-zinc-300">
                      {profile ? new Date(profile.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-4">
                      {profile?.verificationStatus === "PENDING" && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(application.id); }}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedId(application.id); }}>
                            Reject
                          </Button>
                        </div>
                      )}
                      {profile?.verificationStatus !== "PENDING" && (
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); setSelectedId(application.id); }}>
                          View
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {item && (
        <ApplicationDetail
          item={item}
          onClose={() => setSelectedId(null)}
          onApprove={() => handleApprove(item.id)}
          onReject={() => handleReject(item.id)}
          rejectReason={rejectReason}
          onRejectReasonChange={(e) => setRejectReason(e.target.value)}
        />
      )}
    </div>
  );
}

function ApplicationDetail({
  item,
  onClose,
  onApprove,
  onReject,
  rejectReason,
  onRejectReasonChange,
}: {
  item: BoosterView;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  rejectReason: string;
  onRejectReasonChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const profile = item.boosterProfile!;
  const data = (profile.applicationData as {
    personal: {
      fullName: string;
      email: string;
      country: string;
      phoneNumber: string | null;
      discordUsername: string;
    };
    games: {
      gameSlug: string;
      region: string;
      currentRank: { tierId: string; divisionId: string | null };
      peakRank: { tierId: string; divisionId: string | null };
      mainRole: string;
      yearsExperience: number;
    }[];
    experience: {
      biography: string;
      previousExperience: string | null;
      achievements: string | null;
      portfolioLinks: string[];
    };
    availability: {
      languages: string[];
      availableDays: string[];
      availableTimeSlots: string[];
      timezone: string | null;
    };
    declaration: { codeOfConduct: boolean; informationAccurate: boolean };
    submittedAt: string;
  } | null) ?? null;

  const games = data?.games ?? [];

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Application details</h2>
          <p className="text-sm text-zinc-400">
            {item.name} • {item.email}
          </p>
        </div>
        <Button onClick={onClose} variant="outline">
          <ChevronRight className="-mr-1 size-4 rotate-180" /> Back to list
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="col-span-2 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Personal information</h3>
          <div className="grid gap-2 md:grid-cols-3 text-sm">
            {[
              { label: "Name", value: data?.personal.fullName || item.name || "—" },
              { label: "Email", value: data?.personal.email || item.email || "—" },
              { label: "Country", value: data?.personal.country || "—" },
              { label: "Phone", value: data?.personal.phoneNumber || "—" },
              { label: "Discord", value: data?.personal.discordUsername || "—" },
              { label: "Submitted", value: data ? new Date(data.submittedAt).toLocaleString() : "—" },
            ].map((field) => (
              <div key={field.label} className="flex flex-col gap-1">
                <dt className="text-xs text-zinc-500 uppercase">{field.label}</dt>
                <dd className="text-sm text-zinc-300 truncate">{field.value}</dd>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Gaming expertise</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase mb-2">
                <th>Game</th>
                <th>Region</th>
                <th>Current rank</th>
                <th>Peak rank</th>
                <th>Main role</th>
                <th>Years</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {games.map((g, i) => {
                const game = getGame(g.gameSlug);
                return (
                  <tr key={i}>
                    <td className="py-2 text-zinc-300">{game ? game.name : g.gameSlug}</td>
                    <td className="py-2 text-zinc-400">{g.region}</td>
                    <td className="py-2 text-zinc-300">{rankLabel(profile.applicationData, g.gameSlug, "currentRank")}</td>
                    <td className="py-2 text-zinc-300">{rankLabel(profile.applicationData, g.gameSlug, "peakRank")}</td>
                    <td className="py-2 text-zinc-400 truncate">{g.mainRole}</td>
                    <td className="py-2 text-zinc-400">{g.yearsExperience}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="col-span-2 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Experience and portfolio</h3>
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Biography</dt>
              <dd className="text-sm text-zinc-300 whitespace-pre-wrap">{data?.experience.biography || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Previous experience</dt>
              <dd className="text-sm text-zinc-400">{data?.experience.previousExperience || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Achievements</dt>
              <dd className="text-sm text-zinc-400">{data?.experience.achievements || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Portfolio links</dt>
              <dd className="flex flex-col gap-1 text-sm">
                {(data?.experience.portfolioLinks ?? []).map((link, i) => (
                  <a key={i} href={link} className="text-violet-400 underline underline-offset-4 hover:text-violet-300 truncate" target="_blank" rel="noopener noreferrer">
                    {link}
                  </a>
                ))}
                {(data?.experience.portfolioLinks ?? []).length === 0 && <span className="text-zinc-500">—</span>}
              </dd>
            </div>
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Availability and declaration</h3>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Languages</dt>
              <dd className="text-zinc-400">{data?.availability.languages.join(", ") || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Available days</dt>
              <dd className="text-zinc-400">{data?.availability.availableDays.join(", ") || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Time slots</dt>
              <dd className="text-zinc-400">{data?.availability.availableTimeSlots.join(", ") || "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-zinc-500 uppercase">Time zone</dt>
              <dd className="text-zinc-400">{data?.availability.timezone || "—"}</dd>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/10">
            <dt className="text-xs text-zinc-500 uppercase">Declaration</dt>
            <dd className="text-sm text-zinc-400 space-y-1">
              <span>Code of conduct: {data?.declaration.codeOfConduct ? "Agreed" : "Not agreed"}</span>
              <span>Information accurate: {data?.declaration.informationAccurate ? "Confirmed" : "Not confirmed"}</span>
            </dd>
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-white/10 bg-white/3 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Review</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-xs text-zinc-500 uppercase w-24">Status</dt>
              <dd className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[profile.verificationStatus]}`}>
                {profile.verificationStatus}
              </dd>
              {profile.reviewedAt && (
                <span className="text-xs text-zinc-500">reviewed {new Date(profile.reviewedAt).toLocaleString()}</span>
              )}
            </div>
            {profile.rejectionReason && (
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-zinc-500 uppercase">Rejection reason</dt>
                <dd className="text-rose-300">{profile.rejectionReason}</dd>
              </div>
            )}
            {profile.approvedAt && (
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-zinc-500 uppercase">Approved at</dt>
                <dd className="text-emerald-300">{new Date(profile.approvedAt).toLocaleString()}</dd>
              </div>
            )}
          </div>

          {profile.verificationStatus === "PENDING" && (
            <div className="mt-5 pt-4 border-t border-white/10">
              <Button onClick={onApprove} className="w-auto">Approve application</Button>
              <Button
                onClick={onReject}
                variant="destructive"
                disabled={!rejectReason.trim()}
                className="w-auto"
              >
                Reject
              </Button>
              <p className="mt-2 text-xs text-zinc-400">
                Rejection reason:
                <textarea
                  value={rejectReason}
                  onChange={onRejectReasonChange}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-[#111319] px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  placeholder="Mandatory reason"
                />
                {!rejectReason.trim() && (
                  <span className="mt-1 text-xs text-rose-400">A rejection reason is required</span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

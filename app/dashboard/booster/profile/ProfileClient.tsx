"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRankLabel } from "@/lib/catalog/rank-systems";
import { getGame } from "@/lib/catalog/games";

export default function ProfileClient({
  user,
  boosterProfile,
}: {
  user: any;
  boosterProfile: any;
}) {
  const [biography, setBiography] = useState(boosterProfile?.biography || "");
  const [experienceYears, setExperienceYears] = useState(boosterProfile?.experienceYears || 0);
  const [languages, setLanguages] = useState(boosterProfile?.languages?.join(", ") || "");
  const [availabilityStatus, setAvailabilityStatus] = useState(boosterProfile?.availabilityStatus || "UNAVAILABLE");
  const [saving, setSaving] = useState(false);

  const applicationData = boosterProfile?.applicationData as
    | {
        personal: {
          fullName: string;
          country: string;
          discordUsername: string;
          phoneNumber: string | null;
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
      }
    | null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/booster/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          biography,
          experienceYears: Number(experienceYears),
          languages: languages.split(",").map((l: string) => l.trim()).filter(Boolean),
          availabilityStatus,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to save");
      } else {
        alert("Profile updated successfully");
      }
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const isApproved = boosterProfile?.verificationStatus === "APPROVED";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Account Information</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Name</label>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-white">{user.name || "-"}</div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Email</label>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-white">{user.email}</div>
            <p className="mt-1 text-xs text-zinc-500">Private account data. Not shown on public profile.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Role</label>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-white">{user.role}</div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Verification Status</label>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-white">
              {boosterProfile?.verificationStatus}
              {boosterProfile?.approvalStatus ? ` • ${boosterProfile.approvalStatus}` : null}
            </div>
          </div>
        </div>
      </div>

      {!applicationData ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Professional Profile</h2>
          <p className="text-sm text-zinc-400">No application information on file.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Professional Profile</h2>
            <p className="mb-4 text-sm text-zinc-400">
              Submitted with your booster application on{" "}
              {applicationData.submittedAt ? new Date(applicationData.submittedAt).toLocaleDateString() : "—"}.
            </p>

            <div className="mb-6">
              <label className="mb-1 block text-sm text-zinc-400">Display name</label>
              <div className="rounded-lg bg-white/5 px-3 py-2 text-white">{applicationData.personal.fullName}</div>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm text-zinc-400">Biography</label>
              <div className="rounded-lg bg-white/5 px-3 py-2 text-white whitespace-pre-wrap">
                {applicationData.experience.biography}
              </div>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm text-zinc-400">Supported games and ranks</label>
              <div className="space-y-3">
                {applicationData.games.map((game, index) => {
                  const g = getGame(game.gameSlug);
                  const system = g?.rankSystemIds?.[0];
                  return (
                    <div key={index} className="rounded-lg border border-white/10 bg-white/3 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-zinc-200">{g ? g.name : game.gameSlug}</span>
                        <span className="text-xs text-zinc-500">{game.region}</span>
                      </div>
                        <div className="grid gap-2 md:grid-cols-4 text-sm">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-zinc-500 uppercase">Current rank</span>
                            <span className="text-violet-300">
                              {system ? formatRankLabel(system, game.currentRank) : "—"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-zinc-500 uppercase">Peak rank</span>
                            <span className="text-violet-300">
                              {system ? formatRankLabel(system, game.peakRank) : "—"}
                            </span>
                          </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-zinc-500 uppercase">Main role</span>
                          <span className="text-zinc-300">{game.mainRole}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-zinc-500 uppercase">Experience</span>
                          <span className="text-zinc-300">{game.yearsExperience} years</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="mb-1 block text-sm text-zinc-400">Specializations</label>
                <div className="text-sm text-zinc-300">
                  {[...new Set(applicationData.games.map((g) => g.mainRole))].join(", ") || "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="mb-1 block text-sm text-zinc-400">Languages</label>
                <div className="text-sm text-zinc-300">
                  {applicationData.availability.languages.join(", ") || "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="mb-1 block text-sm text-zinc-400">Available days</label>
                <div className="text-sm text-zinc-300">
                  {applicationData.availability.availableDays.join(", ") || "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="mb-1 block text-sm text-zinc-400">Time slots</label>
                <div className="text-sm text-zinc-300">
                  {applicationData.availability.availableTimeSlots.join(", ") || "—"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="mb-1 block text-sm text-zinc-400">Time zone</label>
                <div className="text-sm text-zinc-300">
                  {applicationData.availability.timezone || "—"}
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm text-zinc-400">Portfolio links</label>
              <div className="flex flex-col gap-2 text-sm">
                {(applicationData.experience.portfolioLinks ?? []).map((link, index) => (
                  <a
                    key={index}
                    href={link}
                    className="text-violet-400 underline underline-offset-4 hover:text-violet-300 truncate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link}
                  </a>
                ))}
                {(applicationData.experience.portfolioLinks ?? []).length === 0 && (
                  <span className="text-zinc-500">—</span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">Optional portfolio evidence (Twitch, YouTube, etc.).</p>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-sm text-zinc-400">Application approval status</label>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    isApproved
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : boosterProfile?.verificationStatus === "REJECTED"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-violet-500/30 bg-violet-500/10 text-violet-300",
                  )}
                >
                  {boosterProfile?.verificationStatus}
                </span>
                {boosterProfile?.approvedAt && (
                  <span className="text-xs text-zinc-400">Approved {new Date(boosterProfile.approvedAt).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Manage Profile</h2>
            <p className="mb-4 text-sm text-zinc-400">
              Approved boosters can update their biography, experience, languages and availability.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Biography</label>
                <textarea
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-white"
                  rows={4}
                  value={biography}
                  onChange={(e) => setBiography(e.target.value)}
                  disabled={!isApproved}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-zinc-400">Experience Years</label>
                  <input
                    type="number"
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-white"
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                    disabled={!isApproved}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-400">Languages (comma separated)</label>
                  <input
                    type="text"
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-white"
                    value={languages}
                    onChange={(e) => setLanguages(e.target.value)}
                    placeholder="English, Spanish"
                    disabled={!isApproved}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Availability Status</label>
                <select
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-white"
                  value={availabilityStatus}
                  onChange={(e) => setAvailabilityStatus(e.target.value)}
                  disabled={!isApproved}
                >
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="BUSY">BUSY</option>
                  <option value="UNAVAILABLE">UNAVAILABLE</option>
                </select>
                {!isApproved && (
                  <p className="mt-1 text-xs text-yellow-400">Only approved boosters can change availability</p>
                )}
              </div>
            </div>
            <Button className="mt-4" onClick={handleSave} disabled={saving || !isApproved}>
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { boosterApplicationSchema } from "@/lib/boosters/application-schema";
import { getGames } from "@/lib/catalog/games";
import { getRankSystemsByGame } from "@/lib/catalog/rank-systems";
import { RankPicker } from "@/components/configurator/RankPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Minus, Plus, ArrowRight } from "lucide-react";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const TIME_SLOTS = [
  "Morning (06:00-12:00)",
  "Afternoon (12:00-17:00)",
  "Evening (17:00-22:00)",
  "Night (22:00-02:00)",
] as const;

const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Italian",
  "Dutch",
  "Polish",
  "Turkish",
  "Arabic",
  "Russian",
  "Chinese",
  "Japanese",
  "Korean",
  "Other",
] as const;

type RankSelection = { tierId: string; divisionId: string | null };

type GameEntry = {
  gameSlug: string;
  region: string;
  currentRank: RankSelection;
  peakRank: RankSelection;
  mainRole: string;
  yearsExperience: number;
};

type FormValues = {
  personal: {
    fullName: string;
    country: string;
    phoneNumber: string;
    discordUsername: string;
  };
  games: GameEntry[];
  experience: {
    biography: string;
    previousExperience: string;
    achievements: string;
    portfolioLinks: string[];
  };
  availability: {
    languages: string[];
    availableDays: string[];
    availableTimeSlots: string[];
    timezone: string;
  };
  declaration: {
    codeOfConduct: boolean;
    informationAccurate: boolean;
  };
};

const defaultRank = (tierId: string): RankSelection => ({ tierId, divisionId: null });

const emptyGameEntry = (gameSlug: string): GameEntry => ({
  gameSlug,
  region: "",
  currentRank: defaultRank("iron"),
  peakRank: defaultRank("iron"),
  mainRole: "",
  yearsExperience: 0,
});

const baseForm = (): FormValues => ({
  personal: { fullName: "", country: "", phoneNumber: "", discordUsername: "" },
  games: [emptyGameEntry("league-of-legends")],
  experience: { biography: "", previousExperience: "", achievements: "", portfolioLinks: [] },
  availability: { languages: [], availableDays: [], availableTimeSlots: [], timezone: "" },
  declaration: { codeOfConduct: false, informationAccurate: false },
});

export function BecomeBoosterForm({
  initialName,
  initialEmail,
  initialCountry,
  initialPhone,
}: {
  initialName: string;
  initialEmail: string;
  initialCountry: string;
  initialPhone: string;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormValues>(() => ({
    ...baseForm(),
    personal: { ...baseForm().personal, fullName: initialName, country: initialCountry, phoneNumber: initialPhone },
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const setField = useCallback<(
    path: (string | number)[],
    value: unknown,
  ) => void>((path, value) => {
    setForm((draft) => {
      const next = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        cursor = cursor[path[i]] as Record<string, unknown>;
      }
      cursor[path[path.length - 1]] = value;
      return next as FormValues;
    });
  }, []);

  const gamesForSelection = useMemo(() => getGames(), []);

  const rankSystemForGame = useCallback(
    (gameSlug: string) => {
      const systems = getRankSystemsByGame(gameSlug);
      return systems[0];
    },
    [],
  );

  const addGame = useCallback(() => {
    const slug = gamesForSelection[0]?.slug;
    if (!slug) return;
    if (form.games.length >= 10) return;
    setForm((draft) => ({ ...draft, games: [...draft.games, emptyGameEntry(slug)] }));
  }, [form.games.length, gamesForSelection]);

  const removeGame = useCallback((index: number) => {
    setForm((draft) => ({ ...draft, games: draft.games.filter((_, i) => i !== index) }));
  }, []);

  const toggleMulti = useCallback(
    (path: string[], value: string) => {
      setForm((draft) => {
        const next = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
        let cursor: Record<string, unknown> = next;
        for (let i = 0; i < path.length - 1; i++) {
          cursor = cursor[path[i]] as Record<string, unknown>;
        }
        const arr: string[] = cursor[path[path.length - 1]] as string[];
        cursor[path[path.length - 1]] = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
        return next as FormValues;
      });
    },
    [],
  );

  const validate = useCallback(() => {
    try {
      boosterApplicationSchema.parse(form);
      setErrors({});
      return true;
    } catch (err) {
      const next: Record<string, string> = {};
      if (err && typeof err === "object" && "issues" in err) {
        for (const issue of (err as { issues: { path: (string | number)[]; message: string }[] }).issues) {
          const path = issue.path.length === 0 ? "form" : issue.path.join(".");
          next[path] = issue.message;
        }
      }
      setErrors(next);
      return false;
    }
  }, [form]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/booster/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({
          title: "Application failed",
          description: (json.error || json.issues?.[0]?.message) || "Unable to submit your application.",
          type: "destructive",
        });
        return;
      }

      setSubmitted(true);
      toast({
        title: "Application submitted",
        description: "Your booster application is now under review. You will be notified once a decision is made.",
      });
    } catch {
      toast({
        title: "Application failed",
        description: "A network error occurred. Please try again.",
        type: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="size-6 text-emerald-400">✓</span>
          <h2 className="text-lg font-bold text-white">Application submitted</h2>
        </div>
        <p className="mb-4 text-sm text-zinc-400">
          Thank you for applying to become a booster. Your application has been saved with{" "}
          <strong>PENDING</strong> verification status and is now waiting for admin review. Your account
          role remains CUSTOMER until an administrator approves your application.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <dt className="text-zinc-500 uppercase text-xs">Status</dt>
          <dd className="text-white inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-300">
            PENDING
          </dd>
          <dt className="text-zinc-500 uppercase text-xs">What happens next</dt>
          <dd className="text-zinc-400">
            Our admin team will review your gaming expertise and portfolio. Once approved, your role
            changes to BOOSTER and you can access the booster dashboard.
          </dd>
        </dl>
        <Button asChild className="mt-6" onClick={handleSubmit}>
          <a href="/dashboard/customer">Return to customer dashboard</a>
        </Button>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* A. Personal information */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="size-5 text-violet-400">A</span>
          <h3 className="text-base font-semibold text-white">Personal information</h3>
        </div>
        <p className="mb-6 text-sm text-zinc-400">Your personal details are pre-filled from your account and cannot be changed here.</p>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="col-span-3">
            <Label htmlFor="full-name">Full name <span className="text-zinc-500">(pre-filled)</span></Label>
            <Input id="full-name" defaultValue={form.personal.fullName} disabled readOnly />
            <p className="mt-1 text-xs text-zinc-500">Email is managed in your account settings.</p>
          </div>
          <div>
            <Label htmlFor="email">Email <span className="text-zinc-500">(read-only)</span></Label>
            <Input id="email" defaultValue={initialEmail} disabled readOnly />
          </div>
          <div>
            <Label htmlFor="country">Country <span className="text-rose-500">*</span></Label>
            <Input
              id="country"
              value={form.personal.country}
              onChange={(e) => setField(["personal", "country"], e.target.value)}
              placeholder="e.g. Germany"
            />
            {errors["personal.country"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["personal.country"]}</p>
            )}
          </div>
          <div>
            <Label htmlFor="phone-number">Phone number</Label>
            <Input
              id="phone-number"
              type="tel"
              value={form.personal.phoneNumber}
              onChange={(e) => setField(["personal", "phoneNumber"], e.target.value)}
              placeholder="+49 123 456789"
            />
            {errors["personal.phoneNumber"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["personal.phoneNumber"]}</p>
            )}
            <p className="mt-1 text-xs text-zinc-500">Optional.</p>
          </div>
          <div>
            <Label htmlFor="discord-username">Discord username <span className="text-rose-500">*</span></Label>
            <Input
              id="discord-username"
              value={form.personal.discordUsername}
              onChange={(e) => setField(["personal", "discordUsername"], e.target.value)}
              placeholder="PlayerName#1234"
            />
            {errors["personal.discordUsername"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["personal.discordUsername"]}</p>
            )}
            <p className="mt-1 text-xs text-zinc-500">Used by our team to contact you.</p>
          </div>
        </div>
      </section>

      {/* B. Gaming expertise */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="size-5 text-violet-400">B</span>
          <h3 className="text-base font-semibold text-white">Gaming expertise</h3>
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          Select the games you can boost. For every game, provide your region, ranks, role and
          experience. Ranks follow the official rank configuration.
        </p>

        <div className="space-y-4">
          {form.games.map((game, index) => (
            <div key={index} className="rounded-lg border border-white/10 bg-white/3 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-white">Game {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeGame(index)}
                  disabled={form.games.length === 1}
                  className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-50 disabled:pointer-events-none"
                  aria-label="Remove game"
                >
                  <Minus className="size-4" />
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor={`game-${index}`}>Game <span className="text-rose-500">*</span></Label>
                  <select
                    id={`game-${index}`}
                    className="w-full rounded-lg border border-white/15 bg-[#111319] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    value={game.gameSlug}
                    onChange={(e) =>
                      setField(["games", index, "gameSlug"], e.target.value)
                    }
                  >
                    {gamesForSelection.map((g) => (
                      <option key={g.slug} value={g.slug}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`region-${index}`}>Region / server <span className="text-rose-500">*</span></Label>
                  <Input
                    id={`region-${index}`}
                    value={game.region}
                    onChange={(e) => setField(["games", index, "region"], e.target.value)}
                    placeholder="e.g. EUW"
                  />
                  {errors[`games.${index}.region`] && (
                    <p className="mt-1 text-xs text-rose-400">{errors[`games.${index}.region`]}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor={`current-rank-${index}`}>Current rank <span className="text-rose-500">*</span></Label>
                  <RankPicker
                    rankSystem={rankSystemForGame(game.gameSlug)}
                    value={game.currentRank}
                    onChange={(selection) => setField(["games", index, "currentRank"], selection)}
                    label="Current rank"
                  />
                  {errors[`games.${index}.currentRank`] && (
                    <p className="mt-1 text-xs text-rose-400">{errors[`games.${index}.currentRank`]}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor={`peak-rank-${index}`}>Peak rank <span className="text-rose-500">*</span></Label>
                  <RankPicker
                    rankSystem={rankSystemForGame(game.gameSlug)}
                    value={game.peakRank}
                    onChange={(selection) => setField(["games", index, "peakRank"], selection)}
                    label="Peak rank"
                  />
                  {errors[`games.${index}.peakRank`] && (
                    <p className="mt-1 text-xs text-rose-400">{errors[`games.${index}.peakRank`]}</p>
                  )}
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor={`main-role-${index}`}>Main role / lane / character <span className="text-rose-500">*</span></Label>
                  <Input
                    id={`main-role-${index}`}
                    value={game.mainRole}
                    onChange={(e) => setField(["games", index, "mainRole"], e.target.value)}
                    placeholder="e.g. Jungle, Mid, Controller"
                  />
                  {errors[`games.${index}.mainRole`] && (
                    <p className="mt-1 text-xs text-rose-400">{errors[`games.${index}.mainRole`]}</p>
                  )}
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label htmlFor={`years-${index}`}>Years of experience <span className="text-rose-500">*</span></Label>
                  <Input
                    id={`years-${index}`}
                    type="number"
                    min={0}
                    max={50}
                    value={String(game.yearsExperience || 0)}
                    onChange={(e) =>
                      setField(["games", index, "yearsExperience"], Number(e.target.value) || 0)
                    }
                  />
                  {errors[`games.${index}.yearsExperience`] && (
                    <p className="mt-1 text-xs text-rose-400">{errors[`games.${index}.yearsExperience`]}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button type="button" variant="outline" onClick={addGame} disabled={form.games.length >= 10}>
              <Plus className="mr-2 size-4" />
              Add another game
            </Button>
            {errors.games && <p className="mt-2 text-xs text-rose-400">{errors.games}</p>}
          </div>
          {errors.form && <p className="mt-3 text-xs text-rose-400">{errors.form}</p>}
        </div>
      </section>

      {/* C. Experience and portfolio */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="size-5 text-violet-400">C</span>
          <h3 className="text-base font-semibold text-white">Experience and portfolio</h3>
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          Tell us about your background. Portfolio links are optional (Twitch, YouTube, etc.). We do not
          collect game account passwords, login credentials, or authentication tokens.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2">
            <Label htmlFor="biography">Professional biography <span className="text-rose-500">*</span></Label>
            <textarea
              id="biography"
              className="w-full rounded-lg border border-white/15 bg-[#111319] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              rows={5}
              value={form.experience.biography}
              onChange={(e) => setField(["experience", "biography"], e.target.value)}
              placeholder="Summarize your boosting/coaching background and what makes you a strong booster."
            />
            {errors["experience.biography"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["experience.biography"]}</p>
            )}
          </div>
          <div className="col-span-2">
            <Label htmlFor="previous-experience">Previous coaching or competitive experience</Label>
            <textarea
              id="previous-experience"
              className="w-full rounded-lg border border-white/15 bg-[#111319] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              rows={3}
              value={form.experience.previousExperience}
              onChange={(e) => setField(["experience", "previousExperience"], e.target.value)}
              placeholder="Teams, leagues, tournaments, coaching roles..."
            />
            {errors["experience.previousExperience"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["experience.previousExperience"]}</p>
            )}
            <p className="mt-1 text-xs text-zinc-500">Optional.</p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="achievements">Achievements</Label>
            <textarea
              id="achievements"
              className="w-full rounded-lg border border-white/15 bg-[#111319] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              rows={3}
              value={form.experience.achievements}
              onChange={(e) => setField(["experience", "achievements"], e.target.value)}
              placeholder="Ranks reached, prizes, recognized coaching..."
            />
            {errors["experience.achievements"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["experience.achievements"]}</p>
            )}
            <p className="mt-1 text-xs text-zinc-500">Optional.</p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="portfolio-links">Portfolio links (Twitch, YouTube, etc.)</Label>
            <div className="flex gap-2">
              {form.experience.portfolioLinks.map((link, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={link}
                    onChange={(e) => {
                      const links = [...form.experience.portfolioLinks];
                      links[index] = e.target.value;
                      setField(["experience", "portfolioLinks"], links);
                    }}
                    placeholder="https://twitch.tv/..."
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const links = form.experience.portfolioLinks.filter((_, i) => i !== index);
                      setField(["experience", "portfolioLinks"], links);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-rose-400"
                    aria-label="Remove link"
                  >
                    <Minus className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setField(["experience", "portfolioLinks"], [...form.experience.portfolioLinks, ""])
                }
                className="text-xs text-zinc-400 hover:text-white underline"
              >
                Add link
              </button>
              {errors["experience.portfolioLinks"] && (
                <p className="mt-1 text-xs text-rose-400">{errors["experience.portfolioLinks"]}</p>
              )}
              <p className="mt-1 text-xs text-zinc-500">Optional. Up to 5 links.</p>
            </div>
          </div>
        </div>
      </section>

      {/* D. Availability and declaration */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="size-5 text-violet-400">D</span>
          <h3 className="text-base font-semibold text-white">Availability and declaration</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2 md:col-span-1">
            <Label>Languages spoken <span className="text-rose-500">*</span></Label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  role="checkbox"
                  aria-checked={form.availability.languages.includes(lang)}
                  onClick={() => toggleMulti(["availability", "languages"], lang)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    form.availability.languages.includes(lang)
                      ? "border-violet-500 bg-violet-500/20 text-violet-300"
                      : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>
            {errors["availability.languages"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["availability.languages"]}</p>
            )}
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label>Available days <span className="text-rose-500">*</span></Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  role="checkbox"
                  aria-checked={form.availability.availableDays.includes(day)}
                  onClick={() => toggleMulti(["availability", "availableDays"], day)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    form.availability.availableDays.includes(day)
                      ? "border-violet-500 bg-violet-500/20 text-violet-300"
                      : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
            {errors["availability.availableDays"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["availability.availableDays"]}</p>
            )}
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label>Available time slots <span className="text-rose-500">*</span></Label>
            <div className="flex flex-wrap gap-2">
              {TIME_SLOTS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="checkbox"
                  aria-checked={form.availability.availableTimeSlots.includes(slot)}
                  onClick={() => toggleMulti(["availability", "availableTimeSlots"], slot)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    form.availability.availableTimeSlots.includes(slot)
                      ? "border-violet-500 bg-violet-500/20 text-violet-300"
                      : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>
            {errors["availability.availableTimeSlots"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["availability.availableTimeSlots"]}</p>
            )}
          </div>
          <div className="col-span-2 md:col-span-1">
            <Label htmlFor="timezone">Time zone</Label>
            <Input
              id="timezone"
              value={form.availability.timezone}
              onChange={(e) => setField(["availability", "timezone"], e.target.value)}
              placeholder="e.g. Europe/Berlin"
            />
            {errors["availability.timezone"] && (
              <p className="mt-1 text-xs text-rose-400">{errors["availability.timezone"]}</p>
            )}
            <p className="mt-1 text-xs text-zinc-500">Optional.</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 p-5">
          <h4 className="mb-3 text-sm font-semibold text-white">Declaration</h4>
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.declaration.codeOfConduct}
                onChange={(e) =>
                  setField(["declaration", "codeOfConduct"], e.target.checked)
                }
                className="rounded border-white/15 bg-[#111319] text-violet-500 focus:ring-violet-500/50"
              />
              <div>
                <span className="text-sm text-white">I agree to the platform code of conduct</span>
                <span className="text-rose-500">*</span>
              </div>
              {errors["declaration.codeOfConduct"] && (
                <p className="mt-0.5 text-xs text-rose-400">{errors["declaration.codeOfConduct"]}</p>
              )}
            </label>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.declaration.informationAccurate}
                onChange={(e) =>
                  setField(["declaration", "informationAccurate"], e.target.checked)
                }
                className="rounded border-white/15 bg-[#111319] text-violet-500 focus:ring-violet-500/50"
              />
              <div>
                <span className="text-sm text-white">I confirm the submitted information is accurate</span>
                <span className="text-rose-500">*</span>
              </div>
              {errors["declaration.informationAccurate"] && (
                <p className="mt-0.5 text-xs text-rose-400">{errors["declaration.informationAccurate"]}</p>
              )}
            </label>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full sm:w-auto"
        >
          {isSubmitting ? "Submitting..." : "Submit Application"}
          <ArrowRight className="ml-2 size-4" />
        </Button>
      </section>
    </form>
  );
}

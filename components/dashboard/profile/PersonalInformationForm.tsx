"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Poland",
  "Brazil",
  "Mexico",
  "India",
  "Japan",
  "South Korea",
  "Turkey",
  "Saudi Arabia",
  "United Arab Emirates",
];

export function PersonalInformationForm({ initial }: {
  initial: { name: string; email: string; phoneNumber: string; country: string };
}) {
  const { data: session, update } = useSession();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [phoneNumber, setPhoneNumber] = useState(initial.phoneNumber);
  const [country, setCountry] = useState(initial.country);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setName(initial.name);
    setPhoneNumber(initial.phoneNumber);
    setCountry(initial.country);
    setError(null);
    setSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phoneNumber: phoneNumber || null, country: country || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update profile");
      }
      setSuccess(true);
      setEditing(false);
      await update({ name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Personal Information</h2>
        </div>
        {!editing && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editing} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Input id="email" value={initial.email} disabled className="pr-9" />
            <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input id="phone" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} disabled={!editing} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={!editing}
            className="h-10 w-full rounded-md border border-white/10 bg-[#0b0c10] px-3 text-sm text-white disabled:opacity-60"
          >
            <option value="">Select country</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {success && <p className="mt-3 text-sm text-emerald-400">Profile updated.</p>}
      {editing && (
        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              setEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      )}
    </section>
  );
}

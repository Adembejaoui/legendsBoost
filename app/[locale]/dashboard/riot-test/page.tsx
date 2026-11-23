import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { RIOT_PLATFORMS, RIOT_PLATFORM_LABELS } from "@/lib/services/games/league-of-legends/routing";
import RiotTestClient from "./RiotTestClient";

export const dynamic = "force-dynamic";

/** Riot API diagnostic page. Any signed-in user outside production; ADMIN only in production. */
export default async function RiotTestPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (process.env.NODE_ENV === "production" && ctx.user.role !== "ADMIN") notFound();

  const platforms = RIOT_PLATFORMS.map((p) => ({ value: p, label: `${RIOT_PLATFORM_LABELS[p]} (${p})` }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-white">Riot API test</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Enter a Riot ID and server. Every Riot endpoint the order workspace relies on is called and the raw result shown,
        so you can see exactly what works.
      </p>
      <RiotTestClient platforms={platforms} />
    </div>
  );
}

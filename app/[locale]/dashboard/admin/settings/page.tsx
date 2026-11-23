import { notFound, redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listConfig } from "@/lib/config";
import { ConfigRow } from "@/components/admin/Phase9Controls";

export const dynamic = "force-dynamic";

/** What each setting does (shown above the editor). */
const HELP: Record<string, string> = {
  bid_window_sec: "Length of a bidding window, started by the first bid (seconds).",
  min_bid_bps: "Lowest accepted bid, as a share of the payout (10000 = 100%).",
  claim_now_discount_bps: "Claim now pays the payout minus this share (2500 = 25%).",
  preferred_booster_window_min: "Minutes a customer-chosen booster has the order alone.",
  max_concurrent_orders: "Active orders per booster (can be raised per booster).",
  booster_trial_orders: "Orders a new booster takes on trial.",
  release_grace_min: "Free release window after taking an order (minutes).",
  contact_sla_min: "Minutes to message the customer after taking an order (warning).",
  start_sla_min: "Minutes to start an order after taking it (warning and strike).",
  inactivity_warn_hours: "Hours without games or messages before an inactivity warning.",
  fine_schedule: "Fine rules shown to boosters, with suggested amounts in cents.",
  payout_method_cooldown_hours: "Payout pause after a booster changes their payout method.",
  match_retention_days: "Days match and rank history are kept after an order ends.",
  checkout_hold_ttl_min: "Minutes an unpaid checkout is held.",
  tracker_provider: "riot = Riot tracking on; manual / mock = off.",
  riot_full_refresh_min: "Minutes between full Riot profile refreshes.",
  lp_current_discount_bps: "Price discount by current LP bracket.",
  lp_gain_adjust_bps: "Price change by LP gain per win (low / normal / high).",
  eta_model: "Estimated completion time model.",
};

/** Admin: every setting, validated and audited on save. */
export default async function AdminSettingsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const rows = await listConfig();
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-zinc-400">Values are checked before saving; every change is written to the audit log. Changes apply within 30 seconds.</p>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="space-y-1">
          {HELP[r.key] ? <p className="text-xs text-zinc-400">{HELP[r.key]}</p> : null}
          <ConfigRow configKey={r.key} value={r.value} defaultValue={r.default} overridden={r.overridden} />
        </div>
      ))}
    </div>
  );
}

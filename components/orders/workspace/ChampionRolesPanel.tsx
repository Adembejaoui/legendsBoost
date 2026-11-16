"use client";

import { Swords } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import { Panel, GameArt } from "./Panel";

/** League roles; other games can pass their own role list later. */
const LOL_ROLES = [
  { id: "top", label: "Top", glyph: "T" },
  { id: "jungle", label: "Jungle", glyph: "J" },
  { id: "mid", label: "Mid", glyph: "M" },
  { id: "adc", label: "ADC", glyph: "A" },
  { id: "support", label: "Support", glyph: "S" },
];

export function ChampionRolesPanel({ data }: { data: WorkspaceDTO }) {
  const { roles, champions } = data.preferences;
  const roleOrder = roles.map((r) => r.id);
  const [primary, secondary, ...rest] = roleOrder;
  const known = data.order.gameSlug === "league-of-legends" ? LOL_ROLES : [];
  const hasAny = roles.length > 0 || champions.length > 0;

  return (
    <Panel dense title="Champions & roles" icon={<Swords className="size-3.5" />}>
      {!hasAny ? (
        <p className="text-sm text-zinc-500">No champion or role preference — the booster may play any.</p>
      ) : (
        <>
          {roles.length > 0 && (
            <div className="mb-3">
              <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Roles</p>
              <div className="flex flex-wrap gap-1.5">
                {(known.length ? known : roles.map((r) => ({ ...r, glyph: r.label[0] }))).map((r) => {
                  const rank = r.id === primary ? "Primary" : r.id === secondary ? "Secondary" : rest.includes(r.id) ? "Also" : null;
                  const active = rank !== null;
                  return (
                    <div
                      key={r.id}
                      className={
                        active
                          ? "flex min-w-[56px] flex-col items-center rounded-lg border border-[var(--g-accent)]/40 bg-[var(--g-accent)]/10 px-2 py-1.5"
                          : "flex min-w-[56px] flex-col items-center rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 opacity-40"
                      }
                      aria-label={`${r.label}${rank ? ` (${rank.toLowerCase()} role)` : ""}`}
                    >
                      <span className="grid size-6 place-items-center rounded-md bg-black/40 text-xs font-bold text-[var(--g-light)]">
                        {r.glyph}
                      </span>
                      <span className="mt-1 text-[11px] text-zinc-200">{r.label}</span>
                      {rank && <span className="text-[9px] uppercase tracking-wide text-zinc-500">{rank}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {champions.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Champions</p>
              <ul className="grid grid-cols-4 gap-2">
                {champions.map((c) => (
                  <li key={c.id} className="flex flex-col items-center gap-1">
                    <GameArt
                      src={c.icon}
                      alt=""
                      fallback={c.name}
                      className="size-11 rounded-lg ring-1 ring-white/10"
                    />
                    <span className="w-full truncate text-center text-[11px] text-zinc-300">{c.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

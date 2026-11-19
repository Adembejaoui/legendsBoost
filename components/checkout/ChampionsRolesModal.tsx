'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Search, Check } from 'lucide-react'
import { champions, LOL_ROLES } from '@/lib/catalog/champions'
import { cn } from '@/lib/utils'

interface ChampionsRolesConfig {
  roles: string[]
  champions: string[]
}

interface ChampionsRolesModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (config: ChampionsRolesConfig) => void
  initialValue: ChampionsRolesConfig
  /** OTP Champ Only: pick exactly one champion, no roles. */
  single?: boolean
}

/** Same limit as the server (lib/pricing/order-input.ts). */
export const MAX_CHAMPIONS = 20

/**
 * Champions & Roles picker: every League of Legends champion (Riot Data
 * Dragon), filterable by lane and searchable. Picking lanes also narrows the
 * champion grid to champions played in those lanes (can be turned off).
 */
export function ChampionsRolesModal({ open, onClose, onConfirm, initialValue, single = false }: ChampionsRolesModalProps) {
  const [draftRoles, setDraftRoles] = useState<string[]>(initialValue.roles)
  const [draftChampions, setDraftChampions] = useState<string[]>(initialValue.champions)
  const [query, setQuery] = useState('')
  const [laneFilter, setLaneFilter] = useState<string>('all')

  useEffect(() => {
    if (open) {
      setDraftRoles(initialValue.roles)
      setDraftChampions(initialValue.champions)
      setQuery('')
      setLaneFilter('all')
    }
  }, [open, initialValue])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return champions.filter(
      (c) =>
        (laneFilter === 'all' || (c.lanes ?? []).includes(laneFilter)) &&
        (!q || c.name.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q)),
    )
  }, [query, laneFilter])

  if (!open) return null

  const toggleRole = (roleId: string) => {
    const selected = draftRoles.includes(roleId)
    setDraftRoles(selected ? draftRoles.filter((r) => r !== roleId) : [...draftRoles, roleId])
    // Narrow the grid to the lane just picked (handy default).
    if (!selected) setLaneFilter(roleId)
    else if (laneFilter === roleId) setLaneFilter('all')
  }

  const full = !single && draftChampions.length >= MAX_CHAMPIONS
  const toggleChampion = (champId: string) => {
    if (single) {
      setDraftChampions((prev) => (prev[0] === champId ? [] : [champId]))
      return
    }
    setDraftChampions((prev) =>
      prev.includes(champId) ? prev.filter((c) => c !== champId) : prev.length >= MAX_CHAMPIONS ? prev : [...prev, champId],
    )
  }

  const byId = new Map(champions.map((c) => [c.id, c]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Champions and roles">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-[#111319] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">{single ? "OTP champion" : "Champions & Roles"}</h3>
            <p className="text-xs text-zinc-500">
              {single ? "Your booster will play only this champion for the whole order." : "Tell your booster which lanes and champions to play."}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:text-white" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className={single ? "hidden" : undefined}>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Roles</p>
            <div className="flex flex-wrap gap-2">
              {LOL_ROLES.map((role) => {
                const selected = draftRoles.includes(role.id)
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleRole(role.id)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm transition-all',
                      selected ? 'border-violet-400 bg-violet-500/20 text-white' : 'border-white/10 bg-[#0b0c10] text-zinc-300 hover:border-white/20',
                    )}
                  >
                    {role.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Champions</p>
              <span className={cn('text-xs', full ? 'text-amber-300' : 'text-zinc-500')}>
                {draftChampions.length}/{MAX_CHAMPIONS} selected
              </span>
            </div>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${champions.length} champions...`}
                  className="w-full rounded-lg border border-white/10 bg-[#0b0c10] py-2 pl-9 pr-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
              <div className="flex gap-1 overflow-x-auto rounded-lg border border-white/10 bg-[#0b0c10] p-1">
                {[{ id: 'all', label: 'All' }, ...LOL_ROLES].map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLaneFilter(l.id)}
                    className={cn(
                      'whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors',
                      laneFilter === l.id ? 'bg-violet-500/20 text-white' : 'text-zinc-400 hover:text-white',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-[#0b0c10] p-3 text-xs text-zinc-500">No champions found</p>
            ) : (
              <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-[#0b0c10] p-2 sm:grid-cols-6">
                {filtered.map((champ) => {
                  const selected = draftChampions.includes(champ.id)
                  const disabled = !selected && full
                  return (
                    <button
                      key={champ.id}
                      type="button"
                      onClick={() => toggleChampion(champ.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                      title={champ.title ? `${champ.name}, ${champ.title}` : champ.name}
                      className={cn(
                        'relative flex flex-col items-center gap-1 rounded-lg p-1.5 text-center transition-all',
                        selected ? 'bg-violet-500/20 ring-1 ring-violet-400' : 'hover:bg-white/5',
                        disabled && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {champ.iconSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={champ.iconSrc} alt="" loading="lazy" className="size-10 rounded-md" />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-md bg-white/5 text-xs text-white">{champ.name.charAt(0)}</span>
                      )}
                      <span className="w-full truncate text-[11px] text-zinc-200">{champ.name}</span>
                      {selected ? (
                        <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-violet-500">
                          <Check className="size-3 text-white" />
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}

            {draftChampions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {draftChampions.map((cid) => {
                  const c = byId.get(cid)
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => toggleChampion(cid)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 py-0.5 pl-0.5 pr-2 text-xs text-zinc-300 hover:border-rose-400/40 hover:text-rose-200"
                      title="Remove"
                    >
                      {c?.iconSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.iconSrc} alt="" className="size-5 rounded-full" />
                      ) : null}
                      {c?.name ?? cid}
                      <X className="size-3" />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-1.5 text-sm text-zinc-300 hover:text-white">
            Close
          </button>
          <button
            onClick={() => onConfirm({ roles: draftRoles, champions: draftChampions })}
            className="rounded-lg bg-violet-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { X, Search } from 'lucide-react'
import { champions } from '@/lib/catalog/champions'
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
}

const roles = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'mid', label: 'Mid' },
  { id: 'adc', label: 'ADC' },
  { id: 'support', label: 'Support' },
]

export function ChampionsRolesModal({ open, onClose, onConfirm, initialValue }: ChampionsRolesModalProps) {
  const [draftRoles, setDraftRoles] = useState<string[]>(initialValue.roles)
  const [draftChampions, setDraftChampions] = useState<string[]>(initialValue.champions)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      setDraftRoles(initialValue.roles)
      setDraftChampions(initialValue.champions)
      setQuery('')
    }
  }, [open, initialValue])

  if (!open) return null

  const toggleRole = (roleId: string) => {
    setDraftRoles((prev: string[]) => (prev.includes(roleId) ? prev.filter((r: string) => r !== roleId) : [...prev, roleId]))
  }

  const toggleChampion = (champId: string) => {
    setDraftChampions((prev: string[]) => (prev.includes(champId) ? prev.filter((c: string) => c !== champId) : [...prev, champId]))
  }

  const filtered = champions.filter((c: any) => c.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#111319] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-[#0b0c10] border border-white/10">
              <span className="text-lg">⚔️</span>
            </div>
            <h3 className="text-base font-semibold text-white">Champions & Roles</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Select your Roles</p>
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => {
                const selected = draftRoles.includes(role.id)
                return (
                  <button
                    key={role.id}
                    type="button"
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
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Select your Champions</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search champion..."
                className="w-full rounded-lg border border-white/10 bg-[#0b0c10] pl-9 pr-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#0b0c10]">
              {filtered.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500">No champions found</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {filtered.map((champ: any) => {
                    const selected = draftChampions.includes(champ.id)
                    return (
                      <li key={champ.id}>
                        <button
                          type="button"
                          onClick={() => toggleChampion(champ.id)}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left transition-all',
                            selected ? 'bg-violet-500/10' : 'hover:bg-white/5',
                          )}
                        >
                          <div className="size-8 rounded-lg bg-[#111319] border border-white/10 overflow-hidden flex items-center justify-center">
                            {champ.iconSrc ? (
                              <img src={champ.iconSrc} alt={champ.name} className="size-8 object-contain" />
                            ) : (
                              <span className="text-xs text-white">{champ.name.charAt(0)}</span>
                            )}
                          </div>
                          <span className="text-sm text-white">{champ.name}</span>
                          {selected ? <span className="ml-auto text-xs text-violet-400">Selected</span> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {draftChampions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {draftChampions.map((cid: string) => {
                  const c = champions.find((ch: any) => ch.id === cid)
                  return (
                    <span key={cid} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-300">
                      {c?.name || cid}
                    </span>
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

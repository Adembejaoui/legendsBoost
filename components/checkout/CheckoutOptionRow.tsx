'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Pencil, X } from 'lucide-react'
import type { CheckoutMode, CheckoutOption, ChampionsRolesConfig } from '@/lib/config/checkout-options'
import { champions } from '@/lib/catalog/champions'

interface CheckoutOptionRowProps {
  option: CheckoutOption
  checked: boolean
  onToggle: (checked: boolean) => void
  disabled?: boolean
  championsRoles?: ChampionsRolesConfig
  onConfigureChampionsRoles?: () => void
}

const roles = [
  { id: 'top', label: 'Top' },
  { id: 'jungle', label: 'Jungle' },
  { id: 'mid', label: 'Mid' },
  { id: 'adc', label: 'ADC' },
  { id: 'support', label: 'Support' },
]

export function CheckoutOptionRow({
  option,
  checked,
  onToggle,
  disabled = false,
  championsRoles,
  onConfigureChampionsRoles,
}: CheckoutOptionRowProps) {
  const badgeStyle =
    option.badge?.includes('%')
      ? 'border-orange-400/60 text-orange-400'
      : option.badge === 'Free'
        ? 'border-emerald-400/60 text-emerald-400'
        : 'border-white/15 text-zinc-400'

  const showConfigure = (option as any).type === 'configurable-toggle' && (option as any).configurationType === 'champions-roles' && checked

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-[#0b0c10] p-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-white">{option.label}</p>
          {option.badge ? (
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]', badgeStyle)}>
              {option.badge}
            </span>
          ) : null}
          {showConfigure && onConfigureChampionsRoles ? (
            <button
              type="button"
              onClick={onConfigureChampionsRoles}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white"
              aria-label="Configure champions and roles"
            >
              <Pencil className="size-3" />
              Edit
            </button>
          ) : null}
        </div>
        {showConfigure && championsRoles ? (
          <p className="mt-1 text-xs text-zinc-500">
            {championsRoles.roles.length > 0 ? `Roles: ${championsRoles.roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(', ')}` : 'Roles: -'}{' '}
            •{' '}
            {championsRoles.champions.length > 0
              ? `Champions: ${championsRoles.champions
                  .map((c) => champions.find((ch) => ch.id === c)?.name || c)
                  .join(', ')}`
              : 'Champions: -'}
          </p>
        ) : null}
        {option.description ? <p className="mt-1 text-xs text-zinc-500">{option.description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          onToggle(!checked)
        }}
        className={cn(
          'relative inline-flex h-6 w-10 items-center rounded-full border transition-all',
          checked ? 'border-violet-400 bg-violet-500/30' : 'border-white/10 bg-[#111319]',
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-5' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  )
}

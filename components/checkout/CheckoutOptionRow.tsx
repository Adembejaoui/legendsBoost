'use client'

import { useId, useState } from 'react'
import {
  ChevronRight,
  Crosshair,
  Drama,
  EyeOff,
  Globe,
  Info,
  LineChart,
  Mic,
  Sparkles,
  Swords,
  Trophy,
  User,
  Video,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CheckoutMode, CheckoutOption, ChampionsRolesConfig } from '@/lib/config/checkout-options'
import { champions } from '@/lib/catalog/champions'
import { useLocale, useTranslations } from 'next-intl'
import { isVpnCountry, vpnCountryName } from '@/lib/catalog/vpn-countries'

const ICONS: Record<string, LucideIcon> = { User, Trophy, Zap, Video, Swords, Globe, EyeOff, Drama, LineChart, Crosshair, Mic }

interface CheckoutOptionRowProps {
  option: CheckoutOption
  mode: CheckoutMode
  checked: boolean
  onToggle: (checked: boolean) => void
  /** Server price of this extra ("+$1.96"); undefined while the quote loads. */
  priceLabel?: string
  disabled?: boolean
  championsRoles?: ChampionsRolesConfig
  /** Opens the champion picker of a configurable extra. */
  onConfigure?: () => void
  /** Why the extra is locked (shown instead of its detail). */
  lockedNote?: string
}

const champName = (id: string) => champions.find((c) => c.id === id)?.name ?? id

/**
 * One extra in the order summary (client PDFs 2026-11-19): icon, name, info
 * icon with the hover text, price badge from the server and a switch.
 */
export function CheckoutOptionRow({ option, mode, checked, onToggle, priceLabel, disabled = false, championsRoles, onConfigure, lockedNote }: CheckoutOptionRowProps) {
  const t = useTranslations('Checkout')
  const tRole = useTranslations('Roles')
  const locale = useLocale()
  const [tip, setTip] = useState(false)
  const tipId = useId()
  const Icon = (option.icon && ICONS[option.icon]) || Sparkles
  const hover = (mode === 'duo' && option.descriptionDuo) || option.description
  const free = priceLabel === 'Free'
  // VPN opens its country popup from the name too (client PDFs 2026-11-24).
  const configurable = (option.type === 'configurable-toggle' || option.id === 'vpn') && !!onConfigure

  let detail: string | null = null
  if (checked && option.configurationType === 'champions-roles' && championsRoles) {
    const roleName = (r: string) => (tRole.has(r as 'top') ? tRole(r as 'top') : r)
    const [main, secondary] = championsRoles.roles
    const roles =
      championsRoles.roles.length > 2
        ? championsRoles.roles.map(roleName).join(', ')
        : [main && t('mainRole', { role: roleName(main) }), secondary && t('secondaryRole', { role: roleName(secondary) })].filter(Boolean).join(', ')
    const champs = championsRoles.champions.map(champName).join(', ')
    detail = [roles && t('roles', { list: roles }), champs && t('champions', { list: champs })].filter(Boolean).join(' · ') || t('chooseChampionsRoles')
  }
  if (checked && option.id === 'vpn') {
    detail = isVpnCountry(championsRoles?.vpnCountry) ? t('vpnIn', { country: vpnCountryName(championsRoles!.vpnCountry!, locale) }) : t('vpnChoose')
  }
  if (lockedNote) detail = lockedNote
  if (checked && option.configurationType === 'otp-champion') {
    detail = championsRoles?.otpChampion ? t('championOne', { name: champName(championsRoles.otpChampion) }) : t('chooseChampion')
  }

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.05] text-zinc-400">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {configurable ? (
            <button
              type="button"
              onClick={onConfigure}
              disabled={disabled}
              className="inline-flex min-w-0 items-center gap-0.5 truncate text-start text-sm font-medium text-white hover:text-zinc-200"
            >
              {option.label}
              <ChevronRight className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
            </button>
          ) : (
            <span className="truncate text-sm font-medium text-white">{option.label}</span>
          )}
          {hover ? (
            <span className="relative inline-flex">
              <button
                type="button"
                aria-label={t('about', { name: option.label })}
                aria-describedby={tip ? tipId : undefined}
                onMouseEnter={() => setTip(true)}
                onMouseLeave={() => setTip(false)}
                onFocus={() => setTip(true)}
                onBlur={() => setTip(false)}
                onClick={() => setTip((v) => !v)}
                className="rounded-full p-0.5 text-zinc-500 hover:text-zinc-200"
              >
                <Info className="size-3.5" />
              </button>
              {tip ? (
                <span
                  id={tipId}
                  role="tooltip"
                  className="absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-white/10 bg-[#1a1d26] px-2.5 py-1.5 text-[11px] leading-snug text-zinc-200 shadow-xl"
                >
                  {hover}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {detail ? <p className="truncate text-[11px] text-zinc-500">{detail}</p> : null}
      </div>
      {priceLabel ? (
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums',
            free ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-zinc-300',
          )}
        >
          {free ? t('free') : priceLabel}
        </span>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={option.label}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onToggle(!checked)
        }}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-orange-500' : 'bg-white/15',
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        )}
      >
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}

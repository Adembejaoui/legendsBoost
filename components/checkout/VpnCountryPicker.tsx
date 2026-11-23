'use client'

import { useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isVpnCountry, matchesCountry, vpnCountryName, vpnCountryOptions } from '@/lib/catalog/vpn-countries'

/**
 * VPN country (client 2026-11-23): every country, searchable, no default.
 * A button shows the choice; it opens a search box and the matching list.
 */
export function VpnCountryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | undefined
  onChange: (code: string) => void
  disabled?: boolean
}) {
  const t = useTranslations('Checkout')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const options = useMemo(() => vpnCountryOptions(locale), [locale])
  const shown = useMemo(() => options.filter((o) => matchesCountry(o, query)), [options, query])
  const chosen = isVpnCountry(value) ? vpnCountryName(value, locale) : null

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="mb-1.5 ms-9">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen((v) => !v)
          requestAnimationFrame(() => searchRef.current?.focus())
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-start text-xs',
          chosen ? 'border-white/10 bg-[#0b0c10] text-zinc-200' : 'border-amber-400/40 bg-amber-400/5 text-amber-200',
          'hover:border-white/25 disabled:opacity-50',
        )}
      >
        <span className="truncate">
          <span className="text-zinc-500">{t('vpnCountry')}: </span>
          {chosen ?? t('vpnChoose')}
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open ? (
        <div className="mt-1 rounded-md border border-white/10 bg-[#0b0c10] p-1.5">
          <label className="relative block">
            <span className="sr-only">{t('vpnSearch')}</span>
            <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (shown[0]) pick(shown[0].code)
                }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder={t('vpnSearch')}
              className="h-8 w-full rounded border border-white/10 bg-black/30 ps-7 pe-2 text-xs text-white outline-none placeholder:text-zinc-500 focus:border-white/30"
            />
          </label>
          <ul role="listbox" aria-label={t('vpnCountry')} className="mt-1 max-h-48 overflow-y-auto">
            {shown.length === 0 ? (
              <li className="px-2 py-2 text-xs text-zinc-500">{t('vpnNone')}</li>
            ) : (
              shown.map((o) => (
                <li key={o.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.code === value}
                    onClick={() => pick(o.code)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-xs',
                      o.code === value ? 'bg-orange-500/15 text-white' : 'text-zinc-300 hover:bg-white/5',
                    )}
                  >
                    <span className="truncate">{o.name}</span>
                    {o.code === value ? <Check className="size-3.5 shrink-0 text-orange-300" aria-hidden /> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

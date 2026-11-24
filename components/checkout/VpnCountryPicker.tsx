'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isVpnCountry, matchesCountry, vpnCountryName, vpnCountryOptions } from '@/lib/catalog/vpn-countries'

/**
 * VPN country popup (client PDFs 2026-11-24): turning VPN on opens it; the
 * customer picks a country from a searchable list (every country, no
 * default) and clicks "Save selection". Cancel keeps the previous choice.
 */
export function VpnCountryDialog({
  open,
  value,
  onSave,
  onCancel,
}: {
  open: boolean
  value: string | undefined
  onSave: (code: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('Checkout')
  const locale = useLocale()
  const [draft, setDraft] = useState<string | undefined>(value)
  const [listOpen, setListOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const options = useMemo(() => vpnCountryOptions(locale), [locale])
  const shown = useMemo(() => options.filter((o) => matchesCountry(o, query)), [options, query])

  // Each opening starts from the saved choice.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect -- reset the draft when the popup opens */
    setDraft(value)
    setQuery('')
    setListOpen(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const chosen = isVpnCountry(draft) ? vpnCountryName(draft, locale) : null
  const pick = (code: string) => {
    setDraft(code)
    setListOpen(false)
    setQuery('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="vpn-dialog-title">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} aria-hidden />
      <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#111319] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h3 id="vpn-dialog-title" className="text-base font-semibold text-white">
              {t('vpnTitle')}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">{t('vpnText')}</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1 text-zinc-400 hover:text-white" aria-label={t('vpnCancel')}>
            <X className="size-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-1.5 text-xs font-medium text-zinc-300">{t('vpnSelect')}</p>
          <button
            type="button"
            aria-expanded={listOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setListOpen((v) => !v)
              requestAnimationFrame(() => searchRef.current?.focus())
            }}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0b0c10] px-3 text-start text-sm hover:border-white/25"
          >
            <span className={cn('truncate', chosen ? 'text-white' : 'text-zinc-400')}>{chosen ?? t('vpnChoose')}</span>
            <ChevronDown className={cn('size-4 shrink-0 text-zinc-500 transition-transform', listOpen && 'rotate-180')} aria-hidden />
          </button>

          {listOpen ? (
            <div className="mt-1.5 rounded-lg border border-white/10 bg-[#0b0c10] p-1.5">
              <label className="relative block">
                <span className="sr-only">{t('vpnSearch')}</span>
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" aria-hidden />
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
                  }}
                  placeholder={t('vpnSearch')}
                  className="h-9 w-full rounded-md border border-white/10 bg-black/30 ps-8 pe-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-white/30"
                />
              </label>
              <ul role="listbox" aria-label={t('vpnSelect')} className="mt-1 max-h-56 overflow-y-auto">
                {shown.length === 0 ? (
                  <li className="px-2 py-2 text-xs text-zinc-500">{t('vpnNone')}</li>
                ) : (
                  shown.map((o) => (
                    <li key={o.code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={o.code === draft}
                        onClick={() => pick(o.code)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-sm',
                          o.code === draft ? 'bg-orange-500/15 text-white' : 'text-zinc-300 hover:bg-white/5',
                        )}
                      >
                        <span className="truncate">{o.name}</span>
                        {o.code === draft ? <Check className="size-3.5 shrink-0 text-orange-300" aria-hidden /> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-white/10 bg-white/[0.03] text-sm font-medium text-zinc-200 hover:bg-white/[0.06]"
          >
            {t('vpnCancel')}
          </button>
          <button
            type="button"
            disabled={!isVpnCountry(draft)}
            onClick={() => isVpnCountry(draft) && onSave(draft)}
            className="h-10 rounded-lg bg-orange-500 text-sm font-semibold text-white hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('vpnSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

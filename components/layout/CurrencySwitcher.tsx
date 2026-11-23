'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { CURRENCY_LABELS, SITE_CURRENCIES, type SiteCurrency } from '@/lib/currency/currencies'
import { setCurrency, useCurrency } from '@/lib/currency/client'

/**
 * Currency picker. The choice is saved in a cookie; server-rendered prices
 * ("From ...") are refreshed and the order page asks for a new quote in that
 * currency. Orders are charged in it (lib/currency/rates.ts).
 */
export function CurrencySwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('Currency')
  const currency = useCurrency()
  const router = useRouter()
  return (
    <label className={`flex items-center text-sm text-zinc-400 ${className}`}>
      <span className="sr-only">{t('label')}</span>
      <select
        value={currency}
        onChange={(e) => {
          setCurrency(e.target.value as SiteCurrency)
          router.refresh()
        }}
        className="cursor-pointer rounded-md bg-transparent py-1 text-sm text-zinc-300 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {SITE_CURRENCIES.map((c) => (
          <option key={c} value={c} className="bg-[#111319] text-zinc-200">
            {CURRENCY_LABELS[c]}
          </option>
        ))}
      </select>
    </label>
  )
}

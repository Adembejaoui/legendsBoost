'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Globe } from 'lucide-react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { LOCALE_NAMES, routing, type Locale } from '@/i18n/routing'

/**
 * Language picker. Switching keeps the visitor on the same page (and its
 * query), moves to that language's address (/fr/...) and remembers the
 * choice in the NEXT_LOCALE cookie.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('Language')
  const locale = useLocale()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  return (
    <label className={`flex items-center gap-1.5 text-sm text-zinc-400 ${className}`}>
      <Globe className="size-4" aria-hidden />
      <span className="sr-only">{t('label')}</span>
      <select
        value={locale}
        onChange={(e) => {
          const next = e.target.value as Locale
          const query = searchParams.toString()
          router.replace(query ? `${pathname}?${query}` : pathname, { locale: next, scroll: false })
        }}
        className="cursor-pointer rounded-md bg-transparent py-1 text-sm text-zinc-300 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l} className="bg-[#111319] text-zinc-200">
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  )
}

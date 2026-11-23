import { Link } from "@/i18n/navigation";
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * Four-step progress indicator: Game -> Service -> Configure -> Payment.
 * Completed steps are links back (client-side navigation, so the browser
 * history stays consistent); the current step is marked aria-current.
 * Payment (Stripe Checkout) is never a link: it is reached only through
 * "Continue to Payment".
 */
export function CheckoutSteps({
  current,
  gameSlug,
  serviceSlug,
}: {
  current: 1 | 2 | 3 | 4
  gameSlug?: string
  serviceSlug?: string
}) {
  const t = useTranslations('Steps')
  const steps: { n: 1 | 2 | 3 | 4; label: string; href?: string }[] = [
    { n: 1, label: t('chooseGame'), href: '/games' },
    { n: 2, label: t('chooseService'), href: gameSlug ? `/games/${gameSlug}` : undefined },
    { n: 3, label: t('configure'), href: gameSlug && serviceSlug ? `/games/${gameSlug}/services/${serviceSlug}` : undefined },
    { n: 4, label: t('payment') },
  ]
  return (
    <nav aria-label={t('aria')} className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
      <ol className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs sm:gap-3 sm:text-sm">
        {steps.map((s, i) => {
          const done = s.n < current
          const active = s.n === current
          const content = (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                  done && 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300',
                  active && 'border-orange-400 bg-orange-500 text-white',
                  !done && !active && 'border-white/15 text-zinc-500',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : s.n}
              </span>
              <span className={cn(active ? 'font-semibold text-white' : done ? 'text-zinc-300' : 'text-zinc-500', !active && 'hidden sm:inline')}>
                {s.label}
              </span>
            </span>
          )
          return (
            <li key={s.n} className="flex items-center gap-1.5 sm:gap-3" aria-current={active ? 'step' : undefined}>
              {done && s.href ? (
                <Link href={s.href} className="rounded-md hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400">
                  {content}
                  <span className="sr-only"> {t('completed')}</span>
                </Link>
              ) : (
                content
              )}
              {i < steps.length - 1 ? <span className="h-px w-4 shrink-0 bg-white/15 sm:w-8" aria-hidden /> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

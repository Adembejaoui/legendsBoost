import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export function SiteFooter() {
  const t = useTranslations('Footer')
  return <footer id="footer" className="border-t border-white/[0.08] py-10"><div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-10"><div><a href="#top" className="text-sm font-semibold text-white">Legends<span className="text-violet-400">Boost</span></a><p className="mt-3 max-w-xs text-xs leading-5 text-zinc-600">{t('tagline')}</p></div><div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-zinc-500"><a href="#games" className="hover:text-white">{t('games')}</a><a href="#how-it-works" className="hover:text-white">{t('howItWorks')}</a><a href="#faq" className="hover:text-white">{t('faq')}</a><Link href="/blog" className="hover:text-white">{t('blog')}</Link><span className="text-zinc-700">{t('support')}</span></div><p className="text-xs text-zinc-700">© 2026 LegendsBoost</p></div><p className="mx-auto mt-6 max-w-7xl px-5 text-[11px] leading-5 text-zinc-700 sm:px-8 lg:px-10">{t('riot')}</p></footer>
}

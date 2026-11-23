import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { Search } from 'lucide-react'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { PostCard } from '@/components/blog/PostCard'
import { Link } from '@/i18n/navigation'
import { getGames } from '@/lib/catalog/games'
import { listPublishedPosts } from '@/lib/blog/service'
import { languageAlternates } from '@/lib/i18n/alternates'
import { cn } from '@/lib/utils'

type SearchParams = Promise<{ game?: string; tag?: string; q?: string; page?: string }>

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations('Blog'), getLocale()])
  return { title: t('metaTitle'), description: t('metaDescription'), alternates: languageAlternates('/blog', locale) }
}

/** Blog list: filters by game, tag and words, 12 per page. */
export default async function BlogPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const [t, locale] = await Promise.all([getTranslations('Blog'), getLocale()])
  const games = getGames()
  const game = games.some((g) => g.slug === sp.game) ? sp.game : undefined
  const tag = typeof sp.tag === 'string' && sp.tag.length <= 30 ? sp.tag.toLowerCase() : undefined
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : undefined
  const page = Number(sp.page) > 0 ? Math.floor(Number(sp.page)) : 1
  const result = await listPublishedPosts(locale, { gameSlug: game, tag, q, page }).catch(() => ({ posts: [], total: 0, page: 1, pages: 1 }))
  const filtered = Boolean(game || tag || q)

  const href = (p: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries({ game, tag, q, ...p })) if (v !== undefined && v !== '' && !(k === 'page' && String(v) === '1')) qs.set(k, String(v))
    const s = qs.toString()
    return s ? `/blog?${s}` : '/blog'
  }
  const chip = (active: boolean) =>
    cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', active ? 'border-violet-400 bg-violet-500/15 text-white' : 'border-white/10 text-zinc-400 hover:text-white')

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-5 pb-24 pt-28 sm:px-8 sm:pt-32 lg:px-10">
        <div className="max-w-2xl">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-violet-300">{t('eyebrow')}</div>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{t('title')}</h1>
          <p className="mt-4 text-base leading-7 text-zinc-400">{t('text')}</p>
        </div>

        <div className="mt-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex flex-wrap gap-2" aria-label={t('eyebrow')}>
            <Link href={href({ game: undefined, page: 1 })} className={chip(!game)}>{t('all')}</Link>
            {games.map((g) => (
              <Link key={g.slug} href={href({ game: g.slug, page: 1 })} className={chip(game === g.slug)}>
                {g.name}
              </Link>
            ))}
            {tag ? (
              <Link href={href({ tag: undefined, page: 1 })} className={chip(true)}>
                {t('tag', { tag })} ×
              </Link>
            ) : null}
          </nav>
          <form action={locale === 'en' ? '/blog' : `/${locale}/blog`} method="get" className="flex w-full gap-2 lg:w-80" role="search">
            {game ? <input type="hidden" name="game" value={game} /> : null}
            <label className="relative flex-1">
              <span className="sr-only">{t('search')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              <input
                name="q"
                defaultValue={q}
                maxLength={80}
                placeholder={t('search')}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#111319] pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-violet-400/60"
              />
            </label>
            <button type="submit" className="h-10 rounded-lg bg-white/10 px-4 text-sm text-white hover:bg-white/15">
              {t('searchButton')}
            </button>
          </form>
        </div>

        {result.posts.length === 0 ? (
          <p className="mt-16 rounded-xl border border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">
            {filtered ? t('noResults') : t('empty')}
          </p>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}

        {result.pages > 1 ? (
          <nav className="mt-12 flex items-center justify-center gap-3 text-sm" aria-label={t('page', { page: result.page, pages: result.pages })}>
            {result.page > 1 ? (
              <Link href={href({ page: result.page - 1 })} className="rounded-lg border border-white/10 px-3 py-1.5 text-zinc-300 hover:text-white">
                ← {t('previous')}
              </Link>
            ) : null}
            <span className="text-zinc-500">{t('page', { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages ? (
              <Link href={href({ page: result.page + 1 })} className="rounded-lg border border-white/10 px-3 py-1.5 text-zinc-300 hover:text-white">
                {t('next')} →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
      <SiteFooter />
    </>
  )
}

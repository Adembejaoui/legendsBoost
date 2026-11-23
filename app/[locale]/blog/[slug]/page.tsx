import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { BlogMarkdown } from '@/components/blog/BlogMarkdown'
import { ServiceEmbed } from '@/components/blog/ServiceEmbed'
import { PostCard } from '@/components/blog/PostCard'
import { Link } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { getGame } from '@/lib/catalog/games'
import { findTranslationSlug, getPublishedPost } from '@/lib/blog/service'
import { splitBody, tableOfContents } from '@/lib/blog/content'
import { blogImageUrl } from '@/lib/blog/image-url'
import { localizedPath } from '@/lib/i18n/alternates'
import { siteUrl } from '@/lib/site/url'

type Params = Promise<{ slug: string }>

async function load(slug: string) {
  const locale = await getLocale()
  const data = await getPublishedPost(locale, slug).catch(() => null)
  return { locale, data }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const { locale, data } = await load(slug)
  if (!data) return { title: 'LegendsBoost' }
  const { post, translations } = data
  const path = `/blog/${post.slug}`
  const languages: Record<string, string> = { [locale]: localizedPath(path, locale) }
  for (const tr of translations) languages[tr.locale] = localizedPath(`/blog/${tr.slug}`, tr.locale)
  const en = translations.find((tr) => tr.locale === routing.defaultLocale)
  languages['x-default'] = locale === routing.defaultLocale ? path : en ? `/blog/${en.slug}` : localizedPath(path, locale)
  const title = post.seoTitle ?? `${post.title} — LegendsBoost`
  const description = post.seoDescription ?? post.excerpt
  const image = post.coverImageId ? blogImageUrl(post.coverImageId) : '/images/og.jpg'
  return {
    title,
    description,
    alternates: { canonical: localizedPath(path, locale), languages },
    openGraph: { type: 'article', title, description, images: [image], publishedTime: post.publishedAt, modifiedTime: post.updatedAt, locale },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

/** One article: table of contents, Markdown body with order boxes, related articles. */
export default async function BlogPostPage({ params }: { params: Params }) {
  const { slug } = await params
  const { locale, data } = await load(slug)
  if (!data) {
    // Opened in another language (e.g. after switching): go to that language's version.
    const other = await findTranslationSlug(slug, locale).catch(() => null)
    if (other && other !== slug) redirect(localizedPath(`/blog/${other}`, locale))
    notFound()
  }
  const { post, related } = data
  const [t, format] = await Promise.all([getTranslations('Blog'), getFormatter()])
  const game = post.gameSlug ? getGame(post.gameSlug) : undefined
  const toc = tableOfContents(post.body)
  const blocks = splitBody(post.body)
  const published = new Date(post.publishedAt)
  const updated = new Date(post.updatedAt)
  const showUpdated = updated.getTime() - published.getTime() > 24 * 3600_000

  const base = siteUrl()
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    inLanguage: locale,
    mainEntityOfPage: new URL(localizedPath(`/blog/${post.slug}`, locale), base).toString(),
    ...(post.coverImageId ? { image: new URL(blogImageUrl(post.coverImageId), base).toString() } : {}),
    author: { '@type': 'Organization', name: 'LegendsBoost' },
    publisher: { '@type': 'Organization', name: 'LegendsBoost' },
  }

  return (
    <>
      <SiteHeader />
      <main className="pb-24 pt-28 sm:pt-32">
        {/* Structured data for search engines (escaped: no "<" can close the script). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
        <article className="mx-auto max-w-3xl px-5 sm:px-8">
          <Link href="/blog" className="text-sm text-zinc-400 hover:text-white">
            ← {t('backToBlog')}
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {game ? (
              <Link
                href={`/blog?game=${game.slug}`}
                className="rounded-full px-2 py-0.5 font-medium uppercase tracking-[0.12em]"
                style={{ backgroundColor: `${game.accent}22`, color: game.accent }}
              >
                {game.name}
              </Link>
            ) : null}
            <time dateTime={post.publishedAt}>{format.dateTime(published, { dateStyle: 'long' })}</time>
            <span aria-hidden>·</span>
            <span>{t('minutes', { count: post.readingMinutes })}</span>
            {showUpdated ? (
              <>
                <span aria-hidden>·</span>
                <span>{t('updated', { date: format.dateTime(updated, { dateStyle: 'long' }) })}</span>
              </>
            ) : null}
          </div>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">{post.title}</h1>
          <p className="mt-4 text-lg leading-8 text-zinc-400">{post.excerpt}</p>
          {post.authorName ? <p className="mt-4 text-sm text-zinc-500">{t('by', { name: post.authorName })}</p> : null}

          {post.coverImageId ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded blog image, served by our own route
            <img src={blogImageUrl(post.coverImageId)} alt="" className="mt-8 aspect-[16/9] w-full rounded-2xl border border-white/10 object-cover" />
          ) : null}

          {toc.length >= 2 ? (
            <nav className="mt-10 rounded-xl border border-white/10 bg-[#111319] p-5" aria-label={t('contents')}>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{t('contents')}</p>
              <ol className="mt-3 space-y-1.5 text-sm">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-zinc-300 hover:text-white">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <div className="mt-6">
            {blocks.map((b, i) =>
              b.type === 'markdown' ? <BlogMarkdown key={i} text={b.text} /> : <ServiceEmbed key={i} gameSlug={b.gameSlug} serviceSlug={b.serviceSlug} />,
            )}
          </div>

          {post.tags.length ? (
            <div className="mt-10 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <Link key={tag} href={`/blog?tag=${encodeURIComponent(tag)}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:text-white">
                  #{tag}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="mt-12 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-[#1d1634] to-[#12131a] p-6 text-center sm:p-8">
            <p className="text-2xl font-semibold text-white">{t('ctaTitle')}</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">{t('ctaText')}</p>
            <Link
              href={game ? `/games/${game.slug}` : '/games'}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-violet-100"
            >
              {t('ctaButton')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </article>

        {related.length ? (
          <section className="mx-auto mt-20 max-w-7xl px-5 sm:px-8 lg:px-10">
            <h2 className="mb-6 text-2xl font-semibold text-white">{t('related')}</h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  )
}

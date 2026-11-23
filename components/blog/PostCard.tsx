import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { getGame } from '@/lib/catalog/games'
import { blogImageUrl } from '@/lib/blog/image-url'
import type { BlogListItem } from '@/lib/blog/service'

/** One article in the blog list or under "Related articles". */
export function PostCard({ post }: { post: BlogListItem }) {
  const t = useTranslations('Blog')
  const format = useFormatter()
  const game = post.gameSlug ? getGame(post.gameSlug) : undefined
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-colors hover:border-white/25">
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-[#1d1634] to-[#12131a]">
        {post.coverImageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded blog image, served by our own route
          <img src={blogImageUrl(post.coverImageId)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
          {game ? (
            <span className="rounded-full px-2 py-0.5 font-medium uppercase tracking-[0.12em]" style={{ backgroundColor: `${game.accent}22`, color: game.accent }}>
              {game.shortName}
            </span>
          ) : null}
          <time dateTime={post.publishedAt}>{format.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' })}</time>
          <span aria-hidden>·</span>
          <span>{t('minutes', { count: post.readingMinutes })}</span>
        </div>
        <h2 className="text-lg font-semibold leading-snug text-white">
          <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0">
            {post.title}
          </Link>
        </h2>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">{post.excerpt}</p>
        <span className="mt-auto pt-4 text-sm font-semibold text-violet-300">{t('readMore')} →</span>
      </div>
    </article>
  )
}

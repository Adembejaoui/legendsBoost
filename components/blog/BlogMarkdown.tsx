import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from '@/i18n/navigation'
import { headingId, isAllowedImage, isInternalHref } from '@/lib/blog/content'

function text(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(text).join('')
  if (children && typeof children === 'object' && 'props' in children) return text((children as { props: { children?: ReactNode } }).props.children)
  return ''
}

/**
 * Markdown of a blog post. Raw HTML is never rendered (react-markdown's
 * default); images are limited to our own uploads; links inside the site
 * keep the visitor's language, outside links open in a new tab without
 * passing SEO weight.
 */
const components: Components = {
  h2: ({ children }) => (
    <h2 id={headingId(text(children))} className="mt-10 scroll-mt-28 text-2xl font-semibold tracking-tight text-white">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={headingId(text(children))} className="mt-8 scroll-mt-28 text-xl font-semibold text-white">
      {children}
    </h3>
  ),
  h4: ({ children }) => <h4 className="mt-6 text-lg font-semibold text-white">{children}</h4>,
  p: ({ children }) => <p className="mt-4 leading-7 text-zinc-300">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-6 text-zinc-300">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-6 text-zinc-300">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => <blockquote className="mt-5 border-l-2 border-violet-400/60 pl-4 italic text-zinc-400">{children}</blockquote>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  hr: () => <hr className="my-10 border-white/10" />,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-100">{children}</code>
    ),
  pre: ({ children }) => <pre className="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-zinc-200">{children}</pre>,
  table: ({ children }) => (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm text-zinc-300">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-white/15 px-3 py-2 font-semibold text-white">{children}</th>,
  td: ({ children }) => <td className="border-b border-white/[0.06] px-3 py-2">{children}</td>,
  a: ({ href, children }) => {
    if (!href) return <>{children}</>
    const cls = 'text-violet-300 underline underline-offset-2 hover:text-violet-200'
    if (isInternalHref(href)) return <Link href={href} className={cls}>{children}</Link>
    if (!/^https?:\/\//i.test(href) && !href.startsWith('#')) return <>{children}</>
    return href.startsWith('#') ? (
      <a href={href} className={cls}>{children}</a>
    ) : (
      <a href={href} className={cls} target="_blank" rel="nofollow noopener noreferrer">
        {children}
      </a>
    )
  },
  img: ({ src, alt }) =>
    isAllowedImage(src) ? (
      // eslint-disable-next-line @next/next/no-img-element -- uploaded blog image, served by our own route
      <img src={src} alt={alt ?? ''} loading="lazy" className="mt-6 w-full rounded-xl border border-white/10" />
    ) : null,
}

export function BlogMarkdown({ text: source }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  )
}

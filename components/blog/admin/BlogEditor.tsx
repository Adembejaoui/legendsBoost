'use client'

import { useRef, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import { ImagePlus, Loader2, ShoppingCart } from 'lucide-react'
import { BlogMarkdown } from '@/components/blog/BlogMarkdown'
import { splitBody, slugify } from '@/lib/blog/content'
import { blogImageUrl } from '@/lib/blog/image-url'
import { LOCALE_NAMES, routing } from '@/i18n/routing'
import { localizedPath } from '@/lib/i18n/alternates'
import { cn } from '@/lib/utils'

export interface EditorPost {
  id?: string
  locale: string
  slug: string
  title: string
  excerpt: string
  body: string
  coverImageId: string | null
  gameSlug: string | null
  tags: string[]
  status: 'DRAFT' | 'PUBLISHED'
  publishedAt: string | null
  seoTitle: string | null
  seoDescription: string | null
}

interface Props {
  initial: EditorPost
  /** New translation of this post id. */
  translationOf?: string
  games: { slug: string; name: string }[]
  services: { value: string; label: string }[]
  translations: { id: string; locale: string; title: string; status: string }[]
}

const input = 'w-full rounded-md border border-white/10 bg-[#0b0c10] px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/60'
const labelCls = 'mb-1 block text-xs font-medium text-zinc-300'

/** "2026-11-23T10:00:00.000Z" -> "2026-11-23T11:00" in the admin's own time zone (for datetime-local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function upload(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch('/api/admin/blog/images', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Upload failed.')
  return data.image
}

/**
 * Blog post editor (admins). Markdown body with a live preview, image
 * upload, order boxes, scheduling and translations.
 */
export function BlogEditor({ initial, translationOf, games, services, translations }: Props) {
  const router = useRouter()
  const [post, setPost] = useState<EditorPost>(initial)
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id || initial.slug))
  const [tagsText, setTagsText] = useState(initial.tags.join(', '))
  const [publishAt, setPublishAt] = useState(toLocalInput(initial.publishedAt))
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [service, setService] = useState(services[0]?.value ?? '')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isNew = !post.id
  const set = <K extends keyof EditorPost>(k: K, v: EditorPost[K]) => {
    setSaved(null)
    setPost((p) => ({ ...p, [k]: v }))
  }

  const insert = (snippet: string) => {
    const el = bodyRef.current
    const start = el?.selectionStart ?? post.body.length
    const end = el?.selectionEnd ?? post.body.length
    const before = post.body.slice(0, start)
    const block = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}${snippet}\n\n`
    set('body', before + block + post.body.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      const pos = (before + block).length
      el?.setSelectionRange(pos, pos)
    })
  }

  async function save(status: 'DRAFT' | 'PUBLISHED') {
    setBusy(status)
    setError(null)
    setSaved(null)
    const payload = {
      locale: post.locale,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      body: post.body,
      coverImageId: post.coverImageId,
      gameSlug: post.gameSlug,
      tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      status,
      publishedAt: publishAt ? new Date(publishAt).toISOString() : null,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
    }
    try {
      const url = isNew ? `/api/admin/blog${translationOf ? `?translationOf=${encodeURIComponent(translationOf)}` : ''}` : `/api/admin/blog/${post.id}`
      const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save the post.')
      const savedPost = data.post as EditorPost & { id: string }
      setPost((p) => ({ ...p, id: savedPost.id, status: savedPost.status, publishedAt: savedPost.publishedAt }))
      setPublishAt(toLocalInput(savedPost.publishedAt))
      setSaved(status === 'PUBLISHED' ? 'Published.' : 'Draft saved.')
      if (isNew) router.replace(`/dashboard/admin/blog/${savedPost.id}`)
      else router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the post.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!post.id) return
    if (!window.confirm(`Delete "${post.title}" (${LOCALE_NAMES[post.locale as 'en'] ?? post.locale}) for good? This cannot be undone. Other languages of this article are kept.`)) return
    setBusy('delete')
    const res = await fetch(`/api/admin/blog/${post.id}`, { method: 'DELETE' })
    if (res.ok) router.replace('/dashboard/admin/blog')
    else {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not delete the post.')
      setBusy(null)
    }
  }

  async function onImage(e: React.ChangeEvent<HTMLInputElement>, target: 'cover' | 'body') {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(`upload-${target}`)
    setError(null)
    try {
      const img = await upload(file)
      if (target === 'cover') set('coverImageId', img.id)
      else insert(`![${file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')}](${img.url})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(null)
    }
  }

  const scheduled = post.status === 'PUBLISHED' && post.publishedAt && new Date(post.publishedAt) > new Date()
  const publicPath = localizedPath(`/blog/${post.slug}`, post.locale)
  const missingLocales = routing.locales.filter((l) => l !== post.locale && !translations.some((t) => t.locale === l))

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="title">Title</label>
          <input
            id="title"
            className={cn(input, 'text-lg font-semibold')}
            value={post.title}
            maxLength={140}
            onChange={(e) => {
              set('title', e.target.value)
              if (!slugTouched) set('slug', slugify(e.target.value))
            }}
            placeholder="LP gains explained: why you only gain 15 LP"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="slug">Address</label>
          <div className="flex items-center rounded-md border border-white/10 bg-[#0b0c10] text-sm">
            <span className="pl-3 text-zinc-500">{localizedPath('/blog/', post.locale)}</span>
            <input
              id="slug"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-white outline-none"
              value={post.slug}
              maxLength={100}
              onChange={(e) => {
                setSlugTouched(true)
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
              }}
            />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="excerpt">
            Summary <span className="text-zinc-500">({post.excerpt.length}/300, shown in the list and on Google)</span>
          </label>
          <textarea id="excerpt" className={cn(input, 'h-20 resize-y')} maxLength={300} value={post.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111319]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
            {(['write', 'preview'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn('rounded-md px-3 py-1.5 text-sm', tab === k ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white')}
              >
                {k === 'write' ? 'Write' : 'Preview'}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/5">
              {busy === 'upload-body' ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              Image
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onImage(e, 'body')} disabled={busy !== null} />
            </label>
            <select value={service} onChange={(e) => setService(e.target.value)} className="max-w-[14rem] rounded-md border border-white/10 bg-[#0b0c10] px-2 py-1.5 text-xs text-zinc-300">
              {services.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => insert(`[service:${service}]`)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/5">
              <ShoppingCart className="size-4" />
              Order box
            </button>
          </div>
          {tab === 'write' ? (
            <textarea
              ref={bodyRef}
              className="h-[32rem] w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-zinc-100 outline-none"
              value={post.body}
              onChange={(e) => set('body', e.target.value)}
              placeholder={'## A heading\n\nWrite in Markdown: **bold**, *italic*, [links](/games), lists with "- ".\n\n[service:league-of-legends/rank-boost]'}
            />
          ) : (
            <div className="min-h-[32rem] p-6">
              {post.body.trim() ? (
                splitBody(post.body).map((b, i) =>
                  b.type === 'markdown' ? (
                    <BlogMarkdown key={i} text={b.text} />
                  ) : (
                    <div key={i} className="my-6 rounded-xl border border-violet-400/25 bg-violet-500/10 p-4 text-sm text-violet-200">
                      Order box: {services.find((s) => s.value === `${b.gameSlug}/${b.serviceSlug}`)?.label ?? `${b.gameSlug}/${b.serviceSlug}`} (live price and order button on the site)
                    </div>
                  ),
                )
              ) : (
                <p className="text-sm text-zinc-500">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Markdown: <code>## Heading</code> (shown in the table of contents), <code>**bold**</code>, <code>- list</code>, <code>[text](/games)</code>, <code>&gt; quote</code>, tables. An order box is a line with only{' '}
          <code>[service:game/service]</code>. HTML is not shown.
        </p>
      </div>

      <aside className="space-y-4">
        <div className="space-y-3 rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-sm text-zinc-300">
            Status:{' '}
            <span className={cn('font-semibold', post.status === 'PUBLISHED' ? (scheduled ? 'text-amber-300' : 'text-emerald-300') : 'text-zinc-400')}>
              {post.status === 'PUBLISHED' ? (scheduled ? 'Scheduled' : 'Published') : 'Draft'}
            </span>
          </p>
          <div>
            <label className={labelCls} htmlFor="publishAt">Publication date (empty = now)</label>
            <input id="publishAt" type="datetime-local" className={input} value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy !== null} onClick={() => save('DRAFT')} className="rounded-md border border-white/15 px-3 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50">
              {busy === 'DRAFT' ? 'Saving…' : post.status === 'PUBLISHED' ? 'Unpublish' : 'Save draft'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => save('PUBLISHED')} className="rounded-md bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50">
              {busy === 'PUBLISHED' ? 'Saving…' : post.status === 'PUBLISHED' ? 'Update' : publishAt && new Date(publishAt) > new Date() ? 'Schedule' : 'Publish'}
            </button>
          </div>
          {saved ? <p className="text-xs text-emerald-300">{saved}</p> : null}
          {error ? <p role="alert" className="text-xs text-rose-300">{error}</p> : null}
          {post.id && post.status === 'PUBLISHED' && !scheduled ? (
            <a href={publicPath} target="_blank" rel="noopener" className="block text-xs text-violet-300 hover:underline">
              View on the site ↗
            </a>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-white/10 bg-[#111319] p-4">
          <div>
            <label className={labelCls} htmlFor="locale">Language</label>
            <select id="locale" className={input} value={post.locale} disabled={!isNew} onChange={(e) => set('locale', e.target.value)}>
              {routing.locales.map((l) => (
                <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="game">Game</label>
            <select id="game" className={input} value={post.gameSlug ?? ''} onChange={(e) => set('gameSlug', e.target.value || null)}>
              <option value="">General</option>
              {games.map((g) => (
                <option key={g.slug} value={g.slug}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="tags">Tags (comma separated, up to 8)</label>
            <input id="tags" className={input} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ranked, lp, guide" />
          </div>
          <div>
            <span className={labelCls}>Cover image (16:9)</span>
            {post.coverImageId ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploaded blog image
              <img src={blogImageUrl(post.coverImageId)} alt="" className="mb-2 aspect-[16/9] w-full rounded-md border border-white/10 object-cover" />
            ) : null}
            <div className="flex gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
                {busy === 'upload-cover' ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                {post.coverImageId ? 'Replace' : 'Upload'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onImage(e, 'cover')} disabled={busy !== null} />
              </label>
              {post.coverImageId ? (
                <button type="button" onClick={() => set('coverImageId', null)} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-white">
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-white/10 bg-[#111319] p-4">
          <p className="text-sm font-semibold text-white">Google</p>
          <div>
            <label className={labelCls} htmlFor="seoTitle">Title on Google <span className="text-zinc-500">({(post.seoTitle ?? '').length}/70, optional)</span></label>
            <input id="seoTitle" className={input} maxLength={70} value={post.seoTitle ?? ''} onChange={(e) => set('seoTitle', e.target.value || null)} placeholder={`${post.title || 'Post title'} — LegendsBoost`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="seoDescription">Description on Google <span className="text-zinc-500">({(post.seoDescription ?? '').length}/170, optional)</span></label>
            <textarea id="seoDescription" className={cn(input, 'h-20 resize-y')} maxLength={170} value={post.seoDescription ?? ''} onChange={(e) => set('seoDescription', e.target.value || null)} placeholder="The summary is used when empty." />
          </div>
        </div>

        {post.id ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-[#111319] p-4">
            <p className="text-sm font-semibold text-white">Other languages</p>
            {translations.map((t) => (
              <Link key={t.id} href={`/dashboard/admin/blog/${t.id}`} className="block text-sm text-zinc-300 hover:text-white">
                {LOCALE_NAMES[t.locale as 'en'] ?? t.locale}: {t.title} <span className="text-xs text-zinc-500">({t.status === 'PUBLISHED' ? 'published' : 'draft'})</span>
              </Link>
            ))}
            {missingLocales.map((l) => (
              <Link
                key={l}
                href={`/dashboard/admin/blog/new?translationOf=${post.id}&locale=${l}`}
                className="block rounded-md border border-dashed border-white/15 px-3 py-2 text-center text-xs text-zinc-300 hover:bg-white/5"
              >
                + Add the {LOCALE_NAMES[l]} version
              </Link>
            ))}
          </div>
        ) : null}

        {post.id ? (
          <button type="button" onClick={remove} disabled={busy !== null} className="w-full rounded-md border border-rose-500/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
            {busy === 'delete' ? 'Deleting…' : 'Delete this language version'}
          </button>
        ) : null}
      </aside>
    </div>
  )
}

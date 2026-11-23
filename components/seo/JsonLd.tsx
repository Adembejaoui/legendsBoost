import { ldScript } from '@/lib/seo/structured-data'

type Json = Record<string, unknown>

/** Structured data for search engines; empty entries are skipped. */
export function JsonLd({ data }: { data: (Json | null | undefined)[] }) {
  const items = data.filter((d): d is Json => Boolean(d))
  if (items.length === 0) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(items.length === 1 ? items[0] : items) }} />
}

import { ChevronDown } from 'lucide-react'
import type { FaqItem } from '@/lib/content/faqAC'

/** Short FAQ under the order form (text in lib/content/faqAC.ts). */
export function ServiceFaq({ title, items }: { title: string; items: FaqItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="service-faq" className="rounded-xl border border-white/10 bg-[#111319] p-4 sm:p-5">
      <h2 id="service-faq" className="mb-3 text-base font-semibold text-white">
        {title} FAQ
      </h2>
      <div className="divide-y divide-white/[0.06]">
        {items.map((item) => (
          <details key={item.question} className="group py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-100 marker:hidden hover:text-white">
              {item.question}
              <ChevronDown className="size-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

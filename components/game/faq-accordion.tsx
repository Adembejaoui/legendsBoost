'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface FaqItem {
  question: string
  answer: string
}

interface GameFaqItem {
  q: string
  a: string
}

export function FaqAccordion({
  faqs,
  gameFaqs: gameFaqItems,
  title = 'Good to know',
  eyebrow = 'Questions',
}: {
  faqs?: FaqItem[]
  gameFaqs?: GameFaqItem[]
  title?: string
  eyebrow?: string
}) {
  const items: FaqItem[] = faqs
    ? faqs
    : (gameFaqItems ?? []).map(({ q, a }) => ({ question: q, answer: a }))

  if (items.length === 0) return null

  const [active, setActive] = useState<number | null>(null)

  return (
    <section className="border-t border-white/[0.06] py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:px-10">
        <div>
          <div className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
            {eyebrow}
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {title.split(' ').map((word, i, arr) => (
              <span key={i}>
                {word}
                {i === Math.floor(arr.length / 2) - 1 && <br />}
                {' '}
              </span>
            ))}
          </h2>
        </div>
        <div className="border-t border-white/10">
          {items.map((faq, index) => (
            <div key={faq.question} className="border-b border-white/10">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-6 py-5 text-left text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
                aria-expanded={active === index}
                onClick={() => setActive(active === index ? null : index)}
              >
                <span>{faq.question}</span>
                <ChevronDown
                  className={`shrink-0 text-zinc-500 transition-transform ${active === index ? 'rotate-180' : ''}`}
                />
              </button>
              {active === index && (
                <p className="max-w-2xl pb-5 pr-10 text-sm leading-6 text-zinc-500">{faq.answer}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
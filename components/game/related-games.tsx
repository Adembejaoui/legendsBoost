import type { Game } from '@/types/game'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

export function RelatedGames({ games }: { games: Game[] }) {
  if (games.length === 0) return null

  return (
    <section className="border-t border-white/[0.06] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
              Other arenas
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-4xl">
              Keep exploring
            </h2>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <Link
              key={game.slug}
              href={`/games/${game.slug}`}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all hover:border-white/20"
            >
              <div className="relative h-32 overflow-hidden">
                <img
                  src={game.image}
                  alt={`${game.name} artwork`}
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#111319] to-transparent" />
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold text-white">{game.name}</h3>
                <p className="mt-1 text-sm text-zinc-400">{game.description}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white transition-colors group-hover:text-violet-300">
                  View game
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
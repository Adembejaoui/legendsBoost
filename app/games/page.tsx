import type { Game } from '@/types/game'
import { getGames } from '@/lib/games'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Games — LegendsBoost',
  description: 'Explore eligible gaming services by game. Every game and service is reviewed for eligibility before publication.',
}

export default function GamesPage() {
  const games = getGames()

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden pt-32 sm:pt-40">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_25%,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_30%_40%,rgba(34,211,238,0.05),transparent_28%)]" />
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-violet-300">
              Choose your arena
            </div>
            <h1 className="max-w-2xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-7xl">
              Games
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-zinc-400 sm:text-lg">
              Explore available and eligible services for each game. Every service is reviewed before publication.
            </p>
          </div>
        </section>

        <section className="border-t border-white/[0.06] py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {games.map((game) => (
                <GameListingCard key={game.slug} game={game} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

function GameListingCard({ game }: { game: Game }) {
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319] transition-all hover:border-white/20"
    >
      <div className="relative h-44 overflow-hidden">
        <img
          src={game.image}
          alt={`${game.name} artwork`}
          className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111319] via-[#111319]/30 to-transparent" />
        <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/25 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-300 backdrop-blur">
          {game.availabilityLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-2xl font-semibold tracking-tight text-white">{game.name}</h3>
        <p className="mt-2 text-sm leading-5 text-zinc-400">{game.description}</p>
        <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4">
          <span className="text-xs text-zinc-500">{game.serviceSummary}</span>
          <span className="grid size-9 place-items-center rounded-lg border border-white/15 text-zinc-400 transition-colors group-hover:border-violet-400 group-hover:text-violet-300">
            <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}
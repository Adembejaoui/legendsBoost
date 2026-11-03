import type { Game } from '@/types/game'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function GameHero({ game }: { game: Game }) {
  return (
    <section className="relative overflow-hidden pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at 70% 20%, ${game.accent}22, transparent 40%), radial-gradient(circle at 30% 60%, rgba(34,211,238,0.06), transparent 35%)`,
        }}
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12 lg:px-10">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em]" style={{ color: game.accent }}>
            <span className="h-px w-8" style={{ backgroundColor: game.accent }} />
            {game.shortName}
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[0.98] tracking-[-0.05em] text-white sm:text-6xl lg:text-[4.5rem]">
            {game.name}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-zinc-400 sm:text-lg">
            {game.description}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button
              asChild
              className="h-12 rounded-lg px-5 font-semibold text-white"
              style={{ backgroundColor: game.accent }}
            >
              <a href="#services">
                Explore services
                <ArrowRight data-icon="inline-end" className="size-4" />
              </a>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-lg border-white/15 bg-transparent px-5 font-semibold text-white hover:bg-white/10">
              <a href="#how-it-works">How it works</a>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: game.accent }} />
              Eligibility reviewed
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Transparent scope
            </span>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          <div
            className="absolute -inset-8 rounded-3xl blur-3xl"
            style={{ background: `radial-gradient(circle, ${game.accent}35, transparent 60%)` }}
            aria-hidden
          />
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111319]">
            <img
              src={game.image}
              alt={`${game.name} artwork`}
              className="aspect-[1.15/1] h-full w-full object-cover"
              loading={game.available ? 'eager' : 'lazy'}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0c10]/70 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-300 backdrop-blur">
                {game.availabilityLabel}
              </span>
              <span className="text-xs font-medium text-white/60">{game.serviceSummary}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
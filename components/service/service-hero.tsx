import type { Service } from '@/types/service'
import { ArrowRight } from 'lucide-react'

export function ServiceHero({ service, gameName, gameAccent }: { service: Service; gameName: string; gameAccent: string }) {
  const Icon = service.icon

  return (
    <section className="relative overflow-hidden pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at 70% 20%, ${gameAccent}22, transparent 40%)`,
        }}
      />
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-6">
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em]"
            style={{ borderColor: `${gameAccent}40`, color: gameAccent, backgroundColor: `${gameAccent}15` }}
          >
            <Icon className="size-3.5" />
            {service.category}
          </span>
          <h1 className="text-4xl font-semibold leading-[0.98] tracking-[-0.05em] text-white sm:text-6xl lg:text-[4.5rem]">
            {service.title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            {service.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: gameAccent }} />
              {gameName}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Eligibility reviewed
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
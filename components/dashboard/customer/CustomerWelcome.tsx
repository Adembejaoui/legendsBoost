import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CustomerWelcome({ userName }: { userName: string }) {
  return (
    <header className="mb-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Welcome back, {userName}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Here is your order overview. Pick a game and service to place your first order, or check the status of an existing one.
          </p>
        </div>
        <Link
          href="/games"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          Browse games <ArrowRight className="size-4" />
        </Link>
      </div>
    </header>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-4 text-center text-white">
      <p className="text-sm font-semibold tracking-[0.2em] text-[#C8AA6E]">404</p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-zinc-400">
        The page you are looking for does not exist, or you don&apos;t have access to it.
      </p>
      <div className="flex gap-2">
        <Link href="/" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5">
          Home
        </Link>
        <Link href="/dashboard" className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
          My dashboard
        </Link>
      </div>
    </main>
  );
}

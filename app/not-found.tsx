import Link from 'next/link'
import './globals.css'

/** 404 for addresses outside any language (the language pages have their own). */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center text-white">
          <p className="text-sm font-semibold tracking-[0.2em] text-[#C8AA6E]">404</p>
          <h1 className="text-2xl font-bold">Page not found</h1>
          <Link href="/" className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14]">Home</Link>
        </main>
      </body>
    </html>
  )
}

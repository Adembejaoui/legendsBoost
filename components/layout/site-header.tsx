'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Menu, X, ArrowUpRight, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

const links = [
  { label: 'Games', href: '/games' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'FAQ', href: '#faq' },
]

function dashboardHref(role?: string) {
  if (role === 'CUSTOMER') return '/dashboard/customer'
  if (role === 'BOOSTER') return '/dashboard/booster'
  return '/dashboard'
}

export function SiteHeader() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  const user = session?.user
  const role = user?.role
  const loading = status === 'loading'
  const authed = status === 'authenticated'

  const initials = (user?.name || user?.email || '?')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.08] bg-[#0b0c10]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
        <a href="#top" className="flex items-center gap-3" onClick={close} aria-label="LegendsBoost home">
          <span className="grid size-9 place-items-center rounded-lg bg-violet-500 text-lg font-black text-white shadow-[0_0_28px_rgba(139,92,246,0.45)]">L</span>
          <span className="text-sm font-semibold tracking-tight text-white sm:text-base">Legends<span className="text-violet-400">Boost</span></span>
        </a>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          {links.map((link) => <a key={link.href} href={link.href} className="text-sm text-zinc-400 transition-colors hover:text-white">{link.label}</a>)}
        </nav>
        <div className="hidden items-center gap-5 md:flex">
          {loading ? null : authed ? (
            <>
              <a href={dashboardHref(role)} className="text-sm text-zinc-400 transition-colors hover:text-white">
                {role === 'BOOSTER' ? 'Booster Dashboard' : role === 'ADMIN' ? 'Admin' : 'Dashboard'}
              </a>
              <div className="flex items-center gap-2">
                {user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className="size-8 rounded-full object-cover" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">{initials}</span>
                )}
                <span className="text-sm text-zinc-200">{user?.name || user?.email}</span>
              </div>
              <button onClick={() => signOut({ callbackUrl: '/' })} className="text-sm text-zinc-400 transition-colors hover:text-white">Sign out</button>
            </>
          ) : (
            <>
              <a href="/login" className="text-sm text-zinc-400 transition-colors hover:text-white">Sign in</a>
              <Button asChild className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-violet-100"><a href="/register">Sign up <ArrowUpRight data-icon="inline-end" /></a></Button>
            </>
          )}
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="grid size-10 place-items-center rounded-lg border border-white/10 text-zinc-200 md:hidden" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? 'Close navigation' : 'Open navigation'}>{open ? <X /> : <Menu />}</button>
      </div>
      {open && (
        <nav id="mobile-navigation" className="border-t border-white/[0.08] bg-[#111319] px-5 py-5 md:hidden" aria-label="Mobile navigation">
          <div className="flex flex-col gap-1">
            {links.map((link) => <a key={link.href} href={link.href} onClick={close} className="rounded-lg px-3 py-3 text-sm text-zinc-300 hover:bg-white/5 hover:text-white">{link.label}</a>)}
            {loading ? null : authed ? (
              <>
                <a href={dashboardHref(role)} onClick={close} className="rounded-lg px-3 py-3 text-sm text-zinc-300 hover:bg-white/5 hover:text-white">{role === 'BOOSTER' ? 'Booster Dashboard' : role === 'ADMIN' ? 'Admin' : 'Dashboard'}</a>
                <button onClick={() => { close(); signOut({ callbackUrl: '/' }) }} className="rounded-lg px-3 py-3 text-left text-sm text-zinc-300 hover:bg-white/5 hover:text-white flex items-center gap-2"><LogOut className="size-4" />Sign out</button>
              </>
            ) : (
              <>
                <a href="/login" onClick={close} className="rounded-lg px-3 py-3 text-sm text-zinc-300 hover:bg-white/5 hover:text-white">Sign in</a>
                <a href="/register" onClick={close} className="mt-2 rounded-lg bg-violet-500 px-3 py-3 text-center text-sm font-semibold text-white">Sign up</a>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}

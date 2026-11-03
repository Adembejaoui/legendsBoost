"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { User2, Bell, Search, Settings, LogOut } from "lucide-react";

export function CustomerHeader({ title, breadcrumb }: { title: string; breadcrumb?: { label: string; href: string }[] }) {
  const { data: session } = useSession();
  const user = session?.user;
  const initials = (user?.name || user?.email || "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="border-b border-white/10 bg-[#0b0c10]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-tight text-white">{title}</h1>
          {breadcrumb && (
            <nav aria-label="Breadcrumb" className="flex -mx-1 items-center gap-1 text-xs text-zinc-500">
              <ol className="flex items-center space-x-2">
                {breadcrumb.map((item, index) => (
                  <li key={item.label} className="flex items-center gap-1 px-1">
                    {index > 0 && <span className="text-zinc-600">/</span>}
                    {item.href ? (
                      <Link href={item.href} className="transition-colors hover:text-zinc-300">
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">{item.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" aria-label="Search">
            <Search className="size-5" />
          </button>
          <button className="relative p-2 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" aria-label="Notifications">
            <Bell className="size-5" />
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
            {user?.image ? (
              <img src={user.image} alt="" className="size-8 rounded-full object-cover" />
            ) : (
              <div className="grid size-8 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
                {initials}
              </div>
            )}
            <div className="hidden md:block">
              <div className="text-sm font-medium text-white">{user?.name || user?.email}</div>
              <div className="text-xs text-zinc-500">{user?.role}</div>
            </div>
            <button className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors md:hidden" aria-label="Account menu">
              <Settings className="size-4" />
            </button>
          </div>
          <form action="/api/auth/signout" method="POST" className="hidden md:flex">
            <button className="items-center gap-2 rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-400">
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

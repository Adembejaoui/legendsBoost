"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconMap, getNavigation } from "@/lib/dashboard/navigation";
import type { UserRole } from "@/lib/dashboard/navigation";
import { ToastProvider } from "@/components/ui/toast";

export interface DashboardUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
}

function isActive(pathname: string, href: string) {
  const path = href.split("?")[0];
  if (path === "/dashboard/customer" || path === "/dashboard/booster" || path === "/dashboard/admin") {
    return pathname === path;
  }
  return pathname === path || pathname.startsWith(path + "/");
}

export function DashboardSidebar({ role, user, onNavigate }: { role: UserRole; user: DashboardUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const nav = getNavigation(role);
  const initials = (user.name || user.email || "?").slice(0, 2).toUpperCase();
  return (
    <aside className="flex h-full flex-col border-r border-white/10 bg-[#111319] text-white">
      <div className="flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3" aria-label="LegendsBoost home">
          <span className="grid size-9 place-items-center rounded-lg bg-violet-500 text-lg font-black text-white">L</span>
          <span className="font-bold tracking-tight text-white">Legends<span className="text-violet-400">Boost</span></span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-4" aria-label="Main navigation">
        {nav.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                active
                  ? "border-violet-500/30 bg-violet-500/20 text-violet-300"
                  : "border-transparent bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
            >
              {Icon && <Icon className="size-5" />}
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
          {user.image ? (
            <img src={user.image} alt="" className="size-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{user.name || user.email}</div>
            <div className="truncate text-xs text-zinc-400">{user.email}</div>
          </div>
        </div>
        <form action="/api/auth/signout" method="POST" className="mt-3 w-full">
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200">
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function DashboardShell({ role, user, children }: { role: UserRole; user: DashboardUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#0b0c10] text-white">
        <div className="flex">
          <div className="hidden md:block md:w-64 md:shrink-0">
            <div className="fixed inset-y-0 left-0 w-64">
              <DashboardSidebar role={role} user={user} />
            </div>
          </div>
          {open && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
              <div className="relative h-full w-64">
                <DashboardSidebar role={role} user={user} onNavigate={() => setOpen(false)} />
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0c10]/80 backdrop-blur-md">
              <div className="flex h-16 items-center justify-between px-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <button className="md:hidden p-2 text-zinc-200" onClick={() => setOpen(true)} aria-label="Open navigation">
                    <Menu className="size-5" />
                  </button>
                  <span className="text-sm font-medium text-zinc-300">Dashboard</span>
                </div>
                <div className="flex items-center gap-3">
                  {user.image ? (
                    <img src={user.image} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <div className="grid size-8 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
                      {(user.name || user.email || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </header>
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

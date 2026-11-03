"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, LogOut, User, Gamepad2, ClipboardList, Settings, Ticket, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/dashboard/customer", icon: Gamepad2 },
  { label: "My Orders", href: "/dashboard/customer", icon: ClipboardList },
  { label: "Order History", href: "/dashboard/customer", icon: Ticket },
  { label: "Become a Booster", href: "/dashboard/customer/become-booster", icon: User },
  { label: "My Profile", href: "/dashboard/customer/profile", icon: User },
  { label: "Browse Games", href: "/games", icon: ArrowRight },
];

export function CustomerSidebar({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 border-r border-white/10 bg-[#111319] text-white transition-all duration-300",
        open ? "translate-x-0" : "-translate-x-full",
        "md:relative md:translate-x-0 md:shadow-none",
        className,
      )}
    >
      <div className="flex h-full flex-col">
        <div className="h-16 flex items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3" aria-label="LegendsBoost home">
            <span className="grid size-9 place-items-center rounded-lg bg-violet-500 text-lg font-black text-white shadow-[0_0_28px_rgba(139,92,246,0.45)]">L</span>
            <span className="font-bold tracking-tight text-white sm:text-base">Legends<span className="text-violet-400">Boost</span></span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="md:hidden p-2 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1" aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                "border-transparent bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
              aria-current={typeof window !== "undefined" && window.location.pathname === item.href ? "page" : undefined}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 font-semibold text-xs">
              JD
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">Customer</div>
              <div className="text-xs text-zinc-400 truncate">customer@legendsboost.com</div>
            </div>
            <button
              onClick={() => {
                document.dispatchEvent(new CustomEvent("signout"));
              }}
              className="ml-auto p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Account menu"
            >
              <Settings className="size-4" />
            </button>
          </div>
          <div className="mt-3">
            <form action="/api/auth/signout" method="POST" className="w-full">
              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function CustomerSidebarTrigger({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("md:hidden p-2 rounded-md text-zinc-200 hover:text-white hover:bg-white/10", className)}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur md:hidden" onClick={() => setOpen(false)} />
      )}
    </>
  );
}

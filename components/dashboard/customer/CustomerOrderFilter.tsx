"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { $Enums } from "@/app/generated/prisma/client";
import { formatStatusLabel } from "@/lib/orders/status-display";

interface CustomerOrderFilterProps {
  options: Array<{ label: string; value: string }>;
  selectedValue: string;
}

export function CustomerOrderFilter({ options, selectedValue }: CustomerOrderFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set("status", value);
    } else {
      params.delete("status");
    }

    params.delete("page");

    const query = params.toString();

    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="relative inline-block">
      <select
        value={selectedValue}
        onChange={(event) => handleChange(event.target.value)}
        className="appearance-none rounded-lg border border-white/10 bg-white/5 py-2.5 pl-3 pr-10 text-sm text-zinc-200 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40"
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
      </svg>
      {selectedValue && (
        <Link
          href={buildClearHref(pathname, searchParams)}
          className="ml-2 rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          Clear
        </Link>
      )}
    </div>
  );
}

function buildClearHref(pathname: string, searchParams: URLSearchParams): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("status");
  params.delete("page");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

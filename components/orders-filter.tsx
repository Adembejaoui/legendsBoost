"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };

export default function OrdersFilter({
  current,
  options,
}: {
  current: string;
  options: Option[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const url = value
      ? `/dashboard/customer?status=${encodeURIComponent(value)}`
      : "/dashboard/customer";
    startTransition(() => router.push(url));
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="status-filter" className="text-sm text-white/60">
        Status
      </label>
      <div className="relative">
        <select
          id="status-filter"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          disabled={isPending}
          className="appearance-none rounded-lg border border-white/10 bg-white/5 py-2 pl-3 pr-9 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
        >
          <option value="" className="bg-[#0b0f1a]">
            All statuses
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-[#0b0f1a]">
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
          fill="currentColor"
        >
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
        </svg>
      </div>

      {current ? (
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={isPending}
          className="rounded-lg px-3 py-2 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
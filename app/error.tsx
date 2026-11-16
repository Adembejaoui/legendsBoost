"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

/** Route-level error boundary: a failing page never shows a blank screen or a stack trace. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Reported to Sentry when configured (no-op otherwise); the digest links
    // this screen to the server-side event for support.
    Sentry.captureException(error);
    console.error("Page error", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-4 text-center text-white">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-sm text-zinc-400">
        This page could not be loaded. Please try again. If it keeps happening, contact support
        {error.digest ? (
          <>
            {" "}and mention code <code className="rounded bg-white/10 px-1 font-mono text-xs">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85]"
        >
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5">
          Home
        </Link>
      </div>
    </main>
  );
}

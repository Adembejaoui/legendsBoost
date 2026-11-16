"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/** Last-resort boundary (errors in the root layout itself). Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ background: "#0B0C10", color: "#fff", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 16, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, maxWidth: 420, margin: 0 }}>
            LegendsBoost could not load. Please try again in a moment.
            {error.digest ? ` (code ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: "#C8AA6E", color: "#0A0E14", border: 0, borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

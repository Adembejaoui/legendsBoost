import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "@/lib/monitoring";

/**
 * Next.js instrumentation: error monitoring (Sentry).
 *
 * Fully OFF unless SENTRY_DSN is set (server) / NEXT_PUBLIC_SENTRY_DSN
 * (browser, see instrumentation-client.ts). No personal data is sent
 * (lib/monitoring.ts turns off cookies, headers, bodies and user info). Errors shown on app/error.tsx carry a digest that
 * matches the Sentry event, so support can find it.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      dataCollection: SENTRY_DATA_COLLECTION,
    });
  }
}

/** Server errors in route handlers, server components and actions. */
export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!process.env.SENTRY_DSN) return;
  return Sentry.captureRequestError(...args);
};

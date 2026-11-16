import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Browser-side Supabase client.
 *
 * Configured for client-side use:
 *  - persistSession: false  (session is managed by Auth.js, not Supabase Auth)
 *  - autoRefreshToken: false (no Supabase Auth session to refresh)
 *  - detectSessionInUrl: false (no OAuth redirect handling here)
 *
 * This client is used for Realtime channels, broadcast listeners, and
 * presence tracking. It MUST NOT use the service-role key.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = SUPABASE_URL;
  const key = SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "See docs/SUPABASE-REALTIME-MIGRATION-AUDIT.md (Required environment configuration)."
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Singleton browser Supabase client.
 *
 * Safe to import from client components and browser hooks. Realtime
 * authentication is performed by calling `setRealtimeToken(jwt)` on the
 * realtime client returned by `getRealtimeSupabaseClient()`, never by
 * embedding secrets.
 */
let browserClient: SupabaseClient | null = null;
export function getBrowserSupabaseClient(): SupabaseClient {
  if (browserClient === null) {
    browserClient = createBrowserSupabaseClient();
  }
  return browserClient;
}

/**
 * Returns a Supabase client dedicated to Realtime connections.
 *
 * Callers authenticate the Realtime connection by invoking
 * `realtime.setAuth(realtimeJwt)` (from lib/supabase/realtime-auth.ts) before
 * subscribing to private channels. This keeps the custom JWT off the global
 * Auth.js session and out of REST requests.
 */
let realtimeClient: SupabaseClient | null = null;
export function getRealtimeSupabaseClient(): SupabaseClient {
  if (realtimeClient === null) {
    realtimeClient = createBrowserSupabaseClient();
  }
  return realtimeClient;
}

export type { SupabaseClient };

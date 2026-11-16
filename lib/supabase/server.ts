import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The project URL and anon key are public values, so the server falls back to
// the NEXT_PUBLIC_ variables when the server-only aliases are not configured.
// (Previously only SUPABASE_URL was read; it was never set, which silently
// disabled every server-side Realtime broadcast.)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Server-only configuration for Realtime REST broadcasts. Returns null when the
 * service-role key or project URL is missing. Never import from browser code.
 */
export function getRealtimeServerConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

/**
 * Server-only Supabase clients.
 *
 * These modules must only be imported from server-side code (API routes,
 * server actions, services). The service-role key is never exposed to the
 * browser because it is not a NEXT_PUBLIC_ variable.
 */

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const url = SUPABASE_URL;
  const anonKey = SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY on the server. " +
        "See docs/SUPABASE-REALTIME-MIGRATION-AUDIT.md (Required environment configuration)."
    );
  }
  return { url, anonKey };
}

/**
 * Server Supabase client using the anon key.
 *
 * Use for user-scoped server operations where the caller is already
 * authorized via the Auth.js session. Does not bypass RLS.
 */
export function createServerSupabaseClient(): SupabaseClient {
  const { url, anonKey } = requireSupabaseEnv();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let serverClient: SupabaseClient | null = null;
export function getServerSupabaseClient(): SupabaseClient {
  if (serverClient === null) {
    serverClient = createServerSupabaseClient();
  }
  return serverClient;
}

/**
 * Server Supabase client using the service-role key.
 *
 * Restricted to privileged server operations (e.g. server-initiated
 * Realtime broadcasts) where RLS must be bypassed. Never imported in
 * browser code and never passed to the client.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = SUPABASE_URL;
  const serviceRoleKey = SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type { SupabaseClient };

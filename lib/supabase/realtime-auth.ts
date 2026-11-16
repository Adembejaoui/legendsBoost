import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Auth.js <-> Supabase Realtime JWT bridge.
 *
 * LegendsBoost keeps Auth.js (NextAuth) as its authentication system. Supabase
 * Realtime does not accept NextAuth session tokens, so this module issues a
 * short-lived Supabase-compatible Realtime JWT signed with the project's
 * `SUPABASE_JWT_SECRET` after the caller has validated the Auth.js session and
 * performed channel-level authorization.
 *
 * Claims:
 *  - sub: authenticated user ID (from the verified server-side session ONLY)
 *  - role: "authenticated" (Supabase Realtime auth role)
 *  - aud: "authenticated"
 *  - iat / exp: issued-at and short-lived expiration
 *  - channel: the authorized private channel (informational; enforcement also
 *    happens at the token endpoint and at broadcast time)
 *
 * Never signs a token from a browser-supplied user ID. Never returns the
 * signing secret.
 */

const REACTIVE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface RealtimeTokenParams {
  userId: string;
  role: "authenticated" | "anon";
  channel?: string;
  ttlMs?: number;
}

export interface RealtimeTokenResult {
  token: string;
  expiresInMs: number;
  issuedAt: number;
}

export interface RealtimeTokenPayload extends JWTPayload {
  sub: string;
  role: string;
  aud: string;
  channel?: string;
}

function requireSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is not configured. Set it in .env (server-only) " +
        "and obtain it from the Supabase Dashboard -> Settings -> API -> JWT secret."
    );
  }
  return secret;
}

/**
 * Issue a short-lived Supabase Realtime JWT.
 *
 * Caller must have already validated the Auth.js session and authorized the
 * user for the requested channel. The userId must come from the verified
 * session, never from the browser.
 */
export async function issueRealtimeToken(
  params: RealtimeTokenParams
): Promise<RealtimeTokenResult> {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttlMs = params.ttlMs ?? REACTIVE_TTL_MS;
  const exp = now + Math.floor(ttlMs / 1000);
  const key = new Uint8Array(Buffer.from(secret, "utf-8"));

  const token = await new SignJWT({
    sub: params.userId,
    role: params.role,
    aud: "authenticated",
    ...(params.channel ? { channel: params.channel } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setSubject(params.userId)
    .sign(key);

  return {
    token,
    expiresInMs: ttlMs,
    issuedAt: now,
  };
}

/**
 * Verify and decode a Supabase Realtime JWT.
 *
 * Returns the payload on success, or null if the token is invalid, expired,
 * or signed with a different secret.
 */
export async function verifyRealtimeToken(
  token: string
): Promise<RealtimeTokenPayload | null> {
  if (!token || typeof token !== "string") {
    return null;
  }
  try {
    const secret = requireSecret();
    const key = new Uint8Array(Buffer.from(secret, "utf-8"));
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.sub !== "string") {
      return null;
    }
    return payload as RealtimeTokenPayload;
  } catch {
    return null;
  }
}

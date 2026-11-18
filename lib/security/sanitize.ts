/**
 * Text normalisation and simple in-memory rate limits.
 *
 * No HTML sanitizer here (2026-11-18): the app never renders user content as
 * HTML (React escapes all text), and the previous isomorphic-dompurify import
 * pulled jsdom into every server route that used this file, which crashed on
 * Vercel ("Failed to load external module jsdom ... ERR_REQUIRE_ESM").
 * If user HTML must ever be rendered, sanitize it in the browser.
 */

/** Longest plain-text value accepted from users (chat, tickets). */
export const MAX_TEXT_LENGTH = 10_000;

/**
 * Normalize user-supplied PLAIN text (chat messages, ticket subjects and
 * descriptions). It is stored as typed and always rendered as text by React,
 * which escapes it, so it must NOT be HTML-stripped or HTML-escaped here
 * (that used to turn "a < b" or "<3" into missing or "&lt;" text).
 * Removes control characters (keeps newlines and tabs), normalizes line
 * endings and caps the length. Never render the result with
 * dangerouslySetInnerHTML.
 */
export function sanitizeText(input: string): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Rate limiter for API endpoints.
 * Simple in-memory store - use Redis in production for distributed rate limiting.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number;
}

/** Reset every counter (tests). */
export function clearRateLimit(): void {
  rateLimitStore.clear();
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitCheck {
  const now = Date.now();
  const key = `${config.keyPrefix ?? "default"}:${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // First request or window expired
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
      retryAfter: 0,
    };
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
    retryAfter: 0,
  };
}

/**
 * Clean up expired rate limit entries periodically.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60000).unref?.(); // Clean up every minute

// Rate limit configs
export const MESSAGE_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 60000, // 1 minute
  keyPrefix: "msg",
};

/** Order chat messages (same limit as MESSAGE_RATE_LIMIT). */
export const ORDER_MESSAGE_RATE_LIMIT = MESSAGE_RATE_LIMIT;

export const SUPPORT_TICKET_RATE_LIMIT = {
  maxRequests: 5,
  windowMs: 3600000, // 1 hour
  keyPrefix: "ticket",
};

export const SUPPORT_MESSAGE_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 60000, // 1 minute
  keyPrefix: "support_msg",
};
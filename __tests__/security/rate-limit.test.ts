import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, ORDER_MESSAGE_RATE_LIMIT, SUPPORT_TICKET_RATE_LIMIT, SUPPORT_MESSAGE_RATE_LIMIT, clearRateLimit } from "@/lib/security/sanitize";

describe("Rate Limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRateLimit();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimit();
  });

  describe("checkRateLimit", () => {
    test("allows requests within limit", () => {
      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test("tracks request count per user", () => {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });

      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    test("blocks requests exceeding limit", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      }

      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test("separate limits for different users", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      }

      const result = checkRateLimit("user-2", { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test("resets after window expires", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      }

      expect(checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 }).allowed).toBe(false);

      // Advance time past window
      vi.advanceTimersByTime(61000);

      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    test("returns correct resetAt timestamp", () => {
      const now = Date.now();
      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.resetAt).toBeGreaterThanOrEqual(now + 60000 - 100);
      expect(result.resetAt).toBeLessThanOrEqual(now + 60000 + 100);
    });
  });

  describe("Rate limit configs", () => {
    test("ORDER_MESSAGE_RATE_LIMIT allows 30 messages per minute", () => {
      for (let i = 0; i < 30; i++) {
        const result = checkRateLimit("user-1", ORDER_MESSAGE_RATE_LIMIT);
        expect(result.allowed).toBe(true);
      }
      expect(checkRateLimit("user-1", ORDER_MESSAGE_RATE_LIMIT).allowed).toBe(false);
    });

    test("SUPPORT_TICKET_RATE_LIMIT allows 5 tickets per hour", () => {
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit("user-1", SUPPORT_TICKET_RATE_LIMIT);
        expect(result.allowed).toBe(true);
      }
      expect(checkRateLimit("user-1", SUPPORT_TICKET_RATE_LIMIT).allowed).toBe(false);
    });

    test("SUPPORT_MESSAGE_RATE_LIMIT allows 20 messages per minute", () => {
      for (let i = 0; i < 20; i++) {
        const result = checkRateLimit("user-1", SUPPORT_MESSAGE_RATE_LIMIT);
        expect(result.allowed).toBe(true);
      }
      expect(checkRateLimit("user-1", SUPPORT_MESSAGE_RATE_LIMIT).allowed).toBe(false);
    });
  });

  describe("clearRateLimit", () => {
    test("clears all rate limit data", () => {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      checkRateLimit("user-2", { maxRequests: 5, windowMs: 60000 });
      clearRateLimit();

      const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 60000 });
      expect(result.remaining).toBe(4);
    });
  });
});
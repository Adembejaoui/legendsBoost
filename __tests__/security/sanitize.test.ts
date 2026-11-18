import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeText } from "@/lib/security/sanitize";

// These cases deliberately pass invalid input to check runtime robustness;
// the cast states that intent instead of widening the production signature.
const invalid = (value: null | undefined) => value as unknown as string;

describe("XSS Sanitization", () => {
  describe("sanitizeText", () => {
    test("returns empty string for null/undefined", () => {
      expect(sanitizeText(invalid(null))).toBe("");
      expect(sanitizeText(invalid(undefined))).toBe("");
    });

    test("returns empty string for non-string input", () => {
      expect(sanitizeText(123 as any)).toBe("");
      expect(sanitizeText({} as any)).toBe("");
    });

    test("escapes HTML characters", () => {
      expect(sanitizeText("<script>alert('xss')</script>")).toBe(
        "<script>alert('xss')</script>"
      );
      expect(sanitizeText("<img src=x onerror=alert(1)>")).toBe(
        "<img src=x onerror=alert(1)>"
      );
    });

    test("handles normal text unchanged", () => {
      expect(sanitizeText("Hello world")).toBe("Hello world");
      expect(sanitizeText("Special chars: & < > ' \"")).toBe(
        "Special chars: & < > ' \""
      );
    });

    test("truncates long input", () => {
      const longText = "a".repeat(10001);
      const result = sanitizeText(longText);
      expect(result.length).toBe(10000);
    });
  });

  // Regression (2026-11-18): isomorphic-dompurify pulled jsdom into every server
  // route using this module and crashed on Vercel (ERR_REQUIRE_ESM). The module
  // must stay free of DOM libraries.
  test("does not load a DOM library on the server", () => {
    const src = readFileSync(join(__dirname, "..", "..", "lib", "security", "sanitize.ts"), "utf8");
    expect(src).not.toMatch(/from [\"'](isomorphic-dompurify|dompurify|jsdom)[\"']/);
  });
});
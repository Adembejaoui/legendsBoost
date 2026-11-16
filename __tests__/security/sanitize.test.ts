import { describe, expect, test } from "vitest";
import { sanitizeText, sanitizeHtml } from "@/lib/security/sanitize";

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

  describe("sanitizeHtml", () => {
    test("allows safe HTML tags", () => {
      expect(sanitizeHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
      expect(sanitizeHtml("<b>Bold</b> and <i>italic</i>")).toBe(
        "<b>Bold</b> and <i>italic</i>"
      );
      expect(sanitizeHtml("<a href='https://example.com'>Link</a>")).toBe(
        "<a href=\"https://example.com\" rel=\"noopener noreferrer\" target=\"_blank\">Link</a>"
      );
    });

    test("strips dangerous tags", () => {
      expect(sanitizeHtml("<script>alert('xss')</script>")).toBe("");
      expect(sanitizeHtml("<iframe src='evil.com'></iframe>")).toBe("");
      expect(sanitizeHtml("<object data='evil.swf'></object>")).toBe("");
      expect(sanitizeHtml("<embed src='evil.swf'>")).toBe("");
    });

    test("strips event handlers", () => {
      expect(sanitizeHtml("<img src=x onerror=alert(1)>")).toBe(
        "<img src=\"x\">"
      );
      expect(sanitizeHtml("<div onclick='alert(1)'>Click</div>")).toBe(
        "<div>Click</div>"
      );
    });

    test("strips javascript: URLs", () => {
      expect(sanitizeHtml("<a href='javascript:alert(1)'>Click</a>")).toBe(
        "<a>Click</a>"
      );
      expect(sanitizeHtml("<a href='JAVASCRIPT:alert(1)'>Click</a>")).toBe(
        "<a>Click</a>"
      );
    });

    test("returns empty string for null/undefined", () => {
      expect(sanitizeHtml(invalid(null))).toBe("");
      expect(sanitizeHtml(invalid(undefined))).toBe("");
    });

    test("handles empty string", () => {
      expect(sanitizeHtml("")).toBe("");
    });

    test("preserves allowed attributes", () => {
      expect(sanitizeHtml("<p class='text' id='para'>Text</p>")).toBe(
        "<p class=\"text\" id=\"para\">Text</p>"
      );
      expect(sanitizeHtml("<img src='image.png' alt='Image'>")).toBe(
        "<img src=\"image.png\" alt=\"Image\">"
      );
    });

    test("strips disallowed attributes", () => {
      expect(sanitizeHtml("<img src='x' onload='alert(1)'>")).toBe(
        "<img src=\"x\">"
      );
      expect(sanitizeHtml("<div style='behavior:url(xss.htc)'>XSS</div>")).toBe(
        "<div>XSS</div>"
      );
    });
  });
});
import '@testing-library/jest-dom/vitest'

import { vi } from "vitest";

// The booster "Complete" Riot check is tested on its own
// (__tests__/orders/completion-check.test.ts); other tests assume the target
// is confirmed so they exercise the completion flow itself.
vi.mock("@/lib/orders/completion-check", () => ({
  checkCompletion: vi.fn(async () => ({ result: "reached", detail: "test" })),
  assertBoosterCompletionConfirmed: vi.fn(async () => {}),
  COMPLETION_FRESHNESS_MS: 15 * 60_000,
}));

// Site languages (2026-11-23): components render in English in tests.
// Language-aware links and router behave like the plain Next.js ones (which
// tests mock themselves), and translation hooks read messages/en.json.
vi.mock("@/i18n/navigation", async () => {
  const link = await import("next/link");
  const nav = await import("next/navigation");
  return {
    Link: link.default,
    useRouter: nav.useRouter,
    usePathname: () => (typeof window === "undefined" ? "/" : window.location.pathname),
    redirect: (h: unknown) => {
      throw new Error(`redirect ${JSON.stringify(h)}`);
    },
    getPathname: ({ href }: { href: string }) => href,
  };
});
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { createTranslator } = await import("use-intl/core");
  const messages = (await import("@/messages/en.json")).default;
  return {
    ...actual,
    useLocale: () => "en",
    useTranslations: (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

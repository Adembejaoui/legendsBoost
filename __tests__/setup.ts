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

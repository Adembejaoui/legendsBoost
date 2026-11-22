/**
 * Realtime test 2026-11-22: pop-ups and sounds still arrive while the live
 * connection is down (here realtime is not configured at all), each
 * notification exactly once, and never for notifications from before the
 * page was opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNotificationAlerts, type AlertNotification } from "@/components/realtime/useNotificationAlerts";
import { LIVE_POLL_MS } from "@/components/realtime/LiveRefresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let served: { id: string; type: string; title: string; createdAt: string }[] = [];
const got: AlertNotification[] = [];
let root: Root;

function Probe() {
  useNotificationAlerts("user-1", (n) => got.push(n));
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  served = [{ id: "old", type: "NEW_MESSAGE", title: "New Message", createdAt: "2026-11-22T11:00:00Z" }];
  got.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ notifications: [...served].reverse() }) }))
  );
  const el = document.createElement("div");
  root = createRoot(el);
  await act(async () => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
  });
}

describe("notification alerts without a live connection", () => {
  it("are checked every 20 s and each new notification is handled once", async () => {
    await tick();
    expect(got).toEqual([]); // the one from before the page opened is not alerted

    served.push(
      { id: "tip-1", type: "TIP_RECEIVED", title: "You Got A Tip", createdAt: "2026-11-22T12:00:10Z" },
      { id: "pause-1", type: "ORDER_PROGRESS_UPDATED", title: "Order Paused - Stop Boosting", createdAt: "2026-11-22T12:00:15Z" }
    );
    await tick();
    expect(got.map((n) => n.id)).toEqual(["tip-1", "pause-1"]); // oldest first

    await tick();
    expect(got).toHaveLength(2); // never twice
  });

  it("stop when the page is closed", async () => {
    act(() => root.unmount());
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    root = createRoot(document.createElement("div")); // for afterEach
  });
});

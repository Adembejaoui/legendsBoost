/**
 * Alert sounds and desktop notifications (sound test 2026-11-22): the
 * booster must be alerted while the dashboard is behind another tab or
 * window, and sound must work at once when the browser already allows it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Mod = typeof import("@/components/realtime/new-order-alert");

class FakeAudioContext {
  static startState: "running" | "suspended" = "suspended";
  state: "running" | "suspended" = FakeAudioContext.startState;
  currentTime = 0;
  destination = {};
  oscillators = 0;
  listeners: (() => void)[] = [];
  addEventListener(_: string, cb: () => void) {
    this.listeners.push(cb);
  }
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    this.oscillators++;
    return { type: "", frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (g: unknown) => g, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d };
  }
}

const shown: { title: string; opts: NotificationOptions }[] = [];
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  constructor(title: string, opts: NotificationOptions) {
    shown.push({ title, opts });
  }
  close() {}
}

let ctx: FakeAudioContext | null = null;
async function load(): Promise<Mod> {
  vi.resetModules();
  return import("@/components/realtime/new-order-alert");
}

beforeEach(() => {
  shown.length = 0;
  localStorage.clear();
  FakeNotification.permission = "granted";
  FakeAudioContext.startState = "suspended";
  ctx = null;
  vi.stubGlobal(
    "AudioContext",
    class extends FakeAudioContext {
      constructor() {
        super();
        ctx = this; // eslint-disable-line @typescript-eslint/no-this-alias
      }
    }
  );
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function background(hidden: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(!hidden);
}

describe("sound permission", () => {
  it("a browser that already allows sound for the site plays without a new click", async () => {
    FakeAudioContext.startState = "running";
    const m = await load();
    m.armSoundUnlock();
    expect(m.soundUnlocked()).toBe(true);
    m.playTipSound();
    expect(ctx!.oscillators).toBe(3);
  });

  it("otherwise it stays silent until the first click", async () => {
    const m = await load();
    m.armSoundUnlock();
    expect(m.soundUnlocked()).toBe(false);
    m.playPauseSound();
    expect(ctx!.oscillators).toBe(0);
    window.dispatchEvent(new Event("pointerdown"));
    expect(m.soundUnlocked()).toBe(true);
    m.playPauseSound();
    expect(ctx!.oscillators).toBe(2);
  });

  it("muting the order sound also silences the tip, pause and admin alerts", async () => {
    FakeAudioContext.startState = "running";
    const m = await load();
    m.armSoundUnlock();
    m.setSoundMuted(true);
    m.playTipSound();
    m.playPauseSound();
    m.playAlertSound();
    expect(ctx!.oscillators).toBe(0);
  });
});

describe("desktop notification for a new order", () => {
  it("pops up when the tab is in the background and the booster allowed it", async () => {
    const m = await load();
    background(true);
    expect(m.showDesktopNotification({ title: "New order available", url: "/dashboard/booster/available-orders", tag: "t" })).toBe(true);
    expect(shown).toEqual([{ title: "New order available", opts: expect.objectContaining({ tag: "t" }) }]);
  });

  it("not while the booster is looking at the page (the pop-up and sound in the page are enough)", async () => {
    const m = await load();
    background(false);
    expect(m.showDesktopNotification({ title: "x" })).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it("not without permission, and not when the order sound is muted", async () => {
    const m = await load();
    background(true);
    FakeNotification.permission = "default";
    expect(m.showDesktopNotification({ title: "x" })).toBe(false);
    FakeNotification.permission = "granted";
    m.setSoundMuted(true);
    expect(m.showDesktopNotification({ title: "x" })).toBe(false);
  });

  it("asks for permission only once it has not been decided", async () => {
    const m = await load();
    FakeNotification.permission = "default";
    await m.requestDesktopPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    FakeNotification.permission = "denied";
    await m.requestDesktopPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });
});

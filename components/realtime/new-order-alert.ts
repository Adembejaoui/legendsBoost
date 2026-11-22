/**
 * "New order" sound for boosters (decision 2026-11-16: "halla moudir").
 *
 * Browsers block sound until the user has interacted with the page, so the
 * alert stays silent until the first click / key press (or the "Turn on
 * sound" button). Every alert plays a short built-in chime (Web Audio, no
 * file needed), then the voice: a recorded clip at /sounds/new-order.mp3 when
 * present, otherwise the browser says the words with speech synthesis.
 * Boosters can mute it; the choice is remembered in this browser.
 *
 * Sound test 2026-11-22 (alert silent when the dashboard was behind another
 * tab): the audio engine is now created as soon as the page loads, so a
 * browser that already allows sound for this site (the booster used it
 * before) plays at once without a new click; and the booster can allow
 * desktop notifications, which pop up with the system sound while the tab
 * or the whole window is in the background.
 */

export const NEW_ORDER_PHRASE = "halla moudir";
const CLIP_URL = "/sounds/new-order.mp3";
const MUTE_KEY = "lb.newOrderSound";

let unlocked = false;
let listening = false;
let ctx: AudioContext | null = null;
let listeners: (() => void)[] = [];

function emit() {
  listeners.forEach((l) => l());
}

/** For useSyncExternalStore. */
export function subscribeSound(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function markUnlocked(): void {
  if (!unlocked) {
    unlocked = true;
    emit();
  }
}

/**
 * Create the audio engine now. When the browser already allows sound for
 * this site it starts "running" and no click is needed.
 */
function primeAudio(): void {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === "running") markUnlocked();
  ac.addEventListener?.("statechange", () => {
    if (ac.state === "running") markUnlocked();
  });
  void ac.resume?.().then(() => {
    if (ac.state === "running") markUnlocked();
  }).catch(() => {});
}

/** Wake a suspended engine (a background tab may suspend it). Never throws. */
function wake(ac: AudioContext): void {
  if (ac.state === "suspended") void ac.resume().catch(() => {});
}

/** Mark sound as allowed (must run inside a user gesture). */
export function unlockSound(): void {
  if (typeof window === "undefined") return;
  void audioContext()?.resume().catch(() => {});
  if (!unlocked) {
    unlocked = true;
    emit();
  }
}

/** Start listening for the first user gesture (idempotent). */
export function armSoundUnlock(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const unlock = () => {
    unlockSound();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  primeAudio();
}

/* Desktop notifications ------------------------------------------------ */

export type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as DesktopPermission;
}

/** Ask once, from a click. Resolves to the new permission. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() !== "default") return desktopPermission();
  try {
    await Notification.requestPermission();
  } catch {
    /* old browsers: callback form, ignored */
  }
  emit();
  return desktopPermission();
}

/** True while the booster is not looking at this page (other tab, other window, minimised). */
export function pageInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus();
}

/**
 * A system notification (with the system sound) when the page is in the
 * background and the booster allowed it. Clicking it brings the tab back and
 * opens `url`. Never throws.
 */
export function showDesktopNotification(p: { title: string; body?: string; url?: string; tag?: string }): boolean {
  try {
    if (desktopPermission() !== "granted" || !pageInBackground() || soundMuted()) return false;
    const n = new Notification(p.title, { body: p.body, tag: p.tag, icon: "/favicon.ico", requireInteraction: false });
    n.onclick = () => {
      window.focus();
      if (p.url) window.location.assign(p.url);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function soundUnlocked(): boolean {
  return unlocked;
}

export function soundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "off");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* storage blocked: stays on */
  }
  emit();
}

/** Two rising notes, ~0.5 s. */
function chime(): void {
  const ac = audioContext();
  if (!ac) return;
  wake(ac);
  const start = ac.currentTime + 0.02;
  [880, 1318.5].forEach((freq, i) => {
    const t = start + i * 0.18;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

function speak(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(NEW_ORDER_PHRASE);
  const voices = window.speechSynthesis.getVoices();
  const arabic = voices.find((v) => v.lang.toLowerCase().startsWith("ar"));
  if (arabic) u.voice = arabic;
  u.lang = arabic?.lang ?? "ar";
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** Play the alert if the page is allowed to make sound and it is not muted. Never throws. */
export function playNewOrderSound(opts: { force?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  if (!opts.force && (!unlocked || soundMuted())) return;
  try {
    chime();
  } catch {
    /* no Web Audio */
  }
  setTimeout(() => {
    try {
      const audio = new Audio(CLIP_URL);
      audio.volume = 0.9;
      audio.play().catch(() => speak());
    } catch {
      speak();
    }
  }, 550);
}

/**
 * Short "new message" ding for the customer when their booster writes in the
 * order chat (client PDF 2026-11-21), including while the chat is open.
 * Silent until the page has had a click or key press (browser rule). Never throws.
 */
export function playMessageSound(): void {
  try {
    if (!unlocked) return;
    const ac = audioContext();
    if (!ac) return;
    wake(ac);
    const t = ac.currentTime + 0.02;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1046.5, t);
    osc.frequency.exponentialRampToValueAtTime(784, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.37);
  } catch {
    /* sound is best effort */
  }
}

/** Admin alert (booster change request, booster abandoned): the two-note chime only. Never throws. */
export function playAlertSound(): void {
  try {
    if (unlocked && !soundMuted()) chime();
  } catch {
    /* sound is best effort */
  }
}

/** Tip received: three bright rising notes ("coin"). Never throws. */
export function playTipSound(): void {
  try {
    if (!unlocked || soundMuted()) return;
    const ac = audioContext();
    if (!ac) return;
    wake(ac);
    const start = ac.currentTime + 0.02;
    [1046.5, 1318.5, 1568].forEach((freq, i) => {
      const t = start + i * 0.11;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.27);
    });
  } catch {
    /* sound is best effort */
  }
}

/** Order paused: two falling notes. Never throws. */
export function playPauseSound(): void {
  try {
    if (!unlocked || soundMuted()) return;
    const ac = audioContext();
    if (!ac) return;
    wake(ac);
    const start = ac.currentTime + 0.02;
    [987.8, 659.3].forEach((freq, i) => {
      const t = start + i * 0.2;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  } catch {
    /* sound is best effort */
  }
}

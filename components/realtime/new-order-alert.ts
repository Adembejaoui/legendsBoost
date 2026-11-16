/**
 * "New order" sound for boosters (decision 2026-11-16: "halla moudir").
 *
 * Browsers block sound until the user has interacted with the page, so the
 * alert stays silent until the first click / key press (or the "Turn on
 * sound" button). Every alert plays a short built-in chime (Web Audio, no
 * file needed), then the voice: a recorded clip at /sounds/new-order.mp3 when
 * present, otherwise the browser says the words with speech synthesis.
 * Boosters can mute it; the choice is remembered in this browser.
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

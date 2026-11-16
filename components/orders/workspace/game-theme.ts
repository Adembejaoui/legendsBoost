import type { CSSProperties } from "react";

/**
 * Per-game colours for the order workspace. Set as CSS variables on the
 * workspace root; panels use `var(--g-accent)` etc. The gold LoL values are
 * also the :root defaults (app/globals.css) so portals and dialogs fall back
 * to the site theme.
 */
export interface GameTheme {
  /** Main accent (buttons, icons, progress). */
  accent: string;
  /** Lighter accent for text on dark. */
  light: string;
  /** Button hover. */
  hover: string;
  /** Accent as "r,g,b" for rgba() glows. */
  rgb: string;
  /** Secondary colour (gradients, second glow) as "r,g,b". */
  secondRgb: string;
  /** Text colour on top of the accent. */
  onAccent: string;
}

const LOL: GameTheme = { accent: "#C8AA6E", light: "#e3c98f", hover: "#d8bc85", rgb: "200,170,110", secondRgb: "10,200,185", onAccent: "#0A0E14" };

export const GAME_THEMES: Record<string, GameTheme> = {
  "league-of-legends": LOL,
  valorant: { accent: "#FF4655", light: "#ff8f98", hover: "#ff6370", rgb: "255,70,85", secondRgb: "236,232,225", onAccent: "#0F1923" },
  "teamfight-tactics": { accent: "#B48CFF", light: "#d4bdff", hover: "#c3a3ff", rgb: "180,140,255", secondRgb: "240,178,50", onAccent: "#120a24" },
};

export function gameTheme(slug: string): GameTheme {
  return GAME_THEMES[slug] ?? LOL;
}

export function gameThemeStyle(slug: string): CSSProperties {
  const t = gameTheme(slug);
  return {
    "--g-accent": t.accent,
    "--g-light": t.light,
    "--g-hover": t.hover,
    "--g-rgb": t.rgb,
    "--g-rgb2": t.secondRgb,
    "--g-on": t.onAccent,
  } as CSSProperties;
}

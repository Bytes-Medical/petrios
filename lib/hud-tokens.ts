/**
 * Clinical HUD colour tokens for the public site (spec/13 accessibility
 * baseline). These mirror the custom properties in
 * components/hud/hud.module.css; lib/hud-tokens.test.ts fails if the two
 * drift apart. The signed-in app does not use them.
 */

/** Opaque tokens, Day (the default display). */
export const HUD_DAY = {
  bg: '#F0EEE6',
  surface: '#FAF9F5',
  sunk: '#F5F4EF',
  ink: '#1F1D1A',
  inkHover: '#2E2A25',
  graphite: '#5D5749',
  caption: '#6D6759',
  clay: '#A95134',
  clayStrong: '#A04A30',
  clayFill: '#A95134',
  clayFillHover: '#A04A30',
  onClay: '#FAF9F5',
  clayWash: '#FBF3EF',
  edge: '#1F1D1A',
  hairline: '#CBC6BA',
  focus: '#A04A30',
  termBg: '#1F1D1A',
  termInk: '#F0EEE6',
  termPrompt: '#DF9377',
  termDim: '#A8A292',
} as const

export type HudTokenName = keyof typeof HUD_DAY

/** Opaque tokens, Night (explicit choice, or Match device on a dark OS). */
export const HUD_NIGHT: Record<HudTokenName, string> = {
  bg: '#1F1D1A',
  surface: '#282520',
  sunk: '#211E19',
  ink: '#F0EEE6',
  inkHover: '#CBC6BA',
  graphite: '#CBC6BA',
  caption: '#A8A292',
  clay: '#DF9377',
  clayStrong: '#E5AE97',
  clayFill: '#D97757',
  clayFillHover: '#DF9377',
  onClay: '#1F1D1A',
  clayWash: '#413028',
  edge: '#A8A292',
  hairline: '#4A453D',
  focus: '#DF9377',
  termBg: '#141210',
  termInk: '#F0EEE6',
  termPrompt: '#DF9377',
  termDim: '#A8A292',
}

/** Translucent, decorative tokens. They never carry meaning on their own. */
export const HUD_DAY_TRANSLUCENT = {
  panelShadow: 'rgb(31 29 26 / 0.08)',
  dot: 'rgb(31 29 26 / 0.14)',
  tick: 'rgb(31 29 26 / 0.30)',
  gridMinor: 'rgb(169 81 52 / 0.09)',
  gridMajor: 'rgb(169 81 52 / 0.20)',
  glow: 'rgb(217 119 87 / 0.55)',
  glowSoft: 'rgb(217 119 87 / 0.18)',
} as const

export const HUD_NIGHT_TRANSLUCENT: Record<keyof typeof HUD_DAY_TRANSLUCENT, string> = {
  panelShadow: 'rgb(0 0 0 / 0.45)',
  dot: 'rgb(240 238 230 / 0.10)',
  tick: 'rgb(240 238 230 / 0.30)',
  gridMinor: 'rgb(217 119 87 / 0.07)',
  gridMajor: 'rgb(217 119 87 / 0.15)',
  glow: 'rgb(223 147 119 / 0.75)',
  glowSoft: 'rgb(223 147 119 / 0.22)',
}

/** `clayFillHover` -> `--hud-clay-fill-hover`. */
export function hudCssVar(name: string): string {
  return `--hud-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/**
 * Alpha-composites `rgb(r g b / a)` (or an opaque hex) over an opaque hex
 * ground and returns the blended hex, for contrast checks of text drawn over
 * translucent decoration such as the ECG grid.
 */
export function compositeOver(foreground: string, ground: string): string {
  const [red, green, blue, alpha] = parseColor(foreground)
  const [groundRed, groundGreen, groundBlue, groundAlpha] = parseColor(ground)
  if (groundAlpha !== 1) throw new Error(`compositeOver needs an opaque ground, got ${ground}`)
  const mix = (top: number, bottom: number) => Math.round(alpha * top + (1 - alpha) * bottom)
  return `#${[mix(red, groundRed), mix(green, groundGreen), mix(blue, groundBlue)]
    .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
    .join('')}`
}

function parseColor(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const digits = hex[1]
    return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)).concat(1) as [number, number, number, number]
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/.exec(value.trim())
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])]
  throw new Error(`Unsupported colour: ${value}`)
}

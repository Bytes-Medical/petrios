import {
  compositeOver,
  HUD_DAY,
  HUD_DAY_TRANSLUCENT,
  HUD_NIGHT,
  HUD_NIGHT_TRANSLUCENT,
} from './hud-tokens'
import type { HudTokenName } from './hud-tokens'

/** Normal-text palette values with their required light surfaces. */
export const ACCESSIBLE_TEXT_COLORS = {
  gray500: '#6D6759',
  clay600: '#A95134',
  paper: '#F0EEE6',
  white: '#FAF9F5',
} as const

/** `[name, foreground, background]`, all opaque hex. */
export type ColorPair = readonly [name: string, foreground: string, background: string]

type HudPalette = Record<HudTokenName, string>
type HudTranslucent = Record<keyof typeof HUD_DAY_TRANSLUCENT, string>

function hudModes(): ReadonlyArray<[mode: string, opaque: HudPalette, translucent: HudTranslucent]> {
  return [
    ['Day', HUD_DAY, HUD_DAY_TRANSLUCENT],
    ['Night', HUD_NIGHT, HUD_NIGHT_TRANSLUCENT],
  ]
}

/**
 * Public HUD text pairs that must reach 4.5:1 (spec/13 "Public HUD tokens").
 * Clay on bg is used only at 14px and up. Caption text directly on the ECG
 * grid is forbidden rather than asserted (Day 4.05 on a 5 mm line and 3.64
 * on an intersection; Night 4.37 on an intersection), which is why the strip
 * caption sits on a surface backing.
 */
export const HUD_TEXT_PAIRS: ReadonlyArray<ColorPair> = hudModes().flatMap(([mode, t, tr]) => {
  const gridMajor = compositeOver(tr.gridMajor, t.surface)
  const gridCross = compositeOver(tr.gridMinor, gridMajor)
  const pairs: Array<[string, string, string]> = [
    ['ink on bg', t.ink, t.bg],
    ['ink on surface', t.ink, t.surface],
    ['ink on sunk', t.ink, t.sunk],
    ['ink on wash', t.ink, t.clayWash],
    ['graphite on bg', t.graphite, t.bg],
    ['graphite on surface', t.graphite, t.surface],
    ['graphite on sunk', t.graphite, t.sunk],
    ['graphite on wash', t.graphite, t.clayWash],
    ['caption on bg', t.caption, t.bg],
    ['caption on surface', t.caption, t.surface],
    ['caption on sunk', t.caption, t.sunk],
    ['clay on surface', t.clay, t.surface],
    ['clay on sunk', t.clay, t.sunk],
    ['clay on wash', t.clay, t.clayWash],
    ['clay on bg (14px and up)', t.clay, t.bg],
    ['clay-strong on surface', t.clayStrong, t.surface],
    ['clay-strong on wash', t.clayStrong, t.clayWash],
    ['clay-strong on bg', t.clayStrong, t.bg],
    ['on-clay on clay-fill', t.onClay, t.clayFill],
    ['on-clay on clay-fill-hover', t.onClay, t.clayFillHover],
    ['surface on ink (ink CTA)', t.surface, t.ink],
    ['surface on ink-hover', t.surface, t.inkHover],
    ['term-ink on term-bg', t.termInk, t.termBg],
    ['term-prompt on term-bg', t.termPrompt, t.termBg],
    ['term-dim on term-bg', t.termDim, t.termBg],
    ['ink tagline on ECG 5 mm line', t.ink, gridMajor],
    ['ink tagline on ECG intersection', t.ink, gridCross],
  ]
  return pairs.map(([name, fg, bg]) => [`${mode}: ${name}`, fg, bg] as const)
})

/** Public HUD non-text pairs (edges, focus, marks) that must reach 3:1. */
export const HUD_UI_PAIRS: ReadonlyArray<ColorPair> = hudModes().flatMap(([mode, t, tr]) => {
  const gridMajor = compositeOver(tr.gridMajor, t.surface)
  const pairs: Array<[string, string, string]> = [
    ['edge on bg', t.edge, t.bg],
    ['edge on surface', t.edge, t.surface],
    ['focus on bg', t.focus, t.bg],
    ['focus on surface', t.focus, t.surface],
    ['clay-fill mark on surface', t.clayFill, t.surface],
    ['clay-fill mark on bg', t.clayFill, t.bg],
    ['clay-fill trace over ECG 5 mm line', t.clayFill, gridMajor],
    ['caption dashed edge on surface', t.caption, t.surface],
    ['caption dashed edge on sunk', t.caption, t.sunk],
    ['clay border on wash', t.clay, t.clayWash],
  ]
  return pairs.map(([name, fg, bg]) => [`${mode}: ${name}`, fg, bg] as const)
})

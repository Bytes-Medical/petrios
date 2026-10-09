import { describe, expect, it } from 'vitest'
import { ACCESSIBLE_TEXT_COLORS as colors, HUD_TEXT_PAIRS, HUD_UI_PAIRS } from './accessibility-colors'

function channel(hex: string): number {
  const value = Number.parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '')
  const [red, green, blue] = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)]
    .map(channel)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('normal text colour tokens', () => {
  it.each([
    ['gray500 on paper', colors.gray500, colors.paper],
    ['gray500 on white', colors.gray500, colors.white],
    ['clay600 on paper', colors.clay600, colors.paper],
    ['clay600 on white', colors.clay600, colors.white],
    ['white on clay600', colors.white, colors.clay600],
  ])('%s remains at WCAG AA 4.5:1 or better', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('public HUD colour tokens', () => {
  it('covers both displays', () => {
    for (const pairs of [HUD_TEXT_PAIRS, HUD_UI_PAIRS]) {
      expect(pairs.some(([name]) => name.startsWith('Day: '))).toBe(true)
      expect(pairs.some(([name]) => name.startsWith('Night: '))).toBe(true)
      expect(pairs.every(([, fg, bg]) => /^#[0-9A-F]{6}$/i.test(fg) && /^#[0-9A-F]{6}$/i.test(bg))).toBe(true)
    }
  })

  it.each(HUD_TEXT_PAIRS)('%s reaches WCAG AA 4.5:1 for text', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(HUD_UI_PAIRS)('%s reaches 3:1 for non-text UI', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })
})

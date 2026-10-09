import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compositeOver,
  HUD_DAY,
  HUD_DAY_TRANSLUCENT,
  HUD_NIGHT,
  HUD_NIGHT_TRANSLUCENT,
  hudCssVar,
} from './hud-tokens'

const css = readFileSync(path.resolve(__dirname, '../components/hud/hud.module.css'), 'utf8')

/** Body of the first top-level rule whose selector is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)
  if (!match) throw new Error(`No rule for ${selector} in hud.module.css`)
  return match[1]
}

function mediaBody(source: string, query: string): string {
  const start = source.indexOf(`@media ${query} {`)
  if (start === -1) throw new Error(`No @media ${query} block`)
  let depth = 0
  for (let at = source.indexOf('{', start); at < source.length; at++) {
    if (source[at] === '{') depth++
    if (source[at] === '}' && --depth === 0) return source.slice(source.indexOf('{', start) + 1, at)
  }
  throw new Error(`Unclosed @media ${query} block`)
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--hud-[a-z-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim()
  return out
}

function asCssVars(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens).map(([name, value]) => [hudCssVar(name), value]))
}

const day = declarations(ruleBody(css, '.hud'))
const night = declarations(ruleBody(css, '.hud[data-display="night"]'))
const auto = declarations(ruleBody(mediaBody(css, '(prefers-color-scheme: dark)'), '.hud[data-display="auto"]'))
const opaque = (tokens: Record<string, string>) =>
  Object.fromEntries(Object.entries(tokens).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value)))
const translucent = (tokens: Record<string, string>) =>
  Object.fromEntries(Object.entries(tokens).filter(([, value]) => !/^#[0-9a-f]{6}$/i.test(value)))

describe('hud.module.css token drift guard', () => {
  it('finds the three token blocks', () => {
    expect(Object.keys(day).length).toBeGreaterThan(20)
    expect(Object.keys(night).length).toBeGreaterThan(20)
    expect(Object.keys(auto).length).toBeGreaterThan(20)
  })

  it('Day opaque tokens equal HUD_DAY', () => {
    expect(opaque(day)).toEqual(asCssVars(HUD_DAY))
  })

  it('Night opaque tokens equal HUD_NIGHT', () => {
    expect(opaque(night)).toEqual(asCssVars(HUD_NIGHT))
  })

  it('translucent decoration tokens match the TS records', () => {
    expect(translucent(day)).toEqual(asCssVars(HUD_DAY_TRANSLUCENT))
    expect(translucent(night)).toEqual(asCssVars(HUD_NIGHT_TRANSLUCENT))
  })

  it('Match device on a dark OS is exactly Night', () => {
    expect(auto).toEqual(night)
    expect(ruleBody(mediaBody(css, '(prefers-color-scheme: dark)'), '.hud[data-display="auto"]')).toContain(
      'color-scheme: dark'
    )
  })

  it('Day and Night declare the same token names', () => {
    expect(Object.keys(night).sort()).toEqual(Object.keys(day).sort())
  })

  it('keeps the HUD free of dark: utilities and font-family redeclarations', () => {
    expect(css).not.toMatch(/font-family\s*:/)
    expect(css).not.toMatch(/\bdark:/)
  })
})

describe('hud token helpers', () => {
  it('maps camelCase names to custom properties', () => {
    expect(hudCssVar('clayFillHover')).toBe('--hud-clay-fill-hover')
    expect(hudCssVar('bg')).toBe('--hud-bg')
  })

  it('composites translucent decoration over an opaque ground', () => {
    expect(compositeOver(HUD_DAY_TRANSLUCENT.gridMajor, HUD_DAY.surface)).toBe('#EAD7CE')
    expect(compositeOver(HUD_DAY_TRANSLUCENT.gridMinor, '#EAD7CE')).toBe('#E4CBC0')
    expect(compositeOver('#123456', HUD_DAY.bg)).toBe('#123456')
    expect(() => compositeOver('#123456', 'rgb(0 0 0 / 0.5)')).toThrow()
  })
})

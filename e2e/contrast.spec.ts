import { test, expect, type Page } from '@playwright/test'
import { DISPLAY_COOKIE, type Display } from '../lib/public-display'

/**
 * In-page WCAG contrast probe for the public HUD (spec/13 "Public HUD
 * tokens"), in Day and Night. It measures every rendered text node against
 * the backing it is actually painted on, with no new dependency, and also
 * enforces the 12px floor and the no-small-text-on-a-grid rule.
 */

const ROUTES = [
  '/',
  '/features',
  '/news',
  '/open-source',
  '/contributors',
  '/privacy',
  '/privacy/choices',
  '/subprocessors',
  '/data-processing-agreement',
] as const

const ROOT_BACKGROUND: Record<Exclude<Display, 'auto'>, string> = {
  day: 'rgb(240, 238, 230)',
  night: 'rgb(31, 29, 26)',
}

interface Offender {
  rule: string
  text: string
  detail: string
}

async function finishHudAnimations(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    const root = document.querySelector('[data-hud-root]')
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target && root?.contains(target)) animation.finish()
    }
  })
}

/** Runs in the page, so it must stay self-contained. */
function probe(): { checked: number; offenders: Offender[] } {
  type Rgba = [number, number, number, number]
  const offenders: Offender[] = []
  const root = document.querySelector('[data-hud-root]')
  if (!root) return { checked: 0, offenders: [{ rule: 'setup', text: '', detail: 'no [data-hud-root]' }] }

  const parse = (value: string): Rgba | null => {
    const match =
      /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(value.trim())
    if (!match) return null
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1)
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha]
  }
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top[3]
    return [
      top[0] * alpha + bottom[0] * (1 - alpha),
      top[1] * alpha + bottom[1] * (1 - alpha),
      top[2] * alpha + bottom[2] * (1 - alpha),
      1,
    ]
  }
  const luminance = (color: Rgba) => {
    const linear = (channel: number) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
  }
  const contrast = (a: Rgba, b: Rgba) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (high + 0.05) / (low + 0.05)
  }
  const show = (color: Rgba) => `rgb(${color.slice(0, 3).map(Math.round).join(' ')})`
  const name = (element: Element) =>
    `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
      element.getAttribute('data-part') ? `[data-part=${element.getAttribute('data-part')}]` : ''
    }`

  // The ECG strip is the one grid text may sit on. Measure against its
  // worst pixel, where both 5 mm lines and both 1 mm lines cross.
  const strip = root.querySelector('[data-part="strip"]')
  let gridLayers: Rgba[] = []
  if (strip) {
    // Custom properties compute to their authored tokens, which the CSS
    // pipeline may minify to hex, so a real colour property normalises them.
    const resolve = (token: string) => {
      const swatch = document.createElement('span')
      swatch.style.backgroundColor = `var(${token})`
      strip.appendChild(swatch)
      const value = parse(getComputedStyle(swatch).backgroundColor)
      swatch.remove()
      return value
    }
    const major = resolve('--hud-grid-major')
    const minor = resolve('--hud-grid-minor')
    if (!major || !minor) {
      return { checked: 0, offenders: [{ rule: 'setup', text: '', detail: 'unreadable ECG grid tokens' }] }
    }
    gridLayers = [major, major, minor, minor]
  }

  const backing = (start: Element): { color: Rgba; grid: string | null } => {
    const layers: Rgba[] = [] // topmost first
    let grid: string | null = null
    for (let element: Element | null = start; element; element = element.parentElement) {
      const style = getComputedStyle(element)
      if (element === strip) layers.push(...gridLayers)
      if ((element === strip || style.backgroundImage !== 'none') && grid === null) grid = name(element)
      const color = parse(style.backgroundColor)
      if (color && color[3] > 0) layers.push(color)
      if (color && color[3] >= 1) break
    }
    let color: Rgba = [255, 255, 255, 1]
    for (let index = layers.length - 1; index >= 0; index--) color = over(layers[index], color)
    return { color, grid }
  }

  const rendered = (element: Element) => {
    const visible = element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    })
    if (!visible) return false
    // Visually hidden (sr-only, unfocused skip link, table caption).
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      const rect = current.getBoundingClientRect()
      const style = getComputedStyle(current)
      if ((rect.width <= 1 || rect.height <= 1) && (style.overflow !== 'visible' || style.clipPath !== 'none')) {
        return false
      }
    }
    return true
  }

  let checked = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    const element = node.parentElement
    if (!text || !element || element.closest('script, style, noscript, template')) continue
    if (!rendered(element)) continue

    const style = getComputedStyle(element)
    const foreground = parse(style.color)
    const { color: ground, grid } = backing(element)
    const fontSize = Number.parseFloat(style.fontSize)
    const weight = Number(style.fontWeight)
    const label = text.slice(0, 60)
    if (!foreground) {
      offenders.push({ rule: 'unparsed colour', text: label, detail: style.color })
      continue
    }
    let opacity = 1
    for (let current: Element | null = element; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity)
    }
    const painted = over([foreground[0], foreground[1], foreground[2], foreground[3] * opacity], ground)
    const ratio = contrast(painted, ground)
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700)
    const required = large ? 3 : 4.5
    checked++

    if (ratio < required) {
      offenders.push({
        rule: `contrast below ${required}:1`,
        text: label,
        detail: `${ratio.toFixed(2)}:1, ${show(painted)} on ${show(ground)}, ${fontSize}px/${weight}`,
      })
    }
    if (grid && fontSize < 18) {
      offenders.push({ rule: 'text under 18px on a grid', text: label, detail: `${fontSize}px on ${grid}` })
    }
    // Decorative aria-hidden glyphs (chip shapes) are allowed below the floor.
    if (fontSize < 12 && !element.closest('[aria-hidden="true"]')) {
      offenders.push({ rule: 'text under 12px', text: label, detail: `${fontSize}px` })
    }
  }
  return { checked, offenders }
}

for (const display of ['day', 'night'] as const) {
  test.describe(`${display} display`, () => {
    for (const path of ROUTES) {
      test(`${path} text meets WCAG AA contrast`, async ({ page, context, baseURL }) => {
        if (display === 'night') {
          if (!baseURL) throw new Error('baseURL is required to set the Display cookie')
          await context.addCookies([{ name: DISPLAY_COOKIE, value: 'night', url: baseURL }])
        }
        await page.goto(path)
        const root = page.locator('[data-hud-root]')
        await expect(root).toHaveAttribute('data-display', display)
        await expect(root).toHaveCSS('background-color', ROOT_BACKGROUND[display])
        await expect(page.getByRole('radio', { name: 'Night', exact: true })).toBeEnabled({
          timeout: 15_000,
        })
        await finishHudAnimations(page)

        const { checked, offenders } = await page.evaluate(probe)
        expect(
          offenders,
          offenders.map((offender) => `${offender.rule}: "${offender.text}" (${offender.detail})`).join('\n')
        ).toEqual([])
        expect(checked, 'text nodes measured').toBeGreaterThan(20)
      })
    }
  })
}

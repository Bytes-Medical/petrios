import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { INDIVIDUAL_SIGNUP_ENABLED } from '../lib/flags'
import { complianceSectionId } from '../lib/compliance-sections'
import { NEWS } from '../lib/news-data'
import { DISPLAY_COOKIE } from '../lib/public-display'
import { GITHUB_URL } from '../lib/site'

/**
 * The Clinical HUD landing page (spec/07 "Public site design system",
 * spec/13 "Homepage motion"): the calibration-strip h1, HEAD section order,
 * the CSS-only typewriter, and the Display mode cookie.
 */

const HERO_NAME = 'Petrios: The operating system for clinical teaching'

const SECTION_ORDER = [
  ...(INDIVIDUAL_SIGNUP_ENABLED ? ['Teach on your own'] : []),
  'For trusts & programmes',
  'Built for everyone in the room',
  'A different shape of system',
  'How it works',
  'Open source. Your servers. Your data.',
]

const DAY_BG = 'rgb(240, 238, 230)'
const NIGHT_BG = 'rgb(31, 29, 26)'

/** Seeks every animation inside the HUD root (never the dev tools overlay). */
async function seekHudAnimations(page: Page, at: number | 'end') {
  await page.evaluate((time) => {
    const root = document.querySelector('[data-hud-root]')
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (!target || !root?.contains(target)) continue
      if (time === 'end') {
        animation.finish()
      } else {
        animation.pause()
        animation.currentTime = time
      }
    }
  }, at)
}

async function hudAnimationCount(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-hud-root]')
    return document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target
      return Boolean(target && root?.contains(target))
    }).length
  })
}

async function displayCookieValue(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === DISPLAY_COOKIE)?.value
}

/** The footer Display control is disabled until hydration, so it doubles as the signal. */
async function waitForHydration(page: Page) {
  await expect(page.getByRole('radio', { name: 'Night', exact: true })).toBeEnabled({
    timeout: 15_000,
  })
}

test('the h1 is the calibration strip and names the product in full', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
    /^petrios: the operating system for clinical teaching$/i
  )
  await expect(page.locator('h1 [data-part="trace"]')).toHaveCount(1)
  await expect(page.locator('h1 [data-part="tw-text"]')).toHaveText([
    'The operating system',
    'for clinical teaching',
  ])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })

  test('the full content is server-rendered', async ({ page }) => {
    await page.goto('/')
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    expect((await h1.textContent())?.replace(/\s+/g, ' ').trim()).toBe(HERO_NAME)
    await expect(page.locator('main h2')).toHaveText(SECTION_ORDER)
    await expect(
      page.getByRole('link', { name: 'Join with a department code', exact: true })
    ).toBeVisible()
    // The Display control and the menu button are honestly inert until hydrated.
    await expect(page.getByRole('radio', { name: 'Night', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Toggle menu', exact: true })).toBeDisabled()
    await expect(page.locator('canvas')).toHaveCount(0)
  })
})

test('decorative list markers stay out of the accessibility tree', async ({ page }) => {
  await page.goto('/')
  const principles = page.getByRole('list', { name: 'Principles', exact: true })
  await expect(principles).toMatchAriaSnapshot(`
    - list "Principles":
      - listitem: Evidence-based
      - listitem: Self-hostable
      - listitem: Yours, by design
  `)
  await page.goto('/privacy')
  const processed = page.locator(
    `section[aria-labelledby="${complianceSectionId('Information processed')}"] ul`
  )
  expect(await processed.ariaSnapshot()).not.toMatch(/[▪▸]/)
})

test('sections keep the HEAD order', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('main h2')).toHaveText(SECTION_ORDER)
  const announcementFirst = await page.evaluate(() => {
    const announcement = document.querySelector('main a[href^="/news#"]')
    const hero = document.querySelector('section[aria-labelledby="hero-title"]')
    return Boolean(
      announcement &&
        hero &&
        announcement.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING
    )
  })
  expect(announcementFirst, 'the announcement precedes the hero').toBe(true)
})

test('calls to action point at the existing entry points', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('section[aria-labelledby="hero-title"]')
  await expect(hero.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/login/organisation'
  )
  await expect(
    hero.getByRole('link', { name: 'Join with a department code', exact: true })
  ).toHaveAttribute('href', '/join/dept')
  await expect(
    page.getByRole('link', { name: 'Explore all features', exact: true })
  ).toHaveAttribute('href', '/features')
  await expect(page.getByRole('link', { name: 'Self-host it', exact: true })).toHaveAttribute(
    'href',
    '/open-source'
  )
  await expect(page.getByRole('link', { name: 'Star on GitHub', exact: true })).toHaveAttribute(
    'href',
    GITHUB_URL
  )
  await expect(page.locator(`main a[href="/news#${NEWS[0].slug}"]`)).toContainText(NEWS[0].title)

  const individualDoors = INDIVIDUAL_SIGNUP_ENABLED ? 1 : 0
  await expect(
    page.getByRole('heading', { name: 'Teach on your own', exact: true })
  ).toHaveCount(individualDoors)
  const startTeaching = page.getByRole('link', { name: 'Start teaching', exact: true })
  await expect(startTeaching).toHaveCount(individualDoors)
  if (INDIVIDUAL_SIGNUP_ENABLED) {
    await expect(startTeaching).toHaveAttribute('href', '/login/individual')
  }
})

test.describe('typewriter with motion allowed', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('types in whole chunks without shifting layout', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toBeVisible()
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const loaded = await h1.boundingBox()

    await seekHudAnimations(page, 700)
    const chunks = page.locator('[data-part="tw-chunk"]')
    const texts = page.locator('[data-part="tw-text"]')
    await expect(chunks).toHaveCount(2)
    await expect(texts.first()).not.toHaveCSS('clip-path', 'none')
    // At 700ms the second chunk has not started, so it is still fully clipped.
    await expect(texts.nth(1)).toHaveCSS('clip-path', /100%/)
    await expect(h1).toHaveAccessibleName(HERO_NAME)
    const [firstTop, secondTop] = await chunks.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top)
    )
    expect(secondTop, 'phones type the tagline on two lines').toBeGreaterThan(firstTop)
    const typing = await h1.boundingBox()

    await seekHudAnimations(page, 'end')
    const settled = await h1.boundingBox()
    expect(typing).toEqual(loaded)
    expect(settled).toEqual(loaded)
    await expect(page.locator('[data-part="cursor"]')).toHaveCSS('opacity', '1')
  })
})

test('reduced motion renders the final state with no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('[data-part="trace-seg"]')).toHaveCSS('animation-name', 'none')
  const texts = page.locator('[data-part="tw-text"]')
  await expect(texts).toHaveCount(2)
  for (const text of await texts.all()) await expect(text).toHaveCSS('animation-name', 'none')
  const cursor = page.locator('[data-part="cursor"]')
  await expect(cursor).toHaveCSS('animation-name', 'none')
  await expect(cursor).toBeVisible()
  await expect(cursor).toHaveCSS('opacity', '1')
  expect(await hudAnimationCount(page)).toBe(0)
})

test('the hero sign-in is reachable by keyboard with a visible focus outline', async ({
  page,
}) => {
  await page.goto('/')
  await waitForHydration(page)
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true })
  await expect(skip).toBeFocused()
  expect((await skip.boundingBox())?.width ?? 0, 'the skip link shows on focus').toBeGreaterThan(20)

  const signIn = page
    .locator('section[aria-labelledby="hero-title"]')
    .getByRole('link', { name: 'Sign in', exact: true })
  for (let i = 0; i < 25; i++) {
    if (await signIn.evaluate((element) => element === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(signIn).toBeFocused()
  await expect(signIn).toHaveCSS('outline-style', 'solid')
  await expect(signIn).toHaveCSS('outline-width', '2px')
})

for (const width of [320, 360, 390, 768, 800, 1024, 1440]) {
  test(`the landing page fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const { scroll, escaping } = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth
      return {
        scroll: document.documentElement.scrollWidth - viewport,
        escaping: Array.from(document.querySelectorAll('h1, h2, h3, p, a, li, pre'))
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            return rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1)
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}: ${element.textContent?.trim().slice(0, 60)}`
          ),
      }
    })
    expect(scroll).toBeLessThanOrEqual(0)
    expect(escaping).toEqual([])
  })
}

// WCAG 1.4.12 text-spacing overrides (the standard bookmarklet values).
const TEXT_SPACING = `* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important;
  line-height: 1.5 !important; } p { margin-bottom: 2em !important; }`

test('at 320px with WCAG 1.4.12 text spacing no text is clipped', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })

  await page.goto('/')
  await page.addStyleTag({ content: TEXT_SPACING })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  const clipped = await page.locator('[data-part="tw-text"]').evaluateAll((texts) =>
    texts.flatMap((text) => {
      const box = text.getBoundingClientRect()
      const found: string[] = []
      for (let el = text.parentElement; el && !el.hasAttribute('data-hud-root'); el = el.parentElement) {
        if (getComputedStyle(el).overflowX === 'visible') continue
        const clip = el.getBoundingClientRect()
        if (box.left < clip.left - 0.5 || box.right > clip.right + 0.5) {
          found.push(`"${text.textContent}" clipped by <${el.tagName.toLowerCase()} class="${el.className}">`)
        }
      }
      return found
    })
  )
  expect(clipped).toEqual([])

  await page.goto('/contributors')
  await page.addStyleTag({ content: TEXT_SPACING })
  const chip = page
    .locator('section[aria-labelledby="ledger-title"] span')
    .filter({ hasText: /^.?GitHub list/ })
  const viewport = await page.evaluate(() => document.documentElement.clientWidth)
  const chipBox = await chip.boundingBox()
  expect(chipBox, 'the ledger chip renders').not.toBeNull()
  expect((chipBox?.x ?? 0) + (chipBox?.width ?? 0), 'the ledger chip wraps').toBeLessThanOrEqual(viewport)
})

test('the landing page draws no canvas', async ({ page }) => {
  await page.goto('/')
  await waitForHydration(page)
  await expect(page.locator('canvas')).toHaveCount(0)
})

test.describe('Display mode', () => {
  test.use({ colorScheme: 'dark' })

  test('Night persists across reload, client navigation and back', async ({ page, context }) => {
    test.setTimeout(60_000)
    // Records the root's display at every mutation checkpoint, which runs
    // before the next paint, so a single Day frame during navigation shows up.
    await page.addInitScript(() => {
      const seen: string[] = []
      Object.defineProperty(window, '__hudDisplays', { value: seen })
      const record = () => {
        const value = document.querySelector('[data-hud-root]')?.getAttribute('data-display')
        if (value && seen[seen.length - 1] !== value) seen.push(value)
      }
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-display'],
      })
    })
    const displaysSeen = () =>
      page.evaluate(() => (window as unknown as { __hudDisplays: string[] }).__hudDisplays)

    await page.goto('/')
    const root = page.locator('[data-hud-root]')
    // Light first: a dark OS does not change the default.
    await expect(root).toHaveAttribute('data-display', 'day')
    await expect(root).toHaveCSS('background-color', DAY_BG)

    await waitForHydration(page)
    await page.getByRole('radio', { name: 'Night', exact: true }).check()
    await expect(root).toHaveAttribute('data-display', 'night')
    await expect(root).toHaveCSS('background-color', NIGHT_BG)
    await expect.poll(() => displayCookieValue(context)).toBe('night')

    await page.reload()
    await expect(root).toHaveAttribute('data-display', 'night')
    await expect(root).toHaveCSS('background-color', NIGHT_BG)
    await waitForHydration(page)
    await expect(page.getByRole('radio', { name: 'Night', exact: true })).toBeChecked()
    await page.evaluate(() => {
      Object.defineProperty(window, '__sameDocument', { value: true })
    })

    await page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('link', { name: 'Features', exact: true })
      .click()
    await expect(page).toHaveURL((url) => url.pathname === '/features', { timeout: 20_000 })
    await expect(root).toHaveAttribute('data-display', 'night')
    await expect(root).toHaveCSS('background-color', NIGHT_BG)

    await page.goBack()
    await expect(page).toHaveURL((url) => url.pathname === '/', { timeout: 20_000 })
    await expect(root).toHaveAttribute('data-display', 'night')
    await expect(root).toHaveCSS('background-color', NIGHT_BG)

    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument
      ),
      'navigation stayed client-side'
    ).toBe(true)
    expect(await displaysSeen(), 'no Day frame after choosing Night').toEqual(['night'])
  })

  test('Match device follows the colour scheme and Day deletes the cookie', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    const root = page.locator('[data-hud-root]')
    await waitForHydration(page)

    await page.getByRole('radio', { name: 'Match device', exact: true }).check()
    await expect(root).toHaveAttribute('data-display', 'auto')
    await expect(root).toHaveCSS('background-color', NIGHT_BG)
    await expect.poll(() => displayCookieValue(context)).toBe('auto')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(root).toHaveCSS('background-color', DAY_BG)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveCSS('background-color', NIGHT_BG)

    await page.getByRole('radio', { name: 'Day', exact: true }).check()
    await expect(root).toHaveAttribute('data-display', 'day')
    await expect(root).toHaveCSS('background-color', DAY_BG)
    await expect.poll(() => displayCookieValue(context)).toBeUndefined()
  })
})

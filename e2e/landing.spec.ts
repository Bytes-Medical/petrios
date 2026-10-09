import { test, expect } from '@playwright/test'
import { INDIVIDUAL_SIGNUP_ENABLED } from '../lib/flags'

test('homepage explains the workflow and links to existing entry points', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Run your teaching programme with less admin.',
  )
  await page.getByRole('link', { name: 'See how it works' }).click()
  await expect(page).toHaveURL(/#how-it-works$/)
  await expect(page.locator('#how-it-works')).toBeInViewport()
  await expect(
    page.getByRole('link', {
      name: 'Join with a department code',
      exact: true,
    }),
  ).toHaveAttribute('href', '/join/dept')
  await expect(
    page.getByRole('link', { name: 'Explore Petrios', exact: true }),
  ).toHaveAttribute('href', '/features')
  await expect(
    page.getByRole('link', { name: 'Explore self-hosting' }),
  ).toHaveAttribute('href', '/open-source')
  await expect(
    page.getByRole('link', { name: 'Teach on your own' }),
  ).toHaveCount(INDIVIDUAL_SIGNUP_ENABLED ? 1 : 0)
  await expect(
    page.getByText('Awaiting approval', { exact: true }),
  ).toBeVisible()
})

test('reduced motion retains the static workflow and never adds a canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main canvas')).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'See how it works' }),
  ).toBeVisible()
})

test('the desktop scene enhances the diagram and releases it when motion is reduced', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('[data-scene="ready"] canvas')).toBeVisible({
    timeout: 15000,
  })
  await page.mouse.move(1000, 300)
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('main canvas')).toHaveCount(0)
  await expect(page.locator('[data-scene="ready"]')).toHaveCount(0)
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
})

test('WebGL context loss restores the static diagram', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const canvas = page.locator('[data-scene="ready"] canvas')
  await expect(canvas).toBeVisible({ timeout: 15000 })
  await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  })
  await expect(page.locator('main canvas')).toHaveCount(0)
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
})

test('WebGL initialization failure preserves content and navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).startsWith('webgl')) return null
      return original.apply(this, args)
    } as typeof original
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-scene="ready"]')).toHaveCount(0)
  await page.getByRole('link', { name: 'See how it works' }).click()
  await expect(page).toHaveURL(/#how-it-works$/)
})

test('the homepage works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(
    page.getByText('Teaching that counts.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'See how it works' }).click()
  await expect(page).toHaveURL(/#how-it-works$/)
  await expect(page.locator('main canvas')).toHaveCount(0)
  await context.close()
})

test('the main action is reachable and visibly focused using the keyboard', async ({
  page,
}) => {
  await page.goto('/')
  const action = page.getByRole('link', { name: 'See how it works' })
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab')
    if (await action.evaluate((element) => element === document.activeElement))
      break
  }
  await expect(action).toBeFocused()
  await expect(action).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#how-it-works$/)
})

for (const zoom of [2, 4]) {
  test(`homepage reflows at ${zoom * 100}% zoom-equivalent viewport`, async ({
    browser,
  }) => {
    // A 1280px-wide display at 200%/400% has 640/320 CSS pixels respectively.
    const context = await browser.newContext({
      viewport: { width: 1280 / zoom, height: 960 / zoom },
      deviceScaleFactor: zoom,
    })
    const page = await context.newPage()
    await page.goto('/')
    const overflow = await page.locator('main').evaluate((main) =>
      Array.from(main.querySelectorAll('h1, h2, h3, p, a, figure')).some(
        (element) => {
          const rect = element.getBoundingClientRect()
          return (
            rect.width > 0 &&
            (rect.left < -1 ||
              rect.right > document.documentElement.clientWidth + 1)
          )
        },
      ),
    )
    expect(overflow).toBe(false)
    await page.getByRole('link', { name: 'See how it works' }).click()
    await expect(page).toHaveURL(/#how-it-works$/)
    await context.close()
  })
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`homepage content fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.locator('main').evaluate((main) => {
      const viewport = document.documentElement.clientWidth
      return Array.from(main.querySelectorAll('h1, h2, h3, p, a, figure'))
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && (rect.left < -1 || rect.right > viewport + 1)
        })
        .map((element) => element.textContent?.slice(0, 80))
    })
    expect(overflow).toEqual([])
    if (width < 1024) await expect(page.locator('main canvas')).toHaveCount(0)
  })
}

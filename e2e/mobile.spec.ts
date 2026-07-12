import { test, expect } from '@playwright/test'

/**
 * Mobile responsiveness of the public site (iPhone-ish viewport). Guards
 * the regression where PublicNav rendered all links inline on small
 * screens instead of collapsing to the hamburger menu.
 */
test.use({ viewport: { width: 390, height: 844 } })

test('public nav collapses to a hamburger on mobile', async ({ page }) => {
  await page.goto('/')

  const hamburger = page.getByRole('button', { name: /toggle menu/i })
  await expect(hamburger).toBeVisible()

  // Desktop inline links are hidden; Sign in stays visible.
  await expect(page.locator('nav').getByRole('link', { name: 'Features' })).toBeHidden()
  await expect(page.locator('nav').getByRole('link', { name: 'Sign in' })).toBeVisible()

  // Opening the menu reveals the links (retry the tap: on a dev server the
  // first click can land before React hydration attaches the handler).
  const featuresLink = page.locator('nav').getByRole('link', { name: 'Features' })
  await expect(async () => {
    await hamburger.click()
    await expect(featuresLink).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  await featuresLink.click()
  await expect(page).toHaveURL(/\/features$/)
})

test('landing page has no horizontal overflow on mobile', async ({ page }) => {
  await page.goto('/')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('news and features pages have no horizontal overflow on mobile', async ({ page }) => {
  for (const path of ['/news', '/features', '/open-source', '/contributors']) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0)
  }
})

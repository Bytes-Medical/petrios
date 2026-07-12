import { test, expect } from '@playwright/test'

/**
 * Unauthenticated smoke: the public surface renders sensibly with no
 * database behind it. Guards routing, the proxy's public-route list, and
 * gross rendering regressions from dependency upgrades.
 */

test('landing page renders', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()
})

test('login page shows the sign-in form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[type="email"]').first()).toBeVisible()
})

test('recall page rejects an invalid capability token gracefully', async ({ page }) => {
  const response = await page.goto('/recall/not-a-real-token')
  expect(response?.status()).toBe(200)
  await expect(page.getByText(/not valid/i).first()).toBeVisible()
})

test('news page lists announcements', async ({ page }) => {
  await page.goto('/news')
  await expect(page.getByRole('heading', { name: 'News', exact: true })).toBeVisible()
  await expect(page.locator('article').first()).toBeVisible()
})

test('teaching record verify page renders its form', async ({ page }) => {
  await page.goto('/verify/record')
  await expect(page.getByRole('button', { name: /verify record/i })).toBeVisible()
})

test('well-known federation identity responds with JSON', async ({ request }) => {
  const response = await request.get('/.well-known/bytes-teaching')
  // 404 JSON when INSTANCE_SIGNING_KEY is unset; 200 when configured.
  expect([200, 404]).toContain(response.status())
  expect((response.headers()['content-type'] ?? '')).toContain('application/json')
})

test('health endpoint reports db state as JSON', async ({ request }) => {
  const response = await request.get('/api/health')
  expect([200, 503]).toContain(response.status())
  const body = await response.json()
  expect(body).toHaveProperty('status')
  expect(body).toHaveProperty('db')
})

test('unknown non-public routes hit the auth wall', async ({ page }) => {
  await page.goto('/definitely-not-a-page-xyz')
  // proxy.ts redirects unauthenticated non-public paths to /login.
  await expect(page).toHaveURL(/\/login$/)
})

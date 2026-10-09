import { test, expect } from '@playwright/test'
import { complianceSectionId } from '../lib/compliance-sections'
import { DISPLAY_COOKIE } from '../lib/public-display'

/**
 * Shell, landmark and content contracts shared by every public page
 * (spec/07 "Public site design system", spec/13 public compliance surface).
 */

const PUBLIC_ROUTES = [
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

const LEGAL_ROUTES = [
  '/privacy',
  '/privacy/choices',
  '/subprocessors',
  '/data-processing-agreement',
] as const

const FOOTER_LEGAL_LINKS = [
  ['Privacy', '/privacy'],
  ['Your privacy choices', '/privacy/choices'],
  ['Subprocessors', '/subprocessors'],
  ['DPA', '/data-processing-agreement'],
] as const

const FEATURE_ANCHORS = [
  '#attendance',
  '#petrios-meet',
  '#scheduling',
  '#feedback',
  '#evidence-engine',
  '#petrios-ops',
  '#governance',
]

// spec/13 "Cookies posture"; the /privacy wording is part of the contract.
const COOKIE_DISCLOSURE = `If you choose Night or Match device in the Display control on the public site, a first-party cookie named ${DISPLAY_COOKIE} remembers that choice on this device for up to 6 months. It holds only that setting, is not used to identify you, and is never set unless you choose one of those options. Choosing Day deletes it.`

for (const path of PUBLIC_ROUTES) {
  test(`${path} has one Main nav, one main, and the public footer`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response?.ok(), path).toBeTruthy()

    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toHaveAttribute(
      'href',
      '#main'
    )

    const footer = page.locator('[data-hud-root] footer')
    await expect(footer).toHaveCount(1)
    // The footer is deliberately not a landmark that repeats "Features".
    await expect(footer.locator('nav')).toHaveCount(0)
    await expect(footer).toContainText(`© ${new Date().getFullYear()} Petrios, owned by We Health`)
    for (const [name, href] of FOOTER_LEGAL_LINKS) {
      await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href)
    }
    await expect(footer.getByRole('group', { name: 'Display' })).toHaveCount(1)
  })
}

for (const path of ['/features', ...LEGAL_ROUTES]) {
  test(`${path} contents links resolve to one section each`, async ({ page }) => {
    await page.goto(path)
    const contents = page.getByRole('navigation', { name: 'On this page', exact: true })
    await expect(contents).toHaveCount(1)

    const hrefs = await contents
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    if (path === '/features') expect(hrefs).toEqual(FEATURE_ANCHORS)
    else for (const href of hrefs) expect(href).toMatch(/^#section-[a-z0-9-]+$/)

    const unresolved = await page.evaluate(
      (targets) =>
        targets.filter(
          (href) => document.querySelectorAll(`#${CSS.escape(href.slice(1))}`).length !== 1
        ),
      hrefs
    )
    expect(unresolved).toEqual([])
    await expect(contents.getByRole('link', { name: /^(Features|Sign in)$/ })).toHaveCount(0)

    const last = hrefs[hrefs.length - 1]
    await contents.locator(`a[href="${last}"]`).click()
    await expect(page).toHaveURL((url) => url.hash === last)
    await expect(page.locator(last)).toBeInViewport()
  })
}

test('/privacy discloses the Display preference cookie under Cookies and tracking', async ({
  page,
}) => {
  await page.goto('/privacy')
  const cookies = page.locator(
    `section[aria-labelledby="${complianceSectionId('Cookies and tracking')}"]`
  )
  await expect(cookies).toContainText(COOKIE_DISCLOSURE)
})

test.describe('Global Privacy Control', () => {
  const gpcSection = `section[aria-labelledby="${complianceSectionId('Global Privacy Control')}"]`

  test('/privacy/choices reports the signal as not detected by default', async ({ page }) => {
    await page.goto('/privacy/choices')
    const section = page.locator(gpcSection)
    await expect(section).toContainText('not detected')
    await expect(section).not.toContainText('detected (Sec-GPC: 1)')
    // State by shape as well as words.
    await expect(section.locator('[aria-hidden="true"]')).toHaveText('○')
  })

  test.describe('with Sec-GPC: 1', () => {
    test.use({ extraHTTPHeaders: { 'Sec-GPC': '1' } })

    test('/privacy/choices reports the signal as detected', async ({ page }) => {
      await page.goto('/privacy/choices')
      const section = page.locator(gpcSection)
      await expect(section).toContainText('detected (Sec-GPC: 1)')
      await expect(section).not.toContainText('not detected')
      await expect(section.locator('[aria-hidden="true"]')).toHaveText('●')
    })
  })
})

test('/subprocessors gives the register the full article width and scrolls it only when narrow', async ({
  page,
}) => {
  const register = page.locator(
    `div[role="region"][aria-labelledby="${complianceSectionId('Current service register')}"]`
  )
  const overflow = () => register.evaluate((element) => element.scrollWidth - element.clientWidth)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/subprocessors')
  expect(await overflow(), 'no sideways scroll at 1280px').toBeLessThanOrEqual(0)
  expect((await register.locator('table').boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(760)

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await overflow(), 'the table keeps its 760px minimum and scrolls').toBeGreaterThan(0)
})

test('/subprocessors shows each configurable service status as a chip', async ({ page }) => {
  await page.goto('/subprocessors')
  const register = page.locator(
    `div[role="region"][aria-labelledby="${complianceSectionId('Current service register')}"]`
  )
  await expect(register).toHaveAttribute('tabindex', '0')

  // Purpose text is fixed; provider names and statuses depend on the server env.
  for (const [purpose, status] of [
    ['Sends authentication and operational email', /(Configured|Not declared)$/],
    ['Optional LLM', /(Enabled|Disabled)$/],
    ['Optional text-to-speech', /(Enabled|Disabled|Configuration incomplete)$/],
  ] as const) {
    const cell = register.getByRole('row').filter({ hasText: purpose }).getByRole('cell').last()
    await expect(cell).toBeVisible()
    await expect(cell).toHaveText(status)
    await expect(cell.locator('[aria-hidden="true"]')).toHaveCount(1)
  }
})

test('/open-source checks instance health only when asked', async ({ page }) => {
  let healthRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/health') healthRequests++
  })
  await page.goto('/open-source')
  const status = page.getByRole('main').getByRole('status')
  await expect(status).toHaveText(/Not checked/)

  const button = page.getByRole('button', { name: 'Run health check', exact: true })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  expect(healthRequests, 'no request on page view').toBe(0)

  // Keyboard activation keeps focus on the button while the check runs.
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText(/database (reachable|unreachable)|No response/, {
    timeout: 15_000,
  })
  await expect(button).toBeFocused()
  expect(healthRequests).toBe(1)
})

test('/contributors shows a head count computed from the list', async ({ page }) => {
  await page.goto('/contributors')
  const ledger = page.locator('section[aria-labelledby="ledger-title"]')
  await expect(ledger.getByText('People listed', { exact: true })).toBeVisible()
  const rows = await ledger.locator('ul > li').count()
  await expect(ledger.locator('dl').filter({ hasText: 'People listed' }).locator('dd')).toHaveText(
    String(rows)
  )
  await expect(ledger).toContainText(/GitHub list(, cached up to 1 hour| unavailable)/)
})

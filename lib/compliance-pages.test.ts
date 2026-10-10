import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DISPLAY_COOKIE, DISPLAY_COOKIE_MAX_AGE } from './public-display'

// Source-level guards for the legal pages (spec/13). Rendering them needs the
// Next request scope, so the invariants that must never drift are read from source.
const ROOT = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

const PAGES = [
  ['app/privacy/page.tsx', 'Privacy notice'],
  ['app/privacy/choices/page.tsx', 'Your privacy choices'],
  ['app/subprocessors/page.tsx', 'Subprocessors and external services'],
  ['app/data-processing-agreement/page.tsx', 'Data processing agreement framework'],
] as const

function sectionTitles(source: string): string[] {
  const match = /const SECTIONS = \[([\s\S]*?)\] as const/.exec(source)
  if (!match) throw new Error('No SECTIONS constant')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const prose = (source: string) => source.replace(/\s+/g, ' ')

describe.each(PAGES)('%s', (file, h1) => {
  const source = read(file)

  it('keeps its exact h1', () => {
    expect(source).toContain(`title="${h1}"`)
  })

  it('renders every SECTIONS entry once, in order, so each contents link has a target', () => {
    const titles = sectionTitles(source)
    const used = [...source.matchAll(/<ComplianceSection title=\{SECTIONS\[(\d+)\]\}[^>]*>/g)].map((m) => Number(m[1]))
    expect(titles.length).toBeGreaterThan(0)
    expect(used).toEqual(titles.map((_, index) => index))
    expect(source).not.toMatch(/<ComplianceSection title="/)
    expect(source).toContain('sections={SECTIONS}')
  })

  it('has no hard-coded colour utilities that leak in Night', () => {
    expect(source).not.toMatch(/(bg|text|border|divide)-(white|black|gray-\d+|clay-\d+)|hover:(bg|text)-|dark:|list-disc/)
  })
})

describe('legal wording fixed by spec/13', () => {
  it('keeps the MissingDisclosure wording', () => {
    expect(read('components/CompliancePage.tsx')).toContain('Not declared by this deployment: {children}')
  })

  it('keeps the GPC status strings', () => {
    const source = read('app/privacy/choices/page.tsx')
    expect(source).toContain("'detected (Sec-GPC: 1)'")
    expect(source).toContain("'not detected'")
  })

  it('discloses the Display preference cookie on /privacy', () => {
    const source = prose(read('app/privacy/page.tsx')).replace('<code>{DISPLAY_COOKIE}</code>', DISPLAY_COOKIE)
    expect(source).toContain(
      'If you choose Night or Match device in the Display control on the public site, a first-party cookie named ' +
        `${DISPLAY_COOKIE} remembers that choice on this device for up to 6 months. It holds only that setting, is ` +
        'not used to identify you, and is never set unless you choose one of those options. Choosing Day deletes it.'
    )
    expect(DISPLAY_COOKIE_MAX_AGE).toBeLessThanOrEqual(183 * 24 * 60 * 60)
  })

  it('discloses rota availability on /privacy without any leave category (spec/14)', () => {
    const raw = read('app/privacy/page.tsx')
    const source = prose(raw)
    expect(sectionTitles(raw)).toContain('Rota availability (where enabled)')
    expect(source).toContain('It never receives the reason for leave or any sickness information')
    expect(source).toContain('nothing is excused automatically')
    expect(source).toContain('never later than 90 days after the session')
    expect(source).toContain('<MissingDisclosure>employing trust</MissingDisclosure>')
    expect(source).toContain('<MissingDisclosure>DME contact</MissingDisclosure>')
    expect(source).toContain('isRotaKillSwitchOn()')
  })
})

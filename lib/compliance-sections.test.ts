import { describe, expect, it } from 'vitest'
import { complianceSectionId } from './compliance-sections'

const legacyId = (title: string) => `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

describe('complianceSectionId', () => {
  it('keeps the existing anchor format', () => {
    expect(complianceSectionId('Who is responsible')).toBe('section-who-is-responsible')
  })

  it.each([
    'Information processed',
    'Cookies and tracking',
    'Lawful basis (UK GDPR)',
    'International transfers & safeguards',
    '2. Processing details',
    'Your rights',
  ])('matches the pre-redesign inline slug for %j', (title) => {
    expect(complianceSectionId(title)).toBe(legacyId(title))
  })
})

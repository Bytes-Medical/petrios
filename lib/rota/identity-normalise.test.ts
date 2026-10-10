import { describe, expect, it } from 'vitest'
import { normaliseEmail, normaliseName, normaliseStaffKey } from './identity-normalise'

describe('identity normalisation', () => {
  it('normalises staff keys', () => {
    expect(normaliseStaffKey(' 1234 5678 ', { stripAssignmentSuffix: false })).toBe('12345678')
    expect(normaliseStaffKey('ab123-2', { stripAssignmentSuffix: false })).toBe('AB123-2')
    expect(normaliseStaffKey('ab123-2', { stripAssignmentSuffix: true })).toBe('AB123')
    expect(normaliseStaffKey('  ', { stripAssignmentSuffix: false })).toBeNull()
    expect(normaliseStaffKey('12@34', { stripAssignmentSuffix: false })).toBeNull()
    expect(normaliseStaffKey('x'.repeat(65), { stripAssignmentSuffix: false })).toBeNull()
  })

  it('normalises emails', () => {
    expect(normaliseEmail('  Jane.Doe@NHS.net ')).toBe('jane.doe@nhs.net')
    expect(normaliseEmail('not-an-email')).toBeNull()
    expect(normaliseEmail('')).toBeNull()
  })

  it('normalises names for client-side matching', () => {
    expect(normaliseName('Smith, Dr Jane')).toBe(normaliseName('jane  SMITH'))
    expect(normaliseName('Zoë O\'Brien-Lee')).toBe('obrienlee zoe')
  })
})

import { describe, expect, it } from 'vitest'
import {
  generateSecureGroupCode,
  hashGroupCode,
  normalizeGroupCode,
  verifyGroupCode,
} from './group-code'

describe('attendance group-code security', () => {
  it('generates six unambiguous uppercase characters', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateSecureGroupCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    }
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeGroupCode('  abC234 ')).toBe('ABC234')
  })

  it('stores salted scrypt verifiers and compares normalized codes', () => {
    const first = hashGroupCode('ABC234')
    const second = hashGroupCode('ABC234')
    expect(first).not.toBe(second)
    expect(first).not.toContain('ABC234')
    expect(verifyGroupCode(' abc234 ', first)).toBe(true)
    expect(verifyGroupCode('ABC235', first)).toBe(false)
  })

  it('rejects malformed verifiers without throwing', () => {
    expect(verifyGroupCode('ABC234', '')).toBe(false)
    expect(verifyGroupCode('ABC234', 'sha256$00$00')).toBe(false)
    expect(verifyGroupCode('ABC234', 'scrypt$not-hex$also-not-hex')).toBe(false)
  })
})

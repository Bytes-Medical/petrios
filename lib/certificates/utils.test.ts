import { describe, expect, it } from 'vitest'
import { generateCertificateCode } from './utils'

describe('generateCertificateCode', () => {
  it('produces 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCertificateCode()
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    }
  })

  it('never contains lookalike characters (0, O, 1, I)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCertificateCode()).not.toMatch(/[01OI]/)
    }
  })
})

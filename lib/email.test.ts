import { describe, expect, it } from 'vitest'
import { normalizeSenderDisplayName } from './email'

describe('normalizeSenderDisplayName', () => {
  it.each([
    'Byte Teaching <login@example.org>',
    'Bytes Teaching <login@example.org>',
    'byte-teaching <login@example.org>',
    '"Byte Teaching" <login@example.org>',
  ])('rebrands the legacy sender name in %s', (from) => {
    expect(normalizeSenderDisplayName(from)).toBe('Petrios <login@example.org>')
  })

  it('adds Petrios to a bare sender address', () => {
    expect(normalizeSenderDisplayName('login@example.org')).toBe(
      'Petrios <login@example.org>'
    )
  })

  it('preserves an intentionally customized organization name', () => {
    expect(normalizeSenderDisplayName('Trust Education <login@example.org>')).toBe(
      'Trust Education <login@example.org>'
    )
  })

  it('preserves an existing Petrios sender name', () => {
    expect(normalizeSenderDisplayName('Petrios <login@example.org>')).toBe(
      'Petrios <login@example.org>'
    )
  })
})

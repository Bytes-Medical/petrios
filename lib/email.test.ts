import { describe, expect, it } from 'vitest'
import {
  normalizeSenderDisplayName,
  parseResendProviderMessageId,
} from './email'

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

describe('Resend provider receipts', () => {
  it('accepts and trims a traceable provider message id', () => {
    expect(parseResendProviderMessageId({ id: '  msg_123  ' })).toBe('msg_123')
  })

  it('rejects success payloads without a usable provider message id', () => {
    expect(parseResendProviderMessageId({})).toBeNull()
    expect(parseResendProviderMessageId({ id: '' })).toBeNull()
    expect(parseResendProviderMessageId({ id: 123 })).toBeNull()
    expect(parseResendProviderMessageId(null)).toBeNull()
  })
})

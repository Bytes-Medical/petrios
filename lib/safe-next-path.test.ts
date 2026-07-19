import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-next-path'

describe('safeNextPath', () => {
  it('preserves a local Recall deep link', () => {
    expect(safeNextPath('/recall/session.user.signature')).toBe(
      '/recall/session.user.signature'
    )
  })

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    null,
  ])('rejects nonlocal continuation %s', (value) => {
    expect(safeNextPath(value)).toBe('/dashboard')
  })
})

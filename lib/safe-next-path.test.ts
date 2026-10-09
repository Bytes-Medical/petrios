import { describe, expect, it } from 'vitest'
import { loginUrlFor, safeNextPath } from './safe-next-path'

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

describe('loginUrlFor (signed-out redirect keeps the requested page)', () => {
  const SESSION = '/sessions/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'

  it('carries an emailed video-room link through sign-in', () => {
    expect(loginUrlFor(SESSION)).toBe(`/login?next=${encodeURIComponent(SESSION)}`)
    // ...and the login page resolves it back to the same page.
    const next = new URL(`https://petrios.example${loginUrlFor(SESSION)}`).searchParams.get('next')
    expect(safeNextPath(next)).toBe(SESSION)
  })

  it('keeps the query string but drops the internal _rsc key', () => {
    expect(loginUrlFor('/departments/d1/sessions', '?view=week&_rsc=abc')).toBe(
      `/login?next=${encodeURIComponent('/departments/d1/sessions?view=week')}`
    )
  })

  it.each(['/', '/dashboard', '/login'])('adds nothing for the default landing %s', (path) => {
    expect(loginUrlFor(path)).toBe('/login')
  })

  it('never builds an off-site continuation', () => {
    expect(loginUrlFor('//evil.example/x')).toBe('/login')
    expect(loginUrlFor('/\\evil.example')).toBe('/login')
  })
})

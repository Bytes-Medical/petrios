import { RequestCookies } from 'next/dist/server/web/spec-extension/cookies'
import { describe, expect, it } from 'vitest'
import {
  DISPLAY_COOKIE,
  DISPLAY_OPTIONS,
  displayCookie,
  displayFromCookieString,
  parseDisplay,
} from './public-display'

describe('parseDisplay', () => {
  it.each([
    ['night', 'night'],
    ['auto', 'auto'],
    ['day', 'day'],
    [undefined, 'day'],
    [null, 'day'],
    ['', 'day'],
    ['DARK', 'day'],
    ['Night', 'day'],
    ['dark', 'day'],
  ] as const)('%j -> %s', (input, expected) => {
    expect(parseDisplay(input)).toBe(expected)
  })
})

describe('displayCookie', () => {
  it('remembers Night for six months, first-party and Lax', () => {
    const cookie = displayCookie('night', false)
    expect(cookie.startsWith(`${DISPLAY_COOKIE}=night;`)).toBe(true)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=15552000')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Secure')
    expect(cookie).not.toMatch(/Domain=/i)
  })

  it('adds Secure only when asked', () => {
    expect(displayCookie('auto', true)).toMatch(/; Secure$/)
    expect(displayCookie('auto', true).startsWith(`${DISPLAY_COOKIE}=auto;`)).toBe(true)
    expect(displayCookie('auto', false)).not.toContain('Secure')
  })

  it('deletes the cookie when Day is chosen', () => {
    const cookie = displayCookie('day', true)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Max-Age=15552000')
  })
})

describe('displayFromCookieString', () => {
  it('reads the preference among other cookies', () => {
    expect(displayFromCookieString(`a=1; ${DISPLAY_COOKIE}=night; b=2`)).toBe('night')
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=auto`)).toBe('auto')
  })

  it('resolves a duplicated name to its last occurrence, as Next cookies() does', () => {
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=night; ${DISPLAY_COOKIE}=auto`)).toBe('auto')
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=auto; a=1; ${DISPLAY_COOKIE}=night`)).toBe('night')
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=night; ${DISPLAY_COOKIE}=`)).toBe('day')
  })

  it.each([
    `${DISPLAY_COOKIE}=night`,
    `a=1; ${DISPLAY_COOKIE}=auto; b=2`,
    `${DISPLAY_COOKIE}=night; ${DISPLAY_COOKIE}=auto`,
    `${DISPLAY_COOKIE}=auto;${DISPLAY_COOKIE}=night`,
    `${DISPLAY_COOKIE}=night; ${DISPLAY_COOKIE}=`,
    `${DISPLAY_COOKIE}=sepia`,
    'other=night',
  ])('agrees with the server-side cookie parser for %j', (header) => {
    const server = parseDisplay(new RequestCookies(new Headers({ cookie: header })).get(DISPLAY_COOKIE)?.value)
    expect(displayFromCookieString(header)).toBe(server)
  })

  it('falls back to Day when absent, empty or unknown', () => {
    expect(displayFromCookieString('')).toBe('day')
    expect(displayFromCookieString('other=night')).toBe('day')
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=`)).toBe('day')
    expect(displayFromCookieString(`${DISPLAY_COOKIE}=sepia`)).toBe('day')
    expect(displayFromCookieString(`x${DISPLAY_COOKIE}=night`)).toBe('day')
  })
})

describe('DISPLAY_OPTIONS', () => {
  it('offers Day, Night and Match device in that order', () => {
    expect(DISPLAY_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ['day', 'Day'],
      ['night', 'Night'],
      ['auto', 'Match device'],
    ])
  })
})

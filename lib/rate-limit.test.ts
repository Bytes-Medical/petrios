import { describe, expect, it } from 'vitest'
import {
  clientIpFromHeaders,
  evaluateLoginLinkRateLimit,
  LOGIN_LINK_MAX_PER_EMAIL,
  LOGIN_LINK_MAX_PER_IP,
} from './rate-limit'

function headersOf(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

describe('evaluateLoginLinkRateLimit', () => {
  it('allows a first request', () => {
    expect(evaluateLoginLinkRateLimit({ emailCount: 0, ipCount: 0 }).allowed).toBe(true)
  })

  it('allows up to the per-email limit', () => {
    expect(
      evaluateLoginLinkRateLimit({ emailCount: LOGIN_LINK_MAX_PER_EMAIL - 1, ipCount: 0 })
        .allowed
    ).toBe(true)
  })

  it('blocks once the per-email limit is reached', () => {
    const decision = evaluateLoginLinkRateLimit({
      emailCount: LOGIN_LINK_MAX_PER_EMAIL,
      ipCount: 0,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toMatch(/sign-in links/i)
  })

  it('blocks once the per-IP limit is reached, with a network message', () => {
    const decision = evaluateLoginLinkRateLimit({
      emailCount: 0,
      ipCount: LOGIN_LINK_MAX_PER_IP,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toMatch(/network/i)
  })

  it('the per-email limit takes precedence when both are exceeded', () => {
    const decision = evaluateLoginLinkRateLimit({
      emailCount: LOGIN_LINK_MAX_PER_EMAIL,
      ipCount: LOGIN_LINK_MAX_PER_IP,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toMatch(/sign-in links/i)
  })
})

describe('clientIpFromHeaders', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(
      clientIpFromHeaders(headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))
    ).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(clientIpFromHeaders(headersOf({ 'x-real-ip': '198.51.100.2' }))).toBe(
      '198.51.100.2'
    )
  })

  it('returns null when no header is present', () => {
    expect(clientIpFromHeaders(headersOf({}))).toBeNull()
  })

  it('ignores an empty x-forwarded-for', () => {
    expect(
      clientIpFromHeaders(headersOf({ 'x-forwarded-for': '', 'x-real-ip': '192.0.2.9' }))
    ).toBe('192.0.2.9')
  })
})

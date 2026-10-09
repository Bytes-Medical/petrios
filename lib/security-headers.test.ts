import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { applySecurityHeaders } from './security-headers'
afterEach(() => vi.unstubAllEnvs())

describe('global browser security headers', () => {
  it('covers every route with the required baseline', async () => {
    vi.stubEnv('APP_URL', 'https://teaching.example.org')
    const headers = applySecurityHeaders(NextResponse.next()).headers
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()')
    expect(headers.get('Permissions-Policy')).toContain('autoplay=(self "https://meet.jit.si")')
    expect(headers.get('Permissions-Policy')).toContain('fullscreen=(self "https://meet.jit.si")')
    expect(headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none')

    const csp = headers.get('Content-Security-Policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain('https://meet.jit.si')
    expect(csp).not.toContain("default-src *")
  })
})

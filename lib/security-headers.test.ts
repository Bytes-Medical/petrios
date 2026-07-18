import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

type Header = { key: string; value: string }
type HeaderRule = { source: string; headers: Header[] }

const require = createRequire(import.meta.url)
const nextConfig = require('../next.config.js') as {
  headers: () => Promise<HeaderRule[]>
}

describe('global browser security headers', () => {
  it('covers every route with the required baseline', async () => {
    const rules = await nextConfig.headers()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/(.*)')

    const headers = new Map(rules[0].headers.map(({ key, value }) => [key, value]))
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

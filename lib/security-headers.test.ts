import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { applySecurityHeaders } from './security-headers'

const MEETING_VARS = [
  'JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY',
  'JITSI_APP_ID', 'JITSI_APP_SECRET', 'JITSI_JWT_AUDIENCE', 'JITSI_JWT_SUBJECT',
]
const APP_ID = 'vpaas-magic-cookie-0123456789abcdef'
const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://teaching.example.org')
  vi.stubEnv('SUPABASE_URL', 'https://db.example.org')
  for (const name of MEETING_VARS) vi.stubEnv(name, '')
})
afterEach(() => vi.unstubAllEnvs())

function headers() {
  return applySecurityHeaders(NextResponse.next()).headers
}

function directive(csp: string | null, name: string): string {
  const found = (csp ?? '').split('; ').find((part) => part.startsWith(`${name} `))
  if (!found) throw new Error(`missing ${name}`)
  return found
}

function useJaas() {
  vi.stubEnv('JAAS_APP_ID', APP_ID)
  vi.stubEnv('JAAS_API_KEY_ID', `${APP_ID}/4f4910`)
  vi.stubEnv('JAAS_PRIVATE_KEY', PRIVATE_KEY)
}

describe('global browser security headers', () => {
  it('covers every route with the required baseline', () => {
    const h = headers()
    expect(h.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    expect(h.get('X-Content-Type-Options')).toBe('nosniff')
    expect(h.get('X-Frame-Options')).toBe('DENY')
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(h.get('X-Permitted-Cross-Domain-Policies')).toBe('none')
    const policy = h.get('Permissions-Policy')
    for (const denied of ['accelerometer=()', 'geolocation=()', 'gyroscope=()', 'magnetometer=()', 'payment=()', 'usb=()']) {
      expect(policy).toContain(denied)
    }

    const csp = h.get('Content-Security-Policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://db.example.org wss://db.example.org")
    expect(csp).not.toContain('default-src *')
  })

  it('public mode (meet.jit.si, the default) delegates nothing: rooms open in a new tab', () => {
    const h = headers()
    const csp = h.get('Content-Security-Policy')
    expect(csp).not.toContain('jit.si')
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self'")
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
    const policy = h.get('Permissions-Policy') ?? ''
    expect(policy).not.toContain('jit.si')
    expect(policy).toContain('camera=()')
    expect(policy).toContain('microphone=()')
    expect(policy).toContain('display-capture=()')
    expect(policy).toContain('autoplay=(self)')
    expect(policy).toContain('fullscreen=(self)')
  })

  it('an explicit JITSI_DOMAIN=meet.jit.si is public mode too', () => {
    vi.stubEnv('JITSI_DOMAIN', 'meet.jit.si')
    expect(headers().get('Content-Security-Policy')).not.toContain('jit.si')
  })

  it('JaaS mode delegates exactly https://8x8.vc (which serves /<AppID>/external_api.js)', () => {
    useJaas()
    const h = headers()
    const csp = h.get('Content-Security-Policy')
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline' https://8x8.vc")
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self' https://8x8.vc")
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' https://db.example.org wss://db.example.org https://8x8.vc wss://8x8.vc"
    )
    expect(csp).not.toContain('meet.jit.si')
    const policy = h.get('Permissions-Policy')
    for (const feature of ['camera', 'microphone', 'display-capture', 'autoplay', 'fullscreen']) {
      expect(policy).toContain(`${feature}=(self "https://8x8.vc")`)
    }
    // The private key never appears in any header.
    for (const [, value] of h.entries()) expect(value).not.toContain('PRIVATE KEY')
  })

  it('self-hosted mode delegates the operator origin, port included', () => {
    vi.stubEnv('JITSI_DOMAIN', 'Video.Trust.NHS.uk:8443')
    const h = headers()
    const csp = h.get('Content-Security-Policy')
    const origin = 'https://video.trust.nhs.uk:8443'
    expect(directive(csp, 'script-src')).toBe(`script-src 'self' 'unsafe-inline' ${origin}`)
    expect(directive(csp, 'frame-src')).toBe(`frame-src 'self' ${origin}`)
    expect(directive(csp, 'connect-src')).toContain(`${origin} wss://video.trust.nhs.uk:8443`)
    expect(h.get('Permissions-Policy')).toContain(`camera=(self "${origin}")`)
    expect(h.get('Permissions-Policy')).toContain(`microphone=(self "${origin}")`)
  })

  it('self-hosted rooms with passes delegate the same origin', () => {
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', 'super-secret-value')
    const h = headers()
    expect(directive(h.get('Content-Security-Policy'), 'frame-src')).toBe("frame-src 'self' https://meet.example.org")
    for (const [, value] of h.entries()) expect(value).not.toContain('super-secret-value')
  })

  it('a configuration error behaves like public mode (meetings unavailable, nothing delegated)', () => {
    vi.stubEnv('JAAS_APP_ID', APP_ID) // partial JaaS
    const h = headers()
    const csp = h.get('Content-Security-Policy')
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self'")
    expect(csp).not.toContain('8x8.vc')
    expect(csp).not.toContain('jit.si')
    expect(h.get('Permissions-Policy')).toContain('camera=()')
  })

  it('a hostile domain cannot inject CSP sources', () => {
    vi.stubEnv('JITSI_DOMAIN', "evil.example; script-src 'unsafe-eval' *")
    const csp = headers().get('Content-Security-Policy')
    expect(csp).not.toContain('evil.example')
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self'")
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicRuntimeConfig, serializePublicRuntimeConfig, validatePublicRuntimeConfig } from './runtime-config'
import { getMeetingConfig } from './meeting/config'
import { applySecurityHeaders } from './security-headers'
import { NextResponse } from 'next/server'

afterEach(() => vi.unstubAllEnvs())
describe('runtime installation configuration', () => {
  it('changes public values, the meeting backend and CSP without reloading modules or rebuilding', () => {
    for (const instance of ['one','two']) {
      vi.stubEnv('APP_URL', `https://${instance}.example.org`)
      vi.stubEnv('SUPABASE_URL', `https://db-${instance}.example.org`)
      vi.stubEnv('SUPABASE_ANON_KEY', `${instance}-public`)
      vi.stubEnv('JITSI_DOMAIN', `meet-${instance}.example.org`)
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'never-public')
      const config = getPublicRuntimeConfig()
      validatePublicRuntimeConfig(config)
      expect(config.appUrl).toContain(instance)
      expect(getMeetingConfig()).toMatchObject({ ok: true, mode: 'self-hosted', domain: `meet-${instance}.example.org` })
      expect(JSON.stringify(config)).not.toContain('never-public')
      const csp = applySecurityHeaders(NextResponse.next()).headers.get('Content-Security-Policy')
      expect(csp).toContain(`https://db-${instance}.example.org`)
      expect(csp).toContain(`frame-src 'self' https://meet-${instance}.example.org`)
    }
  })
  it('never ships the meeting backend or its secrets to the browser', () => {
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', 'never-in-the-browser')
    const serialized = serializePublicRuntimeConfig(getPublicRuntimeConfig())
    expect(serialized).not.toContain('meet.example.org')
    expect(serialized).not.toContain('never-in-the-browser')
    expect(Object.keys(getPublicRuntimeConfig()).sort()).toEqual(['appUrl', 'supabaseAnonKey', 'supabaseUrl'])
  })
  it('preserves legacy environment aliases', () => {
    vi.stubEnv('APP_URL', ''); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://legacy.example.org')
    expect(getPublicRuntimeConfig().appUrl).toBe('https://legacy.example.org')
  })
  it('rejects credentials, insecure remote origins, and header injection', () => {
    const base = { appUrl: 'https://app.example.org', supabaseUrl: 'https://db.example.org', supabaseAnonKey: 'public' }
    expect(() => validatePublicRuntimeConfig({ ...base, appUrl: 'https://user:secret@example.org' })).toThrow()
    expect(() => validatePublicRuntimeConfig({ ...base, appUrl: 'http://example.org' })).toThrow()
    // A hostile meeting domain becomes a configuration error and never reaches the CSP.
    vi.stubEnv('JITSI_DOMAIN', 'example.org; script-src *')
    expect(getMeetingConfig().ok).toBe(false)
    expect(applySecurityHeaders(NextResponse.next()).headers.get('Content-Security-Policy')).not.toContain('example.org')
  })
})

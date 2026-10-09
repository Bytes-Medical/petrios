import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicRuntimeConfig, validatePublicRuntimeConfig } from './runtime-config'
import { getJitsiDomain } from './jitsi'
import { applySecurityHeaders } from './security-headers'
import { NextResponse } from 'next/server'

afterEach(() => vi.unstubAllEnvs())
describe('runtime installation configuration', () => {
  it('changes public values and CSP without reloading modules or rebuilding', () => {
    for (const instance of ['one','two']) {
      vi.stubEnv('APP_URL', `https://${instance}.example.org`)
      vi.stubEnv('SUPABASE_URL', `https://db-${instance}.example.org`)
      vi.stubEnv('SUPABASE_ANON_KEY', `${instance}-public`)
      vi.stubEnv('JITSI_DOMAIN', `meet-${instance}.example.org`)
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'never-public')
      const config = getPublicRuntimeConfig()
      validatePublicRuntimeConfig(config)
      expect(config.appUrl).toContain(instance)
      expect(getJitsiDomain()).toBe(`meet-${instance}.example.org`)
      expect(JSON.stringify(config)).not.toContain('never-public')
      expect(applySecurityHeaders(NextResponse.next()).headers.get('Content-Security-Policy')).toContain(`https://db-${instance}.example.org`)
    }
  })
  it('preserves legacy environment aliases', () => {
    vi.stubEnv('APP_URL', ''); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://legacy.example.org')
    expect(getPublicRuntimeConfig().appUrl).toBe('https://legacy.example.org')
  })
  it('rejects credentials, insecure remote origins, and header injection', () => {
    const base = { appUrl: 'https://app.example.org', supabaseUrl: 'https://db.example.org', supabaseAnonKey: 'public', jitsiDomain: 'meet.jit.si' }
    expect(() => validatePublicRuntimeConfig({ ...base, appUrl: 'https://user:secret@example.org' })).toThrow()
    expect(() => validatePublicRuntimeConfig({ ...base, appUrl: 'http://example.org' })).toThrow()
    expect(() => validatePublicRuntimeConfig({ ...base, jitsiDomain: 'example.org; unsafe-inline' })).toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRotaIdentitySecret, isRotaKillSwitchOn, resetRotaConfigLogForTests } from './config'

afterEach(() => {
  vi.restoreAllMocks()
  resetRotaConfigLogForTests()
})

describe('rota config', () => {
  it('turns on only for exactly "true"', () => {
    expect(isRotaKillSwitchOn({ ROTA_INTEGRATION_ENABLED: 'true' })).toBe(true)
    for (const value of [undefined, '', 'TRUE', 'True', '1', 'yes', 'false', ' true']) {
      expect(isRotaKillSwitchOn({ ROTA_INTEGRATION_ENABLED: value })).toBe(false)
    }
  })

  it('requires a secret of at least 32 bytes and logs once without the value', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(getRotaIdentitySecret({})).toBeNull()
    expect(getRotaIdentitySecret({ ROTA_IDENTITY_SECRET: 'short-secret-value' })).toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).not.toContain('short-secret-value')
    const secret = getRotaIdentitySecret({ ROTA_IDENTITY_SECRET: 'x'.repeat(32) })
    expect(secret).toBeInstanceOf(Uint8Array)
    expect(secret?.length).toBe(32)
    // Multi-byte characters count as bytes, not characters.
    expect(getRotaIdentitySecret({ ROTA_IDENTITY_SECRET: 'é'.repeat(16) })?.length).toBe(32)
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { isValidSetupCode, setupInput } from './setup'
afterEach(() => vi.unstubAllEnvs())
it('requires explicit opt-in and a strong configured code', () => {
  vi.stubEnv('SELF_HOSTED_SETUP', 'true'); vi.stubEnv('SETUP_TOKEN', 'a'.repeat(64))
  expect(isValidSetupCode('a'.repeat(64))).toBe(true)
  expect(isValidSetupCode('b'.repeat(64))).toBe(false)
  expect(isValidSetupCode('short')).toBe(false)
  vi.stubEnv('SELF_HOSTED_SETUP', 'false')
  expect(isValidSetupCode('a'.repeat(64))).toBe(false)
})
it('normalizes identity and rejects weak passwords and empty names', () => {
  const value = { code: 'a'.repeat(64), name: 'Admin', email: 'Admin@example.org', password: 'long-private-passphrase', organisation: 'Hospital', department: 'Medicine' }
  expect(setupInput.parse(value).email).toBe('admin@example.org')
  expect(setupInput.safeParse({ ...value, password: 'short' }).success).toBe(false)
  expect(setupInput.safeParse({ ...value, organisation: ' ' }).success).toBe(false)
})

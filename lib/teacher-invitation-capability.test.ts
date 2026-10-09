import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inviteCodeCapabilityOrWarn,
  inviteCodeIsTrustedCapability,
  resetInviteCodeCapabilityWarningForTests,
} from './teacher-invitation-capability'

afterEach(() => {
  vi.restoreAllMocks()
  resetInviteCodeCapabilityWarningForTests()
})

describe('inviteCodeIsTrustedCapability', () => {
  it('is off by default: an invite code is not a capability until the operator confirms the RLS fix', () => {
    expect(inviteCodeIsTrustedCapability({})).toBe(false)
  })

  it.each(['TRUE', '1', 'yes', 'false', ''])('stays off for %j (only the exact value "true" enables it)', (value) => {
    expect(inviteCodeIsTrustedCapability({ TEACHER_INVITATIONS_RLS_LOCKED: value })).toBe(false)
  })

  it('turns on for "true" (surrounding whitespace tolerated)', () => {
    expect(inviteCodeIsTrustedCapability({ TEACHER_INVITATIONS_RLS_LOCKED: 'true' })).toBe(true)
    expect(inviteCodeIsTrustedCapability({ TEACHER_INVITATIONS_RLS_LOCKED: ' true\n' })).toBe(true)
  })
})

describe('inviteCodeCapabilityOrWarn', () => {
  it('warns once per process while off, naming the variable and the spec only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(inviteCodeCapabilityOrWarn({})).toBe(false)
    expect(inviteCodeCapabilityOrWarn({})).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/TEACHER_INVITATIONS_RLS_LOCKED.*spec\/13/)
  })

  it('does not warn when on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(inviteCodeCapabilityOrWarn({ TEACHER_INVITATIONS_RLS_LOCKED: 'true' })).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })
})

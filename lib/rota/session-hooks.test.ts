import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sessionCalls: [] as unknown[],
  memberCalls: [] as unknown[],
  failWith: null as Error | null,
}))

vi.mock('@/lib/db/rota', () => {
  class RotaNotInstalledError extends Error {}
  return {
    RotaNotInstalledError,
    deleteFlagsForSession: async (input: unknown) => {
      state.sessionCalls.push(input)
      if (state.failWith) throw state.failWith
      return 1
    },
    deleteFlagsForMember: async (input: unknown) => {
      state.memberCalls.push(input)
      if (state.failWith) throw state.failWith
      return 1
    },
  }
})

import * as rotaDb from '@/lib/db/rota'
import {
  onDepartmentMemberRemoved,
  onSessionScheduleChanged,
  sessionScheduleChangeInvalidatesFlags,
} from './session-hooks'

const base = {
  date_start: '2026-10-14T11:30:00.000Z',
  date_end: '2026-10-14T12:30:00.000Z',
  status: 'PUBLISHED',
}

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.sessionCalls = []
  state.memberCalls = []
  state.failWith = null
  vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'true')
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  errors.mockRestore()
})

describe('sessionScheduleChangeInvalidatesFlags', () => {
  it('fires on a start or end change and on becoming CANCELLED', () => {
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base, date_start: '2026-10-14T11:00:00.000Z' })).toBe(true)
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base, date_end: '2026-10-14T13:00:00.000Z' })).toBe(true)
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base, status: 'CANCELLED' })).toBe(true)
  })

  it('ignores descriptive edits, equal instants in another format and staying cancelled', () => {
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base })).toBe(false)
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base, date_start: '2026-10-14T11:30:00+00:00' })).toBe(false)
    expect(sessionScheduleChangeInvalidatesFlags(base, { ...base, status: 'DRAFT' })).toBe(false)
    const cancelled = { ...base, status: 'CANCELLED' }
    expect(sessionScheduleChangeInvalidatesFlags(cancelled, cancelled)).toBe(false)
  })
})

describe('onSessionScheduleChanged', () => {
  it('deletes the session flags on a time change with the kill switch on', async () => {
    await onSessionScheduleChanged({
      orgId: 'org',
      sessionId: 's1',
      before: base,
      after: { ...base, date_start: '2026-10-14T10:30:00.000Z' },
    })
    expect(state.sessionCalls).toEqual([{ orgId: 'org', sessionId: 's1' }])
  })

  it('deletes the session flags when the session is cancelled', async () => {
    await onSessionScheduleChanged({ orgId: 'org', sessionId: 's1', before: base, after: { ...base, status: 'CANCELLED' } })
    expect(state.sessionCalls).toHaveLength(1)
  })

  it('does nothing for an edit that keeps the times', async () => {
    await onSessionScheduleChanged({ orgId: 'org', sessionId: 's1', before: base, after: { ...base } })
    expect(state.sessionCalls).toEqual([])
  })

  it.each([undefined, 'false', 'TRUE', '1'])('does nothing unless the kill switch is exactly "true" (%s)', async (value) => {
    vi.stubEnv('ROTA_INTEGRATION_ENABLED', value as string)
    await onSessionScheduleChanged({ orgId: 'org', sessionId: 's1', before: base, after: { ...base, status: 'CANCELLED' } })
    expect(state.sessionCalls).toEqual([])
  })

  it('swallows "not installed" silently', async () => {
    state.failWith = new rotaDb.RotaNotInstalledError('missing')
    await expect(
      onSessionScheduleChanged({ orgId: 'org', sessionId: 's1', before: base, after: { ...base, status: 'CANCELLED' } })
    ).resolves.toBeUndefined()
    expect(errors).not.toHaveBeenCalled()
  })

  it('swallows other failures and logs without ids', async () => {
    state.failWith = new Error('boom org s1')
    await expect(
      onSessionScheduleChanged({ orgId: 'org', sessionId: 's1', before: base, after: { ...base, status: 'CANCELLED' } })
    ).resolves.toBeUndefined()
    expect(errors.mock.calls).toEqual([['[rota] session flag cleanup failed']])
  })
})

describe('onDepartmentMemberRemoved', () => {
  it('deletes the member flags with the kill switch on', async () => {
    await onDepartmentMemberRemoved({ orgId: 'org', departmentId: 'dept', userId: 'u1' })
    expect(state.memberCalls).toEqual([{ orgId: 'org', departmentId: 'dept', userId: 'u1' }])
  })

  it('does nothing with the kill switch off', async () => {
    vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'false')
    await onDepartmentMemberRemoved({ orgId: 'org', departmentId: 'dept', userId: 'u1' })
    expect(state.memberCalls).toEqual([])
  })

  it('swallows "not installed" silently and other failures with an id-free log', async () => {
    state.failWith = new rotaDb.RotaNotInstalledError('missing')
    await onDepartmentMemberRemoved({ orgId: 'org', departmentId: 'dept', userId: 'u1' })
    expect(errors).not.toHaveBeenCalled()
    state.failWith = new Error('boom u1')
    await onDepartmentMemberRemoved({ orgId: 'org', departmentId: 'dept', userId: 'u1' })
    expect(errors.mock.calls).toEqual([['[rota] member flag cleanup failed']])
  })
})

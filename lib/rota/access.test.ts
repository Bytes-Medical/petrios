import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/rota/access.ts guards over mocked facts. react's cache() is an identity.

const state = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  currentOrgId: 'org-a' as string | null,
  orgAdminOf: new Set<string>(),
  superAdmin: false,
  departments: { 'dept-a': 'org-a', 'dept-b': 'org-b' } as Record<string, string>,
  moderatorRows: [] as { departmentId: string; orgId: string }[],
  settings: { 'org-a': { enabled: true, retentionDays: 30, horizonDays: 56 } } as Record<
    string,
    { enabled: boolean; retentionDays: number; horizonDays: number }
  >,
  enrolled: new Set(['org-a|dept-a']),
  uploaders: new Set<string>(),
  notInstalled: false,
  recallStatuses: ['ABSENT', 'EXCUSED'] as string[],
  lookups: 0,
}))

vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/auth', () => ({
  getCurrentUserId: async () => state.userId,
  getCurrentOrgId: async () => state.currentOrgId,
  isOrgAdmin: async (orgId: string) => state.orgAdminOf.has(orgId),
  isSuperAdmin: async () => state.superAdmin,
}))
vi.mock('@/lib/db/departments', () => ({
  findDepartmentOrgId: async (id: string) => state.departments[id] ?? null,
  listDepartmentModeratorOrgIds: async (_userId: string, departmentId: string) =>
    state.moderatorRows.filter((r) => r.departmentId === departmentId).map((r) => r.orgId),
}))
vi.mock('@/lib/db/recall', () => ({
  listCatchupEligibleStatusesAsSystem: async () => state.recallStatuses,
}))
vi.mock('@/lib/db/rota', () => {
  class RotaNotInstalledError extends Error {}
  class RotaRpcError extends Error {
    rotaCode = 'disabled'
  }
  const guard = () => {
    state.lookups++
    if (state.notInstalled) throw new RotaNotInstalledError('not installed')
  }
  return {
    RotaNotInstalledError,
    RotaRpcError,
    getRotaSettings: async (orgId: string) => (guard(), state.settings[orgId] ?? null),
    isRotaDepartment: async (orgId: string, departmentId: string) => (guard(), state.enrolled.has(`${orgId}|${departmentId}`)),
    isRotaUploader: async (orgId: string, departmentId: string, userId: string) => (
      guard(), state.uploaders.has(`${orgId}|${departmentId}|${userId}`)
    ),
  }
})

import {
  getRotaAvailability,
  isRotaModerator,
  RotaAccessError,
  requireRotaModerator,
  requireRotaModeratorForCleanup,
  requireRotaOrgAdmin,
  requireRotaOrgAdminForCleanup,
  requireRotaUploaderOrModerator,
  toRotaFailure,
} from './access'

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return error instanceof RotaAccessError ? error.code : 'other'
  }
}

beforeEach(() => {
  vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'true')
  vi.stubEnv('ROTA_IDENTITY_SECRET', 'k'.repeat(40))
  state.userId = 'user-1'
  state.currentOrgId = 'org-a'
  state.orgAdminOf = new Set()
  state.superAdmin = false
  state.moderatorRows = []
  state.uploaders = new Set()
  state.notInstalled = false
  state.recallStatuses = ['ABSENT', 'EXCUSED']
  state.lookups = 0
  state.settings = { 'org-a': { enabled: true, retentionDays: 30, horizonDays: 56 } }
  state.enrolled = new Set(['org-a|dept-a'])
})
afterEach(() => vi.unstubAllEnvs())

describe('getRotaAvailability', () => {
  it('checks the kill switch and the secret before any lookup', async () => {
    vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'false')
    expect(await getRotaAvailability('org-a', 'dept-a')).toEqual({ available: false, reason: 'kill_switch' })
    vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'true')
    vi.stubEnv('ROTA_IDENTITY_SECRET', 'short')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getRotaAvailability('org-a', 'dept-a')).toEqual({ available: false, reason: 'secret_missing' })
    expect(state.lookups).toBe(0)
  })

  it('maps not-installed, disabled and un-enrolled', async () => {
    state.notInstalled = true
    expect(await getRotaAvailability('org-a', 'dept-a')).toEqual({ available: false, reason: 'not_installed' })
    state.notInstalled = false
    expect(await getRotaAvailability('org-b', 'dept-b')).toEqual({ available: false, reason: 'org_disabled' })
    state.enrolled = new Set()
    expect(await getRotaAvailability('org-a', 'dept-a')).toEqual({ available: false, reason: 'department_not_enrolled' })
    state.enrolled = new Set(['org-a|dept-a'])
    expect(await getRotaAvailability('org-a', 'dept-a')).toMatchObject({ available: true, horizonDays: 56 })
  })

  it('stays not installed until 064 widens the Recall catch-up to EXCUSED (O2)', async () => {
    state.recallStatuses = ['ABSENT']
    expect(await getRotaAvailability('org-a', 'dept-a')).toEqual({ available: false, reason: 'not_installed' })
    state.orgAdminOf = new Set(['org-a'])
    expect(await codeOf(requireRotaOrgAdmin())).toBe('unavailable')
    expect(await codeOf(requireRotaModerator('dept-a'))).toBe('unavailable')
  })
})

describe('requireRotaModerator', () => {
  it('refuses a super admin acting from another organisation', async () => {
    state.superAdmin = true
    state.currentOrgId = 'org-b'
    state.orgAdminOf = new Set(['org-b'])
    expect(await codeOf(requireRotaModerator('dept-a'))).toBe('forbidden')
    expect(await isRotaModerator('dept-a')).toBe(false)
  })

  it('allows an org admin of the department organisation and a department moderator', async () => {
    state.orgAdminOf = new Set(['org-a'])
    expect(await requireRotaModerator('dept-a')).toEqual({ orgId: 'org-a', userId: 'user-1' })
    state.orgAdminOf = new Set()
    state.moderatorRows = [{ departmentId: 'dept-a', orgId: 'org-a' }]
    expect(await isRotaModerator('dept-a')).toBe(true)
  })

  it('is unavailable when the department is not enrolled, and forbidden before revealing it', async () => {
    state.moderatorRows = [{ departmentId: 'dept-a', orgId: 'org-a' }]
    state.enrolled = new Set()
    expect(await codeOf(requireRotaModerator('dept-a'))).toBe('unavailable')
    state.moderatorRows = []
    state.lookups = 0
    expect(await codeOf(requireRotaModerator('dept-a'))).toBe('forbidden')
    expect(state.lookups).toBe(0)
  })
})

describe('requireRotaUploaderOrModerator', () => {
  it('accepts the uploader grant only in the current organisation', async () => {
    expect(await codeOf(requireRotaUploaderOrModerator('dept-a'))).toBe('forbidden')
    state.uploaders = new Set(['org-a|dept-a|user-1'])
    expect(await requireRotaUploaderOrModerator('dept-a')).toEqual({ orgId: 'org-a', userId: 'user-1', role: 'UPLOADER' })
    state.currentOrgId = 'org-b'
    expect(await codeOf(requireRotaUploaderOrModerator('dept-a'))).toBe('forbidden')
  })

  it('prefers the moderator role', async () => {
    state.orgAdminOf = new Set(['org-a'])
    state.uploaders = new Set(['org-a|dept-a|user-1'])
    expect((await requireRotaUploaderOrModerator('dept-a')).role).toBe('MODERATOR')
  })
})

describe('requireRotaOrgAdmin', () => {
  it('needs an org admin of the current org but not an enabled org', async () => {
    expect(await codeOf(requireRotaOrgAdmin())).toBe('forbidden')
    state.orgAdminOf = new Set(['org-a'])
    state.settings = {}
    expect(await requireRotaOrgAdmin()).toEqual({ orgId: 'org-a', userId: 'user-1' })
    state.notInstalled = true
    expect(await codeOf(requireRotaOrgAdmin())).toBe('unavailable')
  })
})

describe('deletion-only cleanup guards', () => {
  it('work with the kill switch off or the secret missing, for the right roles only', async () => {
    vi.stubEnv('ROTA_INTEGRATION_ENABLED', 'false')
    vi.stubEnv('ROTA_IDENTITY_SECRET', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.recallStatuses = ['ABSENT']
    expect(await codeOf(requireRotaOrgAdminForCleanup())).toBe('forbidden')
    state.orgAdminOf = new Set(['org-a'])
    expect(await requireRotaOrgAdminForCleanup()).toMatchObject({ orgId: 'org-a', userId: 'user-1', settings: { enabled: true } })
    expect(await requireRotaModeratorForCleanup('dept-a')).toEqual({ orgId: 'org-a', userId: 'user-1' })
    // The full guards stay closed.
    expect(await codeOf(requireRotaOrgAdmin())).toBe('unavailable')
    expect(await codeOf(requireRotaModerator('dept-a'))).toBe('unavailable')
  })

  it('refuse other organisations and report not installed as unavailable', async () => {
    state.orgAdminOf = new Set(['org-b'])
    expect(await codeOf(requireRotaModeratorForCleanup('dept-a'))).toBe('forbidden')
    state.orgAdminOf = new Set(['org-a'])
    state.notInstalled = true
    expect(await codeOf(requireRotaOrgAdminForCleanup())).toBe('unavailable')
    expect(await codeOf(requireRotaModeratorForCleanup('dept-a'))).toBe('unavailable')
  })
})

describe('toRotaFailure', () => {
  it('maps access errors to fixed copy and hides unexpected errors', () => {
    expect(toRotaFailure(new RotaAccessError('forbidden'), 'x')).toEqual({
      ok: false,
      message: 'You do not have access to rota availability for this department.',
      code: 'forbidden',
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toRotaFailure(new Error('secret value 12345678'), 'upload')
    expect(result.message).not.toContain('12345678')
    expect(String(log.mock.calls[0][0])).not.toContain('12345678')
  })
})

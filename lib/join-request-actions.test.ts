import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cross-organisation authorization of the department join-request actions.
// The attacker is a self-signup user: org_admin of their own workspace
// ('attacker-org') naming a victim department ('victim-dept' in
// 'victim-org'). lib/auth is replaced by a model of the fixed
// requireDepartmentModerator (its own behaviour is covered in
// lib/auth.test.ts); the DAL is mocked so each test can assert which writes
// ran, with which organisation and role. Lives under lib/ because vitest only
// collects lib/** (and cron) tests.

const state = vi.hoisted(() => ({
  userId: 'attacker',
  currentOrgId: 'attacker-org',
  superAdmin: false,
  /** department id -> owning org */
  departments: {} as Record<string, string>,
  /** department ids the caller moderates (inside their current org) */
  moderated: new Set<string>(),
  calls: [] as [string, ...unknown[]][],
  joinRequest: null as Record<string, unknown> | null,
  departmentRole: 'trainee' as string | null,
  orgRole: 'trainee' as string | null,
}))

function record(name: string, ...args: unknown[]) {
  state.calls.push([name, ...args])
}
function calledWith(name: string) {
  return state.calls.filter(([call]) => call === name).map(([, ...args]) => args)
}

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

vi.mock('@/lib/auth', () => {
  async function requireDepartmentModerator(departmentId: string) {
    const orgId = state.departments[departmentId]
    const allowed =
      !!orgId &&
      (state.superAdmin || (orgId === state.currentOrgId && state.moderated.has(departmentId)))
    if (!allowed) throw new Error('Department moderator required')
    return { orgId }
  }
  return {
    requireAuth: async () => state.userId,
    getCurrentUser: async () => ({ id: state.userId, email: `${state.userId}@example.org` }),
    requireSuperAdmin: async () => {
      if (!state.superAdmin) throw new Error('Super admin required')
      return true
    },
    requireDepartmentModerator,
  }
})

vi.mock('@/lib/db/departments', () => ({
  findDepartmentOrgId: async (id: string) => state.departments[id] ?? null,
  findDepartmentMemberRole: async (input: unknown) => (
    record('findDepartmentMemberRole', input), state.departmentRole
  ),
}))
vi.mock('@/lib/db/onboarding', () => ({
  findOrganizationMembershipRole: async (input: unknown) => (
    record('findOrganizationMembershipRole', input), state.orgRole
  ),
  deleteMembershipsInOtherOrgs: async (...args: unknown[]) =>
    record('deleteMembershipsInOtherOrgs', ...args),
  upsertOrganizationMember: async (input: unknown) => record('upsertOrganizationMember', input),
  upsertDepartmentMember: async (input: unknown) => record('upsertDepartmentMember', input),
}))
vi.mock('@/lib/db/join-requests', () => ({
  findJoinRequest: async () => state.joinRequest,
  insertDepartmentJoinRequest: async (input: unknown) => (
    record('insertDepartmentJoinRequest', input), { id: 'jr-new' }
  ),
  listPendingJoinRequests: async (options?: unknown) => (
    record('listPendingJoinRequests', options), []
  ),
  updateJoinRequestStatus: async (input: unknown) => (record('updateJoinRequestStatus', input), true),
  listOrganizationsForJoin: async () => [],
  listDepartmentsForJoin: async () => [],
}))

import {
  approveDepartmentJoinRequest,
  createDepartmentJoinRequest,
  getAllPendingDepartmentJoinRequests,
  rejectDepartmentJoinRequest,
} from '@/app/actions/join-requests'

beforeEach(() => {
  state.userId = 'attacker'
  state.currentOrgId = 'attacker-org'
  state.superAdmin = false
  state.departments = { 'victim-dept': 'victim-org', 'attacker-dept': 'attacker-org' }
  state.moderated = new Set(['attacker-dept'])
  state.calls = []
  state.joinRequest = null
  state.departmentRole = 'trainee'
  state.orgRole = 'trainee'
})

describe('join requests (C1, C2, C3)', () => {
  const pending = (overrides: Record<string, unknown> = {}) => ({
    id: 'jr-1',
    org_id: 'attacker-org',
    department_id: 'attacker-dept',
    user_id: 'requester',
    user_email: 'requester@example.org',
    requested_role: 'trainee',
    status: 'PENDING',
    ...overrides,
  })

  it('refuses a request whose department belongs to another organisation (org takeover)', async () => {
    // Attacker names the victim org but their own department, then approves.
    state.joinRequest = pending({ org_id: 'victim-org', department_id: 'attacker-dept', user_id: 'attacker', requested_role: 'org_admin' })
    await expect(approveDepartmentJoinRequest('jr-1')).rejects.toThrow(
      'Not authorized to approve this request'
    )
    expect(calledWith('upsertOrganizationMember')).toEqual([])
    expect(calledWith('deleteMembershipsInOtherOrgs')).toEqual([])
    expect(calledWith('updateJoinRequestStatus')).toEqual([])
  })

  it('refuses to approve or reject another tenant request', async () => {
    state.joinRequest = pending({ org_id: 'victim-org', department_id: 'victim-dept' })
    await expect(approveDepartmentJoinRequest('jr-1')).rejects.toThrow('Not authorized')
    await expect(rejectDepartmentJoinRequest('jr-1')).rejects.toThrow('Not authorized')
    expect(calledWith('updateJoinRequestStatus')).toEqual([])
  })

  it('grants only the stored ordinary role, ignoring any client-supplied role', async () => {
    state.joinRequest = pending({ requested_role: 'org_admin' })
    await (approveDepartmentJoinRequest as (id: string, role?: string) => Promise<unknown>)(
      'jr-1',
      'org_admin'
    )
    expect(calledWith('upsertOrganizationMember')).toEqual([
      [{ orgId: 'attacker-org', userId: 'requester', role: 'trainee' }],
    ])
    expect(calledWith('upsertDepartmentMember')).toEqual([
      [{ orgId: 'attacker-org', departmentId: 'attacker-dept', userId: 'requester', role: 'trainee' }],
    ])
    // Department membership is written before the organisation membership.
    const order = state.calls.map(([name]) => name)
    expect(order.indexOf('upsertDepartmentMember')).toBeLessThan(
      order.indexOf('upsertOrganizationMember')
    )
  })

  it('keeps a faculty request as faculty', async () => {
    state.joinRequest = pending({ requested_role: 'faculty' })
    await approveDepartmentJoinRequest('jr-1')
    expect(calledWith('upsertOrganizationMember')).toEqual([
      [{ orgId: 'attacker-org', userId: 'requester', role: 'faculty' }],
    ])
  })

  it('never demotes a requester who already holds a higher role', async () => {
    state.joinRequest = pending({ requested_role: 'trainee' })
    state.orgRole = 'org_admin'
    state.departmentRole = 'department_admin'
    await approveDepartmentJoinRequest('jr-1')
    expect(calledWith('upsertOrganizationMember')).toEqual([
      [{ orgId: 'attacker-org', userId: 'requester', role: 'org_admin' }],
    ])
    expect(calledWith('upsertDepartmentMember')).toEqual([
      [{ orgId: 'attacker-org', departmentId: 'attacker-dept', userId: 'requester', role: 'department_admin' }],
    ])
  })

  it('getAllPendingDepartmentJoinRequests is super-admin only', async () => {
    await expect(getAllPendingDepartmentJoinRequests()).rejects.toThrow('Super admin required')
    expect(calledWith('listPendingJoinRequests')).toEqual([])
    state.superAdmin = true
    await getAllPendingDepartmentJoinRequests()
    expect(calledWith('listPendingJoinRequests')).toEqual([[{ service: true }]])
  })

  it('createDepartmentJoinRequest binds department to organisation and role to ordinary roles', async () => {
    await expect(
      createDepartmentJoinRequest('victim-org', 'attacker-dept')
    ).rejects.toThrow('Department not found in this organization')
    await expect(
      createDepartmentJoinRequest('victim-org', 'victim-dept', 'org_admin' as never)
    ).rejects.toThrow('trainee or faculty')
    expect(calledWith('insertDepartmentJoinRequest')).toEqual([])

    await createDepartmentJoinRequest('victim-org', 'victim-dept')
    expect(calledWith('insertDepartmentJoinRequest')).toEqual([
      [expect.objectContaining({ orgId: 'victim-org', departmentId: 'victim-dept', requestedRole: 'trainee' })],
    ])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cross-organisation authorization of department-id server actions. The
// attacker is a self-signup user: org_admin of their own workspace
// ('attacker-org') naming a victim department ('victim-dept' in
// 'victim-org'). lib/auth is replaced by a model of the fixed helpers (its
// own behaviour is covered in lib/auth.test.ts); the DAL is mocked so each
// test can assert which organisation every query and write was scoped to.
// Lives under lib/ because vitest only collects lib/** (and cron) tests.

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
  moderatesElsewhere: false,
  memberIds: [] as string[],
  sessionScope: null as Record<string, unknown> | null,
}))

function record(name: string, ...args: unknown[]) {
  state.calls.push([name, ...args])
}
function calledWith(name: string) {
  return state.calls.filter(([call]) => call === name).map(([, ...args]) => args)
}

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/server', () => ({ after: () => undefined }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://petrios.example' }))
vi.mock('@/lib/email', () => ({
  getEmailClient: () => ({
    emails: {
      send: async (input: unknown) => {
        record('send', input)
        return { data: { id: 'msg' }, error: null }
      },
    },
  }),
  getFromAddress: () => 'Petrios <no-reply@petrios.example>',
}))
vi.mock('@/lib/notify', () => ({ notifyUser: async () => undefined }))
vi.mock('@/lib/webhooks', () => ({ emitWebhook: async () => undefined }))

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
    getCurrentOrgId: async () => state.currentOrgId,
    requireOrg: async () => state.currentOrgId,
    requireSuperAdmin: async () => {
      if (!state.superAdmin) throw new Error('Super admin required')
      return true
    },
    requireDepartmentModerator,
    isDepartmentModerator: async (departmentId: string) =>
      requireDepartmentModerator(departmentId).then(
        () => true,
        () => false
      ),
    requireOrgScope: async (orgId: string) => {
      if (!state.superAdmin && orgId !== state.currentOrgId) {
        throw new Error('Organization access denied')
      }
      return orgId
    },
    requireSessionModerator: async () => {
      throw new Error('not used')
    },
  }
})

vi.mock('@/lib/db/departments', () => ({
  findDepartmentOrgId: async (id: string) => state.departments[id] ?? null,
  listDepartmentsByOrg: async (orgId: string) => (record('listDepartmentsByOrg', orgId), []),
  listDepartmentMemberUserIds: async (departmentId: string, orgId: string) => (
    record('listDepartmentMemberUserIds', departmentId, orgId), state.memberIds
  ),
  countDepartmentMembers: async (departmentId: string, orgId?: string) => (
    record('countDepartmentMembers', departmentId, orgId), 3
  ),
  findDepartmentMemberRole: async (input: unknown) => (
    record('findDepartmentMemberRole', input), state.departmentRole
  ),
  deleteDepartmentMember: async (...args: unknown[]) => record('deleteDepartmentMember', ...args),
  deleteOrgMember: async (...args: unknown[]) => record('deleteOrgMember', ...args),
}))
vi.mock('@/lib/db/onboarding', () => ({
  listProfilesForUsers: async (ids: string[]) =>
    ids.map((id) => ({ user_id: id, email: `${id}@victim.example` })),
  findOrganizationMembershipRole: async (input: unknown) => (
    record('findOrganizationMembershipRole', input), state.orgRole
  ),
  hasDepartmentAdminRole: async (input: unknown) => (
    record('hasDepartmentAdminRole', input), state.moderatesElsewhere
  ),
  listOrganizationMembers: async (orgId: string) => (record('listOrganizationMembers', orgId), []),
  countOrganizationMembers: async (orgId: string) => (record('countOrganizationMembers', orgId), 9),
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
vi.mock('@/lib/db/teaching-slots', () => ({
  insertSlots: async (input: { slots: unknown[] }) => (record('insertSlots', input), input.slots),
  listSlotsForDepartment: async (orgId: string, departmentId: string) => (
    record('listSlotsForDepartment', orgId, departmentId), []
  ),
}))
vi.mock('@/lib/db/external-contacts', () => ({
  listGroupsWithCounts: async (orgId: string) => (record('listGroupsWithCounts', orgId), []),
  listContactsInGroups: async () => [],
}))
vi.mock('@/lib/db/notifications', () => ({}))
vi.mock('@/lib/db/teacher-invitations', () => ({ findDepartmentName: async () => 'Victim Dept' }))
vi.mock('@/lib/db/sessions', () => ({
  insertSessions: async (inputs: unknown[]) => (record('insertSessions', inputs), inputs),
  listSessionsByOrg: async (orgId: string) => (record('listSessionsByOrg', orgId), []),
  findSessionScope: async () => state.sessionScope,
  updateSessionById: async (...args: unknown[]) => (
    record('updateSessionById', ...args), { id: 'own-session', title: 'T' }
  ),
}))
vi.mock('@/lib/db/certificates', () => ({}))

import {
  getDepartmentMemberUsers,
  getDepartmentsForOrg,
  removeDepartmentMember,
} from '@/app/actions/departments'
import {
  approveDepartmentJoinRequest,
  createDepartmentJoinRequest,
  getAllPendingDepartmentJoinRequests,
  rejectDepartmentJoinRequest,
} from '@/app/actions/join-requests'
import {
  createTeachingSlots,
  getPublishAudienceMeta,
  publishSlots,
} from '@/app/actions/teaching-slots'
import { createSession, getSessionsForOrg, updateSession } from '@/app/actions/sessions'
import { appDayKey } from '@/lib/datetime'

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
  state.moderatesElsewhere = false
  state.memberIds = ['victim-user']
  state.sessionScope = null
})

describe('department member actions (E1, E2)', () => {
  it('removeDepartmentMember refuses another tenant department and deletes nothing', async () => {
    await expect(removeDepartmentMember('victim-dept', 'victim-admin')).rejects.toThrow(
      'Department moderator required'
    )
    expect(calledWith('deleteDepartmentMember')).toEqual([])
    expect(calledWith('deleteOrgMember')).toEqual([])
  })

  it('removeDepartmentMember scopes the removal to the department org', async () => {
    await removeDepartmentMember('attacker-dept', 'member-1')
    expect(calledWith('findDepartmentMemberRole')).toEqual([
      [{ departmentId: 'attacker-dept', orgId: 'attacker-org', userId: 'member-1' }],
    ])
    expect(calledWith('deleteDepartmentMember')).toEqual([['attacker-dept', 'attacker-org', 'member-1']])
    expect(calledWith('deleteOrgMember')).toEqual([['attacker-org', 'member-1']])
  })

  it('removeDepartmentMember refuses a peer moderator of another department', async () => {
    state.departmentRole = 'trainee'
    state.orgRole = 'trainee'
    state.moderatesElsewhere = true
    await expect(removeDepartmentMember('attacker-dept', 'peer-mod')).rejects.toThrow(
      'Administrators cannot be removed'
    )
    state.moderatesElsewhere = false
    state.orgRole = 'department_admin'
    await expect(removeDepartmentMember('attacker-dept', 'peer-mod')).rejects.toThrow(
      'Administrators cannot be removed'
    )
    expect(calledWith('deleteDepartmentMember')).toEqual([])
    expect(calledWith('deleteOrgMember')).toEqual([])
  })

  it('removeDepartmentMember refuses non-members and administrators', async () => {
    state.departmentRole = null
    await expect(removeDepartmentMember('attacker-dept', 'stranger')).rejects.toThrow(
      'Member not found in this department'
    )
    state.departmentRole = 'trainee'
    state.orgRole = 'org_admin'
    await expect(removeDepartmentMember('attacker-dept', 'admin')).rejects.toThrow(
      'Administrators cannot be removed'
    )
    state.orgRole = 'faculty'
    state.departmentRole = 'department_admin'
    await expect(removeDepartmentMember('attacker-dept', 'mod')).rejects.toThrow(
      'Administrators cannot be removed'
    )
    expect(calledWith('deleteOrgMember')).toEqual([])
  })

  it('getDepartmentMemberUsers refuses another tenant and scopes its own listing', async () => {
    await expect(getDepartmentMemberUsers('victim-dept')).rejects.toThrow(
      'Department moderator required'
    )
    expect(calledWith('listDepartmentMemberUserIds')).toEqual([])

    await getDepartmentMemberUsers('attacker-dept')
    expect(calledWith('listDepartmentMemberUserIds')).toEqual([['attacker-dept', 'attacker-org']])
  })

  it('getDepartmentsForOrg only serves the current organisation', async () => {
    await expect(getDepartmentsForOrg('victim-org')).rejects.toThrow('Organization access denied')
    await getDepartmentsForOrg('attacker-org')
    expect(calledWith('listDepartmentsByOrg')).toEqual([['attacker-org']])
  })
})

describe('teaching slots (E3)', () => {
  const tomorrow = appDayKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))

  it('createTeachingSlots refuses a victim department and writes nothing', async () => {
    await expect(
      createTeachingSlots('victim-dept', {
        dayKeys: [tomorrow],
        time: '09:00',
        durationMins: 60,
        locationType: 'JITSI',
      })
    ).rejects.toThrow('Department moderator required')
    expect(calledWith('insertSlots')).toEqual([])
  })

  it('createTeachingSlots writes under the department organisation', async () => {
    await createTeachingSlots('attacker-dept', {
      dayKeys: [tomorrow],
      time: '09:00',
      durationMins: 60,
      locationType: 'JITSI',
    })
    expect(calledWith('insertSlots')).toEqual([
      [expect.objectContaining({ orgId: 'attacker-org', departmentId: 'attacker-dept' })],
    ])
  })

  it('publishSlots refuses a victim department before resolving any audience or sending', async () => {
    await expect(
      publishSlots('victim-dept', {
        slotIds: ['planted-slot'],
        groupIds: [],
        allDepartmentMembers: true,
        allOrgMembers: false,
      })
    ).rejects.toThrow('Department moderator required')
    expect(calledWith('listSlotsForDepartment')).toEqual([])
    expect(calledWith('listDepartmentMemberUserIds')).toEqual([])
    expect(calledWith('send')).toEqual([])
  })

  it('getPublishAudienceMeta refuses a victim department and scopes counts to the department org', async () => {
    await expect(getPublishAudienceMeta('victim-dept')).rejects.toThrow(
      'Department moderator required'
    )
    expect(calledWith('countDepartmentMembers')).toEqual([])

    await getPublishAudienceMeta('attacker-dept')
    expect(calledWith('countDepartmentMembers')).toEqual([['attacker-dept', 'attacker-org']])
  })
})

describe('sessions (E4, E5)', () => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  it('createSession refuses a victim department and inserts nothing', async () => {
    await expect(
      createSession({
        department_id: 'victim-dept',
        title: 'Phish',
        date_starts: [start],
        duration_mins: 60,
        location_type: 'MS_TEAMS',
        teams_meeting_url: 'https://teams.microsoft.com/l/meetup-join/evil',
      })
    ).rejects.toThrow('Department moderator required')
    expect(calledWith('insertSessions')).toEqual([])
  })

  it('createSession inserts under the department organisation', async () => {
    await createSession({
      department_id: 'attacker-dept',
      title: 'Teaching',
      date_starts: [start],
      duration_mins: 60,
      location_type: 'JITSI',
    })
    expect(calledWith('insertSessions')).toEqual([
      [[expect.objectContaining({ orgId: 'attacker-org', departmentId: 'attacker-dept' })]],
    ])
  })

  it('updateSession refuses to re-home a session into another department', async () => {
    state.sessionScope = {
      id: 'own-session',
      department_id: 'attacker-dept',
      date_start: start,
      date_end: new Date(Date.parse(start) + 3600_000).toISOString(),
      status: 'DRAFT',
    }
    await expect(
      updateSession('own-session', {
        department_id: 'victim-dept',
        status: 'PUBLISHED',
      } as never)
    ).rejects.toThrow(/department_id/)
    await expect(
      updateSession('own-session', { attendance_locked: false } as never)
    ).rejects.toThrow(/attendance_locked/)
    expect(calledWith('updateSessionById')).toEqual([])

    await updateSession('own-session', { title: 'Renamed' })
    expect(calledWith('updateSessionById')).toEqual([['own-session', 'attacker-org', { title: 'Renamed' }]])
  })

  it('getSessionsForOrg only serves the current organisation', async () => {
    await expect(getSessionsForOrg('victim-org')).rejects.toThrow('Organization access denied')
    expect(calledWith('listSessionsByOrg')).toEqual([])
  })
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

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same-kind gaps inside one organisation: invitation rows (which carry RSVP
// invite codes) and teacher email history are moderator-only, and the member
// attendance report only names members of the caller's own organisation.

const state = vi.hoisted(() => ({
  sessionModerator: false,
  orgAdmin: false,
  moderatedDepartments: [] as { id: string; name: string }[],
  memberRole: 'trainee' as string | null,
  calls: [] as [string, ...unknown[]][],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://petrios.example' }))
vi.mock('@/lib/email', () => ({ getEmailClient: () => ({}), getFromAddress: () => 'x' }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: async () => ({}) }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => 'user-1',
  requireOrg: async () => 'org-1',
  isOrgAdmin: async () => state.orgAdmin,
  isSuperAdmin: async () => false,
  requireDepartmentModerator: async () => ({ orgId: 'org-1' }),
  requireSessionModerator: async (sessionId: string) => {
    state.calls.push(['requireSessionModerator', sessionId])
    if (!state.sessionModerator) throw new Error('Department moderator required')
    return { orgId: 'org-1', departmentId: 'dept-1' }
  },
}))
vi.mock('@/app/actions/departments', () => ({
  getDepartments: async () => [{ id: 'dept-1', name: 'Renal' }],
  getMyModeratedDepartments: async () => state.moderatedDepartments,
}))
vi.mock('@/lib/db/teacher-invitations', () => ({
  listInvitationsForSession: async (orgId: string, sessionId: string) => {
    state.calls.push(['listInvitationsForSession', orgId, sessionId])
    return []
  },
}))
vi.mock('@/lib/db/teacher-emails', () => ({
  listTeacherEmailsForSession: async (orgId: string, sessionId: string) => {
    state.calls.push(['listTeacherEmailsForSession', orgId, sessionId])
    return []
  },
}))
vi.mock('@/lib/db/sessions', () => ({}))
vi.mock('@/lib/db/teaching-slots', () => ({}))
vi.mock('@/lib/db/external-contacts', () => ({}))
vi.mock('@/lib/db/audit', () => ({
  listPastPublishedSessionsMeta: async () => {
    state.calls.push(['listPastPublishedSessionsMeta'])
    return []
  },
  listMemberAttendanceRows: async () => [],
}))
vi.mock('@/lib/db/onboarding', () => ({
  findOrganizationMembershipRole: async (input: unknown) => {
    state.calls.push(['findOrganizationMembershipRole', input])
    return state.memberRole
  },
  findProfileByUserId: async (userId: string) => {
    state.calls.push(['findProfileByUserId', userId])
    return { full_name: 'Dr Member', email: 'member@nhs.example' }
  },
}))
vi.mock('@react-pdf/renderer', () => ({ renderToBuffer: async () => Buffer.from('%PDF') }))
vi.mock('@/lib/audit-report/pdf', () => ({ buildMemberReportDocument: () => null }))

import { getSessionInvitations } from '@/app/actions/teacher-invitations'
import { getTeacherEmailHistory } from '@/app/actions/emails'
import { generateMemberAttendanceReportPDF } from '@/app/actions/audit'

const names = () => state.calls.map(([name]) => name)

beforeEach(() => {
  state.sessionModerator = false
  state.orgAdmin = false
  state.moderatedDepartments = []
  state.memberRole = 'trainee'
  state.calls = []
})

describe('session invitation and email history reads', () => {
  it('refuse a non-moderator before reading invite codes', async () => {
    await expect(getSessionInvitations('session-1')).rejects.toThrow('Department moderator required')
    await expect(getTeacherEmailHistory('session-1')).rejects.toThrow('Department moderator required')
    expect(names()).not.toContain('listInvitationsForSession')
    expect(names()).not.toContain('listTeacherEmailsForSession')
  })

  it('serve a session moderator, scoped to the session organisation', async () => {
    state.sessionModerator = true
    await getSessionInvitations('session-1')
    await getTeacherEmailHistory('session-1')
    expect(state.calls).toContainEqual(['listInvitationsForSession', 'org-1', 'session-1'])
    expect(state.calls).toContainEqual(['listTeacherEmailsForSession', 'org-1', 'session-1'])
  })
})

describe('generateMemberAttendanceReportPDF', () => {
  it('refuses a caller with no audit access', async () => {
    await expect(generateMemberAttendanceReportPDF('anyone')).rejects.toThrow('No audit access')
    expect(names()).not.toContain('findProfileByUserId')
  })

  it('refuses a target who is not a member of the caller organisation', async () => {
    state.orgAdmin = true
    state.memberRole = null
    await expect(generateMemberAttendanceReportPDF('other-tenant-user')).rejects.toThrow(
      'Member not found in this organization'
    )
    expect(state.calls).toContainEqual([
      'findOrganizationMembershipRole',
      { orgId: 'org-1', userId: 'other-tenant-user' },
    ])
    expect(names()).not.toContain('findProfileByUserId')
  })

  it('builds the report for an own-organisation member', async () => {
    state.moderatedDepartments = [{ id: 'dept-1', name: 'Renal' }]
    const report = await generateMemberAttendanceReportPDF('member-1')
    expect(report.filename).toMatch(/\.pdf$/)
    expect(names()).toContain('findProfileByUserId')
  })
})

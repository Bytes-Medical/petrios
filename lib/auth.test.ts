import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/auth.ts role helpers against an in-memory model of the membership
// tables. The Supabase user client is a tiny query-builder fake; the
// service-role department lookup and the session scope come from mocked DAL
// modules. react's cache() is an identity here, so every call re-reads.

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  userId: 'attacker' as string | null,
  tables: {
    organization_members: [] as Row[],
    super_admins: [] as Row[],
    department_members: [] as Row[],
  } as Record<string, Row[]>,
  departments: {} as Record<string, string>, // department id -> org id
  sessions: [] as { id: string; org_id: string; department_id: string }[],
}))

function query(table: string) {
  const eqs: [string, unknown][] = []
  const ins: [string, unknown[]][] = []
  let order: { column: string; ascending: boolean } | null = null
  let limit: number | null = null
  const rows = () => {
    let result = (state.tables[table] ?? []).filter(
      (row) =>
        eqs.every(([column, value]) => row[column] === value) &&
        ins.every(([column, values]) => values.includes(row[column]))
    )
    if (order) {
      const { column, ascending } = order
      result = [...result].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)
      )
    }
    return limit === null ? result : result.slice(0, limit)
  }
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => (eqs.push([column, value]), builder),
    in: (column: string, values: unknown[]) => (ins.push([column, values]), builder),
    order: (column: string, options: { ascending: boolean }) => (
      (order = { column, ascending: options.ascending }), builder
    ),
    limit: (count: number) => ((limit = count), builder),
    maybeSingle: async () => {
      const found = rows()
      return found.length > 1
        ? { data: null, error: { message: 'multiple rows' } }
        : { data: found[0] ?? null, error: null }
    },
    single: async () => {
      const found = rows()
      return found.length === 1
        ? { data: found[0], error: null }
        : { data: null, error: { message: 'not exactly one row' } }
    },
    then: (resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  }
  return builder
}

vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
    },
    from: (table: string) => query(table),
  }),
}))
vi.mock('@/lib/db/departments', () => ({
  findDepartmentOrgId: async (id: string) => state.departments[id] ?? null,
  listDepartmentModeratorOrgIds: async (userId: string, departmentId: string) =>
    state.tables.department_members
      .filter(
        (row) =>
          row.user_id === userId &&
          row.department_id === departmentId &&
          (row.role === 'department_admin' || row.role === 'org_admin')
      )
      .map((row) => row.org_id as string),
}))
vi.mock('@/lib/db/sessions', () => ({
  findSessionScope: async (id: string, orgId: string) =>
    state.sessions.find((session) => session.id === id && session.org_id === orgId) ?? null,
}))

import {
  getCurrentOrgId,
  isDepartmentModerator,
  isOrgManager,
  requireDepartmentModerator,
  requireOrgScope,
  requireSessionModerator,
} from './auth'

beforeEach(() => {
  state.userId = 'attacker'
  state.departments = {
    'victim-dept': 'victim-org',
    'attacker-dept': 'attacker-org',
    'victim-dept-2': 'victim-org',
  }
  state.tables = {
    // Every self-signup user is org_admin of their own workspace.
    organization_members: [
      { id: 'om-1', org_id: 'attacker-org', user_id: 'attacker', role: 'org_admin', created_at: '2026-01-01' },
      { id: 'om-2', org_id: 'victim-org', user_id: 'victim-admin', role: 'org_admin', created_at: '2026-01-01' },
      { id: 'om-3', org_id: 'victim-org', user_id: 'victim-mod', role: 'faculty', created_at: '2026-01-01' },
    ],
    super_admins: [],
    department_members: [
      { id: 'dm-1', org_id: 'victim-org', department_id: 'victim-dept', user_id: 'victim-mod', role: 'department_admin' },
      { id: 'dm-2', org_id: 'victim-org', department_id: 'victim-dept-2', user_id: 'victim-mod', role: 'department_admin' },
    ],
  }
  state.sessions = [
    { id: 'victim-session', org_id: 'victim-org', department_id: 'victim-dept' },
    { id: 'attacker-session', org_id: 'attacker-org', department_id: 'attacker-dept' },
    // Re-homed before migration 062: attacker org, victim department.
    { id: 'rehomed-session', org_id: 'attacker-org', department_id: 'victim-dept' },
  ]
})

describe('isDepartmentModerator / requireDepartmentModerator', () => {
  it('denies a workspace org admin for another tenant department (H1)', async () => {
    expect(await isDepartmentModerator('victim-dept')).toBe(false)
    await expect(requireDepartmentModerator('victim-dept')).rejects.toThrow(
      'Department moderator required'
    )
  })

  it('denies a planted moderator row stamped with the attacker org', async () => {
    state.tables.department_members.push({
      id: 'planted',
      org_id: 'attacker-org',
      department_id: 'victim-dept',
      user_id: 'attacker',
      role: 'department_admin',
    })
    expect(await isDepartmentModerator('victim-dept')).toBe(false)
  })

  it('allows the org admin for their own department and returns its org', async () => {
    expect(await isDepartmentModerator('attacker-dept')).toBe(true)
    await expect(requireDepartmentModerator('attacker-dept')).resolves.toEqual({
      orgId: 'attacker-org',
    })
  })

  it('allows a genuine department admin of several departments', async () => {
    state.userId = 'victim-mod'
    await expect(requireDepartmentModerator('victim-dept')).resolves.toEqual({ orgId: 'victim-org' })
    await expect(requireDepartmentModerator('victim-dept-2')).resolves.toEqual({ orgId: 'victim-org' })
  })

  it('denies an unknown department and an anonymous caller', async () => {
    expect(await isDepartmentModerator('missing')).toBe(false)
    state.userId = null
    expect(await isDepartmentModerator('attacker-dept')).toBe(false)
  })

  it('lets a super admin moderate any department, scoped to that department org', async () => {
    state.tables.super_admins.push({ user_id: 'attacker' })
    await expect(requireDepartmentModerator('victim-dept')).resolves.toEqual({ orgId: 'victim-org' })
  })
})

describe('requireSessionModerator', () => {
  it('resolves an own-org session for its moderator', async () => {
    await expect(requireSessionModerator('attacker-session')).resolves.toEqual({
      orgId: 'attacker-org',
      departmentId: 'attacker-dept',
    })
  })

  it('cannot see another tenant session', async () => {
    await expect(requireSessionModerator('victim-session')).rejects.toThrow('Session not found')
  })

  it('refuses an own-org session bound to a foreign department', async () => {
    await expect(requireSessionModerator('rehomed-session')).rejects.toThrow(
      'Department moderator required'
    )
  })
})

describe('requireOrgScope', () => {
  it('serves the current org only', async () => {
    await expect(requireOrgScope('attacker-org')).resolves.toBe('attacker-org')
    await expect(requireOrgScope('victim-org')).rejects.toThrow('Organization access denied')
  })
})

describe('isOrgManager', () => {
  it('treats a moderator of several departments as a manager (H3)', async () => {
    state.userId = 'victim-mod'
    expect(await getCurrentOrgId()).toBe('victim-org')
    expect(await isOrgManager('victim-org')).toBe(true)
  })

  it('is false for a plain member', async () => {
    state.userId = 'victim-mod'
    state.tables.department_members = []
    expect(await isOrgManager('victim-org')).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Organisation scoping of the department-moderation and join-request DAL
// helpers, against an in-memory table model behind a minimal PostgREST-style
// query builder.

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserts: [] as [string, Row][],
  updates: [] as [string, Row][],
}))

function query(table: string) {
  const eqs: [string, unknown][] = []
  const ins: [string, unknown[]][] = []
  let pendingInsert: Row | null = null
  let pendingUpdate: Row | null = null
  let limit: number | null = null

  const matches = (row: Row) =>
    eqs.every(([column, value]) => row[column] === value) &&
    ins.every(([column, values]) => values.includes(row[column]))

  const run = () => {
    if (pendingInsert) {
      state.inserts.push([table, pendingInsert])
      ;(state.tables[table] ??= []).push(pendingInsert)
      return { data: null, error: null }
    }
    if (pendingUpdate) {
      const hit = (state.tables[table] ?? []).filter(matches)
      for (const row of hit) Object.assign(row, pendingUpdate)
      state.updates.push([table, pendingUpdate])
      return { data: hit.map((row) => ({ id: row.id })), error: null }
    }
    const found = (state.tables[table] ?? []).filter(matches)
    return { data: limit === null ? found : found.slice(0, limit), error: null }
  }

  const builder = {
    select: () => builder,
    insert: (row: Row) => ((pendingInsert = row), builder),
    update: (row: Row) => ((pendingUpdate = row), builder),
    eq: (column: string, value: unknown) => (eqs.push([column, value]), builder),
    in: (column: string, values: unknown[]) => (ins.push([column, values]), builder),
    order: () => builder,
    limit: (count: number) => ((limit = count), builder),
    maybeSingle: async () => {
      const result = run()
      const rows = (result.data as Row[] | null) ?? []
      return { data: rows[0] ?? null, error: null }
    },
    then: (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  }
  return builder
}

vi.mock('@/lib/db/client', () => ({
  getDb: async () => ({ from: (table: string) => query(table) }),
  getServiceDb: async () => ({ from: (table: string) => query(table) }),
}))

import * as departmentsDb from './departments'
import * as joinRequestsDb from './join-requests'

beforeEach(() => {
  state.inserts = []
  state.updates = []
  state.tables = {
    department_members: [
      { id: 'dm-1', org_id: 'victim-org', department_id: 'victim-dept', user_id: 'victim-user', role: 'trainee' },
      // Planted before migration 062: attacker org, victim department.
      { id: 'dm-2', org_id: 'attacker-org', department_id: 'victim-dept', user_id: 'attacker', role: 'department_admin' },
    ],
    department_join_requests: [{ id: 'jr-1', status: 'PENDING' }],
  }
})

describe('department member listings', () => {
  it('findDepartmentMemberRole is organisation scoped', async () => {
    expect(
      await departmentsDb.findDepartmentMemberRole({ departmentId: 'victim-dept', orgId: 'victim-org', userId: 'attacker' })
    ).toBeNull()
  })

  it('listDepartmentModeratorOrgIds exposes the row org so lib/auth can reject a mismatch', async () => {
    expect(await departmentsDb.listDepartmentModeratorOrgIds('attacker', 'victim-dept')).toEqual([
      'attacker-org',
    ])
  })
})

describe('updateJoinRequestStatus', () => {
  it('decides a pending request once', async () => {
    expect(
      await joinRequestsDb.updateJoinRequestStatus({ id: 'jr-1', status: 'APPROVED', decidedBy: 'mod' })
    ).toBe(true)
    expect(
      await joinRequestsDb.updateJoinRequestStatus({ id: 'jr-1', status: 'REJECTED', decidedBy: 'mod' })
    ).toBe(false)
    expect(state.tables.department_join_requests[0].status).toBe('APPROVED')
  })
})

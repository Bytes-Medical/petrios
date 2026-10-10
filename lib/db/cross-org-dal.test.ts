import { beforeEach, describe, expect, it, vi } from 'vitest'

// Organisation scoping inside the data-access layer, against an in-memory
// table model behind a minimal PostgREST-style query builder.

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
  let selectSpec = '*'
  let limit: number | null = null

  const matches = (row: Row) =>
    eqs.every(([column, value]) => row[column] === value) &&
    ins.every(([column, values]) => values.includes(row[column]))

  const embed = (row: Row): Row => {
    // Supports the one embed these tests need: external_contacts:contact_id(*)
    if (selectSpec.includes('external_contacts:contact_id')) {
      const contact = (state.tables.external_contacts ?? []).find((c) => c.id === row.contact_id)
      return { ...row, external_contacts: contact ?? null }
    }
    return row
  }

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
    const found = (state.tables[table] ?? []).filter(matches).map(embed)
    return { data: limit === null ? found : found.slice(0, limit), error: null }
  }

  const builder = {
    select: (spec = '*') => ((selectSpec = spec), builder),
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

import * as contactsDb from './external-contacts'
import * as departmentsDb from './departments'
import * as joinRequestsDb from './join-requests'

beforeEach(() => {
  state.inserts = []
  state.updates = []
  state.tables = {
    contact_groups: [
      { id: 'own-group', org_id: 'attacker-org', name: 'Mine' },
      { id: 'victim-group', org_id: 'victim-org', name: 'Theirs' },
    ],
    external_contacts: [
      { id: 'own-contact', org_id: 'attacker-org', email: 'mine@example.org', archived_at: null },
      { id: 'victim-contact', org_id: 'victim-org', email: 'consultant@victim.nhs.uk', archived_at: null },
    ],
    contact_group_members: [],
    department_members: [
      { id: 'dm-1', org_id: 'victim-org', department_id: 'victim-dept', user_id: 'victim-user', role: 'trainee' },
      // Planted before migration 062: attacker org, victim department.
      { id: 'dm-2', org_id: 'attacker-org', department_id: 'victim-dept', user_id: 'attacker', role: 'department_admin' },
    ],
    department_join_requests: [{ id: 'jr-1', status: 'PENDING' }],
  }
})

describe('addContactToGroup (E6)', () => {
  it('refuses another tenant contact and inserts nothing', async () => {
    await expect(
      contactsDb.addContactToGroup({ orgId: 'attacker-org', groupId: 'own-group', contactId: 'victim-contact' })
    ).rejects.toThrow('Contact not found')
    expect(state.inserts).toEqual([])
  })

  it('refuses another tenant group', async () => {
    await expect(
      contactsDb.addContactToGroup({ orgId: 'attacker-org', groupId: 'victim-group', contactId: 'own-contact' })
    ).rejects.toThrow('Contact group not found')
    expect(state.inserts).toEqual([])
  })

  it('adds an own contact to an own group', async () => {
    await contactsDb.addContactToGroup({ orgId: 'attacker-org', groupId: 'own-group', contactId: 'own-contact' })
    expect(state.inserts).toEqual([
      ['contact_group_members', { org_id: 'attacker-org', group_id: 'own-group', contact_id: 'own-contact' }],
    ])
  })

  it('never returns or fans out to a foreign contact from a previously planted row', async () => {
    state.tables.contact_group_members.push(
      { org_id: 'attacker-org', group_id: 'own-group', contact_id: 'victim-contact' },
      { org_id: 'attacker-org', group_id: 'own-group', contact_id: 'own-contact' }
    )
    const members = await contactsDb.listGroupMemberContacts('attacker-org', 'own-group')
    expect(members.map((c) => c.id)).toEqual(['own-contact'])
    const fanOut = await contactsDb.listContactsInGroups('attacker-org', ['own-group'])
    expect(fanOut.map((c) => c.id)).toEqual(['own-contact'])
  })
})

describe('department member listings', () => {
  it('listDepartmentMemberUserIds only returns rows of the given organisation', async () => {
    expect(await departmentsDb.listDepartmentMemberUserIds('victim-dept', 'victim-org')).toEqual([
      'victim-user',
    ])
    expect(await departmentsDb.listDepartmentMemberUserIds('victim-dept', 'attacker-org')).toEqual([
      'attacker',
    ])
  })

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

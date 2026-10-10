// Rota DAL (lib/db/rota.ts) error mapping and not-installed handling, with a
// mocked client. No database is involved; the SQL itself is covered by
// rota-migration.test.ts (static) and scripts/rota/lab-checks.sql (lab).
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data?: unknown; error?: unknown; count?: number | null }

const state: { result: Result; calls: { method: string; args: unknown[] }[] } = {
  result: { data: null, error: null },
  calls: [],
}

function makeQuery() {
  const query: Record<string, unknown> = {}
  const chain = [
    'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt', 'in', 'is',
    'order', 'range', 'limit', 'single', 'maybeSingle',
  ]
  for (const method of chain) {
    query[method] = (...args: unknown[]) => {
      state.calls.push({ method, args })
      return query
    }
  }
  query.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...state.result }).then(resolve, reject)
  return query
}

vi.mock('./client', () => ({
  getServiceDb: async () => ({
    from: (table: string) => {
      state.calls.push({ method: 'from', args: [table] })
      return makeQuery()
    },
    rpc: (fn: string, params?: unknown) => {
      state.calls.push({ method: 'rpc', args: [fn, params] })
      return makeQuery()
    },
  }),
}))

const rota = await import('./rota')
const recall = await import('./recall')
const { DbConflictError, DbError } = await import('./errors')

beforeEach(() => {
  state.result = { data: null, error: null }
  state.calls = []
})

describe('toRotaDbError', () => {
  it.each(['PGRST205', 'PGRST202', '42P01', '42883'])('maps %s to RotaNotInstalledError', (code) => {
    const err = rota.toRotaDbError('Failed', { code, message: 'relation "public.rota_settings" does not exist' })
    expect(err).toBeInstanceOf(rota.RotaNotInstalledError)
    expect(err).toBeInstanceOf(DbError)
    expect(err.code).toBe('ROTA_NOT_INSTALLED')
  })

  it.each([
    'disabled', 'invalid_payload', 'batch_conflict', 'not_found', 'not_confirmable',
    'not_eligible', 'suggestion_changed', 'presence_evidence', 'already_decided', 'caught_up',
    'preview_required',
  ] as const)('maps rota:%s to RotaRpcError', (code) => {
    const err = rota.toRotaDbError('Failed', { code: 'P0001', message: `rota:${code}` })
    expect(err).toBeInstanceOf(rota.RotaRpcError)
    expect((err as InstanceType<typeof rota.RotaRpcError>).rotaCode).toBe(code)
  })

  it('does not treat an unknown rota code or a prefixed message as an RPC code', () => {
    expect(rota.toRotaDbError('Failed', { code: 'P0001', message: 'rota:made_up' })).not.toBeInstanceOf(rota.RotaRpcError)
    expect(rota.toRotaDbError('Failed', { code: 'P0001', message: 'xrota:disabled' })).not.toBeInstanceOf(rota.RotaRpcError)
    expect(rota.toRotaDbError('Failed', { code: 'P0001', message: 'rota:disabled extra' })).not.toBeInstanceOf(rota.RotaRpcError)
  })

  it('falls back to toDbError for everything else', () => {
    expect(rota.toRotaDbError('Failed', { code: '23505', message: 'duplicate' })).toBeInstanceOf(DbConflictError)
    const err = rota.toRotaDbError('Failed', { code: '23514', message: 'check' })
    expect(err).not.toBeInstanceOf(rota.RotaNotInstalledError)
    expect(err.code).toBe('23514')
    expect(rota.toRotaDbError('Failed', 'weird')).toBeInstanceOf(DbError)
  })

  it('passes an existing DbError through unchanged', () => {
    const original = new rota.RotaRpcError('disabled', 'x')
    expect(rota.toRotaDbError('Failed', original)).toBe(original)
  })
})

describe('not installed (pre-063)', () => {
  it('getRotaSettings throws RotaNotInstalledError', async () => {
    state.result = { error: { code: 'PGRST205', message: 'Could not find the table' } }
    await expect(rota.getRotaSettings('org-1')).rejects.toBeInstanceOf(rota.RotaNotInstalledError)
  })

  it('listFlagsForSession throws RotaNotInstalledError when the view is missing', async () => {
    state.result = { error: { code: '42P01', message: 'relation does not exist' } }
    await expect(rota.listFlagsForSession({ orgId: 'org-1', sessionId: 's-1' })).rejects.toBeInstanceOf(
      rota.RotaNotInstalledError
    )
  })

  it('purgeRotaData returns not_installed silently', async () => {
    state.result = { error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(rota.purgeRotaData()).resolves.toBe('not_installed')
    expect(state.calls).toContainEqual({ method: 'rpc', args: ['purge_rota_data_v1', { p_org_id: null }] })
  })

  it('purgeRotaData rethrows other failures', async () => {
    state.result = { error: { code: '57014', message: 'canceling statement' } }
    await expect(rota.purgeRotaData('org-1')).rejects.toBeInstanceOf(DbError)
  })
})

describe('RPC wrappers', () => {
  it('purgeRotaData returns numeric counts', async () => {
    state.result = { data: { flags_expired: 2, links: '1', junk: 'x' } }
    await expect(rota.purgeRotaData('org-1')).resolves.toEqual({ flags_expired: 2, links: 1, junk: 0 })
  })

  it('ingestBatch sends only HMACs and ids, and maps the summary', async () => {
    state.result = {
      data: {
        batch_id: 'b-1', replayed: false, flags_inserted: 3, flags_replaced: 1, flags_deleted: 2,
        decided_marked_changed: 1, decided_unmarked: 0, links_upserted: 1, links_refused: 1,
        rows_rejected: 4, sessions_annotated: 5,
      },
    }
    const result = await rota.ingestBatch({
      orgId: 'org-1',
      departmentId: 'dept-1',
      actorUserId: 'user-1',
      batch: {
        id: 'b-1', upload_id: 'up-1', kind: 'WORKED', payload_digest: 'a'.repeat(64), range_from: '2026-10-01',
        range_to: '2026-10-09', profile_id: null, people_received: 2, people_matched: 1,
        people_unmatched: 1, conflicts: 0,
      },
      flags: [{ session_id: 's-1', user_id: 'u-1', extra: 'dropped' } as never],
      cleared: [],
      links: [{ key_type: 'STAFF_ID', key_hmac: 'b'.repeat(64), user_id: 'u-1', origin: 'MODERATOR' }],
    })
    expect(result).toEqual({
      batchId: 'b-1', replayed: false, flagsInserted: 3, flagsReplaced: 1, flagsDeleted: 2,
      decidedMarkedChanged: 1, decidedUnmarked: 0, linksUpserted: 1, linksRefused: 1,
      rowsRejected: 4, sessionsAnnotated: 5,
    })
    const call = state.calls.find((c) => c.method === 'rpc')!
    expect(call.args[0]).toBe('ingest_rota_batch_v1')
    const params = call.args[1] as Record<string, unknown>
    expect(params.p_flags).toEqual([{ session_id: 's-1', user_id: 'u-1' }])
    expect(params.p_links).toEqual([{ key_type: 'STAFF_ID', key_hmac: 'b'.repeat(64), user_id: 'u-1', origin: 'MODERATOR' }])
    expect(JSON.stringify(params)).not.toMatch(/@|staff_key|email/)
  })

  it('ingestBatch surfaces batch_conflict as a RotaRpcError', async () => {
    state.result = { error: { code: 'P0001', message: 'rota:batch_conflict' } }
    const promise = rota.ingestBatch({
      orgId: 'o', departmentId: 'd', actorUserId: 'u',
      batch: {
        id: 'b', upload_id: 'up', kind: 'PLANNED', payload_digest: 'a'.repeat(64), range_from: '2026-10-10',
        range_to: '2026-10-11', profile_id: null, people_received: 0, people_matched: 0,
        people_unmatched: 0, conflicts: 0,
      },
      flags: [], cleared: [], links: [],
    })
    await expect(promise).rejects.toMatchObject({ rotaCode: 'batch_conflict' })
  })

  it('confirmRotaExcusal maps suggestion_changed', async () => {
    state.result = { error: { code: 'P0001', message: 'rota:suggestion_changed' } }
    await expect(
      rota.confirmRotaExcusal({ orgId: 'o', sessionId: 's', userId: 'u', actorUserId: 'a' })
    ).rejects.toMatchObject({ name: 'RotaRpcError', rotaCode: 'suggestion_changed' })
  })
})

describe('table helpers', () => {
  it('recordMatchPreview records, dedupes and rate-limits in one RPC', async () => {
    const input = {
      orgId: 'o', departmentId: 'd', uploadId: 'up', callerUserId: 'u', callerRole: 'UPLOADER' as const, peopleCount: 3, maxPerDay: 10,
    }
    for (const outcome of ['recorded', 'duplicate', 'rate_limited'] as const) {
      state.result = { data: outcome }
      await expect(rota.recordMatchPreview(input)).resolves.toBe(outcome)
    }
    expect(state.calls).toContainEqual({
      method: 'rpc',
      args: [
        'record_rota_match_preview_v1',
        {
          p_org_id: 'o', p_department_id: 'd', p_upload_id: 'up', p_caller_user_id: 'u',
          p_caller_role: 'UPLOADER', p_people_count: 3, p_max_per_day: 10,
        },
      ],
    })
    state.result = { data: 'something else' }
    await expect(rota.recordMatchPreview(input)).rejects.toBeInstanceOf(DbError)
  })

  it('dismiss and contest go through their RPCs (state change + activity event)', async () => {
    state.result = { data: false }
    await expect(rota.contestOwnFlag({ orgId: 'o', sessionId: 's', userId: 'u' })).resolves.toBe(false)
    expect(state.calls).toContainEqual({
      method: 'rpc',
      args: ['contest_rota_flag_v1', { p_org_id: 'o', p_session_id: 's', p_user_id: 'u' }],
    })

    state.calls = []
    state.result = { data: true }
    await expect(
      rota.dismissRotaSuggestion({ orgId: 'o', sessionId: 's', userId: 'u', actorUserId: 'a' })
    ).resolves.toBe(true)
    expect(state.calls).toContainEqual({
      method: 'rpc',
      args: ['dismiss_rota_suggestion_v1', { p_org_id: 'o', p_session_id: 's', p_user_id: 'u', p_actor_user_id: 'a' }],
    })
  })

  it('linkRotaIdentity sends HMACs only and maps the counts', async () => {
    state.result = { data: { linked: 1, refused: 1 } }
    await expect(
      rota.linkRotaIdentity({
        orgId: 'o', departmentId: 'd', actorUserId: 'a', userId: 'u',
        links: [{ keyType: 'STAFF_ID', keyHmac: 'c'.repeat(64) }],
      })
    ).resolves.toEqual({ linked: 1, refused: 1 })
    const call = state.calls.find((c) => c.method === 'rpc')!
    expect(call.args).toEqual([
      'link_rota_identity_v1',
      { p_org_id: 'o', p_department_id: 'd', p_actor_user_id: 'a', p_user_id: 'u', p_links: [{ key_type: 'STAFF_ID', key_hmac: 'c'.repeat(64) }] },
    ])
  })

  it('lists only PUBLISHED candidate sessions', async () => {
    state.result = { data: [] }
    await rota.listRotaCandidateSessions({ orgId: 'o', departmentId: 'd', fromIso: '2026-10-01T00:00:00Z', toIso: '2026-10-09T00:00:00Z' })
    expect(state.calls).toContainEqual({ method: 'eq', args: ['status', 'PUBLISHED'] })
  })

  it('reads flags through the visibility view, never the table', async () => {
    state.result = {
      data: [{
        session_id: 's', user_id: 'u', kind: 'WORKED', as_of: '2026-10-10T06:00:00Z', batch_id: 'b',
        state: 'OPEN', rota_changed_at: null, decided_by: null, decided_at: null, contested_at: null,
      }],
    }
    const rows = await rota.listFlagsForSession({ orgId: 'o', sessionId: 's' })
    expect(rows).toEqual([{
      sessionId: 's', userId: 'u', kind: 'WORKED', asOf: '2026-10-10T06:00:00Z', batchId: 'b',
      state: 'OPEN', rotaChangedAt: null, decidedBy: null, decidedAt: null, contestedAt: null,
    }])
    expect(state.calls).toContainEqual({ method: 'from', args: ['rota_visible_session_flags'] })
  })

  it('listLinksForUsers never selects key_hmac', async () => {
    state.result = { data: [] }
    await rota.listLinksForUsers('o', ['u-1', 'u-1'])
    const select = state.calls.find((c) => c.method === 'select')!
    expect(String(select.args[0])).not.toContain('key_hmac')
  })
})

describe('listCatchupEligibleStatusesAsSystem (064 marker)', () => {
  it('falls back to ABSENT before 064', async () => {
    state.result = { error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(recall.listCatchupEligibleStatusesAsSystem()).resolves.toEqual(['ABSENT'])
  })

  it('returns the marker statuses after 064', async () => {
    state.result = { data: ['ABSENT', 'EXCUSED'] }
    await expect(recall.listCatchupEligibleStatusesAsSystem()).resolves.toEqual(['ABSENT', 'EXCUSED'])
  })

  it('ignores unknown values and never returns an empty list', async () => {
    state.result = { data: ['NOPE'] }
    await expect(recall.listCatchupEligibleStatusesAsSystem()).resolves.toEqual(['ABSENT'])
  })

  it('rethrows unexpected errors', async () => {
    state.result = { error: { code: '57014', message: 'timeout' } }
    await expect(recall.listCatchupEligibleStatusesAsSystem()).rejects.toBeInstanceOf(DbError)
  })
})

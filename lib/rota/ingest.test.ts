import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeRotaIngest } from './ingest'
import type { RotaBatchPayload } from './types'

beforeEach(() => vi.stubEnv('APP_TIME_ZONE', 'Europe/London'))
afterEach(() => vi.unstubAllEnvs())

const batch: RotaBatchPayload = {
  v: 1,
  batch_id: '11111111-1111-4111-8111-111111111111',
  kind: 'PLANNED',
  range: { from: '2026-12-01', to: '2026-12-02' },
  templates: { a: [['08:00', '17:00', 'A']], l: [['00:00', '24:00', 'L']] },
  people: [],
}
// GMT in December: wall clock = UTC.
const session = (id: string, day: string) => ({ id, date_start: `${day}T12:30:00.000Z`, date_end: `${day}T13:30:00.000Z` })

describe('computeRotaIngest', () => {
  it('flags unavailable people, clears available ones and leaves unknown ones untouched', () => {
    const result = computeRotaIngest({
      batch,
      matched: [
        { userId: 'u-leave', days: 'l.' },
        { userId: 'u-day', days: 'aa' },
        { userId: 'u-unknown', days: '..' },
      ],
      sessions: [session('s1', '2026-12-01'), session('s2', '2026-12-02')],
    })
    expect(result.flags).toEqual([{ session_id: 's1', user_id: 'u-leave' }])
    // u-leave on day 2 and u-unknown on both days are unknown: neither list.
    expect(result.cleared).toEqual([
      { session_id: 's1', user_id: 'u-day' },
      { session_id: 's2', user_id: 'u-day' },
    ])
    expect(result.sessionsAnnotated).toBe(2)
  })

  it('leaves sessions outside the range untouched', () => {
    const result = computeRotaIngest({
      batch,
      matched: [{ userId: 'u', days: 'll' }],
      sessions: [session('before', '2026-11-30'), session('after', '2026-12-03'), session('in', '2026-12-02')],
    })
    expect(result.flags).toEqual([{ session_id: 'in', user_id: 'u' }])
    expect(result.cleared).toEqual([])
    expect(result.sessionsAnnotated).toBe(1)
  })
})

describe('browser → server pipeline on the synthetic fixture', () => {
  it('flags nights/rest, leave and on-call, and clears day shifts', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { parseCsv } = await import('./csv')
    const { extractRotaRows } = await import('./mapping')
    const { rotaProfileConfigSchema } = await import('./profile')
    const { buildDayTemplates, RotaTemplateRegistry } = await import('./dictionary')
    const { buildRotaBatches } = await import('./build-payload')
    const { validateRotaBatch } = await import('./schema')
    const { resolveRotaPeople } = await import('./matching')

    const dir = path.join(__dirname, '__fixtures__')
    const profile = rotaProfileConfigSchema.parse(JSON.parse(readFileSync(path.join(dir, 'synthetic-profile.json'), 'utf8')))
    const today = '2026-10-12'
    const range = { from: '2026-09-28', to: '2026-12-07' }
    const extraction = extractRotaRows(parseCsv(readFileSync(path.join(dir, 'synthetic-wide.csv'), 'utf8')), profile, range)
    const registry = new RotaTemplateRegistry()
    const people = extraction.people
      .filter((p) => p.name !== 'Dr Ghost')
      .map((p) => ({ ref: p.ref, staffKey: p.staffKey, email: p.email, days: buildDayTemplates(p, profile, range, registry).days }))
    const { worked, planned } = buildRotaBatches({
      people,
      templates: registry.templates,
      range,
      todayKey: today,
      batchIds: { worked: '11111111-1111-4111-8111-111111111111', planned: '22222222-2222-4222-8222-222222222222' },
    })

    const trainees = ['1', '2', '3', '4', '5'].map((n) => ({ userId: `T${n}`, email: n === '4' ? '' : `t${n}.rota@example.test` }))
    const links = [{ keyType: 'STAFF_ID' as const, keyHmac: 'STAFF_ID:10000004', userId: 'T4' }]
    // S1 yesterday 12:30–13:30 BST (11:30Z); S2 +3 days.
    const sessions = [
      { id: 'S1', date_start: '2026-10-11T11:30:00.000Z', date_end: '2026-10-11T12:30:00.000Z' },
      { id: 'S2', date_start: '2026-10-15T11:30:00.000Z', date_end: '2026-10-15T12:30:00.000Z' },
    ]
    const flags: string[] = []
    const cleared: string[] = []
    for (const batch of [worked!, planned!]) {
      const check = validateRotaBatch(batch, { todayKey: today, horizonDays: 56, callerRole: 'UPLOADER' })
      expect(check.ok).toBe(true)
      const resolved = resolveRotaPeople({
        people: batch.people,
        hmacOf: (t, v) => `${t}:${v}`,
        links,
        trainees,
        callerRole: 'UPLOADER',
      })
      expect(resolved.matched).toHaveLength(5)
      const result = computeRotaIngest({ batch, matched: resolved.matched, sessions })
      flags.push(...result.flags.map((f) => `${f.session_id}:${f.user_id}`))
      cleared.push(...result.cleared.map((f) => `${f.session_id}:${f.user_id}`))
    }
    expect(flags.sort()).toEqual(['S1:T1', 'S1:T3', 'S2:T1'])
    expect(cleared.sort()).toEqual(['S1:T2', 'S1:T4', 'S1:T5', 'S2:T2', 'S2:T3', 'S2:T4', 'S2:T5'])
  })
})

import { describe, expect, it } from 'vitest'
import { buildRotaSuggestionRows, PRESENCE_SOURCES } from './suggestions'
import type { RotaFlagRow } from './types'

// Session 12:30–13:30 UTC; check-in window 12:15–13:15 by default.
const session = {
  date_start: '2026-10-14T12:30:00.000Z',
  date_end: '2026-10-14T13:30:00.000Z',
  attendance_policy_version: 2 as const,
  attendance_phase: 'OPEN',
}
const DURING = new Date('2026-10-14T12:45:00.000Z')
const AFTER = new Date('2026-10-14T14:00:00.000Z')
const BEFORE = new Date('2026-10-14T12:00:00.000Z')

const trainees = [
  { userId: 'u1', displayName: 'Ada' },
  { userId: 'u2', displayName: 'Bea' },
]

function flag(userId: string, overrides: Partial<RotaFlagRow> = {}): RotaFlagRow {
  return {
    sessionId: 's1',
    userId,
    kind: 'WORKED',
    asOf: '2026-10-14T05:00:00.000Z',
    batchId: 'b1',
    state: 'OPEN',
    rotaChangedAt: null,
    decidedBy: null,
    decidedAt: null,
    contestedAt: null,
    ...overrides,
  }
}

type Ev = Parameters<typeof buildRotaSuggestionRows>[0]['evidence'][number]
function ev(userId: string, source: Ev['source'], observedAt: string, metadata: Ev['metadata'] = {}): Ev {
  return { user_id: userId, source, observed_at: observedAt, metadata }
}

function build(overrides: Partial<Parameters<typeof buildRotaSuggestionRows>[0]> = {}) {
  return buildRotaSuggestionRows({ trainees, evidence: [], flags: [], session, now: AFTER, ...overrides })
}

describe('buildRotaSuggestionRows', () => {
  it('lists trainees without presence evidence and suggests from an OPEN flag', () => {
    const rows = build({ flags: [flag('u1')] })
    expect(rows.map((row) => [row.userId, row.state])).toEqual([
      ['u1', 'SUGGESTED'],
      ['u2', 'NONE'],
    ])
    expect(rows[0]).toMatchObject({
      asOf: '2026-10-14T05:00:00.000Z',
      kind: 'WORKED',
      canConfirm: true,
      canDismiss: true,
    })
    expect(rows[1]).toMatchObject({ asOf: null, kind: null, canConfirm: false, canDismiss: false })
  })

  it.each(PRESENCE_SOURCES)('hides a trainee with valid %s presence evidence', (source) => {
    const observed = source === 'SELF_CHECKIN' || source === 'GROUP_CODE' ? '2026-10-14T12:25:00.000Z' : '2026-10-14T13:40:00.000Z'
    const rows = build({ flags: [flag('u1')], evidence: [ev('u1', source, observed)] })
    expect(rows.map((row) => row.userId)).toEqual(['u2'])
  })

  it('keeps a trainee whose only presence evidence is outside its window or feedback', () => {
    const rows = build({
      flags: [flag('u1')],
      evidence: [ev('u1', 'SELF_CHECKIN', '2026-10-14T13:50:00.000Z'), ev('u1', 'FEEDBACK', '2026-10-14T13:35:00.000Z')],
    })
    expect(rows.find((row) => row.userId === 'u1')?.state).toBe('SUGGESTED')
  })

  it('ignores assigned-teacher TEACHER attribution as presence', () => {
    const rows = build({
      flags: [flag('u1')],
      evidence: [ev('u1', 'TEACHER', '2026-10-14T12:30:00.000Z', { assigned_as_teacher: true })],
    })
    expect(rows.find((row) => row.userId === 'u1')?.state).toBe('SUGGESTED')
  })

  it('shows an existing manual moderator decision as DECIDED_MANUALLY with no actions', () => {
    const rows = build({
      flags: [flag('u1')],
      evidence: [ev('u1', 'MODERATOR_CONFIRMATION', '2026-10-14T13:45:00.000Z', { status_override: 'ABSENT' })],
    })
    expect(rows[0]).toMatchObject({ userId: 'u1', state: 'DECIDED_MANUALLY', canConfirm: false, canDismiss: false, asOf: null })
  })

  it('shows a contested flag without a suggestion', () => {
    const rows = build({ flags: [flag('u1', { state: 'CONTESTED', contestedAt: '2026-10-14T09:00:00.000Z' })] })
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      state: 'CONTESTED',
      asOf: null,
      kind: null,
      canConfirm: false,
      canDismiss: false,
    })
    expect(rows[0].markers.contested).toBe(true)
  })

  it('keeps Confirm disabled before the session ends and Dismiss before it starts', () => {
    expect(build({ flags: [flag('u1')], now: DURING })[0]).toMatchObject({ canConfirm: false, canDismiss: true })
    expect(build({ flags: [flag('u1')], now: BEFORE })[0]).toMatchObject({ canConfirm: false, canDismiss: false })
  })

  it('offers no actions once attendance is finalized or on policy v1', () => {
    const finalized = build({ flags: [flag('u1')], session: { ...session, attendance_phase: 'FINALIZED' } })
    expect(finalized[0]).toMatchObject({ state: 'SUGGESTED', canConfirm: false, canDismiss: false })
    const v1 = build({ flags: [flag('u1')], session: { ...session, attendance_policy_version: 1 as never } })
    expect(v1[0]).toMatchObject({ canConfirm: false, canDismiss: false })
  })

  it('marks presence evidence received after a confirmed excusal', () => {
    const confirmed = flag('u1', { state: 'CONFIRMED', decidedAt: '2026-10-14T13:40:00.000Z', decidedBy: 'mod' })
    const excusal = ev('u1', 'MODERATOR_CONFIRMATION', '2026-10-14T13:40:00.000Z', {
      status_override: 'EXCUSED',
      reason_code: 'ROTA_UNAVAILABLE',
    })
    const quiet = build({ flags: [confirmed], evidence: [excusal] })
    expect(quiet[0]).toMatchObject({ state: 'CONFIRMED', canConfirm: false, canDismiss: false })
    expect(quiet[0].markers.evidenceAfterExcusal).toBe(false)

    const late = build({
      flags: [confirmed],
      evidence: [excusal, ev('u1', 'TEACHER', '2026-10-14T13:50:00.000Z')],
    })
    expect(late[0]).toMatchObject({ userId: 'u1', state: 'CONFIRMED' })
    expect(late[0].markers.evidenceAfterExcusal).toBe(true)
  })

  it('marks a confirmed excusal whose rota changed since', () => {
    const rows = build({
      flags: [flag('u1', { state: 'CONFIRMED', decidedAt: '2026-10-14T13:40:00.000Z', rotaChangedAt: '2026-10-15T08:00:00.000Z' })],
      evidence: [
        ev('u1', 'MODERATOR_CONFIRMATION', '2026-10-14T13:40:00.000Z', {
          status_override: 'EXCUSED',
          reason_code: 'ROTA_UNAVAILABLE',
        }),
      ],
    })
    expect(rows[0].markers.rotaChanged).toBe(true)
    // A dismissed suggestion never carries the "since you confirmed" marker.
    const dismissed = build({
      flags: [flag('u1', { state: 'DISMISSED', decidedAt: '2026-10-14T13:40:00.000Z', rotaChangedAt: '2026-10-15T08:00:00.000Z' })],
    })
    expect(dismissed[0]).toMatchObject({ state: 'DISMISSED', canConfirm: false })
    expect(dismissed[0].markers.rotaChanged).toBe(false)
  })

  it('shows a later manual correction of a confirmed excusal as DECIDED_MANUALLY', () => {
    const rows = build({
      flags: [flag('u1', { state: 'CONFIRMED', decidedAt: '2026-10-14T13:40:00.000Z' })],
      evidence: [
        ev('u1', 'MODERATOR_CONFIRMATION', '2026-10-14T13:40:00.000Z', {
          status_override: 'EXCUSED',
          reason_code: 'ROTA_UNAVAILABLE',
        }),
        ev('u1', 'MODERATOR_CONFIRMATION', '2026-10-14T14:10:00.000Z', { status_override: 'PRESENT' }),
      ],
    })
    expect(rows[0]).toMatchObject({ userId: 'u1', state: 'DECIDED_MANUALLY' })
  })

  it('never suggests an excusal over a completed catch-up (reopen after RECALL)', () => {
    // Reopened after the trainee completed the catch-up: the OPEN flag is still there.
    const rows = build({
      flags: [flag('u1')],
      evidence: [ev('u1', 'RECALL', '2026-10-16T09:00:00.000Z', { status_override: 'PRESENT' })],
    })
    expect(rows.map((row) => row.userId)).toEqual(['u2'])
  })

  it('breaks a same-instant moderator tie like the SQL (created_at, then id)', () => {
    const at = '2026-10-14T13:40:00.000Z'
    const excusal = {
      ...ev('u1', 'MODERATOR_CONFIRMATION', at, { status_override: 'EXCUSED', reason_code: 'ROTA_UNAVAILABLE' }),
      created_at: '2026-10-14T13:40:01.000Z',
      id: 'b',
    }
    const manual = { ...ev('u1', 'MODERATOR_CONFIRMATION', at, { status_override: 'PRESENT' }), created_at: '2026-10-14T13:40:02.000Z', id: 'a' }
    const confirmed = flag('u1', { state: 'CONFIRMED', decidedAt: at })
    // Evidence arrives newest-first; the later created_at is the latest decision.
    expect(build({ flags: [confirmed], evidence: [manual, excusal] })[0].state).toBe('DECIDED_MANUALLY')
    expect(build({ flags: [confirmed], evidence: [excusal, manual] })[0].state).toBe('DECIDED_MANUALLY')
    // Same created_at: the greater id wins.
    const tie = { ...manual, created_at: excusal.created_at }
    expect(build({ flags: [confirmed], evidence: [tie, excusal] })[0].state).toBe('CONFIRMED')
  })

  it('ignores flags for people who are not current trainees and evidence without a user', () => {
    const rows = build({
      flags: [flag('stranger')],
      evidence: [{ user_id: null, source: 'SELF_CHECKIN', observed_at: '2026-10-14T12:25:00.000Z', metadata: null }],
    })
    expect(rows.map((row) => row.userId)).toEqual(['u1', 'u2'])
    expect(rows.every((row) => row.state === 'NONE')).toBe(true)
  })

  it('never exposes a rota category or reason on a row', () => {
    const rows = build({ flags: [flag('u1')] })
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['asOf', 'canConfirm', 'canDismiss', 'displayName', 'kind', 'markers', 'state', 'userId'].sort()
    )
  })
})

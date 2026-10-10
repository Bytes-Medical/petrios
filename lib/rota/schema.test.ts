import { describe, expect, it } from 'vitest'
import { addDaysToKey, rotaDayCount, validateRotaBatch } from './schema'

const TODAY = '2026-10-12'
const ctx = { todayKey: TODAY, horizonDays: 56, callerRole: 'MODERATOR' as const }

function planned(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    batch_id: '11111111-1111-4111-8111-111111111111',
    kind: 'PLANNED',
    range: { from: TODAY, to: '2026-10-14' },
    templates: { a: [['08:00', '17:00', 'A']], b: [['00:00', '24:00', 'L']] },
    people: [{ ref: 'r0', staff_key: 'AB123', days: 'ab.' }],
    ...overrides,
  }
}

describe('day keys', () => {
  it('counts and adds days across month ends', () => {
    expect(rotaDayCount('2026-10-30', '2026-11-02')).toBe(4)
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(rotaDayCount('2026-10-02', '2026-10-01')).toBe(0)
  })
})

describe('validateRotaBatch', () => {
  it('accepts a valid planned batch', () => {
    const result = validateRotaBatch(planned(), ctx)
    expect(result.ok).toBe(true)
  })

  it('rejects unknown keys without echoing them or their values', () => {
    const result = validateRotaBatch(
      planned({ people: [{ ref: 'r0', staff_key: 'AB123', days: 'ab.', name: 'Jane Secret', code: 'AL' }] }),
      ctx
    )
    expect(result.ok).toBe(false)
    const text = JSON.stringify(result)
    expect(text).not.toContain('Jane Secret')
    expect(text).not.toContain('"name"')
    expect(text).toContain('unknown_key')
    if (!result.ok) expect(result.issues[0].index).toBe(0)
  })

  it('rejects an unknown letter, the S letter and an unknown template id', () => {
    expect(validateRotaBatch(planned({ templates: { a: [['08:00', '17:00', 'Q']] } }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ templates: { a: [['00:00', '24:00', 'S']] } }), ctx).ok).toBe(false)
    const unknownId = validateRotaBatch(planned({ people: [{ ref: 'r0', staff_key: 'AB123', days: 'az.' }] }), ctx)
    expect(unknownId.ok).toBe(false)
    if (!unknownId.ok) expect(unknownId.issues).toEqual([{ index: 0, field: 'days' }])
  })

  it('rejects timed L or X, overlaps, bad template ids and too many templates', () => {
    expect(validateRotaBatch(planned({ templates: { a: [['08:00', '17:00', 'L']] } }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ templates: { a: [['00:00', '12:00', 'X'], ['12:00', '24:00', 'A']] } }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ templates: { a: [['08:00', '12:00', 'A'], ['11:00', '13:00', 'D']] } }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ templates: { a: [['12:00', '08:00', 'A']] } }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ templates: { '.': [['08:00', '17:00', 'A']] } }), ctx).ok).toBe(false)
    const many: Record<string, unknown> = {}
    const ids = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (const id of ids) many[id] = [['08:00', '17:00', 'A']]
    expect(validateRotaBatch(planned({ templates: many }), ctx).ok).toBe(true)
    many['_'] = [['08:00', '17:00', 'A']]
    expect(validateRotaBatch(planned({ templates: many }), ctx).ok).toBe(false)
  })

  it('rejects a link from an uploader but accepts it from a moderator', () => {
    const withLink = planned({
      people: [{ ref: 'r0', link: { user_id: '22222222-2222-4222-8222-222222222222', origin: 'MODERATOR' }, days: 'ab.' }],
    })
    expect(validateRotaBatch(withLink, ctx).ok).toBe(true)
    const uploader = validateRotaBatch(withLink, { ...ctx, callerRole: 'UPLOADER' })
    expect(uploader.ok).toBe(false)
    if (!uploader.ok) expect(uploader.issues).toContainEqual({ index: 0, field: 'link' })
  })

  it('requires an identifier and normalised identifiers', () => {
    expect(validateRotaBatch(planned({ people: [{ ref: 'r0', days: 'ab.' }] }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ people: [{ ref: 'r0', email: 'Upper@Case.test', days: 'ab.' }] }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ people: [{ ref: 'r0', staff_key: 'lower', days: 'ab.' }] }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ people: [{ ref: 'a@b', staff_key: 'X', days: 'ab.' }] }), ctx).ok).toBe(false)
  })

  it('applies the WORKED / PLANNED split around today', () => {
    expect(validateRotaBatch(planned({ range: { from: '2026-10-11', to: '2026-10-13' } }), ctx).ok).toBe(false)
    const worked = planned({ kind: 'WORKED', range: { from: '2026-10-09', to: '2026-10-11' } })
    expect(validateRotaBatch(worked, ctx).ok).toBe(true)
    expect(validateRotaBatch(planned({ kind: 'WORKED' }), ctx).ok).toBe(false)
  })

  it('enforces the 14-day past window and the horizon', () => {
    const tooOld = planned({ kind: 'WORKED', range: { from: '2026-09-27', to: '2026-09-29' } })
    expect(validateRotaBatch(tooOld, ctx).ok).toBe(false)
    const oldest = planned({ kind: 'WORKED', range: { from: '2026-09-28', to: '2026-09-30' } })
    expect(validateRotaBatch(oldest, ctx).ok).toBe(true)
    const far = planned({ range: { from: '2026-12-06', to: '2026-12-08' } })
    expect(validateRotaBatch(far, ctx).ok).toBe(false)
    const edge = planned({ range: { from: '2026-12-05', to: '2026-12-07' } })
    expect(validateRotaBatch(edge, ctx).ok).toBe(true)
  })

  it('requires days to match the range length', () => {
    expect(validateRotaBatch(planned({ people: [{ ref: 'r0', staff_key: 'X', days: 'ab' }] }), ctx).ok).toBe(false)
  })

  it('caps people at 500 and refuses duplicate refs', () => {
    const people = Array.from({ length: 501 }, (_, i) => ({ ref: `r${i}`, staff_key: `S${i}`, days: '...' }))
    expect(validateRotaBatch(planned({ people }), ctx).ok).toBe(false)
    expect(validateRotaBatch(planned({ people: people.slice(0, 500) }), ctx).ok).toBe(true)
    const dup = [
      { ref: 'r0', staff_key: 'A', days: '...' },
      { ref: 'r0', staff_key: 'B', days: '...' },
    ]
    expect(validateRotaBatch(planned({ people: dup }), ctx).ok).toBe(false)
  })
})

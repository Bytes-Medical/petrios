import { describe, expect, it } from 'vitest'
import { resolveRotaPeople } from './matching'
import type { RotaBatchPerson } from './types'

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'
const U3 = '00000000-0000-4000-8000-000000000003'
const OUTSIDER = '00000000-0000-4000-8000-000000000009'
const hmacOf = (t: string, v: string) => `${t}:${v}`
const trainees = [
  { userId: U1, email: 'one@example.test' },
  { userId: U2, email: 'two@example.test' },
  { userId: U3, email: 'three@example.test' },
]
const run = (people: RotaBatchPerson[], opts: { links?: { keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string; userId: string }[]; role?: 'MODERATOR' | 'UPLOADER' } = {}) =>
  resolveRotaPeople({ people, hmacOf, links: opts.links ?? [], trainees, callerRole: opts.role ?? 'MODERATOR' })

describe('resolveRotaPeople', () => {
  it('resolves staff link, then email link, then profile email', () => {
    const result = run(
      [
        { ref: 'r0', staff_key: 'S1', days: 'a' },
        { ref: 'r1', email: 'linked@example.test', days: 'b' },
        { ref: 'r2', email: 'three@example.test', days: 'c' },
        { ref: 'r3', staff_key: 'NOPE', days: 'd' },
      ],
      { links: [{ keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S1', userId: U1 }, { keyType: 'EMAIL', keyHmac: 'EMAIL:linked@example.test', userId: U2 }] }
    )
    expect(result.matched).toEqual([
      { ref: 'r0', userId: U1, days: 'a' },
      { ref: 'r1', userId: U2, days: 'b' },
      { ref: 'r2', userId: U3, days: 'c' },
    ])
    expect(result.unmatched).toBe(1)
    expect(result.conflicts).toBe(0)
    expect(result.newLinks).toEqual([])
    expect(result.via.get('r2')).toBe('EMAIL')
  })

  it('treats a staff/email disagreement as a conflict', () => {
    const result = run([{ ref: 'r0', staff_key: 'S1', email: 'two@example.test', days: 'a' }], {
      links: [{ keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S1', userId: U1 }],
    })
    expect(result.matched).toEqual([])
    expect(result.unmatched).toBe(1)
    expect(result.conflicts).toBe(1)
  })

  it('unmatches every row that resolves to the same user', () => {
    const result = run([
      { ref: 'r0', email: 'one@example.test', days: 'a' },
      { ref: 'r1', email: 'one@example.test', days: 'b' },
    ])
    expect(result.matched).toEqual([])
    expect(result.conflicts).toBe(2)
  })

  it('ignores links to people who are not current trainees', () => {
    const result = run(
      [
        { ref: 'r0', link: { user_id: OUTSIDER, origin: 'MODERATOR' }, staff_key: 'S9', days: 'a' },
        { ref: 'r1', staff_key: 'S8', days: 'b' },
      ],
      { links: [{ keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S8', userId: OUTSIDER }] }
    )
    expect(result.matched).toEqual([])
    expect(result.newLinks).toEqual([])
  })

  it('creates links only from moderator confirmations, by staff key then email', () => {
    const result = run([
      { ref: 'r0', link: { user_id: U1, origin: 'MODERATOR' }, staff_key: 'S1', email: 'x@example.test', days: 'a' },
      { ref: 'r1', link: { user_id: U2, origin: 'EMAIL_MATCH' }, email: 'two@example.test', days: 'b' },
      { ref: 'r2', link: { user_id: U3, origin: 'MODERATOR' }, days: 'c' },
    ])
    expect(result.matched.map((m) => m.userId)).toEqual([U1, U2, U3])
    expect(result.newLinks).toEqual([
      { keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S1', userId: U1, origin: 'MODERATOR' },
      { keyType: 'EMAIL', keyHmac: 'EMAIL:two@example.test', userId: U2, origin: 'EMAIL_MATCH' },
    ])
  })

  it('decides the link origin on the server, never from the browser', () => {
    const result = run([
      // A name-only confirmation labelled EMAIL_MATCH by the browser: the row's
      // email is not the trainee's profile email, so it is a moderator link.
      { ref: 'r0', link: { user_id: U1, origin: 'EMAIL_MATCH' }, email: 'other@example.test', days: 'a' },
      // A real exact-email match labelled MODERATOR is recorded as EMAIL_MATCH.
      { ref: 'r1', link: { user_id: U2, origin: 'MODERATOR' }, staff_key: 'S2', email: 'two@example.test', days: 'b' },
      // Same email but confirmed as a different trainee: MODERATOR.
      { ref: 'r2', link: { user_id: U3, origin: 'EMAIL_MATCH' }, staff_key: 'S3', email: 'one@example.test', days: 'c' },
    ])
    expect(result.newLinks).toEqual([
      { keyType: 'EMAIL', keyHmac: 'EMAIL:other@example.test', userId: U1, origin: 'MODERATOR' },
      { keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S2', userId: U2, origin: 'EMAIL_MATCH' },
      { keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S3', userId: U3, origin: 'MODERATOR' },
    ])
  })

  it('never honours a link from an uploader', () => {
    const result = run([{ ref: 'r0', link: { user_id: U1, origin: 'MODERATOR' }, staff_key: 'S1', days: 'a' }], { role: 'UPLOADER' })
    expect(result.matched).toEqual([])
    expect(result.newLinks).toEqual([])
  })

  it('does not re-create an existing identical link', () => {
    const result = run([{ ref: 'r0', link: { user_id: U1, origin: 'MODERATOR' }, staff_key: 'S1', days: 'a' }], {
      links: [{ keyType: 'STAFF_ID', keyHmac: 'STAFF_ID:S1', userId: U1 }],
    })
    expect(result.newLinks).toEqual([])
    expect(result.matched).toHaveLength(1)
  })
})

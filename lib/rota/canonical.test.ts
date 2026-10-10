import { describe, expect, it } from 'vitest'
import { canonicalRotaJson, sha256Hex } from './canonical'
import type { RotaBatchPayload } from './types'

const batch: RotaBatchPayload = {
  v: 1,
  batch_id: '11111111-1111-4111-8111-111111111111',
  kind: 'PLANNED',
  range: { from: '2026-10-12', to: '2026-10-13' },
  templates: { b: [['00:00', '24:00', 'L']], a: [['08:00', '17:00', 'A']] },
  people: [{ ref: 'r0', staff_key: 'X1', days: 'ab' }],
}

describe('canonicalRotaJson', () => {
  it('is independent of key order and has no whitespace', () => {
    const reordered = {
      people: [{ days: 'ab', staff_key: 'X1', ref: 'r0' }],
      templates: { a: [['08:00', '17:00', 'A']], b: [['00:00', '24:00', 'L']] },
      range: { to: '2026-10-13', from: '2026-10-12' },
      kind: 'PLANNED',
      batch_id: '11111111-1111-4111-8111-111111111111',
      v: 1,
    } as unknown as RotaBatchPayload
    expect(canonicalRotaJson(reordered)).toBe(canonicalRotaJson(batch))
    expect(canonicalRotaJson(batch)).not.toMatch(/\s/)
    expect(canonicalRotaJson(batch).startsWith('{"batch_id":')).toBe(true)
  })

  it('hashes stably with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const a = await sha256Hex(canonicalRotaJson(batch))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex(canonicalRotaJson({ ...batch }))).toBe(a)
  })
})

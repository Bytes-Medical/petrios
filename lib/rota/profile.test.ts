import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POST_NIGHT, defaultRotaProfileConfig, normaliseRotaCode, rotaProfileConfigSchema } from './profile'

describe('rotaProfileConfigSchema', () => {
  it('accepts the synthetic fixture profile and the defaults', () => {
    const fixture = JSON.parse(readFileSync(path.join(__dirname, '__fixtures__', 'synthetic-profile.json'), 'utf8'))
    expect(rotaProfileConfigSchema.safeParse(fixture).success).toBe(true)
    const wide = { ...defaultRotaProfileConfig('WIDE'), columns: { staffId: 'Staff', dateColumns: 'AUTO' } }
    expect(rotaProfileConfigSchema.safeParse(wide).success).toBe(true)
    expect(DEFAULT_POST_NIGHT).toEqual({ enabled: true, trigger: 'ANY', restHours: 46 })
  })

  it('requires an identifier column and layout-specific columns', () => {
    expect(rotaProfileConfigSchema.safeParse(defaultRotaProfileConfig('WIDE')).success).toBe(false)
    const long = { ...defaultRotaProfileConfig('LONG'), columns: { email: 'Email' } }
    expect(rotaProfileConfigSchema.safeParse(long).success).toBe(false)
    expect(
      rotaProfileConfigSchema.safeParse({ ...long, columns: { email: 'Email', date: 'Date', code: 'Code' } }).success
    ).toBe(true)
    expect(
      rotaProfileConfigSchema.safeParse({ ...long, columns: { email: 'Email', date: 'Date', code: 'Code', start: 'S' } }).success
    ).toBe(false)
  })

  it('refuses timed leave, untimed nights, a category letter and unknown keys', () => {
    const base = { ...defaultRotaProfileConfig('WIDE'), columns: { staffId: 'Staff', dateColumns: 'AUTO' as const } }
    const withCode = (entry: unknown) => rotaProfileConfigSchema.safeParse({ ...base, codes: { X1: entry } }).success
    expect(withCode({ letter: 'L', start: '09:00', end: '17:00' })).toBe(false)
    expect(withCode({ letter: 'N', night: true })).toBe(false)
    expect(withCode({ letter: 'N', night: true, start: '20:00', end: '08:00' })).toBe(true)
    expect(withCode({ letter: 'S' })).toBe(false)
    expect(withCode({ letter: 'A', start: '09:00' })).toBe(false)
    expect(withCode({ letter: 'A', category: 'sick' })).toBe(false)
    expect(rotaProfileConfigSchema.safeParse({ ...base, showCategory: true }).success).toBe(false)
    expect(rotaProfileConfigSchema.safeParse({ ...base, postNight: { ...DEFAULT_POST_NIGHT, restHours: 24 } }).success).toBe(false)
  })

  it('limits code names', () => {
    const base = { ...defaultRotaProfileConfig('WIDE'), columns: { staffId: 'Staff', dateColumns: 'AUTO' as const } }
    expect(rotaProfileConfigSchema.safeParse({ ...base, codes: { 'A VERY LONG CODE NAME': { letter: 'A' } } }).success).toBe(false)
    expect(rotaProfileConfigSchema.safeParse({ ...base, codes: { 'BAD;CODE': { letter: 'A' } } }).success).toBe(false)
    const many: Record<string, unknown> = {}
    for (let i = 0; i < 201; i++) many[`C${i}`] = { letter: 'A' }
    expect(rotaProfileConfigSchema.safeParse({ ...base, codes: many }).success).toBe(false)
  })

  it('normalises codes', () => {
    expect(normaliseRotaCode('  ld   oc ')).toBe('LD OC')
  })
})

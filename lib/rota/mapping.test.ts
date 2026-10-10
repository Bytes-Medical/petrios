import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { extractRotaRows, parseRotaDate, parseRotaTime } from './mapping'
import { defaultRotaProfileConfig, rotaProfileConfigSchema } from './profile'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')
const profile = rotaProfileConfigSchema.parse(JSON.parse(fixture('synthetic-profile.json')))

describe('date and time parsing', () => {
  it('reads each supported format', () => {
    expect(parseRotaDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05')
    expect(parseRotaDate('Mon 5/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05')
    expect(parseRotaDate('2026-10-05', 'YYYY-MM-DD')).toBe('2026-10-05')
    expect(parseRotaDate('2026-10-05 00:00:00', 'YYYY-MM-DD')).toBe('2026-10-05')
    expect(parseRotaDate('05-Oct-2026', 'DD-MMM-YYYY')).toBe('2026-10-05')
    expect(parseRotaDate('5 Oct 26', 'DD-MMM-YYYY')).toBe('2026-10-05')
    expect(parseRotaDate('2026-10-05', 'DD/MM/YYYY')).toBeNull()
    expect(parseRotaDate('31/02/2026', 'DD/MM/YYYY')).toBeNull()
    expect(parseRotaDate('Name', 'DD/MM/YYYY')).toBeNull()
  })

  it('reads times', () => {
    expect(parseRotaTime('8:30')).toBe('08:30')
    expect(parseRotaTime('0830')).toBe('08:30')
    expect(parseRotaTime('20:30:00')).toBe('20:30')
    expect(parseRotaTime('25:00')).toBeNull()
  })
})

describe('extractRotaRows', () => {
  it('reads the WIDE fixture, ignoring out-of-range dates', () => {
    const parsed = parseCsv(fixture('synthetic-wide.csv'))
    const result = extractRotaRows(parsed, profile, { from: '2026-10-05', to: '2026-10-18' })
    expect(result.people).toHaveLength(6)
    const [t1] = result.people
    expect(t1).toMatchObject({ ref: 'r0', staffKey: '10000001', email: 't1.rota@example.test', name: 'Tess One' })
    expect(Object.keys(t1.dayCodes).every((d) => d >= '2026-10-05' && d <= '2026-10-18')).toBe(true)
    expect(t1.dayCodes['2026-10-08']).toEqual([{ code: 'N' }])
    const t4 = result.people[3]
    expect(t4.email).toBeUndefined()
    expect(t4.dayCodes['2026-10-07']).toEqual([{ code: 'LD' }, { code: 'OC' }])
    const codes = result.distinctCodes.map((c) => c.code).sort()
    expect(codes).toEqual(['AL', 'LD', 'N', 'OC', 'OFF', 'SD', 'ZD'])
    expect(result.issues).toEqual([])
    expect(result.dates).toMatchObject({ inWindow: 14, first: '2026-10-05', last: '2026-10-18' })
    expect(result.dates.recognised).toBeGreaterThan(14)
  })

  it('reports no recognised dates when the header uses another format, and skips people with no days', () => {
    const csv = 'Staff,Mon 05/10,Tue 06/10\nA1,SD,SD\n'
    const config = { ...defaultRotaProfileConfig('WIDE'), columns: { staffId: 'Staff', dateColumns: 'AUTO' as const } }
    const result = extractRotaRows(parseCsv(csv), config, { from: '2026-10-01', to: '2026-10-31' })
    expect(result.dates).toEqual({ recognised: 0, inWindow: 0, first: null, last: null })
    expect(result.people).toEqual([])
    expect(result.skippedNoDays).toBe(1)
  })

  it('reads the LONG fixture with times, grouped per person', () => {
    const parsed = parseCsv(fixture('synthetic-long.csv'))
    const config = rotaProfileConfigSchema.parse({
      ...profile,
      layout: 'LONG',
      dateFormat: 'YYYY-MM-DD',
      columns: { staffId: 'Assignment', email: 'Email', name: 'Full name', date: 'Duty date', code: 'Shift', start: 'Start', end: 'End' },
    })
    const result = extractRotaRows(parsed, config, { from: '2026-09-28', to: '2026-10-25' })
    expect(result.people).toHaveLength(6)
    const t1 = result.people[0]
    expect(t1.dayCodes['2026-10-08']).toEqual([{ code: 'N', start: '20:30', end: '09:30' }])
    expect(t1.dayCodes['2026-10-12']).toBeUndefined()
  })

  it('splits multi-code cells and reports unusable codes and identifiers without values', () => {
    const csv = 'Staff,Name,01/10/2026,02/10/2026\nA1,Jane,ld + oc,THIS IS A VERY LONG NOTE\n,,SD,SD\n'
    const config = { ...defaultRotaProfileConfig('WIDE'), columns: { staffId: 'Staff', name: 'Name', dateColumns: 'AUTO' as const } }
    const result = extractRotaRows(parseCsv(csv), config, { from: '2026-10-01', to: '2026-10-02' })
    expect(result.people).toHaveLength(1)
    expect(result.people[0].dayCodes['2026-10-01']).toEqual([{ code: 'LD' }, { code: 'OC' }])
    expect(result.issues.map((i) => i.field)).toEqual(['code', 'identifier'])
    expect(JSON.stringify(result.issues)).not.toContain('VERY LONG')
  })
})

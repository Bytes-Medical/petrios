import { describe, expect, it } from 'vitest'
import {
  buildDayTemplates,
  buildPersonDaySegments,
  isNightCode,
  RotaTemplateOverflowError,
  RotaTemplateRegistry,
  unmappedCodes,
} from './dictionary'
import type { ExtractedRotaPerson } from './mapping'
import { defaultRotaProfileConfig, type RotaProfileConfig } from './profile'

const config: RotaProfileConfig = {
  ...defaultRotaProfileConfig('WIDE'),
  columns: { staffId: 'Staff', dateColumns: 'AUTO' },
  codes: {
    SD: { letter: 'A', start: '08:00', end: '17:00' },
    LD: { letter: 'D', start: '08:00', end: '20:30' },
    OC: { letter: 'D' },
    N: { letter: 'N', start: '20:30', end: '09:30', night: true },
    AL: { letter: 'L' },
    OFF: { letter: 'X' },
    NOTE: { letter: 'IGNORE' },
  },
  postNight: { enabled: false, trigger: 'ANY', restHours: 46 },
}

const person = (dayCodes: ExtractedRotaPerson['dayCodes']): ExtractedRotaPerson => ({ ref: 'r0', staffKey: 'A', dayCodes })

describe('unmappedCodes', () => {
  it('lists codes the dictionary does not cover', () => {
    expect(unmappedCodes([{ code: 'SD', count: 3 }, { code: 'ZZ', count: 1 }], config)).toEqual(['ZZ'])
    expect(unmappedCodes([{ code: 'SD', count: 3 }], config)).toEqual([])
  })
})

describe('buildDayTemplates', () => {
  const range = { from: '2026-10-05', to: '2026-10-08' }

  it('builds timed, whole-day, ignored and unknown days', () => {
    const { days, templates } = buildDayTemplates(
      person({ '2026-10-05': [{ code: 'SD' }], '2026-10-06': [{ code: 'AL' }], '2026-10-07': [{ code: 'NOTE' }] }),
      config,
      range
    )
    expect(days).toBe('01..')
    expect(templates).toEqual({ '0': [['08:00', '17:00', 'A']], '1': [['00:00', '24:00', 'L']] })
  })

  it('lets any non-A code in a multi-code cell win', () => {
    const { days, templates } = buildDayTemplates(person({ '2026-10-05': [{ code: 'SD' }, { code: 'OC' }] }), config, range)
    expect(templates[days[0]]).toEqual([['00:00', '24:00', 'D']])
    const leave = buildDayTemplates(person({ '2026-10-05': [{ code: 'SD' }, { code: 'AL' }] }), config, range)
    expect(leave.templates[leave.days[0]]).toEqual([['00:00', '24:00', 'L']])
  })

  it('splits a night across midnight', () => {
    const { days, templates } = buildDayTemplates(person({ '2026-10-05': [{ code: 'N' }] }), config, range)
    expect(templates[days[0]]).toEqual([['20:30', '24:00', 'N']])
    expect(templates[days[1]]).toEqual([['00:00', '09:30', 'N']])
    expect(days.slice(2)).toBe('..')
  })

  it('uses LONG-row times over dictionary defaults', () => {
    const { days, templates } = buildDayTemplates(person({ '2026-10-05': [{ code: 'SD', start: '09:00', end: '13:00' }] }), config, range)
    expect(templates[days[0]]).toEqual([['09:00', '13:00', 'A']])
  })

  it('infers post-night rest when the profile enables it', () => {
    const withRest = { ...config, postNight: { enabled: true, trigger: 'ANY' as const, restHours: 46 as const } }
    const { days, templates } = buildDayTemplates(person({ '2026-10-05': [{ code: 'N' }] }), withRest, range)
    expect(templates[days[1]]).toEqual([['00:00', '24:00', 'N']])
    expect(templates[days[3]]).toEqual([['00:00', '07:30', 'N']])
  })

  describe('post-night rest from the codes (O4)', () => {
    const rest = { enabled: true, trigger: 'ANY' as const, restHours: 46 as const }
    const withNights: RotaProfileConfig = {
      ...config,
      codes: {
        ...config.codes,
        NOC: { letter: 'D', start: '17:00', end: '09:00', night: true },
        NX: { letter: 'N' },
        NU: { letter: 'N', start: '21:00', end: '09:30' },
      },
      postNight: rest,
    }
    const week = { from: '2026-10-05', to: '2026-10-11' }
    const segments = (dayCodes: ExtractedRotaPerson['dayCodes']) => buildPersonDaySegments(person(dayCodes), withNights, week)

    it('gives rest after a night mapped to D and ticked Night', () => {
      const out = segments({ '2026-10-05': [{ code: 'NOC' }], '2026-10-06': [{ code: 'NOC' }] })
      // Second night ends Wed 09:00: rest to Fri 07:00.
      expect(out['2026-10-07']).toEqual([['00:00', '09:00', 'D'], ['09:00', '24:00', 'N']])
      expect(out['2026-10-08']).toEqual([['00:00', '24:00', 'N']])
      expect(out['2026-10-09']).toEqual([['00:00', '07:00', 'N']])
    })

    it('treats an untimed N as a whole rest day, not a night', () => {
      const out = segments({ '2026-10-05': [{ code: 'NX' }] })
      expect(out['2026-10-05']).toEqual([['00:00', '24:00', 'N']])
      expect(out['2026-10-06']).toEqual([])
    })

    it('treats a timed N crossing midnight as a night even without the tick', () => {
      const out = segments({ '2026-10-05': [{ code: 'NU' }] })
      expect(out['2026-10-07']).toEqual([['00:00', '24:00', 'N']])
      expect(out['2026-10-08']).toEqual([['00:00', '07:30', 'N']])
    })

    it('fills the daytime before a new night inside the rest window', () => {
      const out = segments({ '2026-10-05': [{ code: 'NU' }], '2026-10-06': [{ code: 'NU' }], '2026-10-08': [{ code: 'NU' }] })
      expect(out['2026-10-08']).toEqual([['00:00', '24:00', 'N']])
    })

    it('counts rest from the end of the night even when the morning has an explicit whole-day code', () => {
      const out = segments({ '2026-10-05': [{ code: 'NU' }], '2026-10-06': [{ code: 'OFF' }] })
      expect(out['2026-10-06']).toEqual([['00:00', '24:00', 'X']])
      expect(out['2026-10-07']).toEqual([['00:00', '24:00', 'N']])
      // Night ended Tue 09:30: rest to Thu 07:30 (not Wed 22:00).
      expect(out['2026-10-08']).toEqual([['00:00', '07:30', 'N']])
    })

    it('marks codes as nights only when ticked or a timed N crossing midnight', () => {
      expect(isNightCode({ letter: 'N' }, undefined, undefined)).toBe(false)
      expect(isNightCode({ letter: 'N' }, '21:00', '09:30')).toBe(true)
      expect(isNightCode({ letter: 'N' }, '08:00', '12:00')).toBe(false)
      expect(isNightCode({ letter: 'D', start: '17:00', end: '09:00' }, '17:00', '09:00')).toBe(false)
      expect(isNightCode({ letter: 'D', start: '17:00', end: '09:00', night: true }, '17:00', '09:00')).toBe(true)
      expect(isNightCode({ letter: 'A' }, '21:00', '09:00')).toBe(false)
    })
  })

  it('shares ids across people through a registry and refuses more than 62 patterns', () => {
    const registry = new RotaTemplateRegistry()
    const a = buildDayTemplates(person({ '2026-10-05': [{ code: 'SD' }] }), config, range, registry)
    const b = buildDayTemplates(person({ '2026-10-06': [{ code: 'SD' }] }), config, range, registry)
    expect(a.days[0]).toBe(b.days[1])
    const overflow = new RotaTemplateRegistry()
    expect(() => {
      for (let h = 0; h < 63; h++) {
        const start = `${String(Math.floor(h / 4)).padStart(2, '0')}:${String((h % 4) * 15).padStart(2, '0')}`
        overflow.intern([[start, '23:59', 'A']])
      }
    }).toThrow(RotaTemplateOverflowError)
  })
})

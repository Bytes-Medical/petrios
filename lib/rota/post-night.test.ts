import { describe, expect, it } from 'vitest'
import { applyPostNightRest, mergeDaySegments, type RotaNightInfo } from './post-night'
import { listDayKeys } from './schema'
import type { RotaSegment } from './types'

const NIGHT_EVENING: RotaSegment = ['20:30', '24:00', 'N']
const NIGHT_MORNING: RotaSegment = ['00:00', '09:30', 'N']

/** Nights 20:30–09:30 on the given days; returns merged days and the night info. */
function grid(from: string, to: string, nights: string[]): { byDay: Record<string, RotaSegment[]>; info: RotaNightInfo } {
  const raw: Record<string, RotaSegment[]> = {}
  for (const day of listDayKeys(from, to)) raw[day] = []
  const nightEnds = new Map<string, number>()
  for (const night of nights) {
    raw[night].push(NIGHT_EVENING)
    const days = Object.keys(raw)
    const next = days[days.indexOf(night) + 1]
    if (next) {
      raw[next].push(NIGHT_MORNING)
      nightEnds.set(next, 9 * 60 + 30)
    }
  }
  const byDay: Record<string, RotaSegment[]> = {}
  for (const day of Object.keys(raw)) byDay[day] = mergeDaySegments(raw[day])
  return { byDay, info: { nightStarts: new Set(nights), nightEnds, explicit: raw } }
}

const ANY = { enabled: true, trigger: 'ANY' as const, restHours: 46 as const }
const THREE = { ...ANY, trigger: 'THREE_OR_MORE' as const }

describe('mergeDaySegments', () => {
  it('lets any non-A letter win and makes L/X whole-day', () => {
    expect(mergeDaySegments([['00:00', '24:00', 'A'], ['08:00', '20:30', 'D']])).toEqual([
      ['00:00', '08:00', 'A'],
      ['08:00', '20:30', 'D'],
      ['20:30', '24:00', 'A'],
    ])
    expect(mergeDaySegments([['08:00', '17:00', 'A'], ['00:00', '24:00', 'L']])).toEqual([['00:00', '24:00', 'L']])
  })
})

describe('applyPostNightRest', () => {
  it('marks 46 h after a single night (ends D+1 09:30 → rest to D+3 07:30)', () => {
    const { byDay, info } = grid('2026-10-05', '2026-10-10', ['2026-10-05'])
    const result = applyPostNightRest(byDay, ANY, info)
    expect(result['2026-10-06']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-10-07']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-10-08']).toEqual([['00:00', '07:30', 'N']])
    expect(result['2026-10-09']).toEqual([])
  })

  it('applies after the last of three nights, and only for 3+ with THREE_OR_MORE', () => {
    const nights = ['2026-10-05', '2026-10-06', '2026-10-07']
    const run = grid('2026-10-05', '2026-10-12', nights)
    const any = applyPostNightRest(run.byDay, ANY, run.info)
    expect(any['2026-10-10']).toEqual([['00:00', '07:30', 'N']])
    const three = applyPostNightRest(run.byDay, THREE, run.info)
    expect(three['2026-10-10']).toEqual([['00:00', '07:30', 'N']])

    const single = grid('2026-10-05', '2026-10-12', ['2026-10-05'])
    expect(applyPostNightRest(single.byDay, THREE, single.info)['2026-10-07']).toEqual([])
  })

  it('never overwrites the minutes an explicit code covers, and fills the rest of that day', () => {
    const { byDay, info } = grid('2026-10-05', '2026-10-10', ['2026-10-05'])
    byDay['2026-10-07'] = [['08:00', '17:00', 'A']]
    const explicit = { ...info.explicit, '2026-10-07': [['08:00', '17:00', 'A']] as RotaSegment[] }
    const result = applyPostNightRest(byDay, ANY, { ...info, explicit })
    expect(result['2026-10-07']).toEqual([
      ['00:00', '08:00', 'N'],
      ['08:00', '17:00', 'A'],
      ['17:00', '24:00', 'N'],
    ])
    expect(result['2026-10-08']).toEqual([['00:00', '07:30', 'N']])
  })

  it('keeps rest on the daytime of a new night that starts inside the rest window', () => {
    // Nights Mon 5 and Tue 6 (to 09:30), then Thu 8: rest runs Wed 09:30 → Fri 07:30.
    const { byDay, info } = grid('2026-10-05', '2026-10-11', ['2026-10-05', '2026-10-06', '2026-10-08'])
    const result = applyPostNightRest(byDay, ANY, info)
    expect(result['2026-10-07']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-10-08']).toEqual([['00:00', '24:00', 'N']])
    // After Thursday's night (ends Fri 09:30) a new rest runs to Sun 07:30.
    expect(result['2026-10-10']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-10-11']).toEqual([['00:00', '07:30', 'N']])
  })

  it('crosses a month end', () => {
    const { byDay, info } = grid('2026-10-30', '2026-11-03', ['2026-10-31'])
    const result = applyPostNightRest(byDay, ANY, info)
    expect(result['2026-11-01']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-11-02']).toEqual([['00:00', '24:00', 'N']])
    expect(result['2026-11-03']).toEqual([['00:00', '07:30', 'N']])
  })

  it('uses wall-clock hours across a DST change (documented ±1 h)', () => {
    // Night 24/25 Oct 2026 (clocks go back on the 25th): wall-clock rest still ends at 07:30.
    const { byDay, info } = grid('2026-10-24', '2026-10-28', ['2026-10-24'])
    const result = applyPostNightRest(byDay, ANY, info)
    expect(result['2026-10-27']).toEqual([['00:00', '07:30', 'N']])
  })

  it('does nothing when disabled', () => {
    const { byDay, info } = grid('2026-10-05', '2026-10-08', ['2026-10-05'])
    expect(applyPostNightRest(byDay, { ...ANY, enabled: false }, info)).toEqual(byDay)
  })
})

import { appTimeZone, appWallClockToIso } from '@/lib/datetime'
import { addDaysToKey, UNKNOWN_DAY } from './schema'
import type { RotaLetter, RotaSegment } from './types'

/**
 * Template days → absolute intervals (spec/14). Server-side: segment times
 * are wall-clock times in APP_TIME_ZONE and are converted with
 * appWallClockToIso, so DST days are handled (a spring-forward day is 23 h,
 * a fall-back day 25 h). "24:00" is the next day's 00:00. Minutes no segment
 * covers are absent (unknown), never "not working".
 */

export interface RotaInterval {
  startMs: number
  endMs: number
  letter: RotaLetter
}

// Per-isolate memo: one upload converts the same few (day, time) pairs for
// every person. Keyed with the zone so a changed APP_TIME_ZONE never reuses.
const instantCache = new Map<string, number>()
const INSTANT_CACHE_MAX = 20_000

function instant(day: string, time: string): number {
  const local = time === '24:00' ? `${addDaysToKey(day, 1)}T00:00` : `${day}T${time}`
  const key = `${appTimeZone()}|${local}`
  const cached = instantCache.get(key)
  if (cached !== undefined) return cached
  const value = Date.parse(appWallClockToIso(local))
  if (instantCache.size >= INSTANT_CACHE_MAX) instantCache.clear()
  instantCache.set(key, value)
  return value
}

export function expandPersonDays(
  days: string,
  templates: Record<string, RotaSegment[]>,
  range: { from: string }
): RotaInterval[] {
  const intervals: RotaInterval[] = []
  for (let i = 0; i < days.length; i++) {
    const id = days[i]
    if (id === UNKNOWN_DAY) continue
    const segments = templates[id]
    if (!segments) continue
    const day = addDaysToKey(range.from, i)
    for (const [start, end, letter] of segments) {
      const startMs = instant(day, start)
      const endMs = instant(day, end)
      if (endMs > startMs) intervals.push({ startMs, endMs, letter })
    }
  }
  return intervals
}

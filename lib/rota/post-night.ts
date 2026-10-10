import type { RotaProfileConfig } from './profile'
import { addDaysToKey, timeToMinutes } from './schema'
import type { RotaLetter, RotaSegment } from './types'

/**
 * Post-night rest inference (spec/14, O4). Runs in the coordinator's browser.
 *
 * A night is a day on which a night shift STARTS: a code ticked "Night" in
 * the dictionary (mapped to N or D, with times), or a timed N code that
 * crosses midnight. The caller (dictionary.ts) works this out from the codes
 * themselves, never from the merged segment shape, so an explicit code on the
 * following morning cannot hide a night. Consecutive night days form a run.
 * The run ends when the last night's shift ends on the following morning, or
 * at 24:00 of the last night when it does not cross midnight. After the run,
 * N is marked from that end for `restHours` (46) using WALL-CLOCK arithmetic:
 * across a DST change the rest is ±1 hour (documented in spec/14 and
 * docs/rota.md).
 *
 * trigger ANY marks rest after every run; THREE_OR_MORE only after runs of 3+
 * nights. Explicit codes win only on the minutes they cover: inferred rest
 * fills the rest of the day, so a new night starting inside the rest window
 * still leaves its daytime hours as rest.
 */

export interface RotaNightInfo {
  /** Days (YYYY-MM-DD) on which a night shift starts. */
  nightStarts: ReadonlySet<string>
  /** The minute a night ends on the following morning, keyed by that morning's day. */
  nightEnds: ReadonlyMap<string, number>
  /** Per day, the segments explicit codes cover (before merging); rest never overwrites them. */
  explicit: Readonly<Record<string, RotaSegment[]>>
}

const LETTER_PRIORITY: Record<RotaLetter, number> = { A: 1, D: 2, X: 3, L: 4, N: 5 }
const DAY_MINUTES = 1440

function endMinutes(value: string): number {
  return value === '24:00' ? DAY_MINUTES : timeToMinutes(value)
}

function minutesToTime(minutes: number): string {
  if (minutes >= DAY_MINUTES) return '24:00'
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Merges possibly overlapping segments of one day into sorted, non-overlapping
 * segments. Where segments overlap, any non-A letter wins over A (priority
 * N > L > X > D > A). A day containing L or X becomes that single whole-day
 * letter (L before X), as the payload schema requires.
 */
export function mergeDaySegments(segments: RotaSegment[]): RotaSegment[] {
  if (segments.length === 0) return []
  if (segments.some(([, , letter]) => letter === 'L')) return [['00:00', '24:00', 'L']]
  if (segments.some(([, , letter]) => letter === 'X')) return [['00:00', '24:00', 'X']]
  const minutes: (RotaLetter | null)[] = new Array(DAY_MINUTES).fill(null)
  for (const [start, end, letter] of segments) {
    const from = timeToMinutes(start)
    const to = endMinutes(end)
    for (let m = from; m < to; m++) {
      const current = minutes[m]
      if (!current || LETTER_PRIORITY[letter] > LETTER_PRIORITY[current]) minutes[m] = letter
    }
  }
  const merged: RotaSegment[] = []
  let m = 0
  while (m < DAY_MINUTES) {
    const letter = minutes[m]
    if (!letter) {
      m++
      continue
    }
    let end = m
    while (end < DAY_MINUTES && minutes[end] === letter) end++
    merged.push([minutesToTime(m), minutesToTime(end), letter])
    m = end
  }
  return merged
}

function coveredMinutes(segments: RotaSegment[] | undefined): boolean[] {
  const covered: boolean[] = new Array(DAY_MINUTES).fill(false)
  for (const [start, end] of segments ?? []) {
    for (let m = timeToMinutes(start); m < endMinutes(end); m++) covered[m] = true
  }
  return covered
}

/** The parts of [from, to) that no explicit code covers, as N segments. */
function uncoveredRest(from: number, to: number, covered: boolean[]): RotaSegment[] {
  const out: RotaSegment[] = []
  let m = from
  while (m < to) {
    if (covered[m]) {
      m++
      continue
    }
    let end = m
    while (end < to && !covered[end]) end++
    out.push([minutesToTime(m), minutesToTime(end), 'N'])
    m = end
  }
  return out
}

export function applyPostNightRest(
  byDay: Record<string, RotaSegment[]>,
  rule: RotaProfileConfig['postNight'],
  info: RotaNightInfo
): Record<string, RotaSegment[]> {
  const result: Record<string, RotaSegment[]> = {}
  for (const [day, segments] of Object.entries(byDay)) result[day] = [...segments]
  if (!rule.enabled) return result

  const days = Object.keys(byDay).sort()
  if (days.length === 0) return result
  const lastDay = days[days.length - 1]
  const restMinutes = rule.restHours * 60

  const rest: { day: string; from: number; to: number }[] = []
  let runLength = 0
  for (let day = days[0]; day <= lastDay; day = addDaysToKey(day, 1)) {
    if (info.nightStarts.has(day)) {
      runLength++
      continue
    }
    if (runLength > 0) {
      const lastNight = addDaysToKey(day, -1)
      const triggered = rule.trigger === 'ANY' || runLength >= 3
      if (triggered) {
        // The run ends on `day` (the last night's morning) or at 24:00 of the last night.
        const morning = info.nightEnds.get(day)
        const hasMorning = morning !== undefined && morning > 0 && morning < DAY_MINUTES
        let cursorDay = hasMorning ? day : lastNight
        let cursorMin = hasMorning ? morning : DAY_MINUTES
        let remaining = restMinutes
        while (remaining > 0) {
          if (cursorMin >= DAY_MINUTES) {
            cursorDay = addDaysToKey(cursorDay, 1)
            cursorMin = 0
            continue
          }
          const span = Math.min(remaining, DAY_MINUTES - cursorMin)
          rest.push({ day: cursorDay, from: cursorMin, to: cursorMin + span })
          remaining -= span
          cursorMin += span
        }
      }
      runLength = 0
    }
  }

  const coverage = new Map<string, boolean[]>()
  for (const { day, from, to } of rest) {
    if (day > lastDay || !(day in result)) continue
    let covered = coverage.get(day)
    if (!covered) {
      covered = coveredMinutes(info.explicit[day])
      coverage.set(day, covered)
    }
    const pieces = uncoveredRest(from, to, covered)
    if (pieces.length === 0) continue
    result[day] = mergeDaySegments([...(result[day] ?? []), ...pieces])
  }
  return result
}
